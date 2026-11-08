import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRealApi } from './realApi';
import { describeDeleted } from './types';

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

  it('saves promise edits as a commitment.update user op — never a direct commitments write', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ok({ batch: { seq: 12 } }));
    const { client, calls } = fakeSupabase({});
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test',
      userId: 'u1',
      accessToken: 'tok',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(api.capabilities.editCommitments).toBe(true);
    const res = await api.postOps('c1', [{ op: 'commitment.update', id: 'p1', patch: { done: true } }]);
    expect(res).toEqual({ batch: { seq: 12 } });
    expect(fetch).toHaveBeenCalledWith(
      'https://srv.test/conversations/c1/ops',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ops: [{ op: 'commitment.update', id: 'p1', patch: { done: true } }] }),
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
    expect(calls).toEqual([]); // no Supabase table touched
  });

  it('a refused op rejects with the server message', async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'unknown_commitment', message: 'commitment p9 does not exist' }), {
          status: 409,
        }),
    );
    const { client } = fakeSupabase({});
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test',
      userId: 'u1',
      accessToken: 'tok',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await expect(api.postOps('c1', [{ op: 'commitment.update', id: 'p9', patch: { done: true } }])).rejects.toThrow(
      'commitment p9 does not exist',
    );
  });
});

describe('delete my data (DELETE /me/data)', () => {
  const rows = { conversations: 3, folders: 2, concepts: 8, conceptLinks: 5 };
  function apiAnswering(status: number, body: unknown) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
    const { client, calls } = fakeSupabase({});
    const api = createRealApi({
      supabase: client,
      serverHttpUrl: 'https://srv.test/',
      userId: 'u1',
      accessToken: 'tok',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    return { api, fetch, calls };
  }

  it('is one authenticated server call, with no client-side deletes', async () => {
    const { api, fetch, calls } = apiAnswering(200, { deleted: { ...rows, recordings: 3 } });
    expect(await api.deleteMyData()).toEqual({ outcome: 'deleted', deleted: { ...rows, recordings: 3 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://srv.test/me/data',
      expect.objectContaining({ method: 'DELETE', headers: { authorization: 'Bearer tok' } }),
    );
    expect(calls).toEqual([]);
  });

  it('502 → rows deleted, recordings left (with the counts)', async () => {
    const { api } = apiAnswering(502, { error: 'storage', message: 'call again', deleted: rows });
    expect(await api.deleteMyData()).toEqual({ outcome: 'recordings-left', deleted: rows });
  });

  it('503 → nothing deleted', async () => {
    const { api } = apiAnswering(503, { error: 'db', message: 'nothing was deleted; try again' });
    expect(await api.deleteMyData()).toEqual({ outcome: 'nothing-deleted' });
  });

  it('other failures throw (e.g. an expired session)', async () => {
    const { api } = apiAnswering(401, { error: 'auth', message: 'missing or invalid access token' });
    await expect(api.deleteMyData()).rejects.toThrow('missing or invalid access token');
  });

  it('describes the counts in words', () => {
    expect(describeDeleted({ ...rows, recordings: 1 })).toBe(
      '3 conversations, 2 folders, 8 Brain concepts and 1 recording',
    );
    expect(describeDeleted({ conversations: 1, folders: 0, concepts: 1, conceptLinks: 0 })).toBe(
      '1 conversation, 0 folders and 1 Brain concept',
    );
  });
});
