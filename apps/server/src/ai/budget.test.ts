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
import { SttFileUnavailableError } from '../finalize/transcribe';
import { cachedEmbedder, EmbeddingCache } from './embed';
import {
  assertRealApisAllowed,
  createGeminiGateway,
  GeminiGateway,
  LIVE_API_VERSION,
  GeminiRateLimitedError,
  isRateLimit,
  suggestedRetryMs,
  type GenAiLike,
} from './gemini';

const vec = (seed: number) => Array.from({ length: MODELS.embedDims }, (_, i) => ((i * 7 + seed) % 13) - 6);

function fakeGenAi(over: { embed?: (texts: string[]) => Promise<number[][]> } = {}) {
  // like the real API: one vector per Content; a bare string array is ONE input → one vector
  const embedContent = vi.fn(async ({ contents }: { contents: unknown[] }) => {
    const texts = contents.map((c) =>
      typeof c === 'string' ? c : (c as { parts: { text: string }[] }).parts.map((p) => p.text).join(' '),
    );
    const inputs = contents.every((c) => typeof c === 'string') ? [texts.join(' ')] : texts;
    const vectors = over.embed ? await over.embed(inputs) : inputs.map((_, i) => vec(i));
    return { embeddings: vectors.map((values) => ({ values })) };
  });
  const ai = {
    models: { embedContent, generateContent: vi.fn() },
    live: { connect: vi.fn(async () => ({ close() {}, sendRealtimeInput() {} })) },
    files: { upload: vi.fn(), delete: vi.fn() },
  } as unknown as GenAiLike;
  return { ai, embedContent };
}

const err429 = Object.assign(new Error('got status: 429 RESOURCE_EXHAUSTED. Please retry in 12.5s.'), { status: 429 });

describe('GeminiGateway', () => {
  it('sends one Content per text so a batch gets one vector per text', async () => {
    const { ai, embedContent } = fakeGenAi();
    const out = await new GeminiGateway(ai).embed(['hockey game', 'concert friday', 'third text']);
    expect(out).toHaveLength(3);
    const req = embedContent.mock.calls[0]![0] as { contents: unknown[] };
    expect(req.contents).toEqual([
      { role: 'user', parts: [{ text: 'hockey game' }] },
      { role: 'user', parts: [{ text: 'concert friday' }] },
      { role: 'user', parts: [{ text: 'third text' }] },
    ]);
  });

  it('a batch of several texts through the cached embedder stores one vector each', async () => {
    const { ai, embedContent } = fakeGenAi();
    const gateway = new GeminiGateway(ai);
    const embed = cachedEmbedder({ fetch: (t) => gateway.embed(t), cache: new EmbeddingCache(), windowMs: 1 });
    expect(await embed(['a', 'b', 'c', 'd'])).toHaveLength(4);
    expect(embedContent).toHaveBeenCalledOnce();
    expect(gateway.usage().requests).toEqual({ [MODELS.embed]: 1 });
  });

  it('opens Live sessions on v1beta (v1 answers the handshake with 404) and the rest on the default', async () => {
    const made: { apiVersion?: string; client: GenAiLike }[] = [];
    class FakeGenAI {
      constructor(opts: { apiKey: string; httpOptions?: { apiVersion?: string } }) {
        const { ai } = fakeGenAi();
        made.push({ apiVersion: opts.httpOptions?.apiVersion, client: ai });
        return ai as unknown as FakeGenAI;
      }
    }
    const g = createGeminiGateway('k', () => {}, FakeGenAI as never);
    await g.liveConnect({ config: {}, callbacks: { onmessage() {} } } as never);
    await g.embed(['a']);
    expect(made.map((m) => m.apiVersion)).toEqual([undefined, LIVE_API_VERSION]);
    expect(LIVE_API_VERSION).toBe('v1beta');
    expect(made[1]!.client.live.connect).toHaveBeenCalledOnce();
    expect(made[0]!.client.live.connect).not.toHaveBeenCalled();
    expect(made[0]!.client.models.embedContent).toHaveBeenCalledOnce();
    expect(g.usage().requests).toEqual({ [MODELS.sttLive]: 1, [MODELS.embed]: 1 }); // still one counter
  });

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
      today: 1,
      totals: { [MODELS.embed]: 2, [MODELS.sttLive]: 1 },
      cap: null,
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

  it('checks models.list once at startup; file transcription runs only if the key lists MODELS.sttFile', async () => {
    const listing = (names: string[]) =>
      vi.fn(async () =>
        (async function* () {
          for (const name of names) yield { name: `models/${name}` };
        })(),
      );
    const transcribeFile = vi.fn(async () => [
      { audioTranscription: { speakerLabel: 'spk_1', text: 'hi', startOffset: '0s', endOffset: '1s' } },
    ]);
    const make = (names: string[], STT_FILE?: string) => {
      const { ai } = fakeGenAi();
      (ai.models as unknown as { list: unknown }).list = listing(names);
      const gemini = new GeminiGateway(ai);
      (gemini as unknown as { transcribeFile: unknown }).transcribeFile = transcribeFile;
      const env = loadEnv({ LOG_LEVEL: 'silent', ...(STT_FILE ? { STT_FILE } : {}) });
      return {
        deps: createDefaultDeps(env, () => {}, { gemini }),
        gemini,
        list: ai.models.list as unknown as ReturnType<typeof listing>,
      };
    };

    const absent = make(['gemini-embedding-2', MODELS.sttLive]);
    expect(await absent.deps.sttFile.available).toBe(false);
    expect(absent.deps.sttFile.state).toBe('unavailable');
    await expect(absent.deps.transcribeFile!(Buffer.from('x'), 'audio/webm')).rejects.toBeInstanceOf(
      SttFileUnavailableError,
    );
    expect(transcribeFile).not.toHaveBeenCalled();
    expect(absent.list).toHaveBeenCalledOnce();
    expect(absent.gemini.usage().requests).toEqual({ 'models.list': 1 });

    const present = make([MODELS.sttFile]);
    expect(await present.deps.transcribeFile!(Buffer.from('x'), 'audio/webm')).toHaveLength(1);
    expect(present.deps.sttFile.state).toBe('available');

    const off = make([MODELS.sttFile], 'off');
    expect(off.deps.transcribeFile).toBeNull();
    expect(off.list).not.toHaveBeenCalled();
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
