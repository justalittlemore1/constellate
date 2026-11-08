import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDailyCap } from '../src/llm/cap';
import { withRunLimit } from './run-limit';

describe('per-run embedding limit', () => {
  it('stops at the run limit even when the daily cap has room, and counts only what it allowed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runlimit-'));
    try {
      const daily = createDailyCap({ limit: 150, file: join(dir, 'l.json') });
      const cap = withRunLimit(daily, 2);
      expect([cap.reserve('m'), cap.reserve('m'), cap.reserve('m')]).toEqual([true, true, false]);
      expect(daily.used('m')).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
