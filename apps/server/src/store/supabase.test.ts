import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore } from './memory';
import { SupabaseStore } from './supabase';

/** Records the query-builder calls the store makes; every call resolves without error. */
function fakeDb() {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ['insert', 'upsert', 'update', 'delete', 'select', 'eq', 'in']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
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
