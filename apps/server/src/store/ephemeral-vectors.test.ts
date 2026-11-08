/** Stand-in (EMBEDDINGS=local) vectors never reach a persistent store (PR #20 review). */
import { describe, expect, it, vi } from 'vitest';
import { createDefaultDeps } from '../deps';
import { loadEnv } from '../env';
import { createRuntime } from '../seed';
import { fakeAuth, USER_A } from '../test-utils';
import { withEphemeralVectors } from './ephemeral-vectors';
import { MemoryStore } from './memory';
import type { BrainNodeRow, ConceptRow, Store } from './types';

const v = (...xs: number[]) => xs;

/** A stand-in for a persistent store that records every vector write it receives. */
function recordingStore() {
  const nodes: BrainNodeRow[] = [
    {
      id: 'n1',
      conversationId: 'c1',
      label: 'Hockey',
      summary: '',
      level: 1,
      startMs: 0,
      embedding: null,
      conceptId: null,
    },
    {
      id: 'n2',
      conversationId: 'c1',
      label: 'Music',
      summary: '',
      level: 1,
      startMs: 0,
      embedding: null,
      conceptId: null,
    },
  ];
  const concepts: ConceptRow[] = [];
  const store = {
    saveEmbedding: vi.fn(async () => {}),
    matchNodes: vi.fn(async () => []),
    matchConcepts: vi.fn(async () => []),
    listBrainNodes: vi.fn(async () => nodes),
    upsertConcepts: vi.fn(async (_u: string, cs: ConceptRow[]) => {
      for (const c of cs) concepts.push(c);
    }),
    listConcepts: vi.fn(async () => concepts),
    getConversation: vi.fn(async () => null),
  } as unknown as Store;
  return { store, concepts };
}

describe('withEphemeralVectors', () => {
  it('keeps node and concept vectors in memory and writes none to the inner store', async () => {
    const { store, concepts } = recordingStore();
    const s = withEphemeralVectors(store);

    await s.saveEmbedding('n1', v(1, 0));
    await s.saveEmbedding('n2', v(0, 1));
    expect(store.saveEmbedding).not.toHaveBeenCalled();
    expect(await s.matchNodes('c1', v(1, 0.1), 3)).toEqual([
      { id: 'n1', similarity: expect.closeTo(0.995, 2) },
      { id: 'n2', similarity: expect.closeTo(0.0995, 2) },
    ]);
    expect(await s.matchNodes('c1', v(1, 0), 3, 'n1')).toEqual([{ id: 'n2', similarity: 0 }]);
    expect(store.matchNodes).not.toHaveBeenCalled();
    expect((await s.listBrainNodes(['c1'])).map((n) => n.embedding)).toEqual([v(1, 0), v(0, 1)]);

    await s.upsertConcepts(USER_A, [
      { id: 'k1', name: 'Hockey', description: null, parentConceptId: null, mentionCount: 1, embedding: v(1, 0) },
    ]);
    expect(concepts).toEqual([expect.objectContaining({ id: 'k1', embedding: null })]); // nothing persisted
    expect((await s.listConcepts(USER_A))[0]!.embedding).toEqual(v(1, 0));
    expect(await s.matchConcepts(USER_A, v(1, 0), 5)).toEqual([{ id: 'k1', similarity: 1 }]);
    expect(await s.matchConcepts('someone-else', v(1, 0), 5)).toEqual([]);
    expect(store.matchConcepts).not.toHaveBeenCalled();

    // everything else passes straight through
    await s.getConversation('x');
    expect(store.getConversation).toHaveBeenCalledWith('x');
  });

  it('createDefaultDeps wraps a persistent store in local mode, and only then', async () => {
    const { store } = recordingStore();
    const local = createDefaultDeps(loadEnv({ LOG_LEVEL: 'silent' }), () => {}, { store, auth: fakeAuth });
    expect(local.embeddings).toBe('local');
    expect(local.store).not.toBe(store);
    await local.store.saveEmbedding('n1', v(1, 0));
    expect(store.saveEmbedding).not.toHaveBeenCalled();

    const memory = new MemoryStore();
    const tests = createDefaultDeps(loadEnv({ LOG_LEVEL: 'silent' }), () => {}, { store: memory, auth: fakeAuth });
    expect(tests.store).toBe(memory); // in-memory store: nothing shared, no wrapper needed

    const real = createDefaultDeps(loadEnv({ LOG_LEVEL: 'silent', EMBEDDINGS: 'gemini' }), () => {}, {
      store,
      auth: fakeAuth,
      gemini: null,
    });
    expect(real.store).toBe(store); // real embeddings may be persisted
  });
});

describe('seed runtime', () => {
  it('refuses to seed a persistent store without EMBEDDINGS=gemini', () => {
    const { store } = recordingStore();
    expect(() => createRuntime(loadEnv({ LOG_LEVEL: 'silent' }), { store, auth: fakeAuth })).toThrow(
      /EMBEDDINGS=gemini/,
    );
    expect(() =>
      createRuntime(
        loadEnv({ LOG_LEVEL: 'silent', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }),
      ),
    ).toThrow(/EMBEDDINGS=gemini/);
    // in-memory runs (tests) are fine
    expect(() =>
      createRuntime(loadEnv({ LOG_LEVEL: 'silent' }), { store: new MemoryStore(), auth: fakeAuth }),
    ).not.toThrow();
  });
});
