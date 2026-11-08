import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordingPath, type FinalizeConversation, type GraphState, type OpBatch } from '@constellate/shared';
import { partsToSegments, parseOffset } from '../finalize/transcribe';
import { mapUtterances, remapEvidence } from '../finalize/remap';
import { connect, makeHarness, recordConversation, until, USER_A, type Harness } from '../test-utils';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` });

async function get(id: string, token = 'token-a') {
  return h.app.inject({ method: 'GET', url: `/conversations/${id}`, headers: auth(token) });
}

describe('GET /conversations/:id', () => {
  it('returns the full GraphState to its owner only', async () => {
    h = await makeHarness();
    const id = await recordConversation(h);
    const res = await get(id);
    expect(res.statusCode).toBe(200);
    const state = res.json() as GraphState;
    expect(state.conversation).toMatchObject({ id, userId: USER_A, status: 'processing' });
    expect(Object.values(state.nodes).filter((n) => n.kind === 'topic')).toHaveLength(2);
    expect(state.lastSeq).toBeGreaterThan(0);

    expect((await get(id, 'token-b')).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/conversations/${id}` })).statusCode).toBe(401);
    expect((await get(id, 'forged')).statusCode).toBe(401);
    expect((await get('not-a-uuid')).statusCode).toBe(404);
    expect((await get('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  it('serves the transcript to the owner only', async () => {
    h = await makeHarness();
    const id = await recordConversation(h);
    const res = await h.app.inject({ method: 'GET', url: `/conversations/${id}/utterances`, headers: auth() });
    expect(res.json().utterances.map((u: { id: string }) => u.id)).toEqual(['u1', 'u2', 'u3']);
    const other = await h.app.inject({
      method: 'GET',
      url: `/conversations/${id}/utterances`,
      headers: auth('token-b'),
    });
    expect(other.statusCode).toBe(404);
  });
});

describe('POST /conversations/:id/ops', () => {
  it('applies a user batch with the next seq, persists it, and rejects invalid ops', async () => {
    h = await makeHarness();
    const id = await recordConversation(h);
    const before = (await get(id)).json() as GraphState;
    const nodeId = Object.values(before.nodes)[0]!.id;

    const post = (body: unknown, token = 'token-a') =>
      h.app.inject({ method: 'POST', url: `/conversations/${id}/ops`, headers: auth(token), payload: body as object });

    const ok = await post({
      ops: [
        { op: 'node.update', id: nodeId, patch: { highlighted: true, x: 10, y: 20 } },
        {
          op: 'annotation.upsert',
          annotation: { id: crypto.randomUUID(), conversationId: id, nodeId, text: 'ask Sam', x: 0, y: 0 },
        },
      ],
    });
    expect(ok.statusCode).toBe(200);
    const batch = ok.json().batch as OpBatch;
    expect(batch).toMatchObject({ seq: before.lastSeq + 1, source: 'user', conversationId: id });
    const after = (await h.store.loadGraph(id))!;
    expect(after.nodes[nodeId]).toMatchObject({ highlighted: true, x: 10, y: 20 });
    expect(after.annotations).toHaveLength(1);

    const conflict = await post({ ops: [{ op: 'node.remove', id: nodeId }] }); // not provisional
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('not_provisional');
    expect((await h.store.loadGraph(id))!.lastSeq).toBe(batch.seq); // nothing half-applied

    expect((await post({ ops: [] })).statusCode).toBe(400);
    expect((await post({ ops: [{ op: 'nope' }] })).statusCode).toBe(400);
    expect((await post({ ops: [{ op: 'active.set', nodeId: null }] }, 'token-b')).statusCode).toBe(404);
  });

  it('during a live session, user batches share the seq counter and reach the live client', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send({ t: 'hello', token: 'token-a', source: 'mic', consent: true });
    const { conversationId } = await c.waitFor('ready');
    h.adapters[0]!.emit({ text: 'first topic', startMs: 0, endMs: 1_000 });
    const live = await c.waitFor('ops');
    const res = await h.app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/ops`,
      headers: auth(),
      payload: { ops: [{ op: 'conversation.update', patch: { location: 'Cafe' } }] },
    });
    expect(res.json().batch.seq).toBe(live.batch.seq + 1);
    await c.waitFor('ops', (m) => m.batch.source === 'user');
    h.adapters[0]!.emit({ text: 'more', startMs: 1_000, endMs: 2_000 });
    await c.waitFor('ops', (m) => m.batch.seq === live.batch.seq + 2 && m.batch.source === 'live');
    expect((await get(conversationId)).json().conversation.location).toBe('Cafe');
  });
});

describe('finalisation', () => {
  const rename: FinalizeConversation = async ({ state }) => {
    const first = Object.values(state.nodes).sort((a, b) => a.seq - b.seq)[0]!;
    return {
      ops: [
        { op: 'node.update', id: first.id, patch: { label: 'Hockey Night', details: 'They discussed the game.' } },
        { op: 'conversation.update', patch: { title: 'Hockey and a concert', summary: 'Two friends catch up.' } },
      ],
      recallPrompts: [
        { nodeId: first.id, prompt: 'Who stole the game?' },
        { nodeId: 'missing', prompt: 'dropped' },
      ],
    };
  };

  it('diarized transcript → evidence remapped → refinement batch → recall cards → ready', async () => {
    const transcribeFile = vi.fn(async () => [
      { speaker: 0, startMs: 0, endMs: 4_800, text: 'Did you see the hockey game? The goalie was amazing.' },
      { speaker: 1, startMs: 5_200, endMs: 9_100, text: 'Are you going to the concert?' },
    ]);
    h = await makeHarness({ finalizeConversation: rename, transcribeFile });
    const id = await recordConversation(h);
    h.store.recordings.set(recordingPath(USER_A, id), Buffer.from('webm'));

    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json()).toEqual({ status: 'ready', transcript: 'diarized' });
    expect(transcribeFile).toHaveBeenCalledOnce();

    const g = (await h.store.loadGraph(id))!;
    expect(g.conversation).toMatchObject({
      status: 'ready',
      title: 'Hockey and a concert',
      audioPath: recordingPath(USER_A, id),
    });
    const topics = Object.values(g.nodes).sort((a, b) => a.seq - b.seq);
    expect(topics[0]).toMatchObject({ label: 'Hockey Night', utteranceIds: ['u1'], speakers: [0] });
    expect(topics[1]).toMatchObject({ utteranceIds: ['u2'], speakers: [1] });
    expect((await h.store.listUtterances(id)).map((u) => [u.id, u.speaker])).toEqual([
      ['u1', 0],
      ['u2', 1],
    ]);
    expect(h.store.recallCards(id)).toEqual([{ nodeId: topics[0]!.id, prompt: 'Who stole the game?' }]);
    const batches = [...h.store.convs.get(id)!.opLog.values()];
    expect(batches.filter((b) => b.source === 'finalize').length).toBeGreaterThanOrEqual(2);

    // a second call is a no-op
    const again = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(again.json().status).toBe('skipped');
  });

  it('a failed refinement keeps the live graph and marks the conversation failed', async () => {
    h = await makeHarness({
      finalizeConversation: async () => {
        throw new Error('model timeout');
      },
    });
    const id = await recordConversation(h);
    const before = (await h.store.loadGraph(id))!;
    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json()).toMatchObject({ status: 'failed', transcript: 'live' });
    const after = (await h.store.loadGraph(id))!;
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(after.conversation.status).toBe('failed');
  });

  it('refinement ops the reducer rejects also keep the live graph', async () => {
    h = await makeHarness({
      finalizeConversation: async () => ({ ops: [{ op: 'node.remove', id: 'ghost' }], recallPrompts: [] }),
    });
    const id = await recordConversation(h);
    const before = (await h.store.loadGraph(id))!;
    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json().status).toBe('failed');
    expect((await h.store.loadGraph(id))!.nodes).toEqual(before.nodes);
  });

  it('a failed transcription falls back to the live transcript and still finishes', async () => {
    h = await makeHarness({
      finalizeConversation: rename,
      transcribeFile: async () => {
        throw new Error('503');
      },
    });
    const id = await recordConversation(h);
    h.store.recordings.set(recordingPath(USER_A, id), Buffer.from('webm'));
    const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth() });
    expect(res.json()).toEqual({ status: 'ready', transcript: 'live' });
    expect((await h.store.listUtterances(id)).map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('is refused while live and for other users; runs when asked after stop', async () => {
    const finalizeConversation = vi.fn(rename);
    h = await makeHarness({ finalizeConversation });
    const c = await connect(h.app);
    c.send({ t: 'hello', token: 'token-a', source: 'mic', consent: true });
    const { conversationId } = await c.waitFor('ready');
    const live = await h.app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/finalize`,
      headers: auth(),
    });
    expect(live.statusCode).toBe(409);
    h.adapters[0]!.emit({ text: 'something worth keeping', startMs: 0, endMs: 1_000 });
    await c.waitFor('ops');
    c.send({ t: 'stop' });
    await c.waitFor('stopped');
    const other = await h.app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/finalize`,
      headers: auth('token-b'),
    });
    expect(other.statusCode).toBe(404);
    const res = await h.app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/finalize`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
    await until(() => h.store.convs.get(conversationId)!.row.conversation.status === 'ready');
    expect(finalizeConversation).toHaveBeenCalledOnce();
  });

  it('the default onStopped hook finalises automatically', async () => {
    h = await makeHarness({ finalizeConversation: rename, onStopped: undefined });
    const id = await recordConversation(h);
    await until(() => h.store.convs.get(id)?.row.conversation.status === 'ready');
  });
});

describe('DELETE /conversations/:id', () => {
  it('removes the recording and every row, owner only', async () => {
    h = await makeHarness();
    const id = await recordConversation(h);
    const path = recordingPath(USER_A, id);
    h.store.recordings.set(path, Buffer.from('webm'));
    const del = (token: string) =>
      h.app.inject({ method: 'DELETE', url: `/conversations/${id}`, headers: auth(token) });
    expect((await del('token-b')).statusCode).toBe(404);
    expect(h.store.convs.has(id)).toBe(true);
    expect((await del('token-a')).statusCode).toBe(204);
    expect(h.store.convs.has(id)).toBe(false);
    expect(h.store.recordings.has(path)).toBe(false);
    expect((await get(id)).statusCode).toBe(404);
  });

  it('aborts a live session before deleting, without finalising it', async () => {
    const onStopped = vi.fn();
    h = await makeHarness({ onStopped });
    const c = await connect(h.app);
    c.send({ t: 'hello', token: 'token-a', source: 'mic', consent: true });
    const { conversationId } = await c.waitFor('ready');
    const res = await h.app.inject({ method: 'DELETE', url: `/conversations/${conversationId}`, headers: auth() });
    expect(res.statusCode).toBe(204);
    expect(await c.waitFor('error')).toMatchObject({ fatal: true, message: 'this conversation was deleted' });
    await c.closed;
    expect(c.messages.some((m) => m.t === 'stopped')).toBe(false);
    expect(onStopped).not.toHaveBeenCalled();
    expect(h.adapters[0]!.stopped).toBe(true);
    expect(h.store.convs.has(conversationId)).toBe(false);
  });
});

describe('transcript helpers', () => {
  it('parses offsets and turns diarized parts into merged speaker turns', () => {
    expect(parseOffset('1.240s')).toBe(1_240);
    expect(parseOffset('bad')).toBeNull();
    const w = (word: string, s: number, e: number) => ({ word, startOffset: `${s}s`, endOffset: `${e}s` });
    const segs = partsToSegments([
      { audioTranscription: { speakerLabel: 'spk_2', words: [w('Hi', 0.1, 0.3), w('there', 0.3, 0.6)] } },
      { audioTranscription: { speakerLabel: 'spk_2', words: [w('friend', 0.7, 1.0)] } },
      { text: 'not a transcription part' },
      { audioTranscription: { speakerLabel: 'spk_1', text: 'Hello.', startOffset: '1.2s', endOffset: '1.9s' } },
    ]);
    expect(segs).toEqual([
      { speaker: 0, startMs: 100, endMs: 1_000, text: 'Hi there friend' },
      { speaker: 1, startMs: 1_200, endMs: 1_900, text: 'Hello.' },
    ]);
  });

  it('maps live utterances to diarized turns by overlap, falling back to the nearest', () => {
    const u = (id: string, startMs: number, endMs: number, speaker: number | null = null) => ({
      id,
      conversationId: 'c',
      speaker,
      startMs,
      endMs,
      text: id,
    });
    const live = [u('u1', 0, 2_000), u('u2', 2_000, 6_000), u('u3', 9_500, 9_500)];
    const fresh = [u('u1', 0, 3_000, 0), u('u2', 3_100, 7_000, 1), u('u3', 8_000, 9_000, 0)];
    const map = mapUtterances(live, fresh);
    expect(map.get('u1')).toEqual(['u1']);
    expect(map.get('u2')).toEqual(['u1', 'u2']);
    expect(map.get('u3')).toEqual(['u3']);
  });

  it('remapEvidence only emits updates for nodes whose evidence changes', () => {
    const state = {
      nodes: {
        a: { id: 'a', seq: 1, utteranceIds: ['u1', 'u2'], speakers: [] },
        b: { id: 'b', seq: 2, utteranceIds: [], speakers: [] },
      },
    } as unknown as GraphState;
    const live = [
      { id: 'u1', conversationId: 'c', speaker: null, startMs: 0, endMs: 1_000, text: '' },
      { id: 'u2', conversationId: 'c', speaker: null, startMs: 1_000, endMs: 2_000, text: '' },
    ];
    const fresh = [{ id: 'u1', conversationId: 'c', speaker: 1, startMs: 0, endMs: 2_000, text: '' }];
    expect(remapEvidence(state, live, fresh)).toEqual([
      { op: 'node.update', id: 'a', patch: { utteranceIds: ['u1'], speakers: [1] } },
    ]);
  });
});
