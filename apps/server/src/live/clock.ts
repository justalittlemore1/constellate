import { AUDIO_BYTES_PER_MS, type Ms } from '@constellate/shared';

/**
 * The server audio clock: every timestamp in the system is ms on it.
 *  - `audio` mode (microphone, WAV replay): offset + bytes received ÷ 32
 *  - `wall` mode (transcript replay, no audio arrives): offset + elapsed real time × speed
 */
export class AudioClock {
  private bytes = 0;
  private t0: number;

  constructor(
    private readonly mode: 'audio' | 'wall',
    private offsetMs: Ms = 0,
    private readonly speed = 1,
    private readonly realNow: () => number = Date.now,
  ) {
    this.t0 = realNow();
  }

  addBytes(n: number): void {
    this.bytes += n;
  }

  nowMs(): Ms {
    if (this.mode === 'audio') return this.offsetMs + this.bytes / AUDIO_BYTES_PER_MS;
    return this.offsetMs + (this.realNow() - this.t0) * this.speed;
  }

  /** restart counting from `offsetMs` (reconnect / resume) */
  rebase(offsetMs: Ms): void {
    this.offsetMs = offsetMs;
    this.bytes = 0;
    this.t0 = this.realNow();
  }
}
