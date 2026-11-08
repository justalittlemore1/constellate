/** Hard daily embedding cap (AGENTS.md → API budget, PR #17). Fakes only. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@constellate/shared';
import { embeddingsMode, loadEnv } from '../env';
import { makeHarness, recordConversation, type Harness } from '../test-utils';
import { DailyUsage, pacificDay } from './daily-usage';
import { cachedEmbedder, EmbeddingCache, localEmbedder } from './embed';
import { createGeminiGateway, EMBED_DAILY_CAP, GeminiGateway, type GenAiLike } from './gemini';
import { cosine } from '../store/memory';
import type { MergeDecider } from '../brain/merge-llm';

const vec = () => Array.from({ length: MODELS.embedDims }, (_, i) => (i % 7) - 3);
function fakeAi() {
  const embedContent = vi.fn(async ({ contents }: { contents: unknown[] }) => ({
    embeddings: contents.map(() => ({ values: vec() })),
  }));
  return {
    ai: { models: { embedContent }, live: {}, files: {} } as unknown as GenAiLike,
    embedContent,
  };
}

// 2026-11-08 23:59 PST = 2026-11-09T07:59Z; midnight Pacific = 08:00Z (UTC−8 in November)
const BEFORE_MIDNIGHT = Date.parse('2026-11-09T07:59:00Z');
const AFTER_MIDNIGHT = Date.parse('2026-11-09T08:00:30Z');

let dir: string | null = null;
const tmpFile = () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'gemini-usage-'));
  return path.join(dir, 'usage.json');
};
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('daily usage', () => {
  it('days are Pacific days', () => {
    expect(pacificDay(BEFORE_MIDNIGHT)).toBe('2026-11-08');
    expect(pacificDay(AFTER_MIDNIGHT)).toBe('2026-11-09');
  });

  it('persists counts across restarts and resets at midnight Pacific', () => {
    const file = tmpFile();
    let now = BEFORE_MIDNIGHT;
    const a = new DailyUsage(file, () => now);
    a.add(MODELS.embed);
    a.add(MODELS.embed);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ day: '2026-11-08', requests: { [MODELS.embed]: 2 } });
    const b = new DailyUsage(file, () => now); // restart
    expect(b.count(MODELS.embed)).toBe(2);
    now = AFTER_MIDNIGHT;
    expect(b.count(MODELS.embed)).toBe(0);
    expect(b.today().day).toBe('2026-11-09');
  });
});

describe('embedding cap in the shared client', () => {
  it('the production factory counts into the persisted daily file', async () => {
    const file = tmpFile();
    class FakeGenAI {
      constructor() {
        return fakeAi().ai as unknown as FakeGenAI;
      }
    }
    const g = createGeminiGateway('k', () => {}, FakeGenAI as never, new DailyUsage(file));
    await g.embed(['x']);
    expect(JSON.parse(readFileSync(file, 'utf8')).requests).toEqual({ [MODELS.embed]: 1 });
  });

  it('defaults to 500 per day', () => {
    expect(EMBED_DAILY_CAP).toBe(500);
    expect(new GeminiGateway(fakeAi().ai).usage().caps).toEqual({ [MODELS.embed]: 500 });
  });

  it('past the cap embed() returns [] without sending a request; the cap survives a restart and resets at midnight', async () => {
    const file = tmpFile();
    let now = BEFORE_MIDNIGHT;
    const log = vi.fn();
    const { ai, embedContent } = fakeAi();
    const g = new GeminiGateway(ai, {
      now: () => now,
      daily: new DailyUsage(file, () => now),
      dailyCaps: { [MODELS.embed]: 3 },
      log,
    });
    for (let i = 0; i < 3; i++) expect(await g.embed(['a', 'b'])).toHaveLength(2);
    expect(await g.embed(['c'])).toEqual([]);
    expect(await g.embed(['d'])).toEqual([]);
    expect(embedContent).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.filter(([e]) => e === 'gemini.daily_cap_reached')).toHaveLength(1);
    expect(g.usage().today).toEqual({ day: '2026-11-08', requests: { [MODELS.embed]: 3 } });

    // restart: a new client reading the same file is still capped
    const fresh = fakeAi();
    const g2 = new GeminiGateway(fresh.ai, {
      now: () => now,
      daily: new DailyUsage(file, () => now),
      dailyCaps: { [MODELS.embed]: 3 },
    });
    expect(await g2.embed(['e'])).toEqual([]);
    expect(fresh.embedContent).not.toHaveBeenCalled();

    now = AFTER_MIDNIGHT;
    expect(await g2.embed(['e'])).toHaveLength(1);
    expect(g2.usage().today).toEqual({ day: '2026-11-09', requests: { [MODELS.embed]: 1 } });
  });

  it('the cached embedder degrades to [] past the cap, caches nothing, and still serves cache hits', async () => {
    const { ai, embedContent } = fakeAi();
    const g = new GeminiGateway(ai, { dailyCaps: { [MODELS.embed]: 1 } });
    const embed = cachedEmbedder({ fetch: (t) => g.embed(t), cache: new EmbeddingCache(), windowMs: 1 });
    expect(await embed(['known'])).toHaveLength(1);
    expect(await embed(['new text'])).toEqual([]);
    expect(await embed(['known', 'new text'])).toEqual([]); // never partial
    expect(await embed(['known'])).toHaveLength(1); // cache hit, free
    expect(embedContent).toHaveBeenCalledOnce();
  });
});

describe('dev loops never spend embedding quota', () => {
  it('EMBEDDINGS defaults to local unless NODE_ENV=production', () => {
    expect(embeddingsMode(loadEnv({}))).toBe('local');
    expect(embeddingsMode(loadEnv({ NODE_ENV: 'development' }))).toBe('local');
    expect(embeddingsMode(loadEnv({ NODE_ENV: 'production' }))).toBe('gemini');
    expect(embeddingsMode(loadEnv({ EMBEDDINGS: 'gemini' }))).toBe('gemini');
    expect(embeddingsMode(loadEnv({ NODE_ENV: 'production', EMBEDDINGS: 'local' }))).toBe('local');
  });

  it('the local embedder is offline, deterministic, unit-length, and shared words score higher', async () => {
    const [a, b, c, a2] = await localEmbedder([
      'hockey game tonight',
      'the hockey game',
      'baking sourdough bread',
      'hockey game tonight',
    ]);
    expect(a).toEqual(a2);
    expect(a!.length).toBe(MODELS.embedDims);
    expect(Math.hypot(...a!)).toBeCloseTo(1);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
  });
});

describe('callers degrade when embeddings return nothing', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.app.close();
  });
  const auth = { authorization: 'Bearer token-a' };

  it('the Brain merges by name (Claude sees name-only candidates; the fallback joins exact names)', async () => {
    const decideMerge = vi.fn<MergeDecider>(async () => {
      throw new Error('use the heuristic');
    });
    h = await makeHarness({ embed: async () => [], decideMerge });
    for (let i = 0; i < 2; i++) {
      const id = await recordConversation(h);
      await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth });
    }
    const res = await h.app.inject({ method: 'POST', url: '/brain/rebuild', headers: auth });
    expect(res.json()).toMatchObject({ conversations: 2, concepts: 2 });
    const brain = (await h.app.inject({ method: 'GET', url: '/brain', headers: auth })).json();
    expect(brain.concepts.map((c: { mentionCount: number }) => c.mentionCount)).toEqual([2, 2]);
    // the second conversation's request offered the existing concepts by name
    const second = decideMerge.mock.calls[1]![0];
    expect(second.nodes[0]!.candidates.length).toBe(2);
    expect(second.nodes[0]!.candidates.every((c) => c.similarity === null)).toBe(true);
  });

  it('Brain search falls back to matching names', async () => {
    h = await makeHarness({ embed: async () => [] });
    const id = await recordConversation(h);
    await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth });
    await h.app.inject({ method: 'POST', url: '/brain/rebuild', headers: auth });
    const res = await h.app.inject({ method: 'GET', url: '/brain/search?q=topic', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().degraded).toMatch(/by name/);
    expect(res.json().results.length).toBe(2);
  });
});
