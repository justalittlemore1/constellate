import { afterEach, describe, expect, it } from 'vitest';
import { AUDIO_BYTES_PER_MS, AUDIO_FRAME_BYTES } from '@constellate/shared';
import { connect, makeHarness, until, USER_A, type Harness } from '../test-utils';
import { SpeechUnavailableError } from './session';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const hello = (over: Record<string, unknown> = {}) => ({
  t: 'hello',
  token: 'token-a',
  source: 'mic',
  consent: true,
  ...over,
});

describe('live protocol', () => {
  it('round trip: hello → ready → captions → ops → flag → stop → stopped, all persisted', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send(hello());
    const { conversationId } = await c.waitFor('ready');
    await c.waitFor('status', (m) => m.stage === 'listening');
    const fake = h.adapters[0]!;
    expect(fake.started).toBe(true);

    for (let i = 0; i < 30; i++) c.sendAudio(AUDIO_FRAME_BYTES); // 3 s of audio
    await until(() => fake.pushedBytes === 30 * AUDIO_FRAME_BYTES);

    fake.emit({ text: 'did you catch', final: false, startMs: 200, endMs: 900 });
    const interim = await c.waitFor('caption', (m) => !m.final);
    expect(interim).toEqual({ t: 'caption', text: 'did you catch', final: false, startMs: 200 });

    fake.emit({ text: 'Did you catch the game last night?', startMs: 200, endMs: 2_400 });
    const cap = await c.waitFor('caption', (m) => m.final);
    expect(cap).toMatchObject({ utteranceId: 'u1', startMs: 200 });
    const first = await c.waitFor('ops');
    expect(first.batch).toMatchObject({ conversationId, seq: 1, source: 'live' });
    const nodeAdd = first.batch.ops.find((o) => o.op === 'node.add');
    expect(nodeAdd).toBeDefined();
    const nodeId = nodeAdd!.op === 'node.add' ? nodeAdd!.node.id : '';

    c.send({ t: 'flag', atMs: 1_000, source: 'key' });
    const flagBatch = await c.waitFor('ops', (m) => m.batch.ops.some((o) => o.op === 'flag.add'));
    const flagOp = flagBatch.batch.ops[0]!;
    expect(flagOp.op === 'flag.add' && flagOp.flag).toMatchObject({ atMs: 1_000, nodeId, source: 'key' });

    c.send({ t: 'park', text: 'ask about soccer later', atMs: 2_500 });
    await c.waitFor('ops', (m) => m.batch.ops.some((o) => o.op === 'node.add' && o.node.kind === 'parked'));

    fake.flushOnStop = [{ text: 'NEW and one last thing', final: true, startMs: 2_500, endMs: 3_000, speaker: null }];
    c.send({ t: 'stop' });
    await c.waitFor('status', (m) => m.stage === 'finalizing');
    const stopped = await c.waitFor('stopped');
    expect(stopped.conversationId).toBe(conversationId);
    expect(await c.closed).toBe(1000);
    expect(fake.stopped).toBe(true);

    // the final flushed on stop still reached the interpreter
    expect(c.messages.some((m) => m.t === 'caption' && m.final && m.utteranceId === 'u2')).toBe(true);

    const utterances = await h.store.listUtterances(conversationId);
    expect(utterances.map((u) => u.id)).toEqual(['u1', 'u2']);
    const reloaded = (await h.store.loadGraph(conversationId))!;
    expect(reloaded.conversation).toMatchObject({ status: 'processing', durationMs: 3_000, userId: USER_A });
    expect(reloaded.flags).toHaveLength(1);
    // every batch the client saw is in the reloaded state, and the reducer agrees with the rows
    const lastSeq = Math.max(...c.messages.flatMap((m) => (m.t === 'ops' ? [m.batch.seq] : [])));
    expect(reloaded.lastSeq).toBe(lastSeq);
    const rows = h.store.materialized(conversationId);
    expect(rows.nodes).toEqual(reloaded.nodes);
    expect(rows.edges).toEqual(reloaded.edges);
    expect(rows.flags).toEqual(reloaded.flags);
    expect(Object.keys(reloaded.nodes)).toHaveLength(3); // two topics + one parked thought
    // embeddings were saved after their node rows existed
    await until(() => h.store.embeddings.size === 2);
  });

  it('replays a transcript fixture through the same pipeline', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send(hello({ source: 'replay-transcript', fixture: '01-simple-shift' }));
    const { conversationId } = await c.waitFor('ready');
    const fixture = await import('@constellate/shared/fixtures/transcripts/01-simple-shift.json');
    const n = fixture.default.utterances.length;
    await c.waitFor('caption', (m) => m.final && m.utteranceId === `u${n}`, 5_000);
    const finals = c.messages.filter((m) => m.t === 'caption' && m.final);
    expect(finals.map((m) => (m.t === 'caption' ? m.text : ''))).toEqual(fixture.default.utterances.map((u) => u.text));
    expect(c.messages.some((m) => m.t === 'caption' && !m.final)).toBe(true);
    c.send({ t: 'stop' });
    await c.waitFor('stopped');
    expect((await h.store.listUtterances(conversationId)).length).toBe(n);
  });

  it('rejects a bad token with a fatal auth error and creates nothing', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send(hello({ token: 'forged' }));
    const err = await c.waitFor('error');
    expect(err).toMatchObject({ code: 'auth', fatal: true });
    await c.closed;
    expect(h.store.convs.size).toBe(0);
  });

  it('refuses to record without consent', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send({ t: 'hello', token: 'token-a', source: 'mic' });
    const err = await c.waitFor('error');
    expect(err).toMatchObject({ code: 'protocol', fatal: true });
    expect(err.message).toMatch(/consent/);
    await c.closed;
    expect(h.store.convs.size).toBe(0);
  });

  it('rejects audio before hello and unknown fixtures', async () => {
    h = await makeHarness();
    const a = await connect(h.app);
    a.sendAudio(AUDIO_FRAME_BYTES);
    expect(await a.waitFor('error')).toMatchObject({ code: 'protocol', fatal: true });
    const b = await connect(h.app);
    b.send(hello({ source: 'replay-transcript', fixture: '../../etc/passwd' }));
    expect(await b.waitFor('error')).toMatchObject({ code: 'protocol', fatal: true });
    expect(h.store.convs.size).toBe(0);
  });

  it('answers ping with pong before and after hello; bad JSON is not fatal', async () => {
    h = await makeHarness();
    const c = await connect(h.app);
    c.send({ t: 'ping' });
    await c.waitFor('pong');
    c.send(hello());
    await c.waitFor('ready');
    (c as unknown as { send(raw: unknown): void }).send('{nope');
    await c.waitFor('error', (m) => !m.fatal);
    c.send({ t: 'ping' });
    await until(() => c.messages.filter((m) => m.t === 'pong').length === 2);
  });

  it('a dropped socket can resume the same conversation; utterance ids and clock continue', async () => {
    h = await makeHarness();
    const c1 = await connect(h.app);
    c1.send(hello());
    const { conversationId } = await c1.waitFor('ready');
    h.adapters[0]!.emit({ text: 'first thing', startMs: 0, endMs: 1_000 });
    await c1.waitFor('caption', (m) => m.final);
    c1.close();
    await until(() => h.adapters[0]!.stopped);

    const c2 = await connect(h.app);
    c2.send(hello({ conversationId, resumeAtMs: 5_000 }));
    expect((await c2.waitFor('ready')).conversationId).toBe(conversationId);
    c2.sendAudio(AUDIO_BYTES_PER_MS * 1_000);
    h.adapters[1]!.emit({ text: 'second thing', startMs: 5_100, endMs: 5_900 });
    expect(await c2.waitFor('caption', (m) => m.final)).toMatchObject({ utteranceId: 'u2' });
    c2.send({ t: 'stop' });
    await c2.waitFor('stopped');
    const g = (await h.store.loadGraph(conversationId))!;
    expect(g.conversation.durationMs).toBe(6_000);
    expect(h.store.convs.size).toBe(1);
  });

  it("another user can neither resume nor detect someone else's conversation", async () => {
    h = await makeHarness();
    const a = await connect(h.app);
    a.send(hello());
    const { conversationId } = await a.waitFor('ready');
    const b = await connect(h.app);
    b.send(hello({ token: 'token-b', conversationId, resumeAtMs: 0 }));
    const err = await b.waitFor('error');
    expect(err).toMatchObject({ code: 'auth', fatal: true, message: 'conversation not found' });
    // A is unaffected
    a.send({ t: 'ping' });
    await a.waitFor('pong');
  });

  it('an abandoned session is stopped after the grace period', async () => {
    h = await makeHarness({ abandonAfterMs: 50 });
    const c = await connect(h.app);
    c.send(hello());
    const { conversationId } = await c.waitFor('ready');
    c.close();
    await until(() => h.store.convs.get(conversationId)?.row.conversation.status === 'processing', 2_000);
  });

  it('a missing speech provider key is a fatal stt error and the conversation is marked failed', async () => {
    h = await makeHarness({
      createSpeech: () => {
        throw new SpeechUnavailableError('GEMINI_API_KEY is not set on the server');
      },
    });
    const c = await connect(h.app);
    c.send(hello());
    const err = await c.waitFor('error');
    expect(err).toMatchObject({ code: 'stt', fatal: true });
    await until(() => [...h.store.convs.values()].some((r) => r.row.conversation.status === 'failed'));
  });
});
