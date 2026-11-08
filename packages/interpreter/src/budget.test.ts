/**
 * AGENTS.md › API budget / issue #12: no Gemini text models anywhere in this package, Claude is the
 * default for every provider value, and every Gemini request (embeddings, TTS) is counted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GoogleGenAI } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@constellate/shared';
import { createInterpreter } from './live';
import { createLlmClient, interpreterModel, providerFromEnv } from './llm';
import { createGeminiEmbedder } from './llm/gemini';
import {
  countGemini,
  countGeminiThrottle,
  geminiUsage,
  isThrottle,
  resetGeminiUsage,
  setGeminiUsageLogger,
} from './llm/usage';
import { memoryDeps, scriptedLlm } from './test-utils';

afterEach(() => {
  vi.unstubAllEnvs();
  resetGeminiUsage();
  setGeminiUsageLogger(null);
});

describe('no Gemini text models', () => {
  it('defaults to Claude for any provider value', () => {
    vi.stubEnv('INTERPRETER_PROVIDER', '');
    expect(providerFromEnv()).toBe('anthropic');
    vi.stubEnv('INTERPRETER_PROVIDER', 'something-else');
    expect(providerFromEnv()).toBe('anthropic');
    expect(interpreterModel('gemini')).toBe(MODELS.interpreter.anthropic);
    expect(interpreterModel('anthropic')).toBe(MODELS.interpreter.anthropic);
  });

  it('createLlmClient never returns a Gemini client', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    const c = createLlmClient('gemini');
    expect(typeof c.json).toBe('function');
    expect(geminiUsage()).toEqual({});
  });

  it('refuses an explicit Gemini model id', () => {
    const deps = memoryDeps();
    const llm = scriptedLlm(() => ({}));
    expect(() => createInterpreter(deps, { model: MODELS.interpreter.gemini, llm })).toThrow(/refusing Gemini/);
    expect(() => createInterpreter(deps, { model: MODELS.interpreter.fast, llm })).toThrow(/refusing Gemini/);
  });

  it('only the TTS renderer (never run, see #12) calls Gemini generateContent in this package', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (f === 'node_modules' || f.startsWith('.')) continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(join(root, 'src'));
    walk(join(root, 'eval'));
    const callers = files
      .filter((f) => readFileSync(f, 'utf8').includes('generateContent'))
      .map((f) => f.slice(root.length).split(/[\\/]/).filter(Boolean).join('/'));
    expect(callers).toEqual(['src/tts/render.ts']);
  });
});

describe('Gemini embedder', () => {
  it('sends one Content per text in a single counted request', async () => {
    const calls: unknown[] = [];
    const ai = {
      models: {
        embedContent: async (params: { contents: { parts: { text: string }[] }[] }) => {
          calls.push(params);
          return { embeddings: params.contents.map((_, i) => ({ values: [i + 1, 0, 0] })) };
        },
      },
    } as unknown as GoogleGenAI;
    const vs = await createGeminiEmbedder({ ai })(['a', 'b', 'c']);
    expect(vs).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { contents: unknown[] }).contents).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'user', parts: [{ text: 'b' }] },
      { role: 'user', parts: [{ text: 'c' }] },
    ]);
    expect(geminiUsage()[MODELS.embed]).toEqual({ requests: 1, items: 3, throttled: 0 });
  });

  it('counts throttled requests and rethrows', async () => {
    const ai = {
      models: {
        embedContent: async () => {
          throw new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
        },
      },
    } as unknown as GoogleGenAI;
    await expect(createGeminiEmbedder({ ai })(['a'])).rejects.toThrow(/429/);
    expect(geminiUsage()[MODELS.embed]).toEqual({ requests: 1, items: 1, throttled: 1 });
  });
});

describe('Gemini usage counter', () => {
  it('counts requests and items per model and logs running totals', () => {
    const events: string[] = [];
    setGeminiUsageLogger((e) => events.push(e));
    countGemini(MODELS.embed, 3);
    countGemini(MODELS.embed, 2);
    countGeminiThrottle(MODELS.embed);
    expect(geminiUsage()[MODELS.embed]).toEqual({ requests: 2, items: 5, throttled: 1 });
    expect(events).toEqual(['gemini.usage', 'gemini.usage', 'gemini.throttled']);
  });

  it('recognises throttling errors', () => {
    expect(isThrottle(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isThrottle(new Error('503 UNAVAILABLE'))).toBe(true);
    expect(isThrottle(new Error('400 bad request'))).toBe(false);
  });
});
