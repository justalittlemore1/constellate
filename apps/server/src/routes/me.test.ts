import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordingPath } from '@constellate/shared';
import { SupabaseStore } from '../store/supabase';
import { connect, makeHarness, recordConversation, USER_A, USER_B, type Harness } from '../test-utils';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` });
const del = (token = 'token-a') => h.app.inject({ method: 'DELETE', url: '/me/data', headers: auth(token) });

/** Two users with conversations, recordings, folders and a built Brain each. */
async function populate() {
  h = await makeHarness();
  const a1 = await recordConversation(h, 'token-a');
  const a2 = await recordConversation(h, 'token-a');
  const b1 = await recordConversation(h, 'token-b');
  for (const [user, id] of [
    [USER_A, a1],
    [USER_A, a2],
    [USER_B, b1],
  ] as const) {
    h.store.recordings.set(recordingPath(user, id), Buffer.from('webm'));
    const token = user === USER_A ? 'token-a' : 'token-b';
    await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth(token) });
  }
  h.store.folders.set('fa', { userId: USER_A, name: 'Friends' });
  h.store.folders.set('fb', { userId: USER_B, name: 'Work' });
  await h.app.inject({ method: 'POST', url: '/brain/rebuild', headers: auth('token-a') });
  await h.app.inject({ method: 'POST', url: '/brain/rebuild', headers: auth('token-b') });
  return { a1, a2, b1 };
}

describe('DELETE /me/data', () => {
  it("deletes everything the caller owns and nothing of anyone else's", async () => {
    const { a1, a2, b1 } = await populate();
    const aConcepts = (await h.store.listConcepts(USER_A)).length;
    const aLinks = (await h.store.listConceptLinks(USER_A)).length;
    const bBrainBefore = (await h.app.inject({ method: 'GET', url: '/brain', headers: auth('token-b') })).json();
    expect(aConcepts).toBeGreaterThan(0);

    const res = await del();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      deleted: { conversations: 2, folders: 1, concepts: aConcepts, conceptLinks: aLinks, recordings: 2, atomic: true },
    });

    for (const id of [a1, a2]) {
      expect(h.store.convs.has(id)).toBe(false);
      expect(h.store.recordings.has(recordingPath(USER_A, id))).toBe(false);
      expect((await h.app.inject({ method: 'GET', url: `/conversations/${id}`, headers: auth() })).statusCode).toBe(
        404,
      );
    }
    expect(await h.store.listConcepts(USER_A)).toEqual([]);
    expect(await h.store.listConceptLinks(USER_A)).toEqual([]);
    expect([...h.store.folders.values()].some((f) => f.userId === USER_A)).toBe(false);

    // user B untouched
    expect(h.store.convs.has(b1)).toBe(true);
    expect(h.store.recordings.has(recordingPath(USER_B, b1))).toBe(true);
    expect(h.store.folders.has('fb')).toBe(true);
    expect((await h.app.inject({ method: 'GET', url: '/brain', headers: auth('token-b') })).json()).toEqual(
      bBrainBefore,
    );
  });

  it('is idempotent and requires a valid token', async () => {
    await populate();
    expect((await h.app.inject({ method: 'DELETE', url: '/me/data' })).statusCode).toBe(401);
    expect((await del('forged')).statusCode).toBe(401);
    await del();
    const again = await del();
    expect(again.statusCode).toBe(200);
    expect(again.json().deleted).toMatchObject({ conversations: 0, folders: 0, concepts: 0, recordings: 0 });
  });

  it("aborts the caller's live session first, without finalising it", async () => {
    const onStopped = vi.fn();
    h = await makeHarness({ onStopped });
    const c = await connect(h.app);
    c.send({ t: 'hello', token: 'token-a', source: 'mic', consent: true });
    const { conversationId } = await c.waitFor('ready');
    h.adapters[0]!.emit({ text: 'something', startMs: 0, endMs: 1_000 });
    await c.waitFor('ops');

    expect((await del()).json().deleted.conversations).toBe(1);
    expect(await c.waitFor('error')).toMatchObject({ fatal: true, message: 'your data was deleted' });
    await c.closed;
    expect(onStopped).not.toHaveBeenCalled();
    expect(h.store.convs.has(conversationId)).toBe(false);
  });

  it('a storage failure answers 502 after the rows are gone, and a retry removes the recordings', async () => {
    const { a1 } = await populate();
    h.store.failNext.deleteUserRecordings = new Error('storage down');
    const res = await del();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'storage', deleted: { conversations: 2 } });
    expect(h.store.convs.has(a1)).toBe(false);
    expect(h.store.recordings.has(recordingPath(USER_A, a1))).toBe(true);

    const retry = await del();
    expect(retry.statusCode).toBe(200);
    expect(retry.json().deleted).toMatchObject({ conversations: 0, recordings: 2 });
  });

  it('a database failure deletes nothing', async () => {
    const { a1 } = await populate();
    h.store.failNext.deleteUserData = new Error('connection reset');
    const res = await del();
    expect(res.statusCode).toBe(503);
    expect(h.store.convs.has(a1)).toBe(true);
    expect(h.store.recordings.has(recordingPath(USER_A, a1))).toBe(true);
  });
});

describe('SupabaseStore.deleteUserData / deleteUserRecordings', () => {
  const USER = 'a0000000-0000-4000-8000-00000000000a';

  function fakeDb(opts: { rpcError?: { message: string; code?: string }; pages?: string[][] } = {}) {
    const calls: string[] = [];
    const pages = [...(opts.pages ?? [])];
    const db = {
      rpc: vi.fn(async (fn: string, args: unknown) => {
        calls.push(`rpc ${fn} ${JSON.stringify(args)}`);
        return opts.rpcError
          ? { data: null, error: opts.rpcError }
          : { data: { conversations: 3, folders: 1, concepts: 4, conceptLinks: 5 }, error: null };
      }),
      from(table: string) {
        const b: Record<string, unknown> = {};
        b.delete = () => b;
        b.eq = (col: string, v: string) => {
          calls.push(`delete ${table} where ${col}=${v}`);
          return b;
        };
        b.then = (resolve: (v: unknown) => void) => resolve({ error: null, count: 2 });
        return b;
      },
      storage: {
        from: () => ({
          list: vi.fn(async (prefix: string) => {
            calls.push(`list ${prefix}`);
            return { data: (pages.shift() ?? []).map((name) => ({ name })), error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            calls.push(`remove ${paths.join(',')}`);
            return { error: null };
          }),
        }),
      },
    };
    return { db: db as unknown as SupabaseClient, calls };
  }

  it('calls delete_user_data once for the user (one transaction)', async () => {
    const { db, calls } = fakeDb();
    expect(await new SupabaseStore(db).deleteUserData(USER)).toEqual({
      conversations: 3,
      folders: 1,
      concepts: 4,
      conceptLinks: 5,
      atomic: true,
    });
    expect(calls).toEqual([`rpc delete_user_data {"p_user":"${USER}"}`]);
  });

  it('falls back to table-by-table deletes (same order) when migration 0002 is not applied', async () => {
    const { db, calls } = fakeDb({
      rpcError: { message: 'Could not find the function public.delete_user_data', code: 'PGRST202' },
    });
    const out = await new SupabaseStore(db).deleteUserData(USER);
    expect(out.atomic).toBe(false);
    expect(calls.slice(1)).toEqual([
      `delete concept_links where user_id=${USER}`,
      `delete conversations where user_id=${USER}`,
      `delete concepts where user_id=${USER}`,
      `delete folders where user_id=${USER}`,
    ]);
  });

  it('any other database error is thrown, not hidden by the fallback', async () => {
    const { db, calls } = fakeDb({ rpcError: { message: 'permission denied' } });
    await expect(new SupabaseStore(db).deleteUserData(USER)).rejects.toThrow(/permission denied/);
    expect(calls).toHaveLength(1);
  });

  it('removes every recording under the user prefix, page by page', async () => {
    const { db, calls } = fakeDb({ pages: [['c1.webm', 'c2.webm'], ['c3.webm'], []] });
    expect(await new SupabaseStore(db).deleteUserRecordings(USER)).toBe(3);
    expect(calls).toEqual([
      `list ${USER}`,
      `remove ${USER}/c1.webm,${USER}/c2.webm`,
      `list ${USER}`,
      `remove ${USER}/c3.webm`,
      `list ${USER}`,
    ]);
  });
});

describe('migration 0002', () => {
  it('runs as one function the browser cannot call', () => {
    const sql = readFileSync(
      new URL('../../../../supabase/migrations/0002_delete_user_data.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(/create or replace function delete_user_data\(p_user uuid\)/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on function delete_user_data\(uuid\) from anon, authenticated/);
    expect(sql).toMatch(/grant execute on function delete_user_data\(uuid\) to service_role/);
    for (const table of ['concept_links', 'conversations', 'concepts', 'folders']) {
      expect(sql).toMatch(new RegExp(`delete from ${table} where user_id = p_user`));
    }
  });
});
