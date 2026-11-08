import { describe, expect, it, vi } from 'vitest';
import { AUDIO_BYTES_PER_MS, AUDIO_FRAME_BYTES } from '@constellate/shared';
import { LiveUtteranceTimer, GeminiLiveUpstream } from './gemini-live';
import { RotatingSpeechAdapter, type Upstream } from './rotating';
import { loadTranscriptFixture, TranscriptReplayAdapter, FixtureNotFoundError } from './replay';
import type { SpeechSegment } from './types';

/**
 * Fake upstream: every 1,000 ms of audio it receives becomes one final segment "c<k>". Audio that
 * has not reached 1,000 ms is flushed as a final on stop(), like a provider finishing an utterance.
 * While a chunk is partially filled it reports an open interim.
 */
class ChunkingUpstream implements Upstream {
  static all: ChunkingUpstream[] = [];
  /** silence: audio arrives but no speech is recognised */
  static silent = false;
  received = 0;
  private partial = 0;
  private onSegment: (s: SpeechSegment) => void = () => {};
  private closed: (reason: string) => void = () => {};
  isOpen = false;
  stalled = false;
  lastText: number | null = null;
  constructor(
    private readonly counter: { n: number },
    private readonly nowMs: () => number,
    private readonly chunkMs = 1_000,
  ) {
    ChunkingUpstream.all.push(this);
  }
  async start(onSegment: (s: SpeechSegment) => void, onClosed: (r: string) => void) {
    this.onSegment = onSegment;
    this.closed = onClosed;
    this.isOpen = true;
  }
  push(pcm: Buffer) {
    if (!this.isOpen) throw new Error('push to closed upstream');
    this.received += pcm.length;
    if (ChunkingUpstream.silent) return;
    this.partial += pcm.length;
    if (this.partial >= this.chunkMs * AUDIO_BYTES_PER_MS) this.flush();
  }
  private flush() {
    if (this.partial === 0) return;
    this.partial = 0;
    this.lastText = this.nowMs();
    this.onSegment({ text: `c${++this.counter.n}`, final: true, startMs: 0, endMs: this.nowMs(), speaker: null });
  }
  async stop() {
    this.flush();
    this.isOpen = false;
  }
  writable() {
    return this.isOpen && !this.stalled;
  }
  hasOpenUtterance() {
    return this.partial > 0;
  }
  lastTextAtMs() {
    return this.lastText;
  }
  dropConnection() {
    this.isOpen = false;
    this.closed('network');
  }
}

const tick = () => new Promise((r) => setImmediate(r));

function setup(
  limits = { rotateAfterMs: 4_000, rotateHardMs: 5_000, rotateGapMs: 700, maxBufferMs: 5_000 },
  chunkMs = 1_000,
) {
  ChunkingUpstream.all = [];
  let bytes = 0;
  const nowMs = () => bytes / AUDIO_BYTES_PER_MS;
  const counter = { n: 0 };
  const segments: SpeechSegment[] = [];
  const adapter = new RotatingSpeechAdapter({
    factory: () => new ChunkingUpstream(counter, nowMs, chunkMs),
    nowMs,
    limits,
    retryDelaysMs: [1, 1, 1],
  });
  const pushFrames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      bytes += AUDIO_FRAME_BYTES;
      adapter.push(Buffer.alloc(AUDIO_FRAME_BYTES));
      await tick();
    }
  };
  return { adapter, segments, pushFrames, counter, totalBytes: () => bytes };
}

describe('RotatingSpeechAdapter', () => {
  it('rotates under a 5 s cap and loses no audio or utterance', async () => {
    // chunks of 1,300 ms never align with frame boundaries, so rotations happen mid-utterance
    const { adapter, segments, pushFrames, totalBytes } = setup(undefined, 1_300);
    await adapter.start((s) => segments.push(s));
    await pushFrames(170); // 17 s of audio
    await adapter.stop();

    expect(adapter.rotations).toBeGreaterThanOrEqual(3);
    const received = ChunkingUpstream.all.reduce((sum, u) => sum + u.received, 0);
    expect(received).toBe(totalBytes());
    expect(adapter.droppedBytes).toBe(0);
    // every chunk id appears exactly once and in order
    const ids = segments.map((s) => Number(s.text.slice(1)));
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    // no upstream lived longer than the hard cap
    for (const u of ChunkingUpstream.all)
      expect(u.received).toBeLessThanOrEqual(5_000 * AUDIO_BYTES_PER_MS + AUDIO_FRAME_BYTES);
  });

  it('prefers a quiet gap after rotateAfterMs but waits while an utterance is open', async () => {
    // a 4,500 ms chunk keeps an interim open from 4 s to 4.5 s; with a 700 ms gap rule rotation
    // cannot happen before 5.2 s, so the hard cap (6 s here) is not what triggers it
    const { adapter, segments, pushFrames } = setup(
      { rotateAfterMs: 4_000, rotateHardMs: 6_000, rotateGapMs: 700, maxBufferMs: 5_000 },
      4_500,
    );
    await adapter.start((s) => segments.push(s));
    await pushFrames(45); // 4.5 s → first final at 4.5 s
    expect(adapter.rotations).toBe(0);
    await pushFrames(1); // 4.6 s: new chunk open (partial > 0) → no rotation
    expect(adapter.rotations).toBe(0);
    await pushFrames(15); // 6.1 s: hard cap forces it
    await adapter.stop();
    expect(adapter.rotations).toBe(1);
  });

  it('rotates at a silent gap once rotateAfterMs has passed', async () => {
    const { adapter, pushFrames } = setup({
      rotateAfterMs: 2_000,
      rotateHardMs: 60_000,
      rotateGapMs: 700,
      maxBufferMs: 5_000,
    });
    ChunkingUpstream.silent = true;
    try {
      await adapter.start(() => {});
      await pushFrames(19);
      expect(adapter.rotations).toBe(0);
      await pushFrames(2); // 2.1 s, silence since start → rotate
      await adapter.stop();
      expect(adapter.rotations).toBe(1);
    } finally {
      ChunkingUpstream.silent = false;
    }
  });

  it('buffers up to 5 s while the upstream stalls, then drops the oldest audio', async () => {
    const log = vi.fn();
    ChunkingUpstream.all = [];
    let bytes = 0;
    const nowMs = () => bytes / AUDIO_BYTES_PER_MS;
    const adapter = new RotatingSpeechAdapter({
      factory: () => new ChunkingUpstream({ n: 0 }, nowMs),
      nowMs,
      limits: { rotateAfterMs: 1e9, rotateHardMs: 1e9, rotateGapMs: 700, maxBufferMs: 5_000 },
      log,
    });
    await adapter.start(() => {});
    const up = ChunkingUpstream.all[0]!;
    up.stalled = true;
    for (let i = 0; i < 70; i++) {
      bytes += AUDIO_FRAME_BYTES;
      adapter.push(Buffer.alloc(AUDIO_FRAME_BYTES));
    }
    expect(up.received).toBe(0);
    expect(adapter.droppedBytes).toBe(20 * AUDIO_FRAME_BYTES); // 7 s pushed, 5 s kept
    expect(log).toHaveBeenCalledWith('speech.backpressure.drop', expect.any(Object));
    up.stalled = false;
    await adapter.stop();
    expect(up.received).toBe(50 * AUDIO_FRAME_BYTES);
  });

  it('reconnects after an unexpected upstream close without losing buffered audio', async () => {
    const { adapter, pushFrames, totalBytes } = setup({
      rotateAfterMs: 1e9,
      rotateHardMs: 1e9,
      rotateGapMs: 700,
      maxBufferMs: 5_000,
    });
    await adapter.start(() => {});
    await pushFrames(5);
    const first = ChunkingUpstream.all[0]!;
    first.dropConnection();
    await pushFrames(10);
    await adapter.stop();
    expect(ChunkingUpstream.all.length).toBe(2);
    const received = ChunkingUpstream.all.reduce((sum, u) => sum + u.received, 0);
    expect(received).toBe(totalBytes());
  });

  it('signals reconnecting only when a switch takes longer than the notice delay', async () => {
    let bytes = 0;
    const nowMs = () => bytes / AUDIO_BYTES_PER_MS;
    const onReconnecting = vi.fn();
    const onRecovered = vi.fn();
    let n = 0;
    const quick = new RotatingSpeechAdapter({
      factory: () => new ChunkingUpstream({ n: 0 }, nowMs),
      nowMs,
      limits: { rotateAfterMs: 100, rotateHardMs: 200, rotateGapMs: 0, maxBufferMs: 5_000 },
      reconnectNoticeMs: 10,
      onReconnecting,
      onRecovered,
    });
    bytes = 0;
    await quick.start(() => {});
    bytes += 300 * AUDIO_BYTES_PER_MS;
    quick.push(Buffer.alloc(AUDIO_FRAME_BYTES));
    await quick.stop();
    expect(onReconnecting).not.toHaveBeenCalled();

    n = 0;
    const slow = new RotatingSpeechAdapter({
      factory: () => {
        const u = new ChunkingUpstream({ n: 0 }, nowMs);
        if (n++ === 1) {
          const start = u.start.bind(u);
          u.start = async (a, b) => {
            await new Promise((r) => setTimeout(r, 40));
            return start(a, b);
          };
        }
        return u;
      },
      nowMs,
      limits: { rotateAfterMs: 100, rotateHardMs: 200, rotateGapMs: 0, maxBufferMs: 5_000 },
      reconnectNoticeMs: 10,
      onReconnecting,
      onRecovered,
    });
    bytes = 0;
    await slow.start(() => {});
    bytes += 300 * AUDIO_BYTES_PER_MS;
    slow.push(Buffer.alloc(AUDIO_FRAME_BYTES));
    await slow.stop();
    expect(onReconnecting).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
});

describe('LiveUtteranceTimer', () => {
  it('starts 300 ms before the first interim and ends at the final', () => {
    let now = 0;
    const t = new LiveUtteranceTimer(() => now);
    now = 2_000;
    expect(t.interim('hello')).toMatchObject({ final: false, startMs: 1_700, endMs: 2_000 });
    now = 2_600;
    t.interim('hello there');
    expect(t.hasOpenUtterance()).toBe(true);
    now = 3_400;
    expect(t.final('Hello there.')).toMatchObject({ final: true, startMs: 1_700, endMs: 3_400 });
    expect(t.hasOpenUtterance()).toBe(false);
    expect(t.lastTextAtMs()).toBe(3_400);
  });

  it('never starts before the previous utterance ended', () => {
    let now = 1_000;
    const t = new LiveUtteranceTimer(() => now);
    t.final('one two');
    now = 1_100;
    expect(t.interim('three').startMs).toBe(1_000);
  });

  it('estimates a start from word count when a final arrives with no interim', () => {
    let now = 10_000;
    const t = new LiveUtteranceTimer(() => now);
    expect(t.final('one two three four').startMs).toBe(10_000 - 4 * 350);
    now = 10_500;
    expect(t.final('a b c d e f').startMs).toBe(10_000);
  });
});

describe('GeminiLiveUpstream message handling', () => {
  it('maps interim and final transcriptions to timed segments', () => {
    let now = 5_000;
    const up = new GeminiLiveUpstream({ gateway: {} as never, nowMs: () => now });
    const out: SpeechSegment[] = [];
    (up as unknown as { onSegment: (s: SpeechSegment) => void }).onSegment = (s) => out.push(s);
    up.handle({ serverContent: { interimInputTranscription: { text: 'so the' } } } as never);
    now = 6_000;
    up.handle({ serverContent: { inputTranscription: { text: ' So the goalie. ' } } } as never);
    up.handle({ serverContent: { inputTranscription: { text: '   ' } } } as never);
    expect(out).toEqual([
      { text: 'so the', final: false, startMs: 4_700, endMs: 5_000, speaker: null },
      { text: 'So the goalie.', final: true, startMs: 4_700, endMs: 6_000, speaker: null },
    ]);
  });
});

describe('TranscriptReplayAdapter', () => {
  it('loads the format fixture and rejects ids that could escape the folder', async () => {
    const f = await loadTranscriptFixture('01-simple-shift');
    expect(f.utterances.length).toBeGreaterThan(5);
    await expect(loadTranscriptFixture('../../package')).rejects.toBeInstanceOf(FixtureNotFoundError);
    await expect(loadTranscriptFixture('does-not-exist')).rejects.toBeInstanceOf(FixtureNotFoundError);
  });

  it('emits interims then finals on the fixture timing, skipping what ended before a resume point', async () => {
    vi.useFakeTimers();
    try {
      const fixture = {
        id: 'x',
        title: 'x',
        description: 'x',
        speakers: ['A'],
        utterances: [
          { speaker: 0, startMs: 0, endMs: 900, text: 'already sent before the drop' },
          { speaker: 0, startMs: 10_000, endMs: 11_000, text: 'one two three four' },
          { speaker: 0, startMs: 11_200, endMs: 12_000, text: 'five' },
        ],
      };
      const done = vi.fn();
      const out: SpeechSegment[] = [];
      const a = new TranscriptReplayAdapter(fixture, { fromMs: 10_000, onDone: done });
      await a.start((s) => out.push(s));
      await vi.advanceTimersByTimeAsync(999);
      expect(out.map((s) => [s.text, s.final])).toEqual([['one two', false]]);
      await vi.advanceTimersByTimeAsync(1);
      expect(out[1]).toEqual({
        text: 'one two three four',
        final: true,
        startMs: 10_000,
        endMs: 11_000,
        speaker: null,
      });
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(out.at(-1)).toMatchObject({ text: 'five', final: true, startMs: 11_200, endMs: 12_000 });
      expect(done).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop cancels the remaining utterances', async () => {
    vi.useFakeTimers();
    try {
      const f = await loadTranscriptFixture('01-simple-shift');
      const out: SpeechSegment[] = [];
      const a = new TranscriptReplayAdapter(f);
      await a.start((s) => out.push(s));
      await vi.advanceTimersByTimeAsync(6_000);
      const n = out.length;
      await a.stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(out.length).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });
});
