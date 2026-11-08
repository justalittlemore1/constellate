import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GoogleGenAI } from '@google/genai';
import { afterEach, describe, expect, it } from 'vitest';
import { MODELS } from '@constellate/shared';
import { CapExceededError, createDailyCap, pacificDay } from './cap';
import { createGeminiEmbedder, EMBED_BATCH_MAX } from './gemini';
import { createReplayEmbedder, flushDeferred, newReplayStore } from './replay';
import { resetGeminiUsage } from './usage';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'cap-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  resetGeminiUsage();
});

function fakeAi() {
  const calls: number[] = [];
  const ai = {
    models: {
      embedContent: async (p: { contents: unknown[] }) => {
        calls.push(p.contents.length);
        return { embeddings: p.contents.map(() => ({ values: [1, 0, 0] })) };
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, calls };
}

describe('daily cap', () => {
  it('uses the Pacific calendar day', () => {
    expect(pacificDay(new Date('2026-11-08T07:59:00Z'))).toBe('2026-11-07'); // 23:59 PST
    expect(pacificDay(new Date('2026-11-08T08:00:00Z'))).toBe('2026-11-08'); // midnight PST
  });

  it('counts up to the limit, persists across instances, and resets at midnight Pacific', () => {
    const file = join(tmp(), 'ledger.json');
    let now = new Date('2026-11-08T07:00:00Z');
    const a = createDailyCap({ limit: 2, file, now: () => now });
    expect(a.reserve(MODELS.embed)).toBe(true);
    const b = createDailyCap({ limit: 2, file, now: () => now }); // e.g. the next eval run
    expect(b.reserve(MODELS.embed)).toBe(true);
    expect(b.reserve(MODELS.embed)).toBe(false);
    expect(a.used(MODELS.embed)).toBe(2);
    now = new Date('2026-11-08T08:00:01Z');
    expect(b.used(MODELS.embed)).toBe(0);
    expect(b.reserve(MODELS.embed)).toBe(true);
  });

  it('past the cap the embedder returns nothing and never calls Gemini', async () => {
    const { ai, calls } = fakeAi();
    const cap = createDailyCap({ limit: 1, file: join(tmp(), 'l.json') });
    const embed = createGeminiEmbedder({ ai, cap });
    await embed(['a', 'b']);
    await expect(embed(['c'])).rejects.toBeInstanceOf(CapExceededError);
    expect(calls).toEqual([2]);
  });

  it('has no cap unless one is passed (the server brings its own)', async () => {
    const { ai, calls } = fakeAi();
    const embed = createGeminiEmbedder({ ai });
    for (let i = 0; i < 160; i++) await embed([`t${i}`]);
    expect(calls).toHaveLength(160);
  });

  it('chunks very large batches, one counted request per chunk', async () => {
    const { ai, calls } = fakeAi();
    const cap = createDailyCap({ limit: 10, file: join(tmp(), 'l.json') });
    const vs = await createGeminiEmbedder({ ai, cap })(Array.from({ length: EMBED_BATCH_MAX + 5 }, (_, i) => `t${i}`));
    expect(vs).toHaveLength(EMBED_BATCH_MAX + 5);
    expect(calls).toEqual([EMBED_BATCH_MAX, 5]);
    expect(cap.used(MODELS.embed)).toBe(2);
  });
});

describe('deferred embeddings (one batched request per fixture pass)', () => {
  it('collects misses without calling Gemini, then embeds them all in one request', async () => {
    const dir = tmp();
    const { ai, calls } = fakeAi();
    const gemini = createGeminiEmbedder({ ai, cap: null });
    const rs = newReplayStore();
    const embed = createReplayEmbedder(gemini, dir, 'defer', rs);
    await expect(embed(['window one'])).rejects.toThrow(/deferred/);
    await expect(embed(['window two', 'Node. summary'])).rejects.toThrow(/deferred/);
    expect(calls).toEqual([]);
    expect(await flushDeferred(rs, gemini, dir)).toBe(3);
    expect(calls).toEqual([3]);
    expect(await embed(['window one', 'Node. summary'])).toHaveLength(2);
    expect(await flushDeferred(rs, gemini, dir)).toBe(0);
    expect(calls).toEqual([3]);
  });
});
