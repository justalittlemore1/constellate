import type { SpeechAdapter, SpeechSegment } from './types';

/**
 * Test adapter. Records pushed audio and lets the test emit segments by hand.
 * `pushedBytes` counts every byte received so tests can check nothing was dropped.
 */
export class FakeAdapter implements SpeechAdapter {
  pushedBytes = 0;
  started = false;
  stopped = false;
  private onSegment: ((s: SpeechSegment) => void) | null = null;
  /** segments emitted during stop(), to model a provider flushing its last final */
  flushOnStop: SpeechSegment[] = [];

  async start(onSegment: (s: SpeechSegment) => void): Promise<void> {
    this.onSegment = onSegment;
    this.started = true;
  }

  push(pcm: Buffer): void {
    if (this.stopped) throw new Error('push after stop');
    this.pushedBytes += pcm.length;
  }

  emit(s: Partial<SpeechSegment> & { text: string }): void {
    if (!this.onSegment) throw new Error('FakeAdapter not started');
    this.onSegment({ final: true, startMs: 0, endMs: 0, speaker: null, ...s });
  }

  async stop(): Promise<void> {
    for (const s of this.flushOnStop) this.onSegment?.(s);
    this.stopped = true;
  }
}
