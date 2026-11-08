import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';

/**
 * Records the query-builder calls the store makes. Selects resolve with `selectRows[table]`;
 * a write to a table in `failWrites` resolves with an error.
 */
function fakeDb(selectRows: Record<string, unknown[]> = {}, failWrites: string[] = []) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let kind = '';
      for (const method of ['insert', 'upsert', 'update', 'delete', 'select', 'eq', 'neq', 'in']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (!kind) kind = method;
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(
          kind === 'select'
            ? { data: selectRows[table] ?? [], error: null }
            : failWrites.includes(table)
              ? { data: null, error: { message: 'write failed' } }
              : { data: null, error: null },
        );
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const u = {
  id: 'u1',
  conversationId: 'c0000000-0000-4000-8000-000000000001',
  speaker: null,
  startMs: 0,
  endMs: 900,
  text: 'hi',
};

describe('utterance writes are retry-safe', () => {
  it('SupabaseStore upserts utterances on (conversation_id, id)', async () => {
    const { db, calls } = fakeDb();
    await new SupabaseStore(db).insertUtterance('a0000000-0000-4000-8000-00000000000a', u);
    expect(calls).toEqual([
      {
        table: 'utterances',
        method: 'upsert',
        args: [
          expect.objectContaining({ id: 'u1', conversation_id: u.conversationId }),
          { onConflict: 'conversation_id,id' },
        ],
      },
    ]);
  });

  it('MemoryStore treats a repeated utterance write as an upsert', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation('a0000000-0000-4000-8000-00000000000a');
    const mine = { ...u, conversationId: conv.id };
    await store.insertUtterance('x', mine);
    await store.insertUtterance('x', mine);
    expect(await store.listUtterances(conv.id)).toHaveLength(1);
  });
});

const USER = 'a0000000-0000-4000-8000-00000000000a';
const ops = (calls: { table: string; method: string }[]) =>
  calls.filter((c) => ['insert', 'upsert', 'delete'].includes(c.method)).map((c) => `${c.table}.${c.method}`);

describe('SupabaseStore write order', () => {
  it('replaceUtterances upserts the new set before deleting leftovers', async () => {
    const { db, calls } = fakeDb({ utterances: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] });
    await new SupabaseStore(db).replaceUtterances(USER, u.conversationId, [u, { ...u, id: 'u2' }]);
    expect(ops(calls)).toEqual(['utterances.upsert', 'utterances.delete']);
    const del = calls.findLast((c) => c.method === 'in');
    expect(del?.args).toEqual(['id', ['u3']]);
  });

  it('replaceUtterances deletes nothing when the upsert fails', async () => {
    const { db, calls } = fakeDb({ utterances: [{ id: 'u1' }, { id: 'u9' }] }, ['utterances']);
    await expect(new SupabaseStore(db).replaceUtterances(USER, u.conversationId, [u])).rejects.toThrow();
    expect(ops(calls)).toEqual(['utterances.upsert']);
  });

  it('replaceRecallCards inserts the new cards, then removes the old ones', async () => {
    const { db, calls } = fakeDb({ recall_cards: [{ id: 'old-1' }] });
    await new SupabaseStore(db).replaceRecallCards(USER, u.conversationId, [{ nodeId: 'n1', prompt: 'p' }]);
    expect(ops(calls)).toEqual(['recall_cards.insert', 'recall_cards.delete']);
    expect(calls.findLast((c) => c.method === 'in')?.args).toEqual(['id', ['old-1']]);
  });

  it('idsTakenElsewhere looks only at other conversations', async () => {
    const { db, calls } = fakeDb({ nodes: [{ id: 'n-taken' }] });
    const taken = await new SupabaseStore(db).idsTakenElsewhere(u.conversationId, {
      nodes: ['n-taken', 'n-free'],
      edges: [],
      flags: [],
      commitments: [],
      annotations: [],
    });
    expect(taken).toEqual(['n-taken']);
    expect(calls.find((c) => c.method === 'neq')?.args).toEqual(['conversation_id', u.conversationId]);
    expect(calls.filter((c) => c.method === 'select')).toHaveLength(1); // empty lists are skipped
  });
});
