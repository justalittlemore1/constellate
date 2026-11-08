import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRealApi } from './realApi';
import { deleteComplete, describeDeleteReport } from './types';

type Result = { data: unknown; error: { message: string } | null };

/** Minimal chainable stand-in for supabase-js: every chain resolves to the table's next result. */
function fakeSupabase(results: Record<string, Result[]>) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'order', 'in', 'eq', 'delete', 'insert', 'update', 'single']) {
      chain[op] = (...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => {
      const r = results[table]?.shift() ?? { data: null, error: null };
      return Promise.resolve(r).then(resolve, reject);
    };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

describe('real API', () => {
  it('saves conversation edits as a user op through the server, with the access token', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ok({ batch: {} }));
    const { client } = fakeSupabase({});
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test/',
      userId: 'u1',
      accessToken: 'tok',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await api.updateConversation('c1', { reflection: 'Remember Camus' });
    expect(fetch).toHaveBeenCalledWith(
      'https://srv.test/conversations/c1/ops',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ops: [{ op: 'conversation.update', patch: { reflection: 'Remember Camus' } }] }),
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
  });

  it('does not offer promise edits (they would revert: commitments replay from the op log)', () => {
    const { client } = fakeSupabase({});
    const api = createRealApi({ supabase: client, serverHttpUrl: '', userId: 'u1', accessToken: 't' });
    expect(api.capabilities.editCommitments).toBe(false);
  });

  it('delete my data: deletes every conversation through the server, then folders and concepts', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const { client, calls } = fakeSupabase({
      conversations: [{ data: [{ id: 'c1' }, { id: 'c2' }], error: null }],
    });
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test',
      userId: 'u1',
      accessToken: 't',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const report = await api.deleteMyData();
    expect(fetch.mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['https://srv.test/conversations/c1', 'DELETE'],
      ['https://srv.test/conversations/c2', 'DELETE'],
    ]);
    expect(calls.filter((c) => c.op === 'delete').map((c) => c.table)).toEqual(['folders', 'concepts']);
    expect(report).toEqual({
      conversationsTotal: 2,
      conversationsDeleted: 2,
      foldersDeleted: true,
      conceptsDeleted: true,
    });
    expect(deleteComplete(report)).toBe(true);
  });

  it('delete my data keeps going past failures and reports exactly what is left', async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/c2')
        ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
        : new Response(null, { status: 204 }),
    );
    const { client } = fakeSupabase({
      conversations: [{ data: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], error: null }],
      concepts: [{ data: null, error: { message: 'denied' } }],
    });
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test',
      userId: 'u1',
      accessToken: 't',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const report = await api.deleteMyData();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report).toEqual({
      conversationsTotal: 3,
      conversationsDeleted: 2,
      foldersDeleted: true,
      conceptsDeleted: false,
    });
    expect(deleteComplete(report)).toBe(false);
    expect(describeDeleteReport(report)).toBe(
      'Not everything was deleted: 2 conversations were deleted, but 1 of 3 conversations, your Brain concepts could not be removed. Please try again.',
    );
  });
});
