import { makeEdge, makeGraph, makeNode } from '@constellate/shared/testing';
import type { GraphState, TopicNode } from '@constellate/shared';
import { describe, expect, it } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import {
  effectiveDetail,
  nodeAccessibleName,
  pathInOrder,
  RADIUS_MAX,
  RADIUS_MIN,
  relationWords,
  statusWords,
  stepNode,
  topicRadius,
  tracePath,
  visibleGraph,
} from './model';

const demo = loadDemoGraph();
const byLabel = (g: GraphState, label: string, nth = 0): TopicNode =>
  Object.values(g.nodes)
    .filter((n) => n.label === label)
    .sort((a, b) => a.seq - b.seq)[nth]!;

function graphOf(nodes: TopicNode[], edges = [] as ReturnType<typeof makeEdge>[]): GraphState {
  const g = makeGraph();
  for (const n of nodes) g.nodes[n.id] = n;
  for (const e of edges) g.edges[e.id] = e;
  return g;
}

describe('topicRadius', () => {
  it('scales 18–30 px with how long the topic was discussed', () => {
    expect(topicRadius({ startMs: 0, endMs: 10_000, level: 1 })).toBe(RADIUS_MIN);
    expect(topicRadius({ startMs: 0, endMs: 600_000, level: 1 })).toBe(RADIUS_MAX);
    const mid = topicRadius({ startMs: 0, endMs: 70_000, level: 1 });
    expect(mid).toBeGreaterThan(RADIUS_MIN);
    expect(mid).toBeLessThan(RADIUS_MAX);
  });
  it('draws level-2 nodes slightly smaller', () => {
    const a = topicRadius({ startMs: 0, endMs: 70_000, level: 1 });
    const b = topicRadius({ startMs: 0, endMs: 70_000, level: 2 });
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(a * 0.7);
  });
});

describe('visibleGraph', () => {
  it('balanced shows every node, edge and note from the fixture', () => {
    const v = visibleGraph(demo, 'balanced');
    expect(v.nodes).toHaveLength(Object.keys(demo.nodes).length);
    expect(v.notes).toHaveLength(demo.annotations.length);
    // every contract edge plus one connector per note
    expect(v.edges).toHaveLength(Object.keys(demo.edges).length + demo.annotations.length);
    // nodes in conversation order, positions untouched
    expect(v.nodes.map((n) => n.node.seq)).toEqual([...v.nodes.map((n) => n.node.seq)].sort((a, b) => a - b));
    for (const vn of v.nodes)
      expect([vn.node.x, vn.node.y]).toEqual([demo.nodes[vn.node.id]!.x, demo.nodes[vn.node.id]!.y]);
  });

  it('broad hides level-2 topics and notes, keeps threads, and badges the stand-in with the count', () => {
    const v = visibleGraph(demo, 'broad');
    expect(v.nodes.some((n) => n.node.kind === 'topic' && n.node.level === 2)).toBe(false);
    expect(v.nodes.filter((n) => n.node.kind !== 'topic')).toHaveLength(3);
    expect(v.notes).toHaveLength(0);
    const hj = v.nodes.find((n) => n.node.label === 'Historical Jesus')!;
    expect(hj.hiddenChildren).toBe(2); // Gospel Sources, Resurrection Accounts
    const fve = v.nodes.find((n) => n.node.id === byLabel(demo, 'Faith vs Evidence').id)!;
    expect(fve.hiddenChildren).toBe(2); // Personal Doubts, Resurrection Accounts (return)
  });

  it('broad rewires edges so flow still runs forward in time and no edge loops on itself', () => {
    const v = visibleGraph(demo, 'broad');
    const seq = (id: string) => demo.nodes[id]!.seq;
    for (const e of v.edges) {
      expect(e.sourceId).not.toBe(e.targetId);
      if (e.kind === 'flow') expect(seq(e.targetId)).toBeGreaterThan(seq(e.sourceId));
    }
    // the folded return (Resurrection Accounts → earlier) still shows as a revisit, with the ↺ badge
    const fve = byLabel(demo, 'Faith vs Evidence');
    expect(v.edges.some((e) => e.kind === 'revisit' && e.sourceId === fve.id)).toBe(true);
    expect(v.nodes.find((n) => n.node.id === fve.id)!.isRevisit).toBe(true);
  });

  it('marks revisit nodes, flags and highlighted branches', () => {
    const v = visibleGraph(demo, 'balanced');
    const second = byLabel(demo, 'Resurrection Accounts', 1);
    const vn = v.nodes.find((n) => n.node.id === second.id)!;
    expect(vn.isRevisit).toBe(true);
    expect(vn.flags).toBe(1);
    expect(v.nodes.find((n) => n.node.label === 'Sunday Service')!.isRevisit).toBe(false);
    const revisit = v.edges.find((e) => e.kind === 'revisit' && e.sourceId === second.id)!;
    expect(revisit.highlighted).toBe(true); // both occurrences are highlighted
  });
});

describe('words (never colour alone)', () => {
  it('describes statuses', () => {
    const t = makeNode('t', { status: 'provisional' });
    expect(statusWords(t, null)).toBe('tentative topic');
    expect(statusWords(makeNode('a'), 'a')).toBe('being discussed now');
    expect(statusWords(makeNode('p', { kind: 'pending', status: 'unexplored' }), null)).toMatch(/later, not picked up/);
    expect(statusWords(makeNode('k', { kind: 'parked', status: 'resolved' }), null)).toMatch(
      /parked thought, picked up/,
    );
  });

  it('describes a revisit with the earlier time, as the outline needs', () => {
    const second = byLabel(demo, 'Resurrection Accounts', 1);
    expect(relationWords(demo, second)).toContain('returns to Resurrection Accounts from 03:50');
    const first = byLabel(demo, 'Resurrection Accounts', 0);
    expect(relationWords(demo, first)).toContain('picked up again at 07:00');
  });

  it('describes where threads were raised and picked up', () => {
    const soccer = byLabel(demo, 'Intramural Soccer');
    expect(relationWords(demo, soccer)).toContain('raised during Gospel Sources');
    const trip = Object.values(demo.nodes).find((n) => n.label === 'Summer Road Trip' && n.kind === 'pending')!;
    const words = relationWords(demo, trip);
    expect(words).toContain('raised during Camus and Absurdism');
    expect(words.some((w) => w.startsWith('picked up in Summer Road Trip'))).toBe(true);
  });

  it('builds a full accessible name', () => {
    const gs = byLabel(demo, 'Gospel Sources');
    expect(nodeAccessibleName(demo, gs, null)).toBe(
      'Gospel Sources, topic, 02:40–03:50, part of Historical Jesus, flagged',
    );
  });
});

describe('tracePath', () => {
  it('walks flow edges back to the first node', () => {
    const target = byLabel(demo, 'Resurrection Accounts', 0);
    const labels = pathInOrder(demo, tracePath(demo, target.id)).map((n) => n.label);
    expect(labels).toEqual(['Sunday Service', 'Historical Jesus', 'Gospel Sources', 'Resurrection Accounts']);
  });

  it('starts a thread at the topic where it was raised', () => {
    const soccer = byLabel(demo, 'Intramural Soccer');
    const p = tracePath(demo, soccer.id);
    const labels = pathInOrder(demo, p).map((n) => n.label);
    expect(labels).toEqual(['Sunday Service', 'Historical Jesus', 'Gospel Sources', 'Intramural Soccer']);
    expect([...p.edgeIds].some((id) => demo.edges[id]!.kind === 'tether')).toBe(true);
  });

  it('survives cycles', () => {
    const g = graphOf(
      [makeNode('a', { seq: 1 }), makeNode('b', { seq: 2 })],
      [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')],
    );
    expect([...tracePath(g, 'b').nodeIds].sort()).toEqual(['a', 'b']);
  });
});

describe('semantic zoom and keyboard order', () => {
  it('switches to broad when zoomed far out', () => {
    expect(effectiveDetail('detailed', 0.3)).toBe('broad');
    expect(effectiveDetail('detailed', 0.8)).toBe('detailed');
  });
  it('steps through nodes in order and clamps at the ends', () => {
    const order = ['a', 'b', 'c'];
    expect(stepNode(order, 'a', 1)).toBe('b');
    expect(stepNode(order, 'c', 1)).toBe('c');
    expect(stepNode(order, 'a', -1)).toBe('a');
    expect(stepNode(order, null, 1)).toBe('a');
    expect(stepNode(order, null, -1)).toBe('c');
  });
});
