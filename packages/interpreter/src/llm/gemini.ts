/**
 * LlmClient and embeddings on the Gemini API (`@google/genai`), JSON schema via `responseJsonSchema`.
 */
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { MODELS } from '@constellate/shared';
import type { LlmClient, LlmJsonArgs } from './types';
import { LlmError } from './errors';

export interface GeminiClientOptions {
  apiKey?: string;
  ai?: GoogleGenAI;
}

function makeAi(opts: GeminiClientOptions): GoogleGenAI {
  if (opts.ai) return opts.ai;
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenAI({ apiKey });
}

function thinkingLevel(model: string): ThinkingLevel {
  return model === MODELS.interpreter.gemini || model === MODELS.interpreter.fast ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM;
}

export function createGeminiClient(opts: GeminiClientOptions = {}): LlmClient {
  const ai = makeAi(opts);
  return {
    async json<T>({ system, user, schema, model, timeoutMs }: LlmJsonArgs) {
      const t0 = performance.now();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const res = await ai.models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            thinkingConfig: { thinkingLevel: thinkingLevel(model) },
            abortSignal: abort.signal,
          },
        });
        const ms = performance.now() - t0;
        const text = res.text;
        if (!text) throw new LlmError('empty', `empty response (${res.candidates?.[0]?.finishReason ?? 'no candidate'})`);
        let data: T;
        try {
          data = JSON.parse(text) as T;
        } catch {
          throw new LlmError('invalid_json', `response was not JSON: ${text.slice(0, 200)}`);
        }
        const u = res.usageMetadata;
        return {
          data,
          ms,
          inTok: u?.promptTokenCount ?? 0,
          outTok: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        };
      } catch (e) {
        if (abort.signal.aborted) throw new LlmError('timeout', `no response within ${timeoutMs} ms`);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Unit-normalised `MODELS.embed` embeddings, `MODELS.embedDims` long. */
export function createGeminiEmbedder(opts: GeminiClientOptions = {}): (texts: string[]) => Promise<number[][]> {
  const ai = makeAi(opts);
  return async (texts) => {
    if (texts.length === 0) return [];
    const res = await ai.models.embedContent({
      model: MODELS.embed,
      contents: texts,
      config: { outputDimensionality: MODELS.embedDims },
    });
    const out = (res.embeddings ?? []).map((e) => normalise(e.values ?? []));
    if (out.length !== texts.length) throw new Error(`embedContent returned ${out.length} vectors for ${texts.length} texts`);
    return out;
  };
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}
