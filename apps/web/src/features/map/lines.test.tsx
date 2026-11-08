/**
 * Map bugs reported by the humans (Reviewer reproduced on main):
 *  1. labels cut off at the bottom (descenders, and a second line clipped by a fixed-height box)
 *  2. connection lines detouring through lanes and not ending at their stars
 */
import type { GraphState, TopicNode } from '@constellate/shared';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadDemoGraph } from '../../lib/fixtures';
import { usePrefs } from '../../lib/prefs';
import { ConversationMap } from './ConversationMap';
import { columnFlowPath, columnTetherPath } from './edges';
import { visibleGraph, type VisibleGraph } from './model';
import { installFlowDomStubs } from './testing';
import { labelMetrics, textWidth, WEAVE, weaveLayout } from './weave';

beforeAll(() => installFlowDomStubs());
afterEach(() => usePrefs.getState().reset());

const demo = loadDemoGraph();
const mapCss = readFileSync(join(__dirname, 'map.css'), 'utf8');
const vgOf = (g: GraphState): VisibleGraph => visibleGraph(g, 'balanced', { mergeReturns: true, hideParked: true });
const byLabel = (label: string, kind: TopicNode['kind'] = 'topic'): TopicNode =>
  Object.values(demo.nodes)
    .filter((n) => n.label === label && n.kind === kind)
    .sort((a, b) => a.seq - b.seq)[0]!;
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

/** every drawn edge of the fixture under the weave layout, with what the renderer would draw */
function drawnEdges(textSize = 1) {
  const vg = vgOf(demo);
  const lay = weaveLayout(vg, { textSize });
  const r = new Map(vg.nodes.map((v) => [v.node.id, v.radius]));
  return vg.edges
    .filter((e) => e.kind !== 'note')
    .map((e) => {
      const s = lay.nodes.get(e.sourceId)!;
      const t = lay.nodes.get(e.targetId)!;
      const route = lay.routes.get(e.id)!;
      const sr = r.get(e.sourceId)!;
      const tr = r.get(e.targetId)!;
      const d = e.kind === 'tether' ? columnTetherPath(s, t, sr, tr, route) : columnFlowPath(s, t, sr, tr, route);
      return { e, s, t, sr, tr, d, route };
    });
}

describe('bug 2: constellation lines run star to star', () => {
  it('every line starts and ends at centre + (radius + gap) towards the other star', () => {
    const edges = drawnEdges();
    expect(edges.length).toBeGreaterThan(8);
    for (const { e, s, t, sr, tr, d } of edges) {
      const n = nums(d);
      const first = { x: n[0]!, y: n[1]! };
      const last = { x: n[n.length - 2]!, y: n[n.length - 1]! };
      const len = Math.hypot(t.x - s.x, t.y - s.y);
      const ux = (t.x - s.x) / len;
      const uy = (t.y - s.y) / len;
      const wantA = { x: s.x + ux * (sr + WEAVE.lineGap), y: s.y + uy * (sr + WEAVE.lineGap) };
      const wantB = { x: t.x - ux * (tr + WEAVE.lineGap), y: t.y - uy * (tr + WEAVE.lineGap) };
      expect(Math.hypot(first.x - wantA.x, first.y - wantA.y), `${e.kind} ${e.id} start`).toBeLessThan(1);
      expect(Math.hypot(last.x - wantB.x, last.y - wantB.y), `${e.kind} ${e.id} end`).toBeLessThan(1);
    }
  });

  it('a line is one straight segment or one gentle arc: no lanes, no right-angle turns, no jogs', () => {
    for (const { e, d } of drawnEdges()) {
      expect(d, `${e.kind} ${e.id}`).toMatch(
        /^M [-\d.e]+ [-\d.e]+ (L [-\d.e]+ [-\d.e]+|Q [-\d.e]+ [-\d.e]+ [-\d.e]+ [-\d.e]+)$/,
      );
      expect((d.match(/[QC]/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('regression (religion demo): Gospel Sources → Resurrection Accounts and Personal Doubts → Resurrection Accounts', () => {
    const edges = drawnEdges();
    const res = byLabel('Resurrection Accounts');
    for (const from of ['Gospel Sources', 'Personal Doubts']) {
      const src = byLabel(from);
      const hit = edges.find((x) => x.e.kind === 'flow' && x.e.sourceId === src.id && x.e.targetId === res.id)!;
      expect(hit, from).toBeTruthy();
      // no detour into a left lane: the whole line stays between (or bows gently beside) its stars
      const n = nums(hit.d);
      const xs = n.filter((_, i) => i % 2 === 0);
      expect(Math.min(...xs), `${from} → Resurrection Accounts lane detour`).toBeGreaterThan(
        Math.min(hit.s.x, hit.t.x) - 120,
      );
      expect(hit.d).not.toMatch(/ L .* L /); // never two segments
      // it ends aimed at the star's centre, not at a port beside it
      const last = { x: n[n.length - 2]!, y: n[n.length - 1]! };
      const toCentre = Math.hypot(last.x - hit.t.x, last.y - hit.t.y);
      expect(Math.abs(toCentre - (hit.tr + WEAVE.lineGap))).toBeLessThan(1);
    }
  });

  it('tethers follow the same rule and stay dotted; flow lines keep the midpoint chevron', () => {
    const { container } = render(<ConversationMap state={demo} />);
    const tether = container.querySelector('g[data-kind="tether"] path')!;
    expect(tether.getAttribute('stroke-dasharray')).toBe('0.5 4');
    expect(tether.getAttribute('d')).toMatch(/^M [-\d.e]+ [-\d.e]+ [LQ] /);
    for (const g of container.querySelectorAll('g[data-kind="flow"]')) {
      expect(g.querySelector('[data-testid="chevron"]')).toBeTruthy();
      expect(['direct', 'arc', 'return']).toContain(g.getAttribute('data-route'));
    }
  });
});

describe('bug 1: labels never clip', () => {
  it('CSS: line-height ≥ 1.3 for every label variant; the text never shrinks; the weave box can grow', () => {
    for (const sel of ['.cmap-label {', '.cmap-label-beside .cmap-label {', '.cmap-label-weave .cmap-label {']) {
      const i = mapCss.indexOf(sel);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      const block = mapCss.slice(i, mapCss.indexOf('}', i));
      const lh = Number((block.match(/line-height:\s*([\d.]+)/) ?? [])[1]);
      expect(lh, sel).toBeGreaterThanOrEqual(1.3);
    }
    expect(mapCss).toMatch(/\.cmap-label \{\s*flex-shrink: 0;/);
    expect(mapCss).toMatch(/\.cmap-label-weave \{\s*overflow: visible;/);
  });

  it('at text size 1.15 and zoom ≈ 0.57 every label box fits its lines', () => {
    const textSize = 1.15;
    const zoom = 0.57;
    // what the CSS renders in layout units: 13.5 px × text size × label scale (1 when zoom ≤ 1)
    const scale = 1 / Math.max(1, zoom);
    const px = WEAVE.labelPx * textSize * scale;
    const lineH = px * 1.34;
    const vg = vgOf(demo);
    const lay = weaveLayout(vg, { textSize });
    expect(labelMetrics(textSize).lineH).toBeCloseTo(lineH, 5);
    for (const v of vg.nodes) {
      const b = lay.labels.get(v.node.id)!;
      const lines = Math.min(2, Math.ceil(textWidth(v.node.label, textSize) / b.w - 1e-9));
      expect(b.lines, v.node.label).toBeGreaterThanOrEqual(lines);
      expect(b.h, `${v.node.label} box height`).toBeGreaterThanOrEqual(b.lines * lineH);
    }
  });

  it('the rendered weave label box uses min-height (never a fixed height) from the text-size preference', () => {
    usePrefs.getState().set({ textSize: 1.15 });
    render(<ConversationMap state={demo} />);
    const n = byLabel('Gospel Sources');
    const label = screen.getByTestId(`map-node-${n.id}`).querySelector<HTMLElement>('[data-testid="node-label"]')!;
    expect(label.style.height).toBe('');
    const lay = weaveLayout(vgOf(demo), { textSize: 1.15 });
    expect(parseFloat(label.style.minHeight)).toBeCloseTo(lay.labels.get(n.id)!.h, 3);
  });

  it('bigger text gives bigger label boxes (footprints follow --text-size)', () => {
    const a = weaveLayout(vgOf(demo), { textSize: 1 });
    const b = weaveLayout(vgOf(demo), { textSize: 1.5 });
    const id = byLabel('Sunday Service').id;
    expect(b.labels.get(id)!.h).toBeGreaterThan(a.labels.get(id)!.h);
  });
});
