/** AGENTS.md → API budget. Every provider here is a fake; nothing reaches a real API. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_FRAME_BYTES, MODELS, recordingPath } from '@constellate/shared';
import { createDefaultDeps } from '../deps';
import { forceClaudeReasoning, loadEnv } from '../env';
import { RotatingSpeechAdapter, type Upstream } from '../speech/rotating';
import { makeHarness, recordConversation, USER_A, type Harness } from '../test-utils';
import { cachedEmbedder, EmbeddingCache } from './embed';
import {
  assertRealApisAllowed,
  GeminiGateway,
  GeminiRateLimitedError,
  isRateLimit,
  suggestedRetryMs,
  type GenAiLike,
} from './gemini';

const vec = (seed: number) => Array.from({ length: MODELS.embedDims }, (_, i) => ((i * 7 + seed) % 13) - 6);

function fakeGenAi(over: { embed?: (texts: string[]) => Promise<number[][]> } = {}) {
  const embedContent = vi.fn(async ({ contents }: { contents: string[] }) => ({
    embeddings: (over.embed ? await over.embed(contents) : contents.map((_, i) => vec(i))).map((values) => ({
      values,
    })),
  }));
  const ai = {
    models: { embedContent, generateContent: vi.fn() },
    live: { connect: vi.fn(async () => ({ close() {}, sendRealtimeInput() {} })) },
    files: { upload: vi.fn(), delete: vi.fn() },
  } as unknown as GenAiLike;
  return { ai, embedContent };
}

const err429 = Object.assign(new Error('got status: 429 RESOURCE_EXHAUSTED. Please retry in 12.5s.'), { status: 429 });

describe('GeminiGateway', () => {
  it('counts requests per model and logs running totals', async () => {
    const log = vi.fn();
    const { ai } = fakeGenAi();
    const g = new GeminiGateway(ai, { log });
    await g.embed(['a', 'b']);
    await g.embed(['c']);
    await g.liveConnect({ config: {}, callbacks: { onmessage() {} } } as never);
    expect(g.usage().requests).toEqual({ [MODELS.embed]: 2, [MODELS.sttLive]: 1 });
    expect(log).toHaveBeenLastCalledWith('gemini.request', {
      model: MODELS.sttLive,
      count: 1,
      totals: { [MODELS.embed]: 2, [MODELS.sttLive]: 1 },
    });
  });

  it('on 429: cools that model down, sends nothing during the cool-down, backs off exponentially', async () => {
    let now = 0;
    const embed = vi.fn<(t: string[]) => Promise<number[][]>>().mockRejectedValue(new Error('x'));
    const { ai, embedContent } = fakeGenAi({ embed });
    const g = new GeminiGateway(ai, { now: () => now, baseBackoffMs: 5_000 });

    embed.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
    const first = await g.embed(['a']).catch((e) => e);
    expect(first).toBeInstanceOf(GeminiRateLimitedError);
    expect(first.retryAfterMs).toBe(5_000);
    expect(g.usage().rateLimited).toEqual({ [MODELS.embed]: 1 });

    now = 4_000; // still cooling: no request at all
    await expect(g.embed(['a'])).rejects.toBeInstanceOf(GeminiRateLimitedError);
    expect(embedContent).toHaveBeenCalledTimes(1);
    expect(g.usage().coolingDown[MODELS.embed]).toBe(1_000);

    now = 5_000; // second consecutive 429 → 10 s
    embed.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
    expect((await g.embed(['a']).catch((e) => e)).retryAfterMs).toBe(10_000);

    now = 15_000; // success resets the back-off
    embed.mockResolvedValueOnce([vec(1)]);
    await g.embed(['a']);
    embed.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
    expect((await g.embed(['a']).catch((e) => e)).retryAfterMs).toBe(5_000);

    // other models are unaffected by the embed cool-down
    await g.liveConnect({ config: {}, callbacks: { onmessage() {} } } as never);
  });

  it('honours a longer server-suggested retry delay', async () => {
    const { ai } = fakeGenAi({ embed: () => Promise.reject(err429) });
    const g = new GeminiGateway(ai, { baseBackoffMs: 1_000 });
    expect((await g.embed(['a']).catch((e) => e)).retryAfterMs).toBe(12_500);
  });

  it('recognises rate limits in the shapes the SDK and Live socket produce', () => {
    expect(isRateLimit(err429)).toBe(true);
    expect(isRateLimit({ code: 1011, reason: 'RESOURCE_EXHAUSTED: quota exceeded' })).toBe(true);
    expect(isRateLimit({ status: 400, message: 'bad request' })).toBe(false);
    expect(suggestedRetryMs(new Error('"retryDelay": "17s"'))).toBe(17_000);
    expect(suggestedRetryMs(new Error('nothing'))).toBeNull();
  });
});

describe('cached, batched embeddings', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('batches concurrent callers into one request, de-duplicates, normalises, then serves from cache', async () => {
    const fetch = vi.fn(async (texts: string[]) => texts.map((_, i) => vec(i)));
    const embed = cachedEmbedder({ fetch, cache: new EmbeddingCache(), windowMs: 5 });
    const [a, b] = await Promise.all([embed(['hockey', 'music']), embed(['music', 'books'])]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toEqual(['hockey', 'music', 'books']);
    expect(a[1]).toEqual(b[0]);
    expect(Math.hypot(...a[0]!)).toBeCloseTo(1);
    await embed(['books', 'hockey']);
    expect(fetch).toHaveBeenCalledOnce(); // all cached
  });

  it('splits large batches and persists to disk so a restart costs nothing', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'embed-cache-'));
    const file = path.join(dir, 'embeddings.jsonl');
    const fetch = vi.fn(async (texts: string[]) => texts.map((_, i) => vec(i)));
    const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
    const first = await cachedEmbedder({ fetch, cache: new EmbeddingCache(file), windowMs: 1, maxBatch: 100 })(texts);
    expect(fetch.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);

    const fetch2 = vi.fn(async (t: string[]) => t.map(() => vec(0)));
    const again = await cachedEmbedder({ fetch: fetch2, cache: new EmbeddingCache(file), windowMs: 1 })(texts);
    expect(fetch2).not.toHaveBeenCalled();
    expect(again[42]![3]).toBeCloseTo(first[42]![3]!, 5);
  });

  it('a failed request rejects only its callers and caches nothing', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new GeminiRateLimitedError(MODELS.embed, 5_000));
    fetch.mockImplementation(async (texts: string[]) => texts.map(() => vec(2)));
    const embed = cachedEmbedder({ fetch, cache: new EmbeddingCache(), windowMs: 1 });
    await expect(embed(['x'])).rejects.toBeInstanceOf(GeminiRateLimitedError);
    expect(await embed(['x'])).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('Claude for reasoning, fakes in tests', () => {
  it('INTERPRETER_PROVIDER resolves to anthropic even when an old .env says gemini', () => {
    expect(loadEnv({}).INTERPRETER_PROVIDER).toBe('anthropic');
    const env = loadEnv({ INTERPRETER_PROVIDER: 'gemini' });
    expect(env.INTERPRETER_PROVIDER).toBe('anthropic');
    const warn = vi.fn();
    const before = process.env.INTERPRETER_PROVIDER;
    try {
      forceClaudeReasoning(env, warn);
      expect(process.env.INTERPRETER_PROVIDER).toBe('anthropic');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ignored/));
    } finally {
      if (before === undefined) delete process.env.INTERPRETER_PROVIDER;
      else process.env.INTERPRETER_PROVIDER = before;
    }
  });

  it('refuses to build real API clients inside unit tests', () => {
    expect(() => assertRealApisAllowed('x')).toThrow(/must not call real APIs/);
    expect(() => createDefaultDeps(loadEnv({ GEMINI_API_KEY: 'k', LOG_LEVEL: 'silent' }), () => {})).toThrow(
      /must not call real APIs/,
    );
    expect(() => createDefaultDeps(loadEnv({ ANTHROPIC_API_KEY: 'k', LOG_LEVEL: 'silent' }), () => {})).toThrow(
      /must not call real APIs/,
    );
  });

  it('file re-transcription is off by default (MODELS.sttFile is not on our key)', () => {
    const { ai } = fakeGenAi();
    const gemini = new GeminiGateway(ai);
    expect(createDefaultDeps(loadEnv({ LOG_LEVEL: 'silent' }), () => {}, { gemini }).transcribeFile).toBeNull();
    const on = createDefaultDeps(loadEnv({ LOG_LEVEL: 'silent', STT_FILE: 'on' }), () => {}, { gemini });
    expect(on.transcribeFile).not.toBeNull();
  });
});

describe('finalisation without diarization', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.app.close();
  });

  it('keeps the live transcript with empty speakers and still runs the Claude refine', async () => {
    const finalizeConversation = vi.fn(async ({ state, utterances }) => {
      // the refine sees the live transcript: no speaker labels anywhere
      expect(utterances.every((u: { speaker: number | null }) => u.speaker === null)).toBe(true);
      const first = Object.values(state.nodes)[0] as { id: string };
      return {
        ops: [{ op: 'node.update' as const, id: first.id, patch: { details: 'Refined without speakers.' } }],
        recallPrompts: [{ nodeId: first.id, prompt: 'What happened?' }],
      };
    });
    h = await makeHarness({ finalizeConversation, transcribeFile: null });
    const id = await recordConversation(h);
    h.store.recordings.set(recordingPath(USER_A, id), Buffer.from('webm'));
    const res = await h.app.inject({
      method: 'POST',
      url: `/conversations/${id}/finalize?wait=1`,
      headers: { authorization: 'Bearer token-a' },
    });
    expect(res.json()).toEqual({ status: 'ready', transcript: 'live' });
    expect(finalizeConversation).toHaveBeenCalledOnce();
    const g = (await h.store.loadGraph(id))!;
    expect(Object.values(g.nodes).every((n) => n.speakers.length === 0)).toBe(true);
    expect(Object.values(g.nodes).some((n) => n.details === 'Refined without speakers.')).toBe(true);
    expect(g.conversation.audioPath).toBe(recordingPath(USER_A, id));
    expect(h.store.recallCards(id)).toHaveLength(1);
    // the Brain still builds from speaker-less nodes
    const brain = await h.app.inject({
      method: 'POST',
      url: '/brain/rebuild',
      headers: { authorization: 'Bearer token-a' },
    });
    expect(brain.json().conversations).toBe(1);
  });
});

describe('live transcription under a rate limit', () => {
  it('keeps retrying after the advised delay instead of giving up, and stop() cuts the wait short', async () => {
    let bytes = 0;
    let opens = 0;
    const onError = vi.fn();
    const make = (failWith?: Error): Upstream => ({
      start: async () => {
        opens++;
        if (failWith) throw failWith;
      },
      push: () => {},
      stop: async () => {},
      writable: () => true,
      hasOpenUtterance: () => false,
      lastTextAtMs: () => null,
    });
    let n = 0;
    const adapter = new RotatingSpeechAdapter({
      factory: () => (n++ === 0 ? make() : n < 9 ? make(new GeminiRateLimitedError(MODELS.sttLive, 5)) : make()),
      nowMs: () => bytes / 32,
      limits: { rotateAfterMs: 100, rotateHardMs: 200, rotateGapMs: 0, maxBufferMs: 5_000 },
      retryDelaysMs: [1],
      onError,
    });
    await adapter.start(() => {});
    bytes = 300 * 32;
    adapter.push(Buffer.alloc(AUDIO_FRAME_BYTES));
    await vi.waitFor(() => expect(adapter.rotations).toBe(1), { timeout: 2_000 });
    expect(opens).toBe(9); // 1 initial + 7 rate-limited (far beyond the 1 normal retry) + 1 success
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/rate-limited/), false);

    const stuck = new RotatingSpeechAdapter({
      factory: () => (opens++ === 10 ? make() : make(new GeminiRateLimitedError(MODELS.sttLive, 60_000))),
      nowMs: () => bytes / 32,
      limits: { rotateAfterMs: 100, rotateHardMs: 200, rotateGapMs: 0, maxBufferMs: 5_000 },
    });
    opens = 10;
    bytes = 0;
    await stuck.start(() => {});
    bytes = 300 * 32;
    stuck.push(Buffer.alloc(AUDIO_FRAME_BYTES));
    const t0 = Date.now();
    await stuck.stop();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});
