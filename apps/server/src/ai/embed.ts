import type { GoogleGenAI } from '@google/genai';
import { MODELS } from '@constellate/shared';

export type Embedder = (texts: string[]) => Promise<number[][]>;

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

/** `MODELS.embed` at `MODELS.embedDims`, unit-normalised (pgvector cosine indexes expect it). */
export function geminiEmbedder(ai: GoogleGenAI): Embedder {
  return async (texts) => {
    if (texts.length === 0) return [];
    const res = await ai.models.embedContent({
      model: MODELS.embed,
      contents: texts,
      config: { outputDimensionality: MODELS.embedDims },
    });
    const out = (res.embeddings ?? []).map((e) => l2normalize(e.values ?? []));
    if (out.length !== texts.length || out.some((v) => v.length !== MODELS.embedDims)) {
      throw new Error(`embedding response has ${out.length} vectors for ${texts.length} texts`);
    }
    return out;
  };
}

export const noEmbedder: Embedder = async () => {
  throw new Error('GEMINI_API_KEY is not set: embeddings unavailable');
};
