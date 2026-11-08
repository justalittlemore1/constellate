import { describe, expect, it } from 'vitest';
import { topicAt } from './domain';
import { applyOps } from './ops';
import { GUTTER_MIN_GAP, GUTTER_X, JITTER, LANE_WIDTH, placeNode, ROW_HEIGHT, jitterFor } from './layout';
import { batch, makeGraph, makeNode } from './testing';

describe('placeNode', () => {
  it('is deterministic', () => {
    const s = makeGraph();
    const n = makeNode('abc', { level: 2 });
    expect(placeNode(s, n)).toEqual(placeNode(s, n));
  });

  it('jitter stays within ±JITTER', () => {
    for (let i = 0; i < 500; i++) {
      const j = jitterFor(`node-${i}`);
      expect(Math.abs(j)).toBeLessThanOrEqual(JITTER);
    }
  });

  it('places the first topic at y=0 in its level lane, and each next topic one row lower', () => {
    let s = makeGraph();
    const a = makeNode('a', { level: 1, seq: 1 });
    const pa = placeNode(s, a);
    expect(pa.y).toBe(0);
    expect(pa.x - jitterFor('a')).toBe(LANE_WIDTH);
    s = applyOps(s, batch(1, [{ op: 'node.add', node: { ...a, ...pa } }]));

    const b = makeNode('b', { level: 2, seq: 2 });
    const pb = placeNode(s, b);
    expect(pb.y).toBe(ROW_HEIGHT);
    expect(pb.x - jitterFor('b')).toBe(2 * LANE_WIDTH);
  });

  it('puts a revisit in the lane of the earlier occurrence', () => {
    let s = makeGraph();
    const a = makeNode('a', { level: 2, seq: 1 });
    s = applyOps(s, batch(1, [{ op: 'node.add', node: { ...a, ...placeNode(s, a) } }]));
    const r = makeNode('r', { level: 1, seq: 2 });
    expect(placeNode(s, r, { revisitOfId: 'a' }).x - jitterFor('r')).toBe(2 * LANE_WIDTH);
  });

  it('puts pending threads in the gutter at the anchor y, without overlapping each other', () => {
    let s = makeGraph();
    const a = makeNode('a', { seq: 1 });
    s = applyOps(s, batch(1, [{ op: 'node.add', node: { ...a, ...placeNode(s, a) } }, { op: 'active.set', nodeId: 'a' }]));
    const p1 = makeNode('p1', { kind: 'pending', seq: 2 });
    const pos1 = placeNode(s, p1);
    expect(Math.abs(pos1.x - GUTTER_X)).toBeLessThanOrEqual(JITTER);
    expect(pos1.y).toBe(s.nodes.a?.y);
    s = applyOps(s, batch(2, [{ op: 'node.add', node: { ...p1, ...pos1 } }]));

    const p2 = makeNode('p2', { kind: 'parked', seq: 3 });
    const pos2 = placeNode(s, p2);
    expect(pos2.y - pos1.y).toBeGreaterThanOrEqual(GUTTER_MIN_GAP);
  });

  it('never changes existing positions when nodes are added', () => {
    let s = makeGraph();
    for (let i = 1; i <= 6; i++) {
      const n = makeNode(`n${i}`, { seq: i, level: ((i % 2) + 1) as 1 | 2 });
      s = applyOps(s, batch(i, [{ op: 'node.add', node: { ...n, ...placeNode(s, n) } }]));
    }
    const before = Object.values(s.nodes).map((n) => [n.id, n.x, n.y]);
    const extra = makeNode('extra', { seq: 7 });
    s = applyOps(s, batch(7, [{ op: 'node.add', node: { ...extra, ...placeNode(s, extra) } }]));
    const after = Object.values(s.nodes)
      .filter((n) => n.id !== 'extra')
      .map((n) => [n.id, n.x, n.y]);
    expect(after).toEqual(before);
  });
});

describe('topicAt', () => {
  it('returns the latest topic covering the time, ignoring provisional and threads', () => {
    const s = applyOps(
      makeGraph(),
      batch(1, [
        { op: 'node.add', node: makeNode('a', { seq: 1, startMs: 0, endMs: 100, status: 'closed' }) },
        { op: 'node.add', node: makeNode('b', { seq: 2, startMs: 100, endMs: null }) },
        { op: 'node.add', node: makeNode('p', { seq: 3, startMs: 150, status: 'provisional' }) },
        { op: 'node.add', node: makeNode('t', { seq: 4, startMs: 0, kind: 'pending', status: 'active' }) },
      ]),
    );
    expect(topicAt(s, 50)?.id).toBe('a');
    expect(topicAt(s, 160)?.id).toBe('b');
    expect(topicAt(makeGraph(), 10)).toBeNull();
  });
});
