/** Review hardening for the REST routes and finalisation (PR #5 review). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyOps, recordingPath } from '@constellate/shared';
import { makeHarness, recordConversation, USER_A, USER_B, type Harness } from '../test-utils';
import { checkUserOps } from './user-ops';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` });
const post = (id: string, ops: unknown[], token = 'token-a') =>
  h.app.inject({ method: 'POST', url: `/conversations/${id}/ops`, headers: auth(token), payload: { ops } });

describe('user batch policy', () => {
  it('refuses server-only fields, merges and foreign conversation ids; allows the rest', () => {
    const cid = 'c0000000-0000-4000-8000-000000000001';
    expect(checkUserOps([{ op: 'conversation.update', patch: { title: 'x', isFavorite: true } }], cid)).toBeNull();
    expect(checkUserOps([{ op: 'conversation.update', patch: { audioPath: 'u/c.webm' } }], cid)).toMatch(/audioPath/);
    expect(checkUserOps([{ op: 'node.merge', fromId: 'a', intoId: 'b' }], cid)).toMatch(/finalisation/);
    expect(
      checkUserOps(
        [
          {
            op: 'flag.add',
            flag: { id: 'f', conversationId: 'other', atMs: 0, nodeId: null, note: null, source: 'tap' },
          },
        ],
        cid,
      ),
    ).toMatch(/another conversation/);
  });

  it('POST /ops: no server-only fields, no merges, nothing for another conversation', async () => {
    h = await makeHarness();
    const a = await recordConversation(h);
    const b = await recordConversation(h, 'token-b');
    const before = (await h.store.loadGraph(a))!;
    const [n1, n2] = Object.values(before.nodes).sort((x, y) => x.seq - y.seq);

    for (const patch of [
      { audioPath: `${USER_B}/${b}.webm` },
      { status: 'ready' },
      { status: 'live' },
      { startedAt: '2020-01-01T00:00:00.000Z' },
      { endedAt: null },
      { durationMs: 1 },
    ]) {
      const res = await post(a, [{ op: 'conversation.update', patch }]);
      expect(res.statusCode, JSON.stringify(patch)).toBe(403);
      expect(res.json().error).toBe('forbidden_op');
    }
    expect((await post(a, [{ op: 'node.merge', fromId: n2!.id, intoId: n1!.id }])).statusCode).toBe(403);

    const foreign = [
      {
        op: 'edge.add',
        edge: { id: crypto.randomUUID(), conversationId: b, sourceId: n1!.id, targetId: n2!.id, kind: 'user' },
      },
      {
        op: 'annotation.upsert',
        annotation: { id: crypto.randomUUID(), conversationId: b, nodeId: null, text: 'x', x: 0, y: 0 },
      },
      {
        op: 'flag.add',
        flag: { id: crypto.randomUUID(), conversationId: b, atMs: 0, nodeId: null, note: null, source: 'tap' },
      },
    ];
    for (const op of foreign) expect((await post(a, [op])).statusCode, op.op).toBe(403);

    // allowed fields still work, and nothing refused above was applied
    expect(
      (await post(a, [{ op: 'conversation.update', patch: { title: 'Hockey', reflection: 'fun' } }])).statusCode,
    ).toBe(200);
    expect((await h.store.loadGraph(a))!.lastSeq).toBe(before.lastSeq + 1);
  });

  it("a known id from another user's conversation cannot be re-used to overwrite their row", async () => {
    h = await makeHarness();
    const a = await recordConversation(h);
    const b = await recordConversation(h, 'token-b');
    const bNode = Object.values((await h.store.loadGraph(b))!.nodes)[0]!;
    const res = await post(a, [{ op: 'node.add', node: { ...bNode, conversationId: a, label: 'Mine now' } }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('id_in_use');
    expect((await h.store.loadGraph(b))!.nodes[bNode.id]!.label).toBe(bNode.label);
    expect(h.store.materialized(b).nodes[bNode.id]!.label).toBe(bNode.label);
  });
});

describe('commitment.update in user batches', () => {
  it('the policy allows it (it carries no conversation id and no server-only field)', () => {
    expect(checkUserOps([{ op: 'commitment.update', id: 'k1', patch: { done: true } }], 'c1')).toBeNull();
    expect(checkUserOps([{ op: 'commitment.update', id: 'k1', patch: { text: 'Send the essay' } }], 'c1')).toBeNull();
  });

  it('POST /ops ticks off and edits a commitment of this conversation, persisted', async () => {
    h = await makeHarness();
    const a = await recordConversation(h);
    const commitment = {
      id: crypto.randomUUID(),
      conversationId: a,
      nodeId: null,
      text: 'Send Sam the paper',
      speaker: null,
      atMs: 1_000,
      done: false,
    };
    expect((await post(a, [{ op: 'commitment.add', commitment }])).statusCode).toBe(200);
    const res = await post(a, [
      { op: 'commitment.update', id: commitment.id, patch: { done: true, text: 'Send Sam the essay' } },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().batch.source).toBe('user');
    const want = { ...commitment, done: true, text: 'Send Sam the essay' };
    expect((await h.store.loadGraph(a))!.commitments).toEqual([want]);
    expect(h.store.materialized(a).commitments).toEqual([want]); // the row too, not just the op log
  });

  it("an unknown id, or another conversation's commitment, is refused and changes nothing", async () => {
    h = await makeHarness();
    const a = await recordConversation(h);
    const b = await recordConversation(h, 'token-b');
    const bCommitment = {
      id: crypto.randomUUID(),
      conversationId: b,
      nodeId: null,
      text: 'B promise',
      speaker: null,
      atMs: 0,
      done: false,
    };
    expect((await post(b, [{ op: 'commitment.add', commitment: bCommitment }], 'token-b')).statusCode).toBe(200);
    const before = (await h.store.loadGraph(a))!.lastSeq;

    const unknown = await post(a, [{ op: 'commitment.update', id: crypto.randomUUID(), patch: { done: true } }]);
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error).toBe('unknown_commitment');
    const foreign = await post(a, [{ op: 'commitment.update', id: bCommitment.id, patch: { done: true } }]);
    expect(foreign.statusCode).toBe(409);
    expect((await h.store.loadGraph(b))!.commitments[0]!.done).toBe(false);
    expect((await h.store.loadGraph(a))!.lastSeq).toBe(before);

    // fields other than text/done are refused by the schema
    const extra = await post(a, [{ op: 'commitment.update', id: bCommitment.id, patch: { nodeId: null } }]);
    expect(extra.statusCode).toBe(400);
  });
});

describe('authentication on every route', () => {
  it('mutating, transcript and Brain routes reject a missing or forged token', async () => {
    h = await makeHarness();
    const id = await recordConversation(h);
    const calls = [
      { method: 'POST', url: `/conversations/${id}/ops`, payload: { ops: [{ op: 'active.set', nodeId: null }] } },
      { method: 'POST', url: `/conversations/${id}/finalize` },
      { method: 'DELETE', url: `/conversations/${id}` },
      { method: 'GET', url: `/conversations/${id}/utterances` },
      { method: 'POST', url: '/brain/rebuild' },
      { method: 'GET', url: '/brain' },
      { method: 'GET', url: '/brain/search?q=hockey' },
    ] as const;
    for (const c of calls) {
      for (const headers of [{}, auth('forged')]) {
        const res = await h.app.inject({ ...c, headers });
        expect(res.statusCode, `${c.method} ${c.url}`).toBe(401);
      }
    }
    expect(h.store.convs.has(id)).toBe(true);
  });
});

describe('finalisation hardening', () => {
  /** forge a stored audioPath the way old data or a bug could (users can no longer set it) */
  async function forgeAudioPath(id: string, audioPath: string) {
    const g = (await h.store.loadGraph(id))!;
    const batch = {
      conversationId: id,
      seq: g.lastSeq + 1,
      at: new Date().toISOString(),
      source: 'finalize' as const,
      ops: [{ op: 'conversation.update' as const, patch: { audioPath } }],
    };
    await h.store.appendBatch(USER_A, batch, g, applyOps(g, batch));
  }

  it("delete and finalise only touch the owner's canonical recording path", async () => {
    const transcribeFile = vi.fn(async () => [{ speaker: 0, startMs: 0, endMs: 1_000, text: 'stolen' }]);
    h = await makeHarness({ transcribeFile });
    const a = await recordConversation(h);
    const b = await recordConversation(h, 'token-b');
    const bPath = recordingPath(USER_B, b);
    h.store.recordings.set(bPath, Buffer.from('B audio'));
    await forgeAudioPath(a, bPath);

    const fin = await h.app.inject({ method: 'POST', url: `/conversations/${a}/finalize?wait=1`, headers: auth() });
    expect(fin.json().transcript).toBe('live');
    expect(transcribeFile).not.toHaveBeenCalled();

    await h.app.inject({ method: 'DELETE', url: `/conversations/${a}`, headers: auth() });
    expect(h.store.recordings.has(bPath)).toBe(true);
  });

  it('an unexpected database error ends `failed` with the live graph kept, never stuck `processing`', async () => {
    h = await makeHarness({ finalizeConversation: async () => ({ ops: [], recallPrompts: [] }) });
    const id = await recordConversation(h);
    const before = (await h.store.loadGraph(id))!;
    h.store.failNext.listUtterances = new Error('connection terminated');
    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json()).toMatchObject({ status: 'failed' });
    const after = (await h.store.loadGraph(id))!;
    expect(after.conversation.status).toBe('failed');
    expect(after.nodes).toEqual(before.nodes);
  });

  it('if the diarized transcript cannot be saved, node evidence keeps the live ids', { timeout: 15_000 }, async () => {
    const transcribeFile = vi.fn(async () => [{ speaker: 0, startMs: 0, endMs: 9_000, text: 'everything' }]);
    h = await makeHarness({ transcribeFile, finalizeConversation: async () => ({ ops: [], recallPrompts: [] }) });
    const id = await recordConversation(h);
    h.store.recordings.set(recordingPath(USER_A, id), Buffer.from('webm'));
    const before = (await h.store.loadGraph(id))!;
    h.store.replaceUtterances = async () => {
      throw new Error('write failed');
    };
    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json()).toEqual({ status: 'ready', transcript: 'live' });
    expect(transcribeFile).toHaveBeenCalledOnce();
    const after = (await h.store.loadGraph(id))!;
    for (const n of Object.values(before.nodes)) expect(after.nodes[n.id]!.utteranceIds).toEqual(n.utteranceIds);
    expect((await h.store.listUtterances(id)).map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('a forced re-finalisation replaces recall cards instead of duplicating them', async () => {
    h = await makeHarness({
      finalizeConversation: async ({ state }) => ({
        ops: [],
        recallPrompts: [{ nodeId: Object.keys(state.nodes)[0]!, prompt: 'What was the score?' }],
      }),
    });
    const id = await recordConversation(h);
    await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    const again = await h.app.inject({
      method: 'POST',
      url: `/conversations/${id}/finalize?wait=1&force=1`,
      headers: auth(),
    });
    expect(again.json().status).toBe('ready');
    expect(h.store.recallCards(id)).toHaveLength(1);
  });
});
