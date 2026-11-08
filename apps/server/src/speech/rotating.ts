import { AUDIO_BYTES_PER_MS, LIVE, type Ms } from '@constellate/shared';
import type { SpeechAdapter, SpeechEvents, SpeechSegment } from './types';

/**
 * One upstream provider connection (e.g. one Gemini Live session). The rotating adapter owns
 * several of these over the life of a conversation.
 */
export interface Upstream {
  /** resolves once the connection is open; `onClosed` fires on an unexpected close */
  start(onSegment: (s: SpeechSegment) => void, onClosed: (reason: string) => void): Promise<void>;
  push(pcm: Buffer): void;
  /** signal end of audio, wait briefly for the last final, close */
  stop(): Promise<void>;
  /** false while the connection is not open or is backed up */
  writable(): boolean;
  /** an interim hypothesis is open: someone is mid-utterance */
  hasOpenUtterance(): boolean;
  /** audio clock of the last interim or final text received, null if none yet */
  lastTextAtMs(): Ms | null;
}

export type UpstreamFactory = () => Upstream;

export type RotationLimits = Record<'rotateAfterMs' | 'rotateHardMs' | 'rotateGapMs' | 'maxBufferMs', number>;

export interface RotatingOptions extends SpeechEvents {
  factory: UpstreamFactory;
  /** the session's audio clock */
  nowMs(): Ms;
  limits?: RotationLimits;
  /** real time before `onReconnecting` fires (PLAN: 1 s) */
  reconnectNoticeMs?: number;
  /** retry delays when opening an upstream fails */
  retryDelaysMs?: number[];
}

/**
 * Speech adapter that survives the provider's 10-minute session cap and upstream failures.
 *
 *  - Rotation: after `rotateAfterMs` of audio on one upstream, rotate at the first gap of
 *    `rotateGapMs` with no open interim; rotate regardless at `rotateHardMs`. The new upstream is
 *    opened first, PCM switches to it, then the old one is stopped (flushing its last final).
 *  - Backpressure: while no upstream is writable, PCM is buffered up to `maxBufferMs`; beyond that
 *    the oldest frames are dropped and logged.
 *  - `onReconnecting` fires only if a switch takes longer than `reconnectNoticeMs`.
 */
export class RotatingSpeechAdapter implements SpeechAdapter {
  private current: Upstream | null = null;
  private startedAtMs: Ms = 0;
  private buffer: Buffer[] = [];
  private bufferedBytes = 0;
  private rotation: Promise<void> | null = null;
  private stopping = false;
  private onSegment: (s: SpeechSegment) => void = () => {};
  private readonly limits: RotationLimits;
  private unloggedDrop = 0;
  private lastDropLog = 0;
  private wake: (() => void) | null = null;
  droppedBytes = 0;
  rotations = 0;

  constructor(private readonly opts: RotatingOptions) {
    this.limits = opts.limits ?? LIVE;
  }

  async start(onSegment: (s: SpeechSegment) => void): Promise<void> {
    this.onSegment = onSegment;
    const up = this.opts.factory();
    await up.start(onSegment, (reason) => this.handleClosed(up, reason));
    this.current = up;
    this.startedAtMs = this.opts.nowMs();
  }

  push(pcm: Buffer): void {
    if (this.stopping) return;
    this.buffer.push(pcm);
    this.bufferedBytes += pcm.length;
    const max = this.limits.maxBufferMs * AUDIO_BYTES_PER_MS;
    let dropped = 0;
    while (this.bufferedBytes > max && this.buffer.length > 1) {
      const old = this.buffer.shift()!;
      this.bufferedBytes -= old.length;
      dropped += old.length;
    }
    if (dropped) {
      this.droppedBytes += dropped;
      this.unloggedDrop += dropped;
      const now = Date.now();
      if (now - this.lastDropLog >= 1_000) {
        // at most once a second, with the total since the last line
        this.opts.log?.('speech.backpressure.drop', { droppedMs: this.unloggedDrop / AUDIO_BYTES_PER_MS });
        this.unloggedDrop = 0;
        this.lastDropLog = now;
      }
    }
    this.drain();
    this.maybeRotate();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    if (this.rotation) await this.rotation;
    this.drain();
    const up = this.current;
    this.current = null;
    if (up) await up.stop();
  }

  private drain(): void {
    const up = this.current;
    if (!up) return;
    while (this.buffer.length && up.writable()) {
      const chunk = this.buffer.shift()!;
      this.bufferedBytes -= chunk.length;
      up.push(chunk);
    }
  }

  private maybeRotate(): void {
    const up = this.current;
    if (!up || this.rotation || this.stopping) return;
    const now = this.opts.nowMs();
    const elapsed = now - this.startedAtMs;
    if (elapsed >= this.limits.rotateHardMs) {
      this.rotate('hard');
      return;
    }
    if (elapsed < this.limits.rotateAfterMs) return;
    const lastText = up.lastTextAtMs() ?? this.startedAtMs;
    if (!up.hasOpenUtterance() && now - lastText >= this.limits.rotateGapMs) this.rotate('gap');
  }

  private handleClosed(up: Upstream, reason: string): void {
    if (this.stopping || up !== this.current) return;
    this.opts.log?.('speech.upstream.closed', { reason });
    this.current = null; // audio buffers until the replacement is open
    if (!this.rotation) this.rotate('reconnect');
  }

  private rotate(why: 'gap' | 'hard' | 'reconnect'): void {
    this.rotation = this.doRotate(why).finally(() => {
      this.rotation = null;
    });
  }

  private async doRotate(why: string): Promise<void> {
    let noticed = false;
    const notice = setTimeout(() => {
      noticed = true;
      this.opts.onReconnecting?.();
    }, this.opts.reconnectNoticeMs ?? 1_000);
    const delays = this.opts.retryDelaysMs ?? [250, 500, 1_000, 2_000, 4_000];
    let rateLimitNoticeSent = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const next = this.opts.factory();
        try {
          await next.start(this.onSegment, (reason) => this.handleClosed(next, reason));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const retryAfterMs = (err as { retryAfterMs?: unknown }).retryAfterMs;
          if (typeof retryAfterMs === 'number' && !this.stopping) {
            // quota: back off as told and keep trying (the old upstream, if any, keeps transcribing)
            if (!rateLimitNoticeSent) this.opts.onError?.('speech provider is rate-limited; retrying', false);
            rateLimitNoticeSent = true;
            this.opts.log?.('speech.upstream.rate_limited', { retryAfterMs });
            await this.sleep(retryAfterMs);
            if (this.stopping) return;
            attempt--;
            continue;
          }
          this.opts.log?.('speech.upstream.open_failed', { attempt, message });
          if (attempt >= delays.length || this.stopping) {
            this.opts.onError?.(`speech provider unavailable: ${message}`, false);
            return;
          }
          await this.sleep(delays[attempt]!);
          continue;
        }
        const old = this.current;
        this.current = next;
        this.startedAtMs = this.opts.nowMs();
        this.rotations++;
        this.opts.log?.('speech.rotated', { why, attempt });
        this.drain();
        if (old) await old.stop();
        return;
      }
    } finally {
      clearTimeout(notice);
      if (noticed) this.opts.onRecovered?.();
    }
  }

  /** setTimeout that `stop()` cuts short */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }
}
