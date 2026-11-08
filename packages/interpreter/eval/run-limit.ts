import type { DailyCap } from '../src/llm/cap';

/** The daily cap plus a per-run ceiling (`--max-embed-requests`): whichever is hit first stops the run's embeddings. */
export function withRunLimit(daily: DailyCap, maxThisRun: number): DailyCap {
  let used = 0;
  return {
    limit: daily.limit,
    used: (model) => daily.used(model),
    reserve(model) {
      if (used >= maxThisRun) return false;
      if (!daily.reserve(model)) return false;
      used++;
      return true;
    },
  };
}
