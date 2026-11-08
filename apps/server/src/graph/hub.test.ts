import { describe, expect, it } from 'vitest';
import { applyBatches, emptyGraph, OpError, type GraphOp, type OpBatch } from '@constellate/shared';
import { makeConversation, makeEdge, makeNode } from '@constellate/shared/testing';
import { l2normalize } from '../ai/embed';
import { AudioClock } from '../live/clock';
import { diffStates } from '../store/diff';
import { MemoryStore } from '../store/memory';
import { replayGraph } from '../store/replay';
import { USER_A } from '../test-utils';
import { GraphHub } from './hub';

async function setup() {
  const store = new MemoryStore();
  const conv = await store.createConversation(USER_A);
  const hub = new GraphHub(store);
  const cell = (await hub.acquire(conv.id))!;
  const node = (id: string, over = {}) => makeNode(id, { conversationId: conv.id, ...over });
  return { store, conv, hub, cell, node };
}

describe('GraphHub', () => {
  it('assigns increasing seqs, applies synchronously and persists in order', async () => {
    const { store, conv, cell, node } = await setup();
    const a = cell.commit([{ op: 'node.add', node: node('n1') }], 'live');
    expect(cell.state.nodes.n1).toBeDefined(); // visible before persistence
    const b = cell.commit([{ op: 'node.update', id: 'n1', patch: { label: 'Hockey' } }], 'user');
    expect([a.batch.seq, b.batch.seq]).toEqual([1, 2]);
    await b.persisted;
    const g = (await store.loadGraph(conv.id))!;
    expect(g.lastSeq).toBe(2);
    expect(g.nodes.n1!.label).toBe('Hockey');
  });

  it('rejects an invalid batch without changing state or seq', async () => {
    const { cell } = await setup();
    expect(() =>
      cell.commit(
        [{ op: 'edge.add', edge: { ...makeEdge('e1', 'x', 'y'), conversationId: cell.conversationId } }],
        'live',
      ),
    ).toThrow(OpError);
    expect(cell.state.lastSeq).toBe(0);
  });

  it('retries a failed write and the batch still lands exactly once', async () => {
    const { store, conv, cell, node } = await setup();
    store.failNext.appendBatch = new Error('connection reset');
    await cell.commit([{ op: 'node.add', node: node('n1') }], 'live').persisted;
    expect(store.convs.get(conv.id)!.opLog.size).toBe(1);
    expect((await store.loadGraph(conv.id))!.nodes.n1).toBeDefined();
  });

  it('shares one cell between a live session and REST so seqs never collide', async () => {
    const { hub, conv, cell, node } = await setup();
    const again = (await hub.acquire(conv.id))!;
    expect(again).toBe(cell);
    cell.commit([{ op: 'node.add', node: node('n1') }], 'live');
    expect(again.commit([{ op: 'node.update', id: 'n1', patch: { highlighted: true } }], 'user').batch.seq).toBe(2);
  });

  it('enqueued writes (embeddings) run after earlier batches are persisted', async () => {
    const { store, cell, node } = await setup();
    const order: string[] = [];
    const orig = store.appendBatch.bind(store);
    store.appendBatch = async (...args) => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('batch');
      return orig(...args);
    };
    cell.commit([{ op: 'node.add', node: node('n1') }], 'live');
    await cell.enqueue('embedding', async () => {
      order.push('embedding');
    });
    expect(order).toEqual(['batch', 'embedding']);
  });
});

describe('persistence helpers', () => {
  it('re-sent batches are idempotent: the op log keeps one copy and replay ignores repeats', async () => {
    const store = new MemoryStore();
    const conv = await store.createConversation(USER_A);
    const g0 = (await store.loadGraph(conv.id))!;
    const b: OpBatch = {
      conversationId: conv.id,
      seq: 1,
      at: new Date().toISOString(),
      source: 'live',
      ops: [{ op: 'node.add', node: makeNode('n1', { conversationId: conv.id }) }],
    };
    const g1 = applyBatches(g0, [b]);
    await store.appendBatch(USER_A, b, g0, g1);
    await store.appendBatch(USER_A, b, g0, g1);
    expect(store.convs.get(conv.id)!.opLog.size).toBe(1);
    expect(applyBatches(g1, [b])).toBe(g1);
    expect((await store.loadGraph(conv.id))!).toEqual({ ...g1, conversation: g1.conversation });
  });

  it('replay skips a batch the reducer rejects instead of failing the whole conversation', () => {
    const c = makeConversation({ id: 'c1' });
    const ok: OpBatch = {
      conversationId: 'c1',
      seq: 1,
      at: '',
      source: 'live',
      ops: [{ op: 'node.add', node: makeNode('n1', { conversationId: 'c1' }) }],
    };
    const bad: OpBatch = {
      conversationId: 'c1',
      seq: 2,
      at: '',
      source: 'live',
      ops: [{ op: 'node.remove', id: 'missing' }],
    };
    const later: OpBatch = {
      conversationId: 'c1',
      seq: 3,
      at: '',
      source: 'live',
      ops: [{ op: 'node.update', id: 'n1', patch: { label: 'Later' } }],
    };
    const skipped: number[] = [];
    const g = replayGraph(c, [ok, bad, later], (seq) => skipped.push(seq));
    expect(skipped).toEqual([2]);
    expect(g.nodes.n1!.label).toBe('Later');
    expect(g.lastSeq).toBe(3);
  });

  it('diffStates finds upserts, deletions (incl. merges) and conversation changes', () => {
    const g0 = emptyGraph(makeConversation({ id: 'c' }));
    const n = (id: string, seq: number) => makeNode(id, { conversationId: 'c', seq, utteranceIds: [`u${seq}`] });
    const e = (id: string, s: string, t: string) => ({ ...makeEdge(id, s, t), conversationId: 'c' });
    const ops: GraphOp[] = [
      { op: 'node.add', node: n('a', 1) },
      { op: 'node.add', node: n('b', 2) },
      { op: 'node.add', node: n('c', 3) },
      { op: 'edge.add', edge: e('e1', 'a', 'b') },
      { op: 'edge.add', edge: e('e2', 'b', 'c') },
    ];
    const g1 = applyBatches(g0, [{ conversationId: 'c', seq: 1, at: '', source: 'live', ops }]);
    const g2 = applyBatches(g1, [
      {
        conversationId: 'c',
        seq: 2,
        at: '',
        source: 'finalize',
        ops: [
          { op: 'node.merge', fromId: 'c', intoId: 'b' },
          { op: 'conversation.update', patch: { title: 'Hockey night', status: 'ready' } },
        ],
      },
    ]);
    const d = diffStates(g1, g2);
    expect(d.deleteNodeIds).toEqual(['c']);
    expect(d.deleteEdgeIds).toEqual(['e2']); // b→c became a self-loop and was dropped
    expect(d.upsertNodes.map((x) => [x.id, x.utteranceIds])).toEqual([['b', ['u2', 'u3']]]);
    expect(d.conversationPatch).toEqual({ title: 'Hockey night', status: 'ready' });
    expect(diffStates(g2, g2)).toMatchObject({
      upsertNodes: [],
      deleteNodeIds: [],
      upsertEdges: [],
      conversationPatch: {},
    });
  });
});

describe('small utilities', () => {
  it('AudioClock: bytes ÷ 32 in audio mode, scaled wall time in replay mode, rebase on resume', () => {
    const audio = new AudioClock('audio', 1_000);
    audio.addBytes(3_200);
    expect(audio.nowMs()).toBe(1_100);
    audio.rebase(5_000);
    expect(audio.nowMs()).toBe(5_000);
    let now = 0;
    const wall = new AudioClock('wall', 0, 10, () => now);
    now = 100;
    expect(wall.nowMs()).toBe(1_000);
  });

  it('l2normalize yields unit vectors', () => {
    const v = l2normalize([3, 4]);
    expect(v).toEqual([0.6, 0.8]);
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });
});
