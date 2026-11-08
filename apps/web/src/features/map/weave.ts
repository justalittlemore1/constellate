/**
 * Display-only "weave" layout (humans' round 5): the conversation path zig-zags gently left and
 * right across four positions, like a constellation, using the full phone width.
 *
 *  - one row per visible star in conversation order (seq), fixed spacing
 *  - main topics (level 0–1) step through the positions 0 1 2 3 2 1 0 1 …, one step per topic
 *  - a level-2 idea branches to the side the path will NOT take next (away from the path)
 *  - deferred threads (embers / rekindled stars) sit at the outer edge on the side of the topic
 *    that raised them (a short tether)
 *  - every connection is a classic constellation line: a straight segment aimed centre to centre,
 *    trimmed at each star's visual radius plus a small gap; only when a star or a label is in the
 *    way it bows into ONE gentle quadratic arc (control point perpendicular at the midpoint, just
 *    far enough to clear). Returns (into the merged star) and tethers follow the same rule.
 *  - each label goes on a side of its star that its lines leave free (right, left, below, above)
 *
 * Label footprints use the same font size and line height as the CSS (13.5 px × --text-size,
 * line-height 1.34), so a label box always fits its lines. Deterministic, and a star's position
 * depends only on the stars before it, so appending a star never moves an existing one (labels and
 * line bows may change). Persisted x / y are untouched.
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
  /** label type, matching map.css: 13.5 px (× --text-size), line-height 1.34; sub-line 11.5 px */
  labelPx: 13.5,
  subPx: 11.5,
  lineHeight: 1.34,
  /** generous average glyph width of the semibold display face, in em */
  charEm: 0.565,
  edgeMargin: 4,
  /** gap between a star's visual edge and the end of a line */
  lineGap: 4,
  /** a line must keep this far from any other star's edge */
  starClearance: 8,
  /** a line must keep this far from a label box */
  labelPad: 3,
} as const;

/** 0 1 2 3 2 1 | 0 1 2 3 2 1 … */
const PING = [0, 1, 2, 3, 2, 1] as const;
export const pathIndex = (k: number) => PING[k % PING.length]!;

export type LabelPlacement = PlacedLabel['side'];
export type LabelBox = PlacedLabel;

export interface WeaveOptions {
  /** the Text size preference (1–1.5), as written to --text-size */
  textSize?: number;
}

type P = { x: number; y: number };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Label typography in layout units for a text size (what the CSS renders at zoom ≤ 1). */
export function labelMetrics(textSize = 1) {
  const px = WEAVE.labelPx * textSize;
  return {
    px,
    lineH: px * WEAVE.lineHeight,
    subH: WEAVE.subPx * textSize * WEAVE.lineHeight,
    charW: px * WEAVE.charEm,
  };
}

export function textWidth(label: string, textSize = 1): number {
  return Math.ceil(label.length * labelMetrics(textSize).charW);
}

/** Candidate label boxes around a star, in order of preference (each sized for its real lines). */
export function labelCandidates(x: number, y: number, r: number, label: string, textSize = 1): LabelBox[] {
  const m = labelMetrics(textSize);
  const tw = textWidth(label, textSize);
  const W = WEAVE.width;
  const e = WEAVE.edgeMargin;
  const g = WEAVE.labelGap;
  const size = (maxW: number) => {
    const w = Math.min(maxW, tw);
    const lines = Math.min(2, Math.max(1, Math.ceil(tw / Math.max(1, maxW))));
    return { w, h: lines * m.lineH + m.subH, lines };
  };
  const out: LabelBox[] = [];
  const push = (b: LabelBox) => {
    if (b.x0 >= e && b.x0 + b.w <= W - e && b.w >= 40) out.push(b);
  };
  const rightRoom = W - e - (x + r + g);
  const leftRoom = x - r - g - e;
  const rs = size(Math.min(WEAVE.labelMaxSide, rightRoom));
  const ls = size(Math.min(WEAVE.labelMaxSide, leftRoom));
  const bs = size(WEAVE.labelMaxBelow);
  const sides: LabelBox[] = [
    { side: 'right', align: 'start', ...rs, x0: x + r + g, y0: y - rs.h / 2 },
    { side: 'left', align: 'end', ...ls, x0: x - r - g - ls.w, y0: y - ls.h / 2 },
  ];
  // the roomier side first
  if (leftRoom > rightRoom) sides.reverse();
  sides.forEach(push);
  push({ side: 'below', align: 'center', ...bs, x0: clamp(x - bs.w / 2, e, W - e - bs.w), y0: y + r + g });
  push({ side: 'above', align: 'center', ...bs, x0: clamp(x - bs.w / 2, e, W - e - bs.w), y0: y - r - g - bs.h });
  if (!out.length)
    out.push({ side: 'below', align: 'center', ...bs, x0: clamp(x - bs.w / 2, e, W - e - bs.w), y0: y + r + g });
  return out;
}

// ───────────────────────── lines ─────────────────────────

/** Line ends: on the segment between the two centres, at radius + gap from each centre. */
export function lineEnds(s: P, t: P, sr: number, tr: number): [P, P] {
  const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
  const ux = (t.x - s.x) / len;
  const uy = (t.y - s.y) / len;
  return [
    { x: s.x + ux * (sr + WEAVE.lineGap), y: s.y + uy * (sr + WEAVE.lineGap) },
    { x: t.x - ux * (tr + WEAVE.lineGap), y: t.y - uy * (tr + WEAVE.lineGap) },
  ];
}

/**
 * Control point of the gentle arc: perpendicular to the line at its midpoint, `bend` layout units
 * to the left (negative) or right (positive) of the direction of travel.
 */
export function arcControl(a: P, b: P, bend: number): P {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
}

/** The path the renderer draws for a weave route: one straight segment, or one quadratic arc. */
export function weaveEdgePath(s: P, t: P, sr: number, tr: number, route: ColumnRoute): string {
  const [a, b] = lineEnds(s, t, sr, tr);
  if (route.kind === 'arc') {
    const c = arcControl(a, b, route.bend);
    return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

/** Points along the drawn line (for clearance checks). */
export function samplePoints(s: P, t: P, sr: number, tr: number, bend: number, steps = 32): P[] {
  const [a, b] = lineEnds(s, t, sr, tr);
  const c = arcControl(a, b, bend);
  const out: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const u = 1 - k;
    out.push({ x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y });
  }
  return out;
}

const inBox = (p: P, b: LabelBox, pad: number) =>
  p.x > b.x0 - pad && p.x < b.x0 + b.w + pad && p.y > b.y0 - pad && p.y < b.y0 + b.h + pad;
const boxesOverlap = (a: LabelBox, b: LabelBox, pad = 2) =>
  a.x0 - pad < b.x0 + b.w && b.x0 - pad < a.x0 + a.w && a.y0 - pad < b.y0 + b.h && b.y0 - pad < a.y0 + a.h;
const circleInBox = (c: P, r: number, b: LabelBox, pad = 2) => {
  const nx = clamp(c.x, b.x0 - pad, b.x0 + b.w + pad);
  const ny = clamp(c.y, b.y0 - pad, b.y0 + b.h + pad);
  return Math.hypot(c.x - nx, c.y - ny) < r;
};

export interface WeaveLayout extends ColumnLayout {
  labels: Map<string, LabelBox>;
}

/** Arc bends tried, in order (smallest first, alternating sides). */
const BENDS = [0, ...[10, 18, 28, 40, 54, 70, 90, 115, 140, 170].flatMap((d) => [d, -d])];

export function weaveLayout(vg: VisibleGraph, opts: WeaveOptions = {}): WeaveLayout {
  const textSize = opts.textSize ?? 1;
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

  const star = (id: string) => ({ id, p: nodes.get(id)!, r: radius.get(id) ?? 0 });
  const stars = vg.nodes.map((v) => star(v.node.id));
  const edges = vg.edges.filter((e) => e.kind !== 'note' && nodes.has(e.sourceId) && nodes.has(e.targetId));

  // ── labels: the first side its star's straight lines (and earlier labels, stars) leave free
  const straight = new Map(
    edges.map((e) => {
      const S = star(e.sourceId);
      const T = star(e.targetId);
      return [e.id, samplePoints(S.p, T.p, S.r, T.r, 0, 24)] as const;
    }),
  );
  const labels = new Map<string, LabelBox>();
  const placed: LabelBox[] = [];
  for (const v of vg.nodes) {
    const { p, r } = star(v.node.id);
    const cands = labelCandidates(p.x, p.y, r, v.node.label, textSize);
    const crossing = (b: LabelBox) =>
      [...straight].filter(([, pts]) => pts.some((q) => inBox(q, b, WEAVE.labelPad))).map(([id]) => id);
    const crossings = (b: LabelBox) => crossing(b).length;
    // a line can bow around someone else's label, never around a label at its own end
    const own = new Set(edges.filter((e) => e.sourceId === v.node.id || e.targetId === v.node.id).map((e) => e.id));
    const crossedByOwn = (b: LabelBox) => crossing(b).some((id) => own.has(id));
    const clearOfOthers = (b: LabelBox) =>
      !placed.some((q) => boxesOverlap(b, q)) && !stars.some((s) => circleInBox(s.p, s.r, b));
    // a side blocked by a line may slide outwards (away from its star) a little until it clears
    const slid = cands.flatMap((b) => {
      if (b.side !== 'right' && b.side !== 'left') return [b];
      const dir = b.side === 'right' ? 1 : -1;
      return [0, 8, 16, 24, 32, 40, 52, 64, 80, 96].map((d) => ({ ...b, x0: b.x0 + dir * d }));
    });
    const inFrame = (b: LabelBox) => b.x0 >= WEAVE.edgeMargin && b.x0 + b.w <= WEAVE.width - WEAVE.edgeMargin;
    const free = slid.find((b) => inFrame(b) && clearOfOthers(b) && crossings(b) === 0);
    // otherwise the clear box with the fewest lines through it (those lines will bow around it)
    const chosen =
      free ??
      slid
        .filter((b) => inFrame(b) && clearOfOthers(b) && !crossedByOwn(b))
        .sort((a, b) => crossings(a) - crossings(b))[0] ??
      [...cands].filter(clearOfOthers).sort((a, b) => crossings(a) - crossings(b))[0] ??
      cands[0]!;
    labels.set(v.node.id, chosen);
    placed.push(chosen);
    const np = nodes.get(v.node.id)!;
    nodes.set(v.node.id, {
      ...np,
      labelSide: chosen.side === 'left' ? 'left' : 'right',
      labelWidth: chosen.w,
      label: chosen,
    });
  }

  // ── routes: straight, or the smallest gentle arc that clears every other star and every label
  const routes = new Map<string, ColumnRoute>();
  for (const e of edges) {
    const S = star(e.sourceId);
    const T = star(e.targetId);
    const clears = (bend: number) => {
      const pts = samplePoints(S.p, T.p, S.r, T.r, bend);
      return (
        stars.every(
          (o) =>
            o.id === S.id ||
            o.id === T.id ||
            pts.every((q) => Math.hypot(q.x - o.p.x, q.y - o.p.y) >= o.r + WEAVE.starClearance),
        ) &&
        placed.every((b) => pts.every((q) => !inBox(q, b, WEAVE.labelPad))) &&
        pts.every((q) => q.x >= 2 && q.x <= WEAVE.width - 2)
      );
    };
    const bend = BENDS.find(clears) ?? 0;
    routes.set(e.id, bend === 0 ? { kind: 'line' } : { kind: 'arc', bend });
  }

  const rows = vg.nodes.length;
  const maxR = Math.max(0, ...radius.values());
  const maxY = Math.max(
    WEAVE.top + Math.max(0, rows - 1) * WEAVE.row + maxR + 20,
    ...placed.map((b) => b.y0 + b.h + 8),
  );
  const minY = Math.min(WEAVE.top - maxR - 16, ...placed.map((b) => b.y0 - 8));
  return { nodes, routes, labels, bounds: { minX: 0, minY, maxX: WEAVE.width, maxY } };
}
