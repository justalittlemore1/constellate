/**
 * Gemini embeddings (`MODELS.embed`). This package has NO Gemini text-model client on purpose:
 * all reasoning runs on Claude because the Gemini key is free-tier (AGENTS.md › API budget).
 */
import { GoogleGenAI } from '@google/genai';
import { MODELS } from '@constellate/shared';
import { CapExceededError, type DailyCap } from './cap';
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

/** Texts per embedding request (one request each). */
export const EMBED_BATCH_MAX = 100;

export interface GeminiEmbedderOptions extends GeminiClientOptions {
  /** hard daily request cap (the eval passes its 150/day ledger; the server has its own 500/day cap) */
  cap?: DailyCap | null;
  log?(event: string, data?: Record<string, unknown>): void;
}

/**
 * Unit-normalised `MODELS.embed` embeddings, `MODELS.embedDims` long. Every request is counted
 * (usage.ts). With a `cap` (cap.ts) each request is checked first; past it this throws
 * CapExceededError without calling Gemini, and callers degrade (no revisit candidates).
 */
export function createGeminiEmbedder(opts: GeminiEmbedderOptions = {}): (texts: string[]) => Promise<number[][]> {
  const ai = makeAi(opts);
  const cap = opts.cap ?? null;
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_MAX) {
      const chunk = texts.slice(i, i + EMBED_BATCH_MAX);
      if (cap && !cap.reserve(MODELS.embed)) {
        opts.log?.('gemini.cap', { model: MODELS.embed, limit: cap.limit });
        throw new CapExceededError(MODELS.embed, cap.limit);
      }
      countGemini(MODELS.embed, chunk.length);
      let res;
      try {
        res = await ai.models.embedContent({
          model: MODELS.embed,
          // one Content per text: a bare string array is read as ONE input with several parts
          // (one vector back), which silently broke every batched request
          contents: chunk.map((text) => ({ role: 'user', parts: [{ text }] })),
          config: { outputDimensionality: MODELS.embedDims },
        });
      } catch (e) {
        if (isThrottle(e)) countGeminiThrottle(MODELS.embed);
        throw e;
      }
      const vs = (res.embeddings ?? []).map((e) => normalise(e.values ?? []));
      if (vs.length !== chunk.length) {
        throw new Error(`embedContent returned ${vs.length} vectors for ${chunk.length} texts`);
      }
      out.push(...vs);
    }
    return out;
  };
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}
