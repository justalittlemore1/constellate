/**
 * Display-only "weave" layout (humans' round 5): the conversation path zig-zags gently left and
 * right across four positions, like a constellation, using the full phone width.
 *
 *  - one row per visible star in conversation order (seq), fixed spacing
 *  - main topics (level 0–1) step through the positions 0 1 2 3 2 1 0 1 …, one step per topic
 *  - a level-2 idea branches to the side the path will NOT take next (away from the path)
 *  - deferred threads (embers / rekindled stars) sit at the outer edge on the side of the topic
 *    that raised them (a short tether)
 *  - a step to the next row is an S-curve from the bottom of one star to the top of the next;
 *    returns and longer jumps leave the star diagonally, cross in the empty gap between rows, run
 *    down a side channel clear of every star and label they pass, and cross back in a gap
 *  - labels sit level with their star, on the side with room (the S-curves are vertical there, so
 *    no line can cross them); the last star's label sits centred below it
 *
 * Nothing overlaps by construction. Deterministic, and a star's position depends only on the stars
 * before it, so appending a star never moves an existing one (a label may change side). Persisted
 * x / y are untouched.
 */
import type { TopicNode } from '@constellate/shared';
import type { ColumnLayout, ColumnRoute, PlacedLabel, PlacedNode } from './layout';
import type { VisibleGraph } from './model';

export const WEAVE = {
  width: 360,
  top: 52,
  row: 100,
  /** the four horizontal positions of the path */
  path: [70, 145, 215, 290] as const,
  /** threads at the outer edges */
  threadLeft: 38,
  threadRight: 322,
  /** how far a level-2 idea branches from its parent */
  branch: 78,
  labelGap: 6,
  labelMaxBelow: 132,
  labelMaxSide: 118,
  /** 13.5 px semibold: generous average glyph width and line height (layout units) */
  charW: 7.6,
  lineH: 16.4,
  /** room kept for the sub-line ("now", "playing", "picked up") under every label */
  subH: 14,
  channelStep: 8,
  edgeMargin: 4,
  /** where a channel leaves / enters a star: this fraction of the radius, diagonally */
  diag: 0.7,
} as const;

/** 0 1 2 3 2 1 | 0 1 2 3 2 1 … */
const PING = [0, 1, 2, 3, 2, 1] as const;
export const pathIndex = (k: number) => PING[k % PING.length]!;

export type LabelPlacement = PlacedLabel['side'];
export type LabelBox = PlacedLabel;

type P = { x: number; y: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function textWidth(label: string): number {
  return Math.ceil(label.length * WEAVE.charW);
}

/** The label beside a star (side with room) or, for the last star, centred below it. */
export function labelFor(x: number, y: number, r: number, label: string, last: boolean): LabelBox {
  const tw = textWidth(label);
  const W = WEAVE.width;
  const m = WEAVE.edgeMargin;
  const g = WEAVE.labelGap;
  const size = (w: number) => {
    const lines = tw > w ? 2 : 1;
    return { w: Math.min(w, tw), h: lines * WEAVE.lineH + WEAVE.subH, lines };
  };
  if (last) {
    const s = size(WEAVE.labelMaxBelow);
    return { side: 'below', align: 'center', ...s, x0: clamp(x - s.w / 2, m, W - m - s.w), y0: y + r + g };
  }
  const rightRoom = W - m - (x + r + g);
  const leftRoom = x - r - g - m;
  const want = Math.min(tw, WEAVE.labelMaxSide);
  const right = rightRoom >= want || (leftRoom < want && rightRoom >= leftRoom);
  if (right) {
    const s = size(Math.min(WEAVE.labelMaxSide, rightRoom));
    return { side: 'right', align: 'start', ...s, x0: x + r + g, y0: y - s.h / 2 };
  }
  const s = size(Math.min(WEAVE.labelMaxSide, leftRoom));
  return { side: 'left', align: 'end', ...s, x0: x - r - g - s.w, y0: y - s.h / 2 };
}

/** Orthogonal polyline with rounded corners (radius `k`). */
function rounded(points: P[], k = 12): string {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const inLen = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const outLen = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    const r = Math.min(k, inLen / 2, outLen / 2);
    const a = { x: c.x - ((c.x - p.x) / inLen) * r, y: c.y - ((c.y - p.y) / inLen) * r };
    const b = { x: c.x + ((n.x - c.x) / outLen) * r, y: c.y + ((n.y - c.y) / outLen) * r };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1]!;
  return pts.length > 1 ? `${d} L ${last.x} ${last.y}` : d;
}

/** S-curve between stars in neighbouring rows: out of one star's bottom (top), into the other's top (bottom). */
export function curvePath(s: P, t: P, sr: number, tr: number): string {
  const down = s.y < t.y;
  const a = { x: s.x, y: down ? s.y + sr + 1 : s.y - sr - 1 };
  const b = { x: t.x, y: down ? t.y - tr - 2 : t.y + tr + 2 };
  const m = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${m}, ${b.x} ${m}, ${b.x} ${b.y}`;
}

/** Side channel: diagonally out of `s`, across the gap next to its row, along x = cx, across the gap next to `t`'s row, in. */
export function channelPoints(s: P, t: P, sr: number, tr: number, cx: number): P[] {
  const side = cx < (s.x + t.x) / 2 ? -1 : 1;
  const k = WEAVE.diag;
  const half = WEAVE.row / 2;
  const down = s.y < t.y;
  const a = { x: s.x + side * k * sr, y: down ? s.y + k * sr : s.y - k * sr };
  const b = { x: t.x + side * k * (tr + 2), y: down ? t.y - k * (tr + 2) : t.y + k * (tr + 2) };
  const g1 = down ? s.y + half : s.y - half;
  const g2 = down ? t.y - half : t.y + half;
  return [a, { x: a.x, y: g1 }, { x: cx, y: g1 }, { x: cx, y: g2 }, { x: b.x, y: g2 }, b];
}

export function channelPath(s: P, t: P, sr: number, tr: number, cx: number): string {
  return rounded(channelPoints(s, t, sr, tr, cx));
}

/** The path the renderer draws for a weave route. */
export function weaveEdgePath(s: P, t: P, sr: number, tr: number, route: ColumnRoute): string {
  if (route.kind === 'channel') return channelPath(s, t, sr, tr, route.x);
  return curvePath(s, t, sr, tr);
}

/** Points along a cubic (for collision checks). */
function sampleCurve(s: P, t: P, sr: number, tr: number, steps = 24): P[] {
  const n = (curvePath(s, t, sr, tr).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = n as [number, number, number, number, number, number, number, number];
  const out: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t_ = i / steps;
    const u = 1 - t_;
    out.push({
      x: u * u * u * ax + 3 * u * u * t_ * c1x + 3 * u * t_ * t_ * c2x + t_ * t_ * t_ * bx,
      y: u * u * u * ay + 3 * u * u * t_ * c1y + 3 * u * t_ * t_ * c2y + t_ * t_ * t_ * by,
    });
  }
  return out;
}

const pointInBox = (p: P, b: LabelBox, pad: number) =>
  p.x > b.x0 - pad && p.x < b.x0 + b.w + pad && p.y > b.y0 - pad && p.y < b.y0 + b.h + pad;

export interface WeaveLayout extends ColumnLayout {
  labels: Map<string, LabelBox>;
}

export function weaveLayout(vg: VisibleGraph): WeaveLayout {
  const nodes = new Map<string, PlacedNode>();
  const radius = new Map(vg.nodes.map((v) => [v.node.id, v.radius]));
  const kindOf = new Map(vg.nodes.map((v) => [v.node.id, v.node]));
  let mainCount = 0;
  let lastMain: { x: number; k: number } | null = null;

  // ── stars
  vg.nodes.forEach((v, row) => {
    const n: TopicNode = v.node;
    const y = WEAVE.top + row * WEAVE.row;
    let x: number;
    let lane: PlacedNode['lane'];
    if (n.kind !== 'topic') {
      lane = 'gutter';
      // the outer edge on the side of the topic that raised it (a short tether to an earlier star)
      let raisedX: number | null = null;
      for (const e of vg.edges) {
        if (e.kind !== 'tether') continue;
        const other = e.sourceId === n.id ? e.targetId : e.targetId === n.id ? e.sourceId : null;
        const p = other ? nodes.get(other) : undefined;
        if (p && kindOf.get(other!)?.kind === 'topic') {
          raisedX = p.x;
          break;
        }
      }
      x = raisedX !== null && raisedX < WEAVE.width / 2 ? WEAVE.threadLeft : WEAVE.threadRight;
    } else if (n.level >= 2 && lastMain) {
      lane = 'level2';
      // branch to the side the path will not take next
      const dir = Math.sign(pathIndex(lastMain.k + 1) - pathIndex(lastMain.k)) || 1;
      x = clamp(lastMain.x - dir * WEAVE.branch, 40, WEAVE.width - 40);
    } else {
      lane = 'main';
      const k = mainCount++;
      x = WEAVE.path[pathIndex(k)];
      lastMain = { x, k };
    }
    nodes.set(n.id, { x, y, row, lane, labelSide: 'right', labelWidth: WEAVE.labelMaxSide });
  });

  // ── labels (beside, or below the last star)
  const lastRow = vg.nodes.length - 1;
  const labels = new Map<string, LabelBox>();
  for (const v of vg.nodes) {
    const p = nodes.get(v.node.id)!;
    const l = labelFor(p.x, p.y, v.radius, v.node.label, p.row === lastRow);
    labels.set(v.node.id, l);
    nodes.set(v.node.id, { ...p, labelSide: l.side === 'left' ? 'left' : 'right', labelWidth: l.w, label: l });
  }

  // ── routes
  const star = (id: string) => ({ p: nodes.get(id)!, r: radius.get(id) ?? 0, l: labels.get(id)! });
  const routes = new Map<string, ColumnRoute>();
  const channels: { id: string; a: number; b: number; side: -1 | 1; base: number }[] = [];
  for (const e of vg.edges) {
    if (e.kind === 'note') continue;
    const S = star(e.sourceId);
    const T = star(e.targetId);
    if (!S.p || !T.p) continue;
    const returning = (e.kind === 'flow' || e.kind === 'user' || e.kind === 'revisit') && T.p.row < S.p.row;
    const span = Math.abs(T.p.row - S.p.row);
    if (!returning && e.kind !== 'revisit') {
      if (span === 1) {
        routes.set(e.id, { kind: 'curve' });
        continue;
      }
      // a longer forward step may still curve if nothing is in its way
      const pts = sampleCurve(S.p, T.p, S.r, T.r);
      const clear = vg.nodes.every((v) => {
        if (v.node.id === e.sourceId || v.node.id === e.targetId) return true;
        const o = star(v.node.id);
        return pts.every((q) => Math.hypot(q.x - o.p.x, q.y - o.p.y) >= o.r + 4 && !pointInBox(q, o.l, 3));
      });
      if (clear) {
        routes.set(e.id, { kind: 'curve' });
        continue;
      }
    }
    // side channel: the vertical run clears every star and label in the rows strictly between
    const lo = Math.min(S.p.row, T.p.row);
    const hi = Math.max(S.p.row, T.p.row);
    const passed = vg.nodes.map((v) => star(v.node.id)).filter((o) => o.p.row > lo && o.p.row < hi);
    const leftX = Math.min(...passed.map((o) => Math.min(o.p.x - o.r, o.l.x0)), WEAVE.width) - 10;
    const rightX = Math.max(...passed.map((o) => Math.max(o.p.x + o.r, o.l.x0 + o.l.w)), 0) + 10;
    const mid = (S.p.x + T.p.x) / 2;
    const fitsL = leftX >= 4;
    const fitsR = rightX <= WEAVE.width - 4;
    const nearer: -1 | 1 = Math.abs(mid - Math.min(leftX, mid)) <= Math.abs(Math.max(rightX, mid) - mid) ? -1 : 1;
    const side: -1 | 1 = fitsL && fitsR ? nearer : fitsL ? -1 : fitsR ? 1 : nearer;
    const base = passed.length ? (side < 0 ? Math.min(leftX, mid) : Math.max(rightX, mid)) : mid;
    channels.push({ id: e.id, a: lo, b: hi, side, base });
  }
  // nest overlapping channels on the same side (shortest innermost)
  for (const side of [-1, 1] as const) {
    const list = channels.filter((c) => c.side === side).sort((p, q) => p.b - p.a - (q.b - q.a) || p.a - q.a);
    const taken: { a: number; b: number; x: number }[] = [];
    for (const c of list) {
      let x = c.base;
      while (taken.some((t) => c.a < t.b && t.a < c.b && Math.abs(t.x - x) < WEAVE.channelStep)) {
        x += side * WEAVE.channelStep;
      }
      x = clamp(x, 3, WEAVE.width - 3);
      taken.push({ a: c.a, b: c.b, x });
      routes.set(c.id, { kind: 'channel', x });
    }
  }

  const rows = vg.nodes.length;
  const maxR = Math.max(0, ...radius.values());
  const placed = [...labels.values()];
  const maxY = Math.max(
    WEAVE.top + Math.max(0, rows - 1) * WEAVE.row + maxR + 20,
    ...placed.map((b) => b.y0 + b.h + 8),
  );
  const minY = Math.min(WEAVE.top - maxR - 16, ...placed.map((b) => b.y0 - 8));
  return { nodes, routes, labels, bounds: { minX: 0, minY, maxX: WEAVE.width, maxY } };
}
