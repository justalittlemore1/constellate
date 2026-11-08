/**
 * Hard daily cap on Gemini requests (AGENTS.md › API budget: the eval may make at most 150 embedding
 * requests per day). Counted from midnight Pacific and persisted to disk, so restarts and repeated
 * runs share one budget. Past the cap, `reserve` returns false and callers degrade.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVAL_EMBED_CAP_PER_DAY = 150;

/** Default ledger: git-ignored, next to the eval's other local files. */
export const DEFAULT_LEDGER = fileURLToPath(new URL('../../eval/.cache/gemini-usage.json', import.meta.url));

/** YYYY-MM-DD in America/Los_Angeles (Google's quota day). */
export function pacificDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

interface Ledger {
  day: string;
  counts: Record<string, number>;
}

export class CapExceededError extends Error {
  constructor(
    readonly model: string,
    readonly limit: number,
  ) {
    super(`daily cap reached for ${model}: ${limit} requests per Pacific day`);
    this.name = 'CapExceededError';
  }
}

export interface DailyCap {
  /** count one request if under the cap; false when the cap is reached (nothing is counted) */
  reserve(model: string): boolean;
  /** requests counted today */
  used(model: string): number;
  readonly limit: number;
}

export function createDailyCap(
  opts: { limit: number; file?: string; now?: () => Date } = { limit: EVAL_EMBED_CAP_PER_DAY },
): DailyCap {
  const file = opts.file ?? DEFAULT_LEDGER;
  const now = opts.now ?? (() => new Date());
  const load = (): Ledger => {
    const today = pacificDay(now());
    if (existsSync(file)) {
      try {
        const l = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
        if (l.day === today && l.counts) return l;
      } catch {
        // unreadable ledger: start the day fresh
      }
    }
    return { day: today, counts: {} };
  };
  const save = (l: Ledger) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(l, null, 2)}\n`);
  };
  return {
    limit: opts.limit,
    used: (model) => load().counts[model] ?? 0,
    reserve(model) {
      const l = load();
      const n = l.counts[model] ?? 0;
      if (n >= opts.limit) return false;
      l.counts[model] = n + 1;
      save(l);
      return true;
    },
  };
}
