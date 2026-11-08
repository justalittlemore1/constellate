/**
 * scripts/seed-demo.ts: the real run is guarded (humans, once, at H10); the dry run drives the real
 * pipeline (A1's seed runtime → interpreter → finalisation → Brain) with fakes and no network.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReplayEmbedder } from '../src/llm/replay';
import type { TranscriptFixture } from '@constellate/shared';
import {
  DEMO_FIXTURES,
  DRY_RUN_USER,
  dryRunRuntime,
  evalCacheEmbedder,
  instantReplaySpeech,
  parseArgs,
  refusal,
  SeedStepTimeout,
  seedDemo,
} from '../../../scripts/seed-demo-lib';
import { TranscriptReplayAdapter } from '../../../apps/server/src/speech/replay';
import { FIXTURE_DIR } from './harness';

/** One conversation (or the Brain build) must finish within this; the error names the stuck step. */
const STEP_MS = 20_000;
const demoFixture = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `${id}.json`), 'utf8')) as TranscriptFixture;

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
    const summary = await seedDemo(dryRunRuntime(), DRY_RUN_USER, { log: (m) => logs.push(m), stepTimeoutMs: STEP_MS });
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

describe('seed-demo dry run is deterministic', () => {
  it('replays every utterance even when the session clock is far ahead (the CI hang)', async () => {
    const fx = demoFixture('demo-journal');
    // A1's adapter skips utterances that ended before `fromMs` (a wall clock at REPLAY_SPEED):
    // a few ms of CI load at 1000x was enough to drop the first ones, and the seed waited forever
    const real: unknown[] = [];
    await new TranscriptReplayAdapter(fx, { speed: 1000, fromMs: 10 * 60_000 }).start((seg) => real.push(seg));
    expect(real).toHaveLength(0);
    // the dry run's adapter has no clock: every final, in order, with no timers
    const finals: string[] = [];
    await instantReplaySpeech(fx).start((seg) => seg.final && finals.push(seg.text));
    expect(finals).toEqual(fx.utterances.map((u) => u.text));
  });

  it('uses no shared on-disk state and no Gemini client', () => {
    const rt = dryRunRuntime();
    expect(rt.deps.gemini).toBeNull();
    expect(rt.deps.embeddings).toBe('local');
    expect(rt.deps.waitForRecordingMs).toBe(0);
  });

  it('names the stuck step when replay never finishes', async () => {
    const rt = dryRunRuntime({
      createSpeech: () => ({ start: () => new Promise<void>(() => {}), push() {}, stop: async () => {} }),
    });
    const err = await seedDemo(rt, DRY_RUN_USER, {
      fixtures: ['demo-journal'],
      stepTimeoutMs: 300,
      log: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SeedStepTimeout);
    expect(err).toMatchObject({ fixture: 'demo-journal', step: 'replay' });
  });

  it('names the stuck step when finalisation never finishes', async () => {
    const rt = dryRunRuntime({ finalizeConversation: () => new Promise(() => {}) });
    const err = await seedDemo(rt, DRY_RUN_USER, {
      fixtures: ['demo-journal'],
      stepTimeoutMs: 1_000,
      log: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SeedStepTimeout);
    expect(err).toMatchObject({ step: 'finalise' });
    expect(String(err.message)).toContain('stuck in step "finalise"');
  });
});
