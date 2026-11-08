import type { Ms } from '@constellate/shared';

/** One transcript result from a speech provider. Times are on the server audio clock. */
export interface SpeechSegment {
  text: string;
  final: boolean;
  startMs: Ms;
  endMs: Ms;
  speaker: number | null;
}

/** PLAN.md → Provider interfaces. Implementations live in this folder. */
export interface SpeechAdapter {
  start(onSegment: (s: SpeechSegment) => void): Promise<void>;
  /** PCM s16le, 16 kHz, mono */
  push(pcm: Buffer): void;
  /** flush pending finals, then close */
  stop(): Promise<void>;
}

/** Optional hooks the gateway passes to adapters that can fail or reconnect upstream. */
export interface SpeechEvents {
  /** the upstream switch is taking longer than 1 s (PLAN: send `status: reconnecting-stt`) */
  onReconnecting?(): void;
  /** the upstream is healthy again after `onReconnecting` */
  onRecovered?(): void;
  /** non-fatal provider problem worth surfacing (`error stt`) */
  onError?(message: string, fatal: boolean): void;
  log?(event: string, data?: Record<string, unknown>): void;
}
