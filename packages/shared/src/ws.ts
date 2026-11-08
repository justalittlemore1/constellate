/**
 * WebSocket protocol between apps/web and apps/server (path: /live).
 * JSON text frames for messages; audio as binary frames.
 */
import type { FlagSource } from './domain';
import type { OpBatch } from './ops';

/** Audio wire format: PCM signed 16-bit little-endian, 16 kHz, mono. */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_BYTES_PER_MS = 32; // 16,000 samples/s × 2 bytes ÷ 1000
export const AUDIO_FRAME_MS = 100;
export const AUDIO_FRAME_BYTES = AUDIO_FRAME_MS * AUDIO_BYTES_PER_MS; // 3,200

export type LiveSource = 'mic' | 'replay-transcript';

export type ClientMsg =
  | {
      t: 'hello';
      /** Supabase access token */
      token: string;
      source: LiveSource;
      /** transcript fixture id when source = 'replay-transcript' */
      fixture?: string;
      /** set when reconnecting to an existing conversation */
      conversationId?: string;
      /** audio clock to resume from when reconnecting */
      resumeAtMs?: number;
      consent: true;
    }
  | {
      t: 'flag';
      atMs: number;
      source: FlagSource;
      /** optional note typed with the flag: 1–140 chars after trimming; stored as Flag.note */
      note?: string;
    }
  | { t: 'park'; text: string; atMs: number }
  | { t: 'stop' }
  | { t: 'ping' };

export type LiveStage = 'listening' | 'thinking' | 'reconnecting-stt' | 'finalizing';
export type ServerErrorCode = 'auth' | 'stt' | 'llm' | 'db' | 'protocol';

export type ServerMsg =
  | { t: 'ready'; conversationId: string }
  | { t: 'caption'; text: string; final: boolean; utteranceId?: string; startMs: number }
  | { t: 'ops'; batch: OpBatch }
  | { t: 'status'; stage: LiveStage }
  | { t: 'error'; code: ServerErrorCode; message: string; fatal: boolean }
  | { t: 'stopped'; conversationId: string }
  | { t: 'pong' };
