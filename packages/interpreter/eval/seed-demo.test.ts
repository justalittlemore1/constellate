/**
 * scripts/seed-demo.ts: the real run is guarded (humans, once, at H10); the dry run drives the real
 * pipeline (A1's seed runtime → interpreter → finalisation → Brain) with fakes and no network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReplayEmbedder } from '../src/llm/replay';
import {
  DEMO_FIXTURES,
  DRY_RUN_USER,
  dryRunRuntime,
  evalCacheEmbedder,
  parseArgs,
  refusal,
  seedDemo,
} from '../../../scripts/seed-demo-lib';

const ok = {
  EMBEDDINGS: 'gemini',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-key',
};
const real = (extra: string[] = []) =>
  parseArgs(['--user', 'a0000000-0000-4000-8000-00000000000a', '--confirm-h10', ...extra]);

describe('seed-demo guards', () => {
  it('refuses the real run without EMBEDDINGS=gemini', () => {
    expect(refusal(real(), { ...ok, EMBEDDINGS: undefined })).toMatch(/EMBEDDINGS=gemini/);
    expect(refusal(real(), { ...ok, EMBEDDINGS: 'local' })).toMatch(/EMBEDDINGS=gemini/);
  });

  it('refuses without the database, a demo account id, or the H10 confirmation', () => {
    expect(refusal(real(), { ...ok, SUPABASE_URL: undefined })).toMatch(/SUPABASE_URL/);
    expect(refusal(parseArgs(['--confirm-h10']), ok)).toMatch(/--user/);
    expect(refusal(parseArgs(['--user', 'not-a-uuid', '--confirm-h10']), ok)).toMatch(/--user/);
    expect(refusal(parseArgs(['--user', 'a0000000-0000-4000-8000-00000000000a']), ok)).toMatch(/--confirm-h10/);
    expect(refusal(real(), ok)).toBeNull();
  });

  it('the dry run needs nothing', () => {
    expect(refusal(parseArgs(['--dry-run']), {})).toBeNull();
  });
});

describe('seed-demo dry run', () => {
  it('seeds all five demo conversations through the real pipeline with fakes and makes no API request', async () => {
    const logs: string[] = [];
    const summary = await seedDemo(dryRunRuntime(), DRY_RUN_USER, { log: (m) => logs.push(m) });
    expect(summary.conversations.map((c) => c.fixture)).toEqual(DEMO_FIXTURES);
    for (const c of summary.conversations) {
      expect(c.status).toBe('ready');
      expect(c.nodes).toBeGreaterThan(0);
      expect(c.utterances).toBeGreaterThan(10);
    }
    expect(summary.brainConversations).toBe(5);
    expect(summary.embeddings.thisRun).toBe(0);
    expect(logs.some((l) => l.includes('embedding requests: 0 this run'))).toBe(true);
  }, 120_000);
});

describe('eval-cache embedder', () => {
  it('answers recorded texts from the eval recordings and sends the rest to the server embedder in one batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seedcache-'));
    try {
      await createReplayEmbedder(async (ts) => ts.map(() => [1, 0, 0]), dir, 'auto')(['known text']);
      const calls: string[][] = [];
      const { embed, stats } = evalCacheEmbedder(async (ts) => (calls.push(ts), ts.map(() => [0, 1, 0])), dir);
      const vs = await embed(['known text', 'new one', 'new two']);
      expect(vs).toHaveLength(3);
      expect(vs[0]![0]).toBeCloseTo(1, 2);
      expect(calls).toEqual([['new one', 'new two']]);
      expect(stats).toEqual({ evalHits: 1, passedOn: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
