import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { AUDIO_SAMPLE_RATE, MODELS, type Ms } from '@constellate/shared';
import type { SpeechSegment } from './types';
import type { Upstream } from './rotating';

/** PLAN: the live model has no word timestamps; start = clock at first interim − 300 ms. */
export const LIVE_START_LEAD_MS = 300;
/** used to estimate a start time when a final arrives with no interim before it */
export const EST_MS_PER_WORD = 350;

/**
 * Turns the provider's untimed interim/final texts into timed segments on the audio clock.
 * Pure apart from the injected clock, so it is unit-tested directly.
 */
export class LiveUtteranceTimer {
  private firstInterimAt: Ms | null = null;
  private lastEnd: Ms = 0;
  private lastText: Ms | null = null;

  constructor(private readonly nowMs: () => Ms) {}

  interim(text: string): SpeechSegment {
    const now = this.nowMs();
    if (this.firstInterimAt === null) this.firstInterimAt = now;
    this.lastText = now;
    return { text, final: false, startMs: this.startFrom(this.firstInterimAt), endMs: now, speaker: null };
  }

  final(text: string): SpeechSegment {
    const now = this.nowMs();
    const startMs =
      this.firstInterimAt !== null
        ? this.startFrom(this.firstInterimAt)
        : Math.max(this.lastEnd, now - text.split(/\s+/).length * EST_MS_PER_WORD);
    this.firstInterimAt = null;
    this.lastEnd = now;
    this.lastText = now;
    return { text, final: true, startMs: Math.min(startMs, now), endMs: now, speaker: null };
  }

  hasOpenUtterance(): boolean {
    return this.firstInterimAt !== null;
  }

  lastTextAtMs(): Ms | null {
    return this.lastText;
  }

  private startFrom(firstInterim: Ms): Ms {
    return Math.max(0, this.lastEnd, firstInterim - LIVE_START_LEAD_MS);
  }
}

export interface GeminiLiveOptions {
  ai: GoogleGenAI;
  nowMs(): Ms;
  log?(event: string, data?: Record<string, unknown>): void;
  /** how long stop() waits for the final of an open utterance */
  flushTimeoutMs?: number;
}

/** One Gemini Live transcription session (`MODELS.sttLive`), capped at 10 minutes by the provider. */
export class GeminiLiveUpstream implements Upstream {
  private session: Session | null = null;
  private open = false;
  private stopping = false;
  private readonly timer: LiveUtteranceTimer;
  private onSegment: (s: SpeechSegment) => void = () => {};
  private finalWaiter: (() => void) | null = null;

  constructor(private readonly opts: GeminiLiveOptions) {
    this.timer = new LiveUtteranceTimer(opts.nowMs);
  }

  async start(onSegment: (s: SpeechSegment) => void, onClosed: (reason: string) => void): Promise<void> {
    this.onSegment = onSegment;
    this.session = await this.opts.ai.live.connect({
      model: MODELS.sttLive,
      config: {
        responseModalities: [Modality.TEXT],
        inputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (m) => this.handle(m),
        onerror: (e) => this.opts.log?.('speech.gemini.error', { message: String(e?.message ?? e) }),
        onclose: (e) => {
          this.open = false;
          this.finalWaiter?.();
          if (!this.stopping) onClosed(e?.reason || 'closed');
        },
      },
    });
    this.open = true;
  }

  handle(m: LiveServerMessage): void {
    const sc = m.serverContent;
    const interim = sc?.interimInputTranscription?.text?.trim();
    if (interim) this.onSegment(this.timer.interim(interim));
    const final = sc?.inputTranscription?.text?.trim();
    if (final) {
      this.onSegment(this.timer.final(final));
      this.finalWaiter?.();
    }
  }

  push(pcm: Buffer): void {
    if (!this.session || !this.open) return;
    this.session.sendRealtimeInput({
      audio: { data: pcm.toString('base64'), mimeType: `audio/pcm;rate=${AUDIO_SAMPLE_RATE}` },
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const s = this.session;
    if (!s) return;
    if (this.open) {
      try {
        s.sendRealtimeInput({ audioStreamEnd: true });
      } catch {
        // connection already gone
      }
      if (this.timer.hasOpenUtterance()) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.opts.flushTimeoutMs ?? 1_500);
          this.finalWaiter = () => {
            clearTimeout(t);
            resolve();
          };
        });
      }
    }
    this.open = false;
    try {
      s.close();
    } catch {
      // ignore
    }
  }

  writable(): boolean {
    return this.open;
  }

  hasOpenUtterance(): boolean {
    return this.timer.hasOpenUtterance();
  }

  lastTextAtMs(): Ms | null {
    return this.timer.lastTextAtMs();
  }
}
