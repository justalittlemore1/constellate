/**
 * Per-day request counts for the shared Gemini client, persisted to disk so a restart does not
 * reset them (AGENTS.md → API budget: hard daily caps counted from midnight Pacific).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Google's quotas reset at midnight Pacific; so do our caps. */
export const QUOTA_TIME_ZONE = 'America/Los_Angeles';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: QUOTA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" of `ms` in Pacific time. */
export function pacificDay(ms: number): string {
  return dayFormat.format(new Date(ms));
}

interface Snapshot {
  day: string;
  requests: Record<string, number>;
}

export class DailyUsage {
  private snap: Snapshot;

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.snap = { day: pacificDay(now()), requests: {} };
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
        if (saved && typeof saved.day === 'string' && saved.requests && typeof saved.requests === 'object') {
          this.snap = saved;
        }
      } catch {
        // unreadable file: start counting again (it is rewritten on the next request)
      }
    }
  }

  /** Today's counts (rolls over at midnight Pacific). */
  today(): { day: string; requests: Record<string, number> } {
    this.roll();
    return { day: this.snap.day, requests: { ...this.snap.requests } };
  }

  count(model: string): number {
    this.roll();
    return this.snap.requests[model] ?? 0;
  }

  /** Record one request; returns today's count for the model. */
  add(model: string): number {
    this.roll();
    const n = (this.snap.requests[model] ?? 0) + 1;
    this.snap.requests[model] = n;
    this.save();
    return n;
  }

  private roll(): void {
    const day = pacificDay(this.now());
    if (day !== this.snap.day) {
      this.snap = { day, requests: {} };
      this.save();
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.snap));
    } catch {
      // best effort: the in-memory count still enforces the cap for this process
    }
  }
}

/** `apps/server/.cache/gemini-usage.json` unless GEMINI_USAGE_FILE says otherwise ("off" = memory only). */
export function usageFile(setting: string | undefined): string | null {
  if (setting === 'off') return null;
  if (setting) return path.resolve(setting);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.cache/gemini-usage.json');
}
