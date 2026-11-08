import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TranscriptFixtureSchema, type TranscriptFixture } from '@constellate/shared';
import type { SpeechAdapter, SpeechSegment } from './types';

const require = createRequire(import.meta.url);

/** Directory holding packages/shared/fixtures/transcripts/*.json. */
export function transcriptFixtureDir(): string {
  return path.join(path.dirname(require.resolve('@constellate/shared/fixtures/README.md')), 'transcripts');
}

const FIXTURE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class FixtureNotFoundError extends Error {}

/** Loads and validates a transcript fixture by id. Ids are restricted so they cannot escape the folder. */
export async function loadTranscriptFixture(id: string, dir = transcriptFixtureDir()): Promise<TranscriptFixture> {
  if (!FIXTURE_ID.test(id)) throw new FixtureNotFoundError(`invalid fixture id "${id}"`);
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `${id}.json`), 'utf8');
  } catch {
    throw new FixtureNotFoundError(`unknown fixture "${id}"`);
  }
  return TranscriptFixtureSchema.parse(JSON.parse(raw));
}

export interface ReplayOptions {
  /** 1 = original timing; tests use larger values */
  speed?: number;
  /** resume point: utterances that ended at or before it are skipped; timing is relative to it */
  fromMs?: number;
  /** called after the last utterance has been emitted */
  onDone?(): void;
}

/**
 * Emits a fixture's utterances on their original timing, skipping speech-to-text. Each utterance
 * produces an interim caption (first half of the words) halfway through, then the final at its end,
 * so the caption path is exercised exactly as with a live provider.
 */
export class TranscriptReplayAdapter implements SpeechAdapter {
  private timers: NodeJS.Timeout[] = [];
  private readonly speed: number;
  private readonly fromMs: number;

  constructor(
    private readonly fixture: TranscriptFixture,
    private readonly opts: ReplayOptions = {},
  ) {
    this.speed = opts.speed ?? 1;
    this.fromMs = opts.fromMs ?? 0;
  }

  async start(onSegment: (s: SpeechSegment) => void): Promise<void> {
    const at = (ms: number, fn: () => void) =>
      this.timers.push(setTimeout(fn, Math.max(0, ms - this.fromMs) / this.speed));
    const utterances = this.fixture.utterances.filter((u) => u.endMs > this.fromMs);
    utterances.forEach((u, i) => {
      const { startMs, endMs } = u;
      const words = u.text.split(/\s+/);
      if (words.length > 3) {
        at((u.startMs + u.endMs) / 2, () =>
          onSegment({
            text: words.slice(0, Math.ceil(words.length / 2)).join(' '),
            final: false,
            startMs,
            endMs: (startMs + endMs) / 2,
            speaker: null,
          }),
        );
      }
      at(u.endMs, () => {
        onSegment({ text: u.text, final: true, startMs, endMs, speaker: null });
        if (i === utterances.length - 1) this.opts.onDone?.();
      });
    });
    if (utterances.length === 0) this.opts.onDone?.();
  }

  push(): void {
    // audio is ignored in transcript replay
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
