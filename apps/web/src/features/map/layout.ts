/**
 * Display-only column layout (humans' round 4). Persisted `x / y` and `placeNode` are contracts and
 * stay untouched; this derives where each star is DRAWN from what is already stored:
 *
 *  - one row per visible star, in conversation order (seq), top to bottom, fixed row height
 *  - main topics (level 0–1) in one lane; level-2 ideas offset a little to the right of it
 *  - deferred threads (embers, rekindled stars) in a slim gutter on the far right
 *  - topic labels sit to the RIGHT of their star; gutter labels to the LEFT of theirs
 *  - returns and long jumps loop down a channel on the LEFT, where there are no labels
 *  - tethers to gutter threads run down a channel on the RIGHT of the gutter
 *
 * Deterministic: the same graph always gives the same layout, and a star's row depends only on the
 * stars before it, so appending a star never moves an existing one (live maps stay still).
 */
import type { TopicNode } from '@constellate/shared';
import type { VisibleEdge, VisibleGraph } from './model';

export const COLUMN = {
  /** canvas width the layout is drawn in (fits a 375 px phone at zoom ≈ 1) */
  width: 360,
  /** first row's centre */
  top: 44,
  /** fixed vertical spacing between rows */
  row: 76,
  /** lanes */
  main: 100,
  level2: 152,
  gutter: 318,
  /** innermost left channel (returns, long jumps) and the step between nested channels */
  leftChannel: 58,
  channelStep: 12,
  minChannelX: 8,
  /** gap between a star's rim and its label */
  labelGap: 8,
  /** label widths: topics (right of the star) and gutter threads (left of the star) */
  topicLabelMax: 170,
  gutterLabelMax: 120,
} as const;

export type LabelSide = 'right' | 'left';

/** A label box placed by the weave layout (layout units, absolute). */
export interface PlacedLabel {
  side: 'below' | 'right' | 'left' | 'above';
  x0: number;
  y0: number;
  w: number;
  h: number;
  lines: number;
  /** text alignment inside the box */
  align: 'start' | 'center' | 'end';
}

export interface PlacedNode {
  x: number;
  y: number;
  row: number;
  lane: 'main' | 'level2' | 'gutter';
  labelSide: LabelSide;
  /** max label width at this position */
  labelWidth: number;
  /** weave layout: exactly where the label goes */
  label?: PlacedLabel;
}

export type ColumnRoute =
  | { kind: 'direct' }
  | { kind: 'left-channel'; x: number }
  | { kind: 'tether-direct' }
  | { kind: 'tether-gutter'; x: number }
  /** weave layout: a straight constellation line, centre to centre */
  | { kind: 'line' }
  /** weave layout: one gentle quadratic arc; `bend` = perpendicular offset of the control point */
  | { kind: 'arc'; bend: number };

export interface ColumnLayout {
  nodes: Map<string, PlacedNode>;
  routes: Map<string, ColumnRoute>;
  /** layout frame: the width is fixed; height grows with the rows */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const isGutter = (n: TopicNode) => n.kind !== 'topic';

function laneOf(n: TopicNode): PlacedNode['lane'] {
  if (isGutter(n)) return 'gutter';
  return n.level >= 2 ? 'level2' : 'main';
}

const LANE_X: Record<PlacedNode['lane'], number> = {
  main: COLUMN.main,
  level2: COLUMN.level2,
  gutter: COLUMN.gutter,
};

/** Assign nested channel depths so overlapping spans never share a channel (shortest innermost). */
function allocateDepths(spans: { id: string; a: number; b: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const taken: { a: number; b: number; d: number }[] = [];
  const sorted = [...spans].sort((p, q) => p.b - p.a - (q.b - q.a) || p.a - q.a || p.id.localeCompare(q.id));
  for (const s of sorted) {
    let d = 0;
    while (taken.some((t) => t.d === d && s.a < t.b && t.a < s.b)) d++;
    taken.push({ a: s.a, b: s.b, d });
    out.set(s.id, d);
  }
  return out;
}

export function columnLayout(vg: VisibleGraph): ColumnLayout {
  const nodes = new Map<string, PlacedNode>();
  vg.nodes.forEach((v, row) => {
    const lane = laneOf(v.node);
    const x = LANE_X[lane];
    const labelSide: LabelSide = lane === 'gutter' ? 'left' : 'right';
    const labelWidth =
      labelSide === 'right'
        ? Math.min(COLUMN.topicLabelMax, COLUMN.width - (x + v.radius + COLUMN.labelGap) - 4)
        : COLUMN.gutterLabelMax;
    nodes.set(v.node.id, { x, y: COLUMN.top + row * COLUMN.row, row, lane, labelSide, labelWidth });
  });

  const radius = new Map(vg.nodes.map((v) => [v.node.id, v.radius]));
  /** left edge of the star in each row (topic lanes only) */
  const leftEdge = new Map<number, number>();
  for (const v of vg.nodes) {
    const p = nodes.get(v.node.id)!;
    if (p.lane !== 'gutter') leftEdge.set(p.row, p.x - v.radius);
  }
  const gutterR = Math.max(10, ...vg.nodes.filter((v) => isGutter(v.node)).map((v) => v.radius));
  const gutterChannel = Math.min(COLUMN.width - 4, COLUMN.gutter + gutterR + 8);

  const routes = new Map<string, ColumnRoute>();
  const left: { id: string; a: number; b: number }[] = [];
  const right: { id: string; a: number; b: number }[] = [];
  const topicRows = new Set([...nodes.values()].filter((p) => p.lane !== 'gutter').map((p) => p.row));

  for (const e of vg.edges as VisibleEdge[]) {
    const s = nodes.get(e.sourceId);
    const t = nodes.get(e.targetId);
    if (!s || !t) continue;
    if (e.kind === 'flow' || e.kind === 'user') {
      const lo = Math.min(s.row, t.row);
      const hi = Math.max(s.row, t.row);
      let blocked = false;
      for (let r = lo + 1; r < hi; r++) if (topicRows.has(r)) blocked = true;
      if (t.row > s.row && !blocked) routes.set(e.id, { kind: 'direct' });
      else left.push({ id: e.id, a: lo, b: hi });
    } else if (e.kind === 'tether') {
      if (Math.abs(s.row - t.row) <= 1) routes.set(e.id, { kind: 'tether-direct' });
      else right.push({ id: e.id, a: Math.min(s.row, t.row), b: Math.max(s.row, t.row) });
    } else if (e.kind === 'revisit') {
      left.push({ id: e.id, a: Math.min(s.row, t.row), b: Math.max(s.row, t.row) });
    }
  }
  const spanOf = new Map(left.map((s) => [s.id, s]));
  for (const [id, d] of allocateDepths(left)) {
    // the vertical run must clear every star in the rows it passes (labels are all on the right)
    const s = spanOf.get(id)!;
    let clear: number = COLUMN.leftChannel;
    for (let r = s.a + 1; r < s.b; r++) {
      const edge = leftEdge.get(r);
      if (edge !== undefined) clear = Math.min(clear, edge - 12);
    }
    routes.set(id, { kind: 'left-channel', x: Math.max(COLUMN.minChannelX, clear - d * COLUMN.channelStep) });
  }
  for (const [id, d] of allocateDepths(right)) {
    routes.set(id, { kind: 'tether-gutter', x: Math.min(COLUMN.width - 2, gutterChannel + d * 6) });
  }

  const rows = vg.nodes.length;
  const maxR = Math.max(0, ...radius.values());
  return {
    nodes,
    routes,
    bounds: {
      minX: 0,
      minY: COLUMN.top - Math.max(maxR, 24) - 8,
      maxX: COLUMN.width,
      maxY: COLUMN.top + Math.max(0, rows - 1) * COLUMN.row + Math.max(maxR, 30) + 24,
    },
  };
}

// ───────────────────────── label boxes (for routing checks and tests) ─────────────────────────

/** Approximate rendered label box (17 px semibold, up to 2 lines, plus the sub-line). */
export function labelBox(
  p: PlacedNode,
  radius: number,
  label: string,
  hasSub: boolean,
): { x0: number; x1: number; y0: number; y1: number } {
  const charW = 8.6;
  const width = Math.min(p.labelWidth, Math.ceil(label.length * charW));
  const lines = label.length * charW > p.labelWidth ? 2 : 1;
  const h = lines * 20.4 + (hasSub ? 16 : 0);
  const x0 = p.labelSide === 'right' ? p.x + radius + COLUMN.labelGap : p.x - radius - COLUMN.labelGap - width;
  return { x0, x1: x0 + width, y0: p.y - h / 2, y1: p.y + h / 2 };
}
