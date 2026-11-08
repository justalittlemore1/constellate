import { cosine } from './memory';
import type { ConceptRow, NodeMatch, Store } from './types';

/**
 * With EMBEDDINGS=local (the offline stand-in used in development), vectors must never reach the
 * shared database: they live in a different vector space from real `gemini-embedding-2` vectors,
 * so `match_nodes` / `match_concepts` would compare unrelated spaces, and anything built on them
 * would not come from the real pipeline. This wrapper keeps node and concept vectors in process
 * memory, answers vector searches from memory, and writes null embeddings to the inner store.
 * Everything else passes through.
 */
export function withEphemeralVectors(inner: Store): Store {
  const nodeVectors = new Map<string, number[]>();
  const conceptVectors = new Map<string, { userId: string; v: number[] }>();

  const rank = (candidates: { id: string; v: number[] }[], embedding: number[], k: number): NodeMatch[] =>
    candidates
      .map(({ id, v }) => ({ id, similarity: cosine(v, embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);

  const wrapped: Store = Object.create(inner);
  Object.assign(wrapped, {
    async saveEmbedding(nodeId: string, embedding: number[]) {
      nodeVectors.set(nodeId, [...embedding]);
    },

    async matchNodes(conversationId: string, embedding: number[], k: number, excludeId?: string) {
      // listBrainNodes returns this conversation's topic nodes
      const topics = await inner.listBrainNodes([conversationId]);
      const candidates = topics
        .filter((n) => n.id !== excludeId && nodeVectors.has(n.id))
        .map((n) => ({ id: n.id, v: nodeVectors.get(n.id)! }));
      return rank(candidates, embedding, k);
    },

    async listBrainNodes(conversationIds: string[]) {
      const rows = await inner.listBrainNodes(conversationIds);
      return rows.map((r) => ({ ...r, embedding: nodeVectors.get(r.id) ?? null }));
    },

    async upsertConcepts(userId: string, concepts: ConceptRow[]) {
      for (const c of concepts) if (c.embedding) conceptVectors.set(c.id, { userId, v: [...c.embedding] });
      await inner.upsertConcepts(
        userId,
        concepts.map((c) => ({ ...c, embedding: null })),
      );
    },

    async listConcepts(userId: string) {
      const rows = await inner.listConcepts(userId);
      return rows.map((c) => ({ ...c, embedding: conceptVectors.get(c.id)?.v ?? null }));
    },

    async matchConcepts(userId: string, embedding: number[], k: number) {
      const candidates = [...conceptVectors].filter(([, c]) => c.userId === userId).map(([id, c]) => ({ id, v: c.v }));
      return rank(candidates, embedding, k);
    },
  } satisfies Partial<Store>);
  return wrapped;
}
