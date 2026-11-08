import { AUDIO_FRAME_MS, emptyGraph, type ClientMsg, type GraphState } from '@constellate/shared';
import { batch, makeConversation, makeEdge, makeNode, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDemoGraph, loadDemoOps } from '../../lib/fixtures';
import {
  BACKOFF_MS,
  LiveController,
  MAX_BUFFERED_FRAMES,
  PING_INTERVAL_MS,
  STOP_TIMEOUT_MS,
  type LiveSourceSpec,
} from './controller';
import { mockDeps } from './deps';
import { fakeDeps, flush } from './testing';

const MIC: LiveSourceSpec = { kind: 'mic' };
const DEMO: LiveSourceSpec = { kind: 'transcript', fixture: 'demo-religion' };

const hellos = (sent: ClientMsg[]) => sent.filter((m): m is Extract<ClientMsg, { t: 'hello' }> => m.t === 'hello');

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** start a mic session on fake deps and complete the handshake */
async function liveMic(graph: GraphState = emptyGraph(makeConversation())) {
  const f = fakeDeps({ graph: () => structuredClone(graph) });
  const c = new LiveController(MIC, f.deps);
  c.requestConsent();
  await c.consent();
  f.net.last.open();
  f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
  await flush();
  return { c, ...f };
}

describe('mock replay (VITE_USE_MOCKS)', () => {
  it('replays the recorded op stream through the protocol and ends in exactly loadDemoGraph()', async () => {
    const { deps, server } = mockDeps({ speed: 4 });
    const c = new LiveController(DEMO, deps);
    c.requestConsent();
    await c.consent();
    await vi.runAllTimersAsync();

    const s = c.getSnapshot();
    expect(s.phase).toBe('stopped');
    expect(s.error).toBeNull();
    expect(s.graph).toEqual(loadDemoGraph());
    expect(s.captions.length).toBeGreaterThan(5);
    expect(hellos(server.received)).toEqual([
      { t: 'hello', token: 'mock-token', source: 'replay-transcript', fixture: 'demo-religion', consent: true },
    ]);
    server.dispose();
  });

  it('runs on the gaps between `at` times, four times faster at speed 4', async () => {
    const ops = loadDemoOps();
    const { deps, server } = mockDeps({ speed: 4 });
    const c = new LiveController(DEMO, deps);
    c.requestConsent();
    await c.consent();
    const t0 = Date.parse(loadDemoGraph().conversation.startedAt);
    const secondAt = (Date.parse(ops[1]!.at) - t0) / 4;
    await vi.advanceTimersByTimeAsync(secondAt - 50);
    expect(c.getSnapshot().graph?.lastSeq).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(c.getSnapshot().graph?.lastSeq).toBe(2);
    // the timer follows the conversation clock (4× wall time)
    expect(c.clockMs()).toBeGreaterThan(secondAt * 4 - 400);
    c.dispose();
    server.dispose();
  });

  it('reconnects with conversationId + resumeAtMs and never duplicates nodes when a batch arrives twice', async () => {
    const ops = loadDemoOps();
    const { deps, server } = mockDeps({ speed: 4 });
    const c = new LiveController(DEMO, deps);
    c.requestConsent();
    await c.consent();
    await vi.advanceTimersByTimeAsync(60_000); // ~4 min of conversation
    const before = c.getSnapshot().graph!;
    expect(before.lastSeq).toBeGreaterThan(4);

    // the same batch twice on a healthy connection
    server.resend(ops[0]!);
    server.resend(ops[before.lastSeq - 1]!);
    await vi.advanceTimersByTimeAsync(1);
    expect(c.getSnapshot().graph).toBe(before);

    server.drop();
    expect(c.getSnapshot().reconnecting).toBe(true);
    expect(c.getSnapshot().phase).toBe('live');
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + 10);
    expect(c.getSnapshot().reconnecting).toBe(false);

    const [, again] = hellos(server.received);
    expect(again).toMatchObject({ conversationId: server.conversationId, consent: true });
    expect(again!.resumeAtMs).toBeGreaterThan(200_000);

    // the server re-sends everything it thinks we might have missed
    for (const b of ops.slice(0, before.lastSeq)) server.resend(b);
    await vi.advanceTimersByTimeAsync(1);
    const nodes = Object.keys(c.getSnapshot().graph!.nodes);
    expect(new Set(nodes).size).toBe(nodes.length);
    expect(c.getSnapshot().error).toBeNull();

    await vi.runAllTimersAsync();
    expect(c.getSnapshot().graph).toEqual(loadDemoGraph());
    server.dispose();
  });

  it('turns flag and park into ops on the map', async () => {
    const { deps, server } = mockDeps({ speed: 4 });
    const c = new LiveController(DEMO, deps);
    c.requestConsent();
    await c.consent();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(c.flag('button')).toBe(true);
    expect(c.park('  Ask about Lisbon  ')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const g = c.getSnapshot().graph!;
    expect(g.flags.some((f) => f.source === 'button' && f.nodeId !== null)).toBe(true);
    const parked = Object.values(g.nodes).find((n) => n.kind === 'parked' && n.label === 'Ask about Lisbon');
    expect(parked).toMatchObject({ status: 'unexplored', createdBy: 'user' });
    expect(Object.values(g.edges).some((e) => e.kind === 'tether' && e.targetId === parked!.id)).toBe(true);
    c.dispose();
    server.dispose();
  });

  it('stops early on request and ends as processing', async () => {
    const { deps, server } = mockDeps({ speed: 4 });
    const c = new LiveController(DEMO, deps);
    c.requestConsent();
    await c.consent();
    await vi.advanceTimersByTimeAsync(20_000);
    const stopping = c.stop();
    expect(c.getSnapshot().phase).toBe('stopping');
    await vi.runAllTimersAsync();
    await stopping;
    expect(c.getSnapshot().phase).toBe('stopped');
    expect(c.getSnapshot().graph?.conversation.status).toBe('processing');
    expect(server.received.at(-1)).toEqual({ t: 'stop' });
    server.dispose();
  });
});

describe('consent', () => {
  it('captures and sends no audio before consent; hello carries consent: true and precedes every frame', async () => {
    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    expect(c.getSnapshot().phase).toBe('consenting');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.deps.startCapture).not.toHaveBeenCalled();
    expect(f.net.conns).toHaveLength(0);

    await c.consent();
    expect(f.deps.startCapture).toHaveBeenCalledOnce();
    f.capture.emit(3); // audio before the socket is even open
    const conn = f.net.last;
    expect(conn.audio).toHaveLength(0);
    conn.open();
    expect(conn.sent[0]).toEqual({ t: 'hello', token: 'tok', source: 'mic', consent: true });
    f.capture.emit(2, 3);
    expect(conn.audio).toHaveLength(0); // still not ready

    conn.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    expect(c.getSnapshot().phase).toBe('live');
    expect(conn.audio.map((a) => new Uint8Array(a)[0])).toEqual([0, 1, 2, 3, 4]); // buffered, in order
    f.capture.emit(1, 5);
    expect(conn.audio).toHaveLength(6);
    c.dispose();
  });

  it('cancelling consent stops without ever opening a connection', async () => {
    const f = fakeDeps();
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    await c.stop();
    expect(c.getSnapshot().phase).toBe('stopped');
    expect(f.deps.startCapture).not.toHaveBeenCalled();
    expect(f.net.conns).toHaveLength(0);
  });
});

describe('microphone errors', () => {
  it('reports a denied microphone as mic-denied (the screen offers WAV replay)', async () => {
    const f = fakeDeps({
      startCapture: vi.fn(async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }),
    });
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    await c.consent();
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', error: { code: 'mic-denied' } });
    expect(f.net.conns).toHaveLength(0);
  });

  it('fails with auth when there is no session', async () => {
    const f = fakeDeps({ getAuth: vi.fn(async () => null) });
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    await c.consent();
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', error: { code: 'auth' } });
    expect(f.deps.startCapture).not.toHaveBeenCalled();
  });
});

describe('ops', () => {
  it('fetches the initial graph on ready, then applies batches with applyOps', async () => {
    const { c, deps, net } = await liveMic();
    expect(deps.fetchGraph).toHaveBeenCalledWith(TEST_CONVERSATION_ID, { token: 'tok', userId: 'u1' });
    net.last.push({ t: 'ops', batch: batch(1, [{ op: 'node.add', node: makeNode('a') }]) });
    expect(Object.keys(c.getSnapshot().graph!.nodes)).toEqual(['a']);
    c.dispose();
  });

  it('queues batches that arrive while the initial graph is loading', async () => {
    let release!: (g: GraphState) => void;
    const f = fakeDeps({ fetchGraph: vi.fn(() => new Promise<GraphState>((r) => (release = r))) });
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    await c.consent();
    f.net.last.open();
    f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    f.net.last.push({ t: 'ops', batch: batch(1, [{ op: 'node.add', node: makeNode('a') }]) });
    expect(c.getSnapshot().graph).toBeNull();
    release(emptyGraph(makeConversation()));
    await flush();
    expect(Object.keys(c.getSnapshot().graph!.nodes)).toEqual(['a']);
    c.dispose();
  });

  it('refetches GET /conversations/:id on an OpError instead of crashing', async () => {
    const server = emptyGraph(makeConversation());
    const { c, deps, net } = await liveMic(server);
    // edge to a node we never received
    net.last.push({ t: 'ops', batch: batch(1, [{ op: 'edge.add', edge: makeEdge('e', 'x', 'y') }]) });
    expect(deps.fetchGraph).toHaveBeenCalledTimes(2);
    await flush();
    expect(c.getSnapshot().phase).toBe('live');
    expect(c.getSnapshot().notice?.message).toMatch(/sync/);
    c.dispose();
  });

  it('refetches when batches were missed (seq gap), then applies the newer batch on top', async () => {
    const withA: GraphState = { ...emptyGraph(makeConversation()), nodes: { a: makeNode('a') }, lastSeq: 1 };
    let calls = 0;
    const f = fakeDeps({
      fetchGraph: vi.fn(async () => structuredClone(calls++ === 0 ? emptyGraph(makeConversation()) : withA)),
    });
    const c = new LiveController(MIC, f.deps);
    c.requestConsent();
    await c.consent();
    f.net.last.open();
    f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    await flush();
    f.net.last.push({ t: 'ops', batch: batch(2, [{ op: 'node.add', node: makeNode('b', { seq: 2 }) }]) });
    await flush();
    expect(f.deps.fetchGraph).toHaveBeenCalledTimes(2);
    expect(Object.keys(c.getSnapshot().graph!.nodes).sort()).toEqual(['a', 'b']);
    expect(c.getSnapshot().graph!.lastSeq).toBe(2);
    c.dispose();
  });

  it('shows interim captions dimmed until the final replaces them', async () => {
    const { c, net } = await liveMic();
    net.last.push({ t: 'caption', text: 'so I', final: false, startMs: 0 });
    expect(c.getSnapshot().interim).toBe('so I');
    net.last.push({ t: 'caption', text: 'So I went to church.', final: true, startMs: 0, utteranceId: 'u1' });
    expect(c.getSnapshot()).toMatchObject({ interim: null, captions: [{ text: 'So I went to church.' }] });
    net.last.push({ t: 'status', stage: 'thinking' });
    expect(c.getSnapshot().stage).toBe('thinking');
    c.dispose();
  });
});

describe('connection', () => {
  it('pings every 15 s', async () => {
    const { c, net } = await liveMic();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2 + 10);
    expect(net.last.sent.filter((m) => m.t === 'ping')).toHaveLength(2);
    c.dispose();
  });

  it('keeps the last 5 s of audio while reconnecting and resumes the clock at the first kept frame', async () => {
    const { c, net, capture } = await liveMic();
    capture.emit(10); // frames 0–9 sent live
    expect(net.last.audio).toHaveLength(10);
    net.last.drop();
    expect(c.getSnapshot().reconnecting).toBe(true);
    capture.emit(MAX_BUFFERED_FRAMES + 5, 10); // 55 frames while offline; the oldest 5 are dropped
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    const conn = net.last;
    conn.open();
    expect(conn.sent[0]).toMatchObject({
      t: 'hello',
      conversationId: TEST_CONVERSATION_ID,
      resumeAtMs: 15 * AUDIO_FRAME_MS,
      consent: true,
    });
    conn.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    expect(conn.audio).toHaveLength(MAX_BUFFERED_FRAMES);
    expect(new Uint8Array(conn.audio[0]!)[0]).toBe(15);
    expect(c.clockMs()).toBe(65 * AUDIO_FRAME_MS);
    c.dispose();
  });

  it('queues a flag raised while reconnecting and sends it once ready', async () => {
    const { c, net, capture } = await liveMic();
    capture.emit(20);
    net.last.drop();
    expect(c.flag('key')).toBe(true);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]);
    net.last.open();
    net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    expect(net.last.sent).toContainEqual({ t: 'flag', atMs: 2000, source: 'key' });
    c.dispose();
  });

  it('backs off between attempts and gives up after repeated failures', async () => {
    const { c, net } = await liveMic();
    net.last.drop();
    for (let i = 0; i < 10; i++) {
      const n = net.conns.length;
      await vi.advanceTimersByTimeAsync(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]!);
      expect(net.conns).toHaveLength(n + 1);
      net.last.drop();
    }
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', error: { code: 'network' } });
  });

  it('does not reconnect after a fatal server error', async () => {
    const { c, net } = await liveMic();
    net.last.push({ t: 'error', code: 'auth', message: 'invalid or expired token', fatal: true });
    net.last.drop(1008, 'invalid or expired token');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.conns).toHaveLength(1);
    expect(c.getSnapshot()).toMatchObject({ phase: 'error', error: { code: 'auth' } });
  });

  it('shows a non-fatal server error as a notice and keeps going', async () => {
    const { c, net } = await liveMic();
    net.last.push({ t: 'error', code: 'db', message: 'could not save', fatal: false });
    expect(c.getSnapshot()).toMatchObject({ phase: 'live', notice: { message: 'could not save' } });
    c.dispose();
  });
});

describe('stop', () => {
  it('stops audio, sends stop, waits for stopped, then uploads the recording', async () => {
    const { c, net, capture, deps } = await liveMic();
    capture.emit(3);
    const done = c.stop();
    expect(c.getSnapshot().phase).toBe('stopping');
    expect(net.last.sent.at(-1)).toEqual({ t: 'stop' });
    capture.emit(3, 3); // late frames after stop are never sent
    expect(net.last.audio).toHaveLength(3);
    await flush();
    expect(capture.stopped).toBe(true);
    expect(deps.upload).not.toHaveBeenCalled();
    net.last.push({ t: 'stopped', conversationId: TEST_CONVERSATION_ID });
    await done;
    expect(deps.upload).toHaveBeenCalledWith(expect.any(Blob), { token: 'tok', userId: 'u1' }, TEST_CONVERSATION_ID);
    expect(c.getSnapshot()).toMatchObject({ phase: 'stopped', upload: 'done' });
  });

  it('still finishes (and uploads) when the server never confirms', async () => {
    const { c, deps } = await liveMic();
    const done = c.stop();
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    await done;
    expect(deps.upload).toHaveBeenCalled();
    expect(c.getSnapshot().phase).toBe('stopped');
  });

  it('reports a failed upload without losing the stop', async () => {
    const { c, net } = await liveMic();
    const f = c as unknown as { deps: { upload: () => Promise<void> } };
    f.deps.upload = vi.fn(async () => {
      throw new Error('storage down');
    });
    const done = c.stop();
    net.last.push({ t: 'stopped', conversationId: TEST_CONVERSATION_ID });
    await done;
    expect(c.getSnapshot()).toMatchObject({ phase: 'stopped', upload: 'failed' });
  });

  it('stops by itself when a WAV replay ends', async () => {
    const f = fakeDeps({ graph: () => emptyGraph(makeConversation()) });
    const c = new LiveController({ kind: 'wav', data: new ArrayBuffer(8) }, f.deps);
    c.requestConsent();
    await c.consent();
    expect(f.deps.startCapture).toHaveBeenCalledWith(
      { kind: 'wav', data: expect.any(ArrayBuffer) },
      expect.any(Function),
    );
    f.net.last.open();
    expect(f.net.last.sent[0]).toMatchObject({ t: 'hello', source: 'mic' });
    f.net.last.push({ t: 'ready', conversationId: TEST_CONVERSATION_ID });
    f.capture.onEnded?.();
    expect(c.getSnapshot().phase).toBe('stopping');
    expect(f.net.last.sent.at(-1)).toEqual({ t: 'stop' });
    c.dispose();
  });
});
