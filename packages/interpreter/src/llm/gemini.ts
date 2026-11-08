/**
 * Gemini embeddings (`MODELS.embed`). This package has NO Gemini text-model client on purpose:
 * all reasoning runs on Claude because the Gemini key is free-tier (AGENTS.md › API budget).
 */
import { GoogleGenAI } from '@google/genai';
import { MODELS } from '@constellate/shared';
import { countGemini, countGeminiThrottle, isThrottle } from './usage';

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

/** Unit-normalised `MODELS.embed` embeddings, `MODELS.embedDims` long. */
export function createGeminiEmbedder(opts: GeminiClientOptions = {}): (texts: string[]) => Promise<number[][]> {
  const ai = makeAi(opts);
  return async (texts) => {
    if (texts.length === 0) return [];
    countGemini(MODELS.embed, texts.length);
    let res;
    try {
      res = await ai.models.embedContent({
        model: MODELS.embed,
        // one Content per text: a bare string array is read as ONE input with several parts
        // (one vector back), which silently broke every batched request
        contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
        config: { outputDimensionality: MODELS.embedDims },
      });
    } catch (e) {
      if (isThrottle(e)) countGeminiThrottle(MODELS.embed);
      throw e;
    }
    const out = (res.embeddings ?? []).map((e) => normalise(e.values ?? []));
    if (out.length !== texts.length)
      throw new Error(`embedContent returned ${out.length} vectors for ${texts.length} texts`);
    return out;
  };
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}
