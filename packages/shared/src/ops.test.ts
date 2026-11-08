import { describe, expect, it } from 'vitest';
import { applyBatches, applyOps, OpError } from './ops';
import { batch, makeEdge, makeGraph, makeNode } from './testing';

const twoNodes = () =>
  applyOps(
    makeGraph(),
    batch(1, [
      { op: 'node.add', node: makeNode('a', { seq: 1 }) },
      { op: 'node.add', node: makeNode('b', { seq: 2 }) },
      { op: 'edge.add', edge: makeEdge('e1', 'a', 'b') },
    ]),
  );

describe('applyOps', () => {
  it('applies a batch and records its seq', () => {
    const s = twoNodes();
    expect(Object.keys(s.nodes)).toEqual(['a', 'b']);
    expect(s.edges.e1?.targetId).toBe('b');
    expect(s.lastSeq).toBe(1);
  });

  it('is pure: never mutates the input state', () => {
    const before = makeGraph();
    const snapshot = JSON.stringify(before);
    applyOps(before, batch(1, [{ op: 'node.add', node: makeNode('a') }]));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('ignores batches with seq ≤ lastSeq (idempotent replay)', () => {
    const s = twoNodes();
    const again = applyOps(s, batch(1, [{ op: 'node.add', node: makeNode('c') }]));
    expect(again).toBe(s);
    const older = applyOps(s, batch(0, [{ op: 'node.add', node: makeNode('c') }]));
    expect(older).toBe(s);
  });

  it('replaying the full log twice gives the same state', () => {
    const log = [
      batch(1, [{ op: 'node.add', node: makeNode('a') }]),
      batch(2, [{ op: 'node.add', node: makeNode('b', { seq: 2 }) }]),
    ];
    const once = applyBatches(makeGraph(), log);
    const twice = applyBatches(once, log);
    expect(twice).toEqual(once);
  });

  it('rejects a batch for another conversation', () => {
    const b = { ...batch(1, []), conversationId: 'other' };
    expect(() => applyOps(makeGraph(), b)).toThrow(OpError);
  });

  it('is all-or-nothing: a bad op rejects the whole batch', () => {
    const s = twoNodes();
    expect(() =>
      applyOps(
        s,
        batch(2, [
          { op: 'node.add', node: makeNode('c', { seq: 3 }) },
          { op: 'edge.add', edge: makeEdge('e2', 'c', 'missing') },
        ]),
      ),
    ).toThrow(/unknown_node/);
    expect(s.nodes.c).toBeUndefined();
    expect(s.lastSeq).toBe(1);
  });

  it('rejects duplicate nodes and edges', () => {
    const s = twoNodes();
    expect(() => applyOps(s, batch(2, [{ op: 'node.add', node: makeNode('a') }]))).toThrow(/duplicate_node/);
    expect(() => applyOps(s, batch(2, [{ op: 'edge.add', edge: makeEdge('e1', 'b', 'a') }]))).toThrow(
      /duplicate_edge/,
    );
  });

  it('rejects edges with missing endpoints and self-loops', () => {
    const s = twoNodes();
    expect(() => applyOps(s, batch(2, [{ op: 'edge.add', edge: makeEdge('e2', 'a', 'zzz') }]))).toThrow(
      /unknown_node/,
    );
    expect(() => applyOps(s, batch(2, [{ op: 'edge.add', edge: makeEdge('e2', 'a', 'a') }]))).toThrow(/self_loop/);
  });

  it('rejects a parent that does not exist', () => {
    expect(() => applyOps(makeGraph(), batch(1, [{ op: 'node.add', node: makeNode('a', { parentId: 'x' }) }]))).toThrow(
      /unknown_node/,
    );
  });

  it('node.remove only removes provisional nodes, and drops their edges', () => {
    const s = twoNodes();
    expect(() => applyOps(s, batch(2, [{ op: 'node.remove', id: 'b' }]))).toThrow(/not_provisional/);

    const withProvisional = applyOps(
      s,
      batch(2, [
        { op: 'node.add', node: makeNode('p', { seq: 3, status: 'provisional' }) },
        { op: 'edge.add', edge: makeEdge('e2', 'b', 'p') },
        { op: 'active.set', nodeId: 'p' },
      ]),
    );
    const removed = applyOps(withProvisional, batch(3, [{ op: 'node.remove', id: 'p' }]));
    expect(removed.nodes.p).toBeUndefined();
    expect(removed.edges.e2).toBeUndefined();
    expect(removed.activeNodeId).toBeNull();
  });

  it('node.merge rewires edges, unions evidence, widens span and drops self-loops and duplicates', () => {
    let s = applyOps(
      makeGraph(),
      batch(1, [
        { op: 'node.add', node: makeNode('a', { seq: 1, startMs: 0, endMs: 10, utteranceIds: ['u1'] }) },
        { op: 'node.add', node: makeNode('b', { seq: 2, startMs: 10, endMs: 20, utteranceIds: ['u2'] }) },
        { op: 'node.add', node: makeNode('c', { seq: 3, startMs: 20, endMs: 30, utteranceIds: ['u3', 'u2'] }) },
        { op: 'node.add', node: makeNode('k', { seq: 4, parentId: 'c' }) },
        { op: 'edge.add', edge: makeEdge('e1', 'a', 'b') },
        { op: 'edge.add', edge: makeEdge('e2', 'b', 'c') },
        { op: 'edge.add', edge: makeEdge('e3', 'a', 'c') },
        { op: 'flag.add', flag: { id: 'f1', conversationId: 'c0000000-0000-4000-8000-000000000001', atMs: 25, nodeId: 'c', note: null, source: 'button' } },
        { op: 'active.set', nodeId: 'c' },
      ]),
    );
    s = applyOps(s, batch(2, [{ op: 'node.merge', fromId: 'c', intoId: 'b' }], 'finalize'));

    expect(s.nodes.c).toBeUndefined();
    expect(s.nodes.b?.utteranceIds).toEqual(['u2', 'u3']);
    expect(s.nodes.b?.startMs).toBe(10);
    expect(s.nodes.b?.endMs).toBe(30);
    // e2 (b→c) became a self-loop and is gone; e3 (a→c) became a duplicate of e1 (a→b) and is gone
    expect(Object.keys(s.edges)).toEqual(['e1']);
    expect(s.nodes.k?.parentId).toBe('b');
    expect(s.flags[0]?.nodeId).toBe('b');
    expect(s.activeNodeId).toBe('b');
  });

  it('node.merge never makes a node its own parent', () => {
    let s = applyOps(
      makeGraph(),
      batch(1, [
        { op: 'node.add', node: makeNode('root', { seq: 1 }) },
        { op: 'node.add', node: makeNode('parent', { seq: 2, parentId: 'root' }) },
        { op: 'node.add', node: makeNode('child', { seq: 3, parentId: 'parent' }) },
      ]),
    );
    s = applyOps(s, batch(2, [{ op: 'node.merge', fromId: 'parent', intoId: 'child' }], 'finalize'));
    expect(s.nodes.child?.parentId).toBe('root');
  });

  it('locks layout for live batches but lets user and finalize move nodes', () => {
    const s = twoNodes();
    expect(() => applyOps(s, batch(2, [{ op: 'node.update', id: 'a', patch: { x: 50 } }]))).toThrow(/layout_locked/);
    expect(applyOps(s, batch(2, [{ op: 'node.update', id: 'a', patch: { x: 50 } }], 'user')).nodes.a?.x).toBe(50);
    expect(applyOps(s, batch(2, [{ op: 'node.update', id: 'a', patch: { y: 9 } }], 'finalize')).nodes.a?.y).toBe(9);
    // a live update that repeats the same coordinates is fine
    expect(applyOps(s, batch(2, [{ op: 'node.update', id: 'a', patch: { x: 0, label: 'A' } }])).nodes.a?.label).toBe('A');
  });

  it('flags, commitments and annotations are idempotent by id', () => {
    const flag = { id: 'f1', conversationId: 'c0000000-0000-4000-8000-000000000001', atMs: 5, nodeId: 'a', note: null, source: 'key' as const };
    let s = applyOps(twoNodes(), batch(2, [{ op: 'flag.add', flag }, { op: 'flag.add', flag }]));
    expect(s.flags).toHaveLength(1);
    const ann = { id: 'n1', conversationId: flag.conversationId, nodeId: 'a', text: 'one', x: 1, y: 2 };
    s = applyOps(s, batch(3, [{ op: 'annotation.upsert', annotation: ann }], 'user'));
    s = applyOps(s, batch(4, [{ op: 'annotation.upsert', annotation: { ...ann, text: 'two' } }], 'user'));
    expect(s.annotations).toEqual([{ ...ann, text: 'two' }]);
  });

  it('commitment.update edits text and done of an existing commitment only', () => {
    const commitment = {
      id: 'k1',
      conversationId: 'c0000000-0000-4000-8000-000000000001',
      nodeId: 'a',
      text: 'Send Sam the paper',
      speaker: 0,
      atMs: 1_000,
      done: false,
    };
    let s = applyOps(twoNodes(), batch(2, [{ op: 'commitment.add', commitment }]));
    s = applyOps(s, batch(3, [{ op: 'commitment.update', id: 'k1', patch: { done: true } }], 'user'));
    expect(s.commitments).toEqual([{ ...commitment, done: true }]);
    s = applyOps(s, batch(4, [{ op: 'commitment.update', id: 'k1', patch: { text: 'Send Sam the Camus essay' } }], 'user'));
    expect(s.commitments).toEqual([{ ...commitment, done: true, text: 'Send Sam the Camus essay' }]);
    // an empty patch changes nothing; other fields are never touched
    s = applyOps(s, batch(5, [{ op: 'commitment.update', id: 'k1', patch: {} }], 'user'));
    expect(s.commitments[0]).toMatchObject({ nodeId: 'a', speaker: 0, atMs: 1_000 });
  });

  it('commitment.update rejects an unknown id and leaves the whole batch unapplied', () => {
    const s = twoNodes();
    const bad = batch(2, [
      { op: 'node.update', id: 'a', patch: { label: 'Changed' } },
      { op: 'commitment.update', id: 'missing', patch: { done: true } },
    ]);
    expect(() => applyOps(s, bad)).toThrow(OpError);
    try {
      applyOps(s, bad);
    } catch (e) {
      expect((e as OpError).code).toBe('unknown_commitment');
      expect((e as OpError).opIndex).toBe(1);
    }
    expect(s.nodes.a?.label).toBe('a');
    expect(s.lastSeq).toBe(1);
  });

  it('conversation.update merges the patch', () => {
    const s = applyOps(makeGraph(), batch(1, [{ op: 'conversation.update', patch: { title: 'Hi', status: 'ready' } }]));
    expect(s.conversation.title).toBe('Hi');
    expect(s.conversation.status).toBe('ready');
  });
});
