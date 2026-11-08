/**
 * Humans' round 5: hover dwell, the weaving layout, smaller labels placed where they fit, and the
 * controlled list view for A4's header button.
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';
import { ConversationMap, HOVER_DWELL_MS } from './ConversationMap';
import { columnFlowPath, columnTetherPath, samplePath } from './edges';
import { visibleGraph, type VisibleGraph } from './model';
import { playTranscriptMoment, SavedMap } from './SavedMap';
import { installFlowDomStubs } from './testing';
import { fitWidth } from './viewport';
import { pathIndex, WEAVE, weaveLayout, type LabelBox } from './weave';

vi.mock('../../lib/audio', async (orig) => ({
  ...(await orig<typeof import('../../lib/audio')>()),
  playTranscript: vi.fn(),
}));

beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const mapCss = readFileSync(join(__dirname, 'map.css'), 'utf8');
const vgOf = (g: GraphState): VisibleGraph => visibleGraph(g, 'balanced', { mergeReturns: true, hideParked: true });
const byLabel = (label: string, kind: TopicNode['kind'] = 'topic'): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === kind)
    .sort((a, b) => a.seq - b.seq)[0]!;
const wrapper = (n: TopicNode) => screen.getByTestId(`map-node-${n.id}`).closest<HTMLElement>('.react-flow__node')!;

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

describe('hover dwell', () => {
  it('no strip before ~700 ms of resting on a star; the strip after', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationMap state={demo} />);
      fireEvent.mouseEnter(wrapper(byLabel('Gospel Sources')));
      act(() => vi.advanceTimersByTime(HOVER_DWELL_MS - 50));
      expect(screen.queryByTestId('preview-card')).toBeNull();
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId('preview-card')).toHaveTextContent('Gospel Sources');
      expect(HOVER_DWELL_MS).toBeGreaterThanOrEqual(600);
      expect(HOVER_DWELL_MS).toBeLessThanOrEqual(800);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelled when the pointer leaves earlier; hides on leave as before', () => {
    vi.useFakeTimers();
    try {
      render(<ConversationMap state={demo} />);
      const n = wrapper(byLabel('Gospel Sources'));
      fireEvent.mouseEnter(n);
      act(() => vi.advanceTimersByTime(300));
      fireEvent.mouseLeave(n);
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('preview-card')).toBeNull();
      fireEvent.mouseEnter(n);
      act(() => vi.advanceTimersByTime(HOVER_DWELL_MS + 10));
      expect(screen.getByTestId('preview-card')).toBeInTheDocument();
      fireEvent.mouseLeave(n);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByTestId('preview-card')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard focus still shows it at once', () => {
    render(<ConversationMap state={demo} />);
    act(() => wrapper(byLabel('Sunday Service')).focus());
    expect(screen.getByTestId('preview-card')).toHaveTextContent('Sunday Service');
  });
});

describe('weaving layout', () => {
  it('is deterministic and display-only', () => {
    const before = JSON.stringify(Object.values(demo.nodes).map((n) => [n.x, n.y]));
    const a = weaveLayout(vgOf(demo));
    const b = weaveLayout(vgOf(structuredClone(demo)));
    expect([...a.nodes]).toEqual([...b.nodes]);
    expect([...a.routes]).toEqual([...b.routes]);
    expect([...a.labels]).toEqual([...b.labels]);
    expect(JSON.stringify(Object.values(demo.nodes).map((n) => [n.x, n.y]))).toBe(before);
  });

  it('never moves an existing star when a new one arrives', () => {
    const total = Object.keys(demo.nodes).length;
    let prev = weaveLayout(vgOf(prefix(1))).nodes;
    for (let k = 2; k <= total; k++) {
      const next = weaveLayout(vgOf(prefix(k))).nodes;
      for (const [id, p] of prev) expect(next.get(id), `star ${id} after ${k}`).toMatchObject({ x: p.x, y: p.y });
      prev = next;
    }
  });

  it('weaves across the width: ≥ 3 x-positions, the path zig-zags, level-2 branches away, threads at the edges', () => {
    const vg = vgOf(demo);
    const lay = weaveLayout(vg);
    const xs = vg.nodes.map((v) => lay.nodes.get(v.node.id)!.x);
    expect(new Set(xs).size).toBeGreaterThanOrEqual(3);
    expect(Math.min(...xs)).toBeLessThanOrEqual(80);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(280);
    // main topics step through 0 1 2 3 2 1 …
    const main = vg.nodes.filter((v) => v.node.kind === 'topic' && v.node.level < 2);
    main.forEach((v, k) => expect(lay.nodes.get(v.node.id)!.x).toBe(WEAVE.path[pathIndex(k)]));
    // level-2: opposite the path's next step
    let k = -1;
    let parentX = 0;
    for (const v of vg.nodes) {
      const p = lay.nodes.get(v.node.id)!;
      if (p.lane === 'main') {
        k++;
        parentX = p.x;
      } else if (p.lane === 'level2') {
        const nextDir = Math.sign(pathIndex(k + 1) - pathIndex(k)) || 1;
        expect(Math.sign(p.x - parentX)).toBe(-nextDir);
      } else {
        expect([WEAVE.threadLeft, WEAVE.threadRight]).toContain(p.x);
      }
    }
    // one row per star, a little more vertical room than before
    vg.nodes.forEach((v, i) => expect(lay.nodes.get(v.node.id)!.y).toBe(WEAVE.top + i * WEAVE.row));
    expect(WEAVE.row).toBeGreaterThan(76);
    // every connection is a straight line, or one gentle arc where something is in the way
    for (const e of vg.edges.filter((x) => x.kind !== 'note'))
      expect(['line', 'arc']).toContain(lay.routes.get(e.id)!.kind);
  });

  it('no overlaps: no line through a label or another star, no label on a star or another label', () => {
    const vg = vgOf(demo);
    const lay = weaveLayout(vg);
    const byId = new Map(vg.nodes.map((v) => [v.node.id, v]));
    const labels = vg.nodes.map((v) => ({ id: v.node.id, b: lay.labels.get(v.node.id)! }));
    const stars = vg.nodes.map((v) => ({ id: v.node.id, p: lay.nodes.get(v.node.id)!, r: v.radius }));
    const inBox = (x: number, y: number, b: LabelBox) => x > b.x0 && x < b.x0 + b.w && y > b.y0 && y < b.y0 + b.h;
    let edges = 0;
    for (const e of vg.edges) {
      if (e.kind === 'note') continue;
      const s = lay.nodes.get(e.sourceId)!;
      const t = lay.nodes.get(e.targetId)!;
      const route = lay.routes.get(e.id)!;
      const sr = byId.get(e.sourceId)!.radius;
      const tr = byId.get(e.targetId)!.radius;
      // the path exactly as the renderer draws it
      const d = e.kind === 'tether' ? columnTetherPath(s, t, sr, tr, route) : columnFlowPath(s, t, sr, tr, route);
      for (const pt of samplePath(d, 24)) {
        for (const l of labels) expect(inBox(pt.x, pt.y, l.b), `${e.kind} ${e.id} through label ${l.id}`).toBe(false);
        for (const st of stars) {
          if (st.id === e.sourceId || st.id === e.targetId) continue;
          expect(Math.hypot(pt.x - st.p.x, pt.y - st.p.y) < st.r, `${e.kind} ${e.id} through star ${st.id}`).toBe(
            false,
          );
        }
      }
      edges++;
    }
    expect(edges).toBeGreaterThan(8);
    for (const a of labels) {
      for (const b of labels) {
        if (a.id === b.id) continue;
        const hit =
          a.b.x0 < b.b.x0 + b.b.w && b.b.x0 < a.b.x0 + a.b.w && a.b.y0 < b.b.y0 + b.b.h && b.b.y0 < a.b.y0 + a.b.h;
        expect(hit, `labels ${a.id} / ${b.id}`).toBe(false);
      }
      for (const st of stars) {
        const nx = Math.max(a.b.x0, Math.min(st.p.x, a.b.x0 + a.b.w));
        const ny = Math.max(a.b.y0, Math.min(st.p.y, a.b.y0 + a.b.h));
        expect(Math.hypot(st.p.x - nx, st.p.y - ny) < st.r, `label ${a.id} on star ${st.id}`).toBe(false);
      }
      // inside the frame
      expect(a.b.x0).toBeGreaterThanOrEqual(0);
      expect(a.b.x0 + a.b.w).toBeLessThanOrEqual(WEAVE.width);
    }
  });

  it('each label sits on a side of its star that its lines leave free', () => {
    const vg = vgOf(demo);
    const lay = weaveLayout(vg);
    for (const v of vg.nodes) expect(['right', 'left', 'below', 'above']).toContain(lay.labels.get(v.node.id)!.side);
    render(<ConversationMap state={demo} />);
    const label = screen
      .getByTestId(`map-node-${byLabel('Gospel Sources').id}`)
      .querySelector('[data-testid="node-label"]')!;
    expect(label).toHaveClass('cmap-label-weave');
    expect(label).toHaveAttribute('data-side', lay.labels.get(byLabel('Gospel Sources').id)!.side);
  });

  it('the round-4 column is behind the columnLayout flag', () => {
    render(<ConversationMap state={demo} flags={{ columnLayout: true }} />);
    const label = screen
      .getByTestId(`map-node-${byLabel('Sunday Service').id}`)
      .querySelector('[data-testid="node-label"]')!;
    expect(label).toHaveClass('cmap-label-beside');
  });
});

describe('label size at 375 and 430 px', () => {
  it('labels ≈ 13.5 px on screen, stars ≥ 28 px across, the frame fits the width', () => {
    const vg = vgOf(demo);
    const lay = weaveLayout(vg);
    const smallest = Math.min(...vg.nodes.filter((v) => v.node.kind === 'topic').map((v) => v.radius));
    for (const w of [375, 430]) {
      const zoom = fitWidth(lay.bounds, w, 0, 1.25, 0.96).zoom;
      const labelPx = 13.5 * zoom * (1 / Math.max(1, zoom));
      expect(labelPx, `label px at ${w}`).toBeGreaterThanOrEqual(13);
      expect(labelPx, `label px at ${w}`).toBeLessThanOrEqual(14);
      expect(2 * smallest * zoom, `star px at ${w}`).toBeGreaterThanOrEqual(28);
      expect((lay.bounds.maxX - lay.bounds.minX) * zoom).toBeLessThanOrEqual(w);
    }
    expect(mapCss).toMatch(
      /\.cmap-label-weave \.cmap-label \{\s*font-size: calc\(13\.5px \* var\(--text-size\) \* var\(--cmap-label-scale, 1\)\)/,
    );
  });

  it('the map sets the label scale so labels stay small when zoomed in', () => {
    render(<ConversationMap state={demo} />);
    const root = screen.getByTestId('conversation-map');
    expect(Number(root.style.getPropertyValue('--cmap-label-scale'))).toBeGreaterThan(0);
    expect(Number(root.style.getPropertyValue('--cmap-label-scale'))).toBeLessThanOrEqual(1);
  });
});

describe('controlled list view for A4 (SavedMap view / onViewChange)', () => {
  it('view="list" shows the nodes as a list; the in-map link reports changes', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const api = createMockApi();
    const { rerender } = renderApp({
      route: `/c/${demo.conversation.id}`,
      api,
      element: <SavedMap graph={demo} view="list" onViewChange={onViewChange} />,
      path: '/c/:id',
    });
    expect(screen.getByRole('tree', { name: /outline/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Map view' }));
    expect(onViewChange).toHaveBeenCalledWith('map');
    void rerender;
  });

  it('view="map" shows the map; the focus-only "Text view" link asks for the list', async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderApp({
      route: `/c/${demo.conversation.id}`,
      element: <SavedMap graph={demo} view="map" onViewChange={onViewChange} />,
      path: '/c/:id',
    });
    expect(screen.queryByRole('tree')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Text view' }));
    expect(onViewChange).toHaveBeenCalledWith('list');
  });
});

describe('revealHold (the sky waits for the diary)', () => {
  const stars = () => document.querySelectorAll('[data-testid^="map-node-"]');

  it('while held nothing is rendered on the canvas (no stars, lines or focus stops)', () => {
    const { container } = render(<ConversationMap state={demo} reveal revealHold />);
    expect(stars()).toHaveLength(0);
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(0);
    expect(container.querySelectorAll('.react-flow__node[tabindex="0"]')).toHaveLength(0);
    expect(screen.queryByText('Topics appear here as the conversation goes.')).toBeNull();
  });

  it('on release the one-by-one reveal starts from the beginning', () => {
    const { rerender } = render(<ConversationMap state={demo} reveal revealHold />);
    rerender(<ConversationMap state={demo} reveal revealHold={false} />);
    const delays = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].map((e) => Number(e.dataset.reveal));
    expect(delays.length).toBe(vgOf(demo).nodes.length);
    expect(delays[0]).toBe(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(document.querySelector('g.cmap-draw')).toBeTruthy();
  });

  it('default (no hold) plays on mount as before; SavedMap passes the prop through', () => {
    render(<ConversationMap state={demo} reveal />);
    expect(stars().length).toBe(vgOf(demo).nodes.length);
  });

  it('SavedMap: held → empty, released → stars', () => {
    const { rerender } = renderApp({
      route: `/c/${demo.conversation.id}`,
      element: <SavedMap graph={demo} revealHold />,
      path: '/c/:id',
    });
    expect(stars()).toHaveLength(0);
    void rerender;
  });
});

describe('Play without a recording (A4 transcript playback)', () => {
  it('hands the moment to lib/audio playTranscript when it exists', async () => {
    const audio = await import('../../lib/audio');
    const ok = await playTranscriptMoment({ key: 'n1', startMs: 1000, endMs: 5000, utterances: [] });
    expect(ok).toBe(true);
    expect(audio.playTranscript).toHaveBeenCalledWith({ key: 'n1', startMs: 1000, endMs: 5000, utterances: [] });
  });
});

describe('labels never fade (colour contrast mid-reveal)', () => {
  const block = (selector: string) => {
    const i = mapCss.indexOf(selector);
    expect(i, selector).toBeGreaterThanOrEqual(0);
    return mapCss.slice(i, mapCss.indexOf('}\n', mapCss.indexOf('{', i)) + 1);
  };

  it('the star grows and its art fades, but no animation touches the label opacity', () => {
    // the node wrapper only scales (it holds the label)
    const appear = mapCss.slice(mapCss.indexOf('@keyframes cmap-appear'), mapCss.indexOf('.cmap-appear {'));
    expect(appear).toMatch(/transform: scale\(0\.55\)/);
    expect(appear).not.toMatch(/opacity/);
    // the label is hidden until its turn, then shown whole: visibility only
    const show = mapCss.slice(
      mapCss.indexOf('@keyframes cmap-label-show'),
      mapCss.indexOf(".cmap-appear > [data-testid='node-label']"),
    );
    expect(show).toMatch(/visibility: hidden/);
    expect(show).not.toMatch(/opacity/);
    expect(block(".cmap-appear > [data-testid='node-label']")).toMatch(/animation: cmap-label-show/);
    // the art (svg, badges, glyphs) is what fades
    expect(mapCss).toMatch(/\.cmap-appear > svg,[\s\S]*?animation: cmap-fade-in/);
  });

  it('a revealed label ends at full opacity in the text colour token', () => {
    render(<ConversationMap state={demo} reveal />);
    for (const label of document.querySelectorAll<HTMLElement>('[data-testid="node-label"]')) {
      // nothing between the label and the canvas sets a partial opacity (dimming aside, which is off)
      let el: HTMLElement | null = label;
      while (el && !el.classList.contains('react-flow__node')) {
        expect(el.style.opacity === '' || el.style.opacity === '1', el.className).toBe(true);
        el = el.parentElement;
      }
    }
    // the label text keeps the full-contrast token
    expect(block('.cmap-label {')).toMatch(/color: var\(--text\)/);
    expect(block('.cmap-label {')).not.toMatch(/opacity/);
  });
});
