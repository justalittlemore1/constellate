/**
 * Humans' round 4: display-only column layout, hover strip without a close button, larger labels,
 * and the reveal when a saved conversation opens.
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { ConversationMap, REVEAL_STEP_MS } from './ConversationMap';
import { columnFlowPath, columnTetherPath, type Pt } from './edges';
import { COLUMN, columnLayout, labelBox } from './layout';
import { nodeSubLabel, visibleGraph, type VisibleGraph } from './model';
import { installFlowDomStubs } from './testing';
import { fitWidth } from './viewport';

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const vgOf = (g: GraphState): VisibleGraph => visibleGraph(g, 'balanced', { mergeReturns: true, hideParked: true });
const byLabel = (label: string, kind: TopicNode['kind'] = 'topic'): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === kind)
    .sort((a, b) => a.seq - b.seq)[0]!;
const wrapper = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`).closest<HTMLElement>('.react-flow__node')!;

/** The graph as it stood after the first `k` nodes (by seq) had arrived. */
function prefix(k: number): GraphState {
  const keep = new Set(
    Object.values(demo.nodes)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, k)
      .map((n) => n.id),
  );
  return {
    ...demo,
    nodes: Object.fromEntries(Object.entries(demo.nodes).filter(([id]) => keep.has(id))),
    edges: Object.fromEntries(
      Object.entries(demo.edges).filter(([, e]) => keep.has(e.sourceId) && keep.has(e.targetId)),
    ),
    annotations: demo.annotations.filter((a) => !a.nodeId || keep.has(a.nodeId)),
    flags: demo.flags.filter((f) => !f.nodeId || keep.has(f.nodeId)),
  };
}

/** Points along a path made of M / L / C / Q segments (absolute coordinates). */
function samplePath(d: string, steps = 24): Pt[] {
  const tokens = d.match(/[MLCQ]|-?\d+(\.\d+)?/g) ?? [];
  const out: Pt[] = [];
  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      cur = { x: num(), y: num() };
      out.push(cur);
    } else if (cmd === 'L') {
      const p = { x: num(), y: num() };
      for (let s = 1; s <= steps; s++)
        out.push({ x: cur.x + ((p.x - cur.x) * s) / steps, y: cur.y + ((p.y - cur.y) * s) / steps });
      cur = p;
    } else if (cmd === 'Q') {
      const c = { x: num(), y: num() };
      const p = { x: num(), y: num() };
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        out.push({
          x: u * u * cur.x + 2 * u * t * c.x + t * t * p.x,
          y: u * u * cur.y + 2 * u * t * c.y + t * t * p.y,
        });
      }
      cur = p;
    } else if (cmd === 'C') {
      const c1 = { x: num(), y: num() };
      const c2 = { x: num(), y: num() };
      const p = { x: num(), y: num() };
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        out.push({
          x: u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x,
          y: u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y,
        });
      }
      cur = p;
    }
  }
  return out;
}

describe('column layout (display only)', () => {
  it('leaves persisted x / y untouched', () => {
    const before = JSON.stringify(Object.values(demo.nodes).map((n) => [n.id, n.x, n.y]));
    columnLayout(vgOf(demo));
    expect(JSON.stringify(Object.values(demo.nodes).map((n) => [n.id, n.x, n.y]))).toBe(before);
  });

  it('is deterministic: the same input always gives the same positions and routes', () => {
    const a = columnLayout(vgOf(demo));
    const b = columnLayout(vgOf(structuredClone(demo)));
    expect([...a.nodes]).toEqual([...b.nodes]);
    expect([...a.routes]).toEqual([...b.routes]);
  });

  it('never moves an existing star when a new one arrives (live)', () => {
    const total = Object.keys(demo.nodes).length;
    let prev = columnLayout(vgOf(prefix(1))).nodes;
    for (let k = 2; k <= total; k++) {
      const next = columnLayout(vgOf(prefix(k))).nodes;
      for (const [id, p] of prev) expect(next.get(id), `star ${id} after ${k} nodes`).toMatchObject({ x: p.x, y: p.y });
      prev = next;
    }
  });

  it('a narrow column: one row per star in time order, ≤ 3 lanes, level-2 to the right, threads in a right gutter', () => {
    const vg = vgOf(demo);
    const lay = columnLayout(vg);
    const placed = vg.nodes.map((v) => ({ v, p: lay.nodes.get(v.node.id)! }));
    placed.forEach(({ p }, i) => expect(p.y).toBe(COLUMN.top + i * COLUMN.row));
    expect(new Set(placed.map(({ p }) => p.x)).size).toBeLessThanOrEqual(3);
    for (const { v, p } of placed) {
      if (v.node.kind !== 'topic') expect(p).toMatchObject({ lane: 'gutter', x: COLUMN.gutter, labelSide: 'left' });
      else if (v.node.level >= 2) expect(p).toMatchObject({ lane: 'level2', labelSide: 'right' });
      else expect(p).toMatchObject({ lane: 'main', labelSide: 'right' });
    }
    expect(COLUMN.level2).toBeGreaterThan(COLUMN.main);
    expect(lay.bounds.maxX - lay.bounds.minX).toBeLessThanOrEqual(360);
  });

  it('returns loop on the left, opposite the labels', () => {
    const vg = vgOf(demo);
    const lay = columnLayout(vg);
    const returns = vg.edges.filter((e) => e.returning);
    expect(returns.length).toBeGreaterThan(0);
    for (const e of returns) {
      const r = lay.routes.get(e.id)!;
      expect(r.kind).toBe('left-channel');
      if (r.kind === 'left-channel') expect(r.x).toBeLessThan(COLUMN.main - 30);
    }
  });

  it('no line passes through a label or another star (fixture)', () => {
    const vg = vgOf(demo);
    const lay = columnLayout(vg);
    const byId = new Map(vg.nodes.map((v) => [v.node.id, v]));
    const boxes = vg.nodes.map((v) => {
      const p = lay.nodes.get(v.node.id)!;
      const sub = nodeSubLabel(v.node, { active: false, playing: false, showTime: false });
      return { id: v.node.id, p, r: v.radius, box: labelBox(p, v.radius, v.node.label, Boolean(sub)) };
    });
    let checked = 0;
    for (const e of vg.edges) {
      if (e.kind === 'note') continue;
      const s = lay.nodes.get(e.sourceId)!;
      const t = lay.nodes.get(e.targetId)!;
      const route = lay.routes.get(e.id)!;
      const sr = byId.get(e.sourceId)!.radius;
      const tr = byId.get(e.targetId)!.radius;
      const d = e.kind === 'tether' ? columnTetherPath(s, t, sr, tr, route) : columnFlowPath(s, t, sr, tr, route);
      for (const pt of samplePath(d)) {
        for (const b of boxes) {
          const inLabel = pt.x > b.box.x0 && pt.x < b.box.x1 && pt.y > b.box.y0 && pt.y < b.box.y1;
          expect(inLabel, `${e.kind} ${e.id} crosses the label of ${b.id}`).toBe(false);
          if (b.id !== e.sourceId && b.id !== e.targetId) {
            const inStar = Math.hypot(pt.x - b.p.x, pt.y - b.p.y) < b.r - 1;
            expect(inStar, `${e.kind} ${e.id} crosses the star ${b.id}`).toBe(false);
          }
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('the old layout is behind the storedLayout flag', () => {
    const { unmount } = render(<ConversationMap state={demo} />);
    const n = byLabel('Gospel Sources');
    const side = parseFloat(screen.getByTestId(`map-node-${n.id}`).style.width);
    const p = columnLayout(vgOf(demo)).nodes.get(n.id)!;
    expect(wrapper(n).style.transform).toBe(`translate(${p.x - side / 2}px,${p.y - side / 2}px)`);
    unmount();
    render(<ConversationMap state={demo} flags={{ storedLayout: true }} />);
    expect(wrapper(n).style.transform).toBe(`translate(${n.x - side / 2}px,${n.y - side / 2}px)`);
  });
});

describe('larger text at the default zoom', () => {
  it('labels ≥ 16 px and stars ≥ 28 px across on 375–430 px phones', () => {
    const vg = vgOf(demo);
    const lay = columnLayout(vg);
    for (const w of [375, 390, 430]) {
      const zoom = fitWidth(lay.bounds, w, 0, 1.25, 0.96).zoom;
      expect(17 * zoom, `label px at ${w}`).toBeGreaterThanOrEqual(16);
      const smallest = Math.min(...vg.nodes.filter((v) => v.node.kind === 'topic').map((v) => v.radius));
      expect(2 * smallest * zoom, `smallest star px at ${w}`).toBeGreaterThanOrEqual(28);
      // the whole column fits the width: no sideways panning needed
      expect((lay.bounds.maxX - lay.bounds.minX) * zoom).toBeLessThanOrEqual(w);
    }
  });

  it('labels sit beside their star (right of topics, left of gutter threads)', () => {
    render(<ConversationMap state={demo} />);
    const label = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`).querySelector('[data-testid="node-label"]')!;
    expect(label(byLabel('Sunday Service'))).toHaveAttribute('data-side', 'right');
    expect(label(byLabel('Intramural Soccer', 'pending'))).toHaveAttribute('data-side', 'left');
    expect(label(byLabel('Sunday Service'))).toHaveClass('cmap-label-beside');
  });
});

describe('hover strip', () => {
  it('has no close button and disappears on mouse leave', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationMap state={demo} />);
      const n = wrapper(byLabel('Gospel Sources'));
      fireEvent.mouseEnter(n);
      const strip = screen.getByTestId('preview-card');
      expect(screen.queryByRole('button', { name: 'Close preview' })).toBeNull();
      expect(strip.querySelector('[aria-label="Close preview"]')).toBeNull();
      fireEvent.mouseLeave(n);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId('preview-card')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard focus shows it; blur and Escape hide it; Enter still opens the sheet', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ConversationMap state={demo} />
        <button type="button">elsewhere</button>
      </>,
    );
    const n = wrapper(byLabel('Sunday Service'));
    act(() => n.focus());
    expect(screen.getByTestId('preview-card')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('preview-card')).toBeNull();
    act(() => n.focus());
    act(() => wrapper(byLabel('Historical Jesus')).focus());
    expect(screen.getByTestId('preview-card')).toHaveTextContent('Historical Jesus');
    act(() => screen.getByRole('button', { name: 'elsewhere' }).focus());
    expect(screen.queryByTestId('preview-card')).toBeNull();
    act(() => n.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Sunday Service' })).toBeInTheDocument();
  });
});

describe('reveal when a saved conversation opens', () => {
  const delays = () =>
    [...document.querySelectorAll<HTMLElement>('[data-reveal]')].map((el) => ({
      id: el.dataset.testid!.replace('map-node-', ''),
      delay: Number(el.dataset.reveal),
    }));

  it('stars appear one by one in conversation order, then the lines draw in', () => {
    const { container } = render(<ConversationMap state={demo} reveal />);
    const d = delays();
    const vg = vgOf(demo);
    expect(d.map((x) => x.id)).toEqual(vg.nodes.map((v) => v.node.id));
    d.forEach((x, i) => expect(x.delay).toBe(i * REVEAL_STEP_MS));
    expect(REVEAL_STEP_MS).toBeGreaterThanOrEqual(120);
    expect(REVEAL_STEP_MS).toBeLessThanOrEqual(180);
    const lines = [...container.querySelectorAll<SVGGElement>('g.cmap-draw')];
    expect(lines.length).toBeGreaterThan(0);
    const last = d[d.length - 1]!.delay;
    for (const g of lines) expect(parseInt(g.style.animationDelay, 10)).toBeGreaterThan(last);
    expect(document.querySelector('.cmap-reveal')).toBeTruthy();
  });

  it('plays again on every visit (remount)', () => {
    const first = render(<ConversationMap state={demo} reveal />);
    expect(delays().length).toBeGreaterThan(0);
    first.unmount();
    expect(delays()).toHaveLength(0);
    render(<ConversationMap state={demo} reveal />);
    expect(delays()[0]!.delay).toBe(0);
    expect(delays().length).toBe(vgOf(demo).nodes.length);
  });

  it('is instant under reduced motion, and the live map has no reveal', () => {
    usePrefs.getState().set({ reduceMotion: true });
    const { unmount } = render(<ConversationMap state={demo} reveal />);
    expect(delays()).toHaveLength(0);
    expect(document.querySelector('g.cmap-draw')).toBeNull();
    unmount();
    usePrefs.getState().reset();
    render(<ConversationMap state={demo} live />);
    expect(delays()).toHaveLength(0);
  });
});
