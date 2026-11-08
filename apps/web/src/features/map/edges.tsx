/**
 * Edge components. Types differ by line shape, not only hue:
 *  flow    — classic constellation line (default): thin, even, straight where it can be, with a tiny
 *            chevron at the midpoint pointing source → target (no end arrowheads). Returns to an
 *            earlier star and long jumps keep their side-channel curve, plus the chevron.
 *            (flag `cometTrails`: the earlier comet trail — a solid curve, bright and thicker at the source, fading toward the target,
 *            so direction reads without an arrowhead. A return to an earlier topic (merged stars)
 *            loops out to the side and back into the star; a long forward jump runs down a side
 *            channel instead of cutting through the topics in between.
 *  revisit — (flag `revisitArcs`) dashed arc swinging out to the left margin, arrowhead into the earlier node
 *  tether  — fine dotted line, no gradient, no arrow (deferred / parked threads)
 *  user    — long-dash comet trail (drawn by the user)
 *  note    — thin faint connector from a sticky note to its node
 * Geometry helpers are exported for unit tests.
 */
import type { EdgeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { COLUMN, type ColumnRoute } from './layout';
import { weaveEdgePath } from './weave';
import { EDGE_COLOR, type MapFlowEdge } from './flow';

export interface Pt {
  x: number;
  y: number;
}

/**
 * Forward curve from the source to the rim of the target (vertical tangents). Going down, it
 * leaves from under the source's label (`gap` = label height) so it never crosses the text.
 */
export function flowPath(s: Pt, t: Pt, sr: number, tr: number, gap = 0): string {
  const dy = t.y - s.y;
  if (Math.abs(dy) < Math.max(sr, tr) * 2) {
    // side by side: straight line between rims
    const len = Math.hypot(t.x - s.x, dy) || 1;
    const ux = (t.x - s.x) / len;
    const uy = dy / len;
    return `M ${s.x + ux * sr} ${s.y + uy * sr} L ${t.x - ux * (tr + 3)} ${t.y - uy * (tr + 3)}`;
  }
  const dir = Math.sign(dy);
  const b = { x: t.x, y: t.y - dir * (tr + 3) };
  const below = s.y + sr + gap;
  if (dir > 0 && gap > 0 && b.y - below < 14) {
    // the label (and its time line) fills the space below the node
    const side = Math.sign(t.x - s.x);
    if (side !== 0 && Math.abs(t.x - s.x) > sr + 20) {
      // changing lane: leave from the side facing the target, clear of the label
      const a = { x: s.x + side * sr, y: s.y };
      return `M ${a.x} ${a.y} C ${a.x + side * 48} ${a.y}, ${b.x} ${b.y - 40}, ${b.x} ${b.y}`;
    }
    // same lane: a short stub just above the target, under the label
    return `M ${b.x} ${Math.min(below, b.y - 8)} L ${b.x} ${b.y}`;
  }
  const a = { x: s.x, y: dir > 0 && gap > 0 ? below : s.y + dir * sr };
  // too short for an S-curve to read: a straight segment
  if (Math.abs(b.y - a.y) < 36) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const k = (b.y - a.y) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + k}, ${b.x} ${b.y - k}, ${b.x} ${b.y}`;
}

/** x of the left margin the revisit arcs swing out to (left of lane 1, which sits at x = 140). */
export const REVISIT_MARGIN_X = 40;

/**
 * x of both control points of a revisit arc: out at the left margin, deeper for longer spans so
 * nested returns don't overlap, and always at least 90 px left of both endpoints.
 */
export function revisitControlX(s: Pt, t: Pt): number {
  const depth = Math.min(48, Math.abs(s.y - t.y) * 0.05);
  return Math.min(REVISIT_MARGIN_X - depth, Math.min(s.x, t.x) - 90);
}

/** Arc from the left of the newer node out to the left margin and into the left of the earlier one. */
export function revisitPath(s: Pt, t: Pt, sr: number, tr: number): string {
  const a = { x: s.x - sr, y: s.y };
  const b = { x: t.x - tr - 3, y: t.y };
  const cx = revisitControlX(s, t);
  return `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
}

/** A forward jump longer than this (about 1.5 rows) runs down a side channel. */
export const SKIP_DY = 150;

/**
 * Side channel between two nodes: leave the source from its side, run out to a channel beside
 * both, come back into the target's side. Used for returns (going up) and long forward jumps.
 * `side` is −1 (left) or +1 (right).
 */
export function channelPath(s: Pt, t: Pt, sr: number, tr: number, side: -1 | 1): string {
  const swing = 60 + Math.min(40, Math.abs(t.y - s.y) * 0.04);
  const a = { x: s.x + side * sr, y: s.y };
  const b = { x: t.x + side * (tr + 3), y: t.y };
  const cx = side < 0 ? Math.min(s.x, t.x) - swing : Math.max(s.x, t.x) + swing;
  return `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
}

/** Returns loop on the left when both ends sit in the first lane, otherwise on the right. */
export function returnSide(s: Pt, t: Pt): -1 | 1 {
  return s.x <= 210 && t.x <= 210 ? -1 : 1;
}

export type FlowRoute = 'direct' | 'return' | 'skip';

export function flowRoute(s: Pt, t: Pt, returning: boolean): FlowRoute {
  if (returning) return 'return';
  return t.y - s.y > SKIP_DY ? 'skip' : 'direct';
}

/** The comet path for a flow / user edge, by route. */
export function cometPath(s: Pt, t: Pt, sr: number, tr: number, gap: number, returning: boolean): string {
  const route = flowRoute(s, t, returning);
  if (route === 'return') return channelPath(s, t, sr, tr, returnSide(s, t));
  if (route === 'skip') return channelPath(s, t, sr, tr, t.x > s.x + 20 ? 1 : -1);
  return flowPath(s, t, sr, tr, gap);
}

/** Estimated half-width of a node label's text (14 px semibold, at most 136 px wide). */
export function labelHalfWidth(chars: number): number {
  return Math.min(68, Math.max(18, chars * 3.9));
}

/**
 * Constellation route: a straight rim-to-rim line when it doesn't cross the source's label;
 * otherwise the curved forward route; returns and long jumps keep their side channel.
 */
export function linePath(
  s: Pt,
  t: Pt,
  sr: number,
  tr: number,
  gap: number,
  returning: boolean,
  labelChars = 12,
): string {
  const route = flowRoute(s, t, returning);
  if (route !== 'direct') return cometPath(s, t, sr, tr, gap, returning);
  const dy = t.y - s.y;
  if (dy > 0 && gap > 0) {
    // where the straight line passes the middle of the label block, how far is it from the centre?
    const yMid = sr + gap / 2;
    const xOff = Math.abs(((t.x - s.x) * yMid) / dy);
    if (xOff < labelHalfWidth(labelChars) && yMid < dy) return flowPath(s, t, sr, tr, gap);
  }
  return rimToRim(s, t, sr, tr + 2);
}

/** Points along a path of absolute M / L / Q / C segments. */
export function samplePath(d: string, steps = 20): Pt[] {
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
      for (let k = 1; k <= steps; k++)
        out.push({ x: cur.x + ((p.x - cur.x) * k) / steps, y: cur.y + ((p.y - cur.y) * k) / steps });
      cur = p;
    } else if (cmd === 'Q') {
      const c = { x: num(), y: num() };
      const p = { x: num(), y: num() };
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
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
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        out.push({
          x: u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p.x,
          y: u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p.y,
        });
      }
      cur = p;
    } else break;
  }
  return out;
}

/** Point and direction (degrees) halfway along a path, by length (works for any M / L / Q / C path). */
export function pathMidpoint(d: string): { x: number; y: number; angle: number } {
  if (/[QC]/.test(d) && !/^M[^C]*C[^C]*$/.test(d.replace(/\s+/g, ' ').trim())) {
    const pts = samplePath(d, 24);
    const seg = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k]!.x, p.y - pts[k]!.y));
    const half = seg.reduce((a, b) => a + b, 0) / 2;
    let acc = 0;
    for (let k = 0; k < seg.length; k++) {
      if (acc + seg[k]! >= half) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const f = seg[k]! ? (half - acc) / seg[k]! : 0;
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        };
      }
      acc += seg[k]!;
    }
  }
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (n.length >= 8) {
    const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = n as [number, number, number, number, number, number, number, number];
    const x = (ax + 3 * c1x + 3 * c2x + bx) / 8;
    const y = (ay + 3 * c1y + 3 * c2y + by) / 8;
    // B'(0.5) ∝ (b − a) + (c2 − c1)
    const angle = (Math.atan2(by - ay + c2y - c1y, bx - ax + c2x - c1x) * 180) / Math.PI;
    return { x, y, angle };
  }
  const [ax = 0, ay = 0, bx = 0, by = 0] = n;
  return { x: (ax + bx) / 2, y: (ay + by) / 2, angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI };
}

// ───────────────────────── column layout routes (display layout, round 4) ─────────────────────────

/** Column: next star down (no topic in between) — a straight line from the bottom of one star to the top of the next. */
export function columnDirectPath(s: Pt, t: Pt, sr: number, tr: number): string {
  return `M ${s.x} ${s.y + sr} L ${t.x} ${t.y - tr - 2}`;
}

/**
 * Column: returns and long jumps loop down the left channel (labels are on the right): straight out
 * of the star's left side, along the channel, straight back into the other star's left side, with
 * rounded corners. Each row holds one star, so the out / in legs pass nothing.
 */
export function columnChannelPath(s: Pt, t: Pt, sr: number, tr: number, cx: number): string {
  return roundedPath(
    [
      { x: s.x - sr - 1, y: s.y },
      { x: cx, y: s.y },
      { x: cx, y: t.y },
      { x: t.x - tr - 3, y: t.y },
    ],
    14,
  );
}

/** Orthogonal polyline with rounded corners (radius `k`). */
export function roundedPath(points: Pt[], k = 10): string {
  if (points.length < 2) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!;
    const c = points[i]!;
    const n = points[i + 1]!;
    const inLen = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    const outLen = Math.hypot(n.x - c.x, n.y - c.y) || 1;
    const r = Math.min(k, inLen / 2, outLen / 2);
    const a = { x: c.x - ((c.x - p.x) / inLen) * r, y: c.y - ((c.y - p.y) / inLen) * r };
    const b = { x: c.x + ((n.x - c.x) / outLen) * r, y: c.y + ((n.y - c.y) / outLen) * r };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

/** Column tether between neighbouring rows: an S-curve from the upper star's bottom to the lower one's top. */
export function tetherDirectPath(u: Pt, l: Pt, ur: number, lr: number): string {
  const a = { x: u.x, y: u.y + ur + 2 };
  const b = { x: l.x, y: l.y - lr - 2 };
  const m = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${m}, ${b.x} ${m}, ${b.x} ${b.y}`;
}

/**
 * Column tether across several rows: out of the upper star (its bottom for a topic, its right side
 * for a gutter thread), down the channel right of the gutter, into the lower star (its top for a
 * topic, crossing in the gap above its row; its right side for a gutter thread).
 */
export function tetherGutterPath(
  u: Pt,
  l: Pt,
  ur: number,
  lr: number,
  uGutter: boolean,
  lGutter: boolean,
  gx: number,
): string {
  const pts: Pt[] = [];
  if (uGutter) pts.push({ x: u.x + ur + 2, y: u.y }, { x: gx, y: u.y });
  else {
    const y = u.y + Math.max(ur, 24) + 8;
    pts.push({ x: u.x, y: u.y + ur + 2 }, { x: u.x, y }, { x: gx, y });
  }
  if (lGutter) pts.push({ x: gx, y: l.y }, { x: l.x + lr + 2, y: l.y });
  else {
    const y = l.y - Math.max(lr, 24) - 8;
    pts.push({ x: gx, y }, { x: l.x, y }, { x: l.x, y: l.y - lr - 2 });
  }
  return roundedPath(pts);
}

/** Path for a flow / user edge under a column or weave route. */
export function columnFlowPath(s: Pt, t: Pt, sr: number, tr: number, route: ColumnRoute): string {
  if (route.kind === 'line' || route.kind === 'arc') return weaveEdgePath(s, t, sr, tr, route);
  if (route.kind === 'left-channel') return columnChannelPath(s, t, sr, tr, route.x);
  return columnDirectPath(s, t, sr, tr);
}

/** Path for a tether under a column route (either end may be the gutter thread). */
export function columnTetherPath(s: Pt, t: Pt, sr: number, tr: number, route: ColumnRoute): string {
  if (route.kind === 'line' || route.kind === 'arc') return weaveEdgePath(s, t, sr, tr, route);
  const sUp = s.y <= t.y;
  const [u, l, ur, lr] = sUp ? [s, t, sr, tr] : [t, s, tr, sr];
  const g = (p: Pt) => p.x >= COLUMN.gutter - 1;
  if (route.kind === 'tether-gutter') return tetherGutterPath(u, l, ur, lr, g(u), g(l), route.x);
  return tetherDirectPath(u, l, ur, lr);
}

/** Constellation line colour (pale gold at ~80 %). */
export const LINE_COLOUR = '#FFE0A8';

/** First and last points of a path made of numbers (start of the comet head, end of its tail). */
export function pathEnds(d: string): [Pt, Pt] {
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return [
    { x: n[0] ?? 0, y: n[1] ?? 0 },
    { x: n[n.length - 2] ?? 0, y: n[n.length - 1] ?? 0 },
  ];
}

/** Straight segment between two rims (tethers). */
export function rimToRim(s: Pt, t: Pt, sr: number, tr: number): string {
  const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
  const ux = (t.x - s.x) / len;
  const uy = (t.y - s.y) / len;
  return `M ${s.x + ux * sr} ${s.y + uy * sr} L ${t.x - ux * tr} ${t.y - uy * tr}`;
}

type P = EdgeProps<MapFlowEdge>;

/** data-route value: the column route's kind when laid out in columns, else the old route name. */
function routeName(route: ColumnRoute | undefined, old: FlowRoute, returning: boolean): string {
  if (!route) return old;
  if (returning) return 'return';
  if (route.kind === 'left-channel') return 'skip';
  if (route.kind === 'arc') return 'arc';
  return 'direct';
}

/** Saved-map reveal: lines draw in after their stars (class + delay; none under reduced motion). */
function revealClass(data: P['data']): string | undefined {
  return data?.revealDelay !== undefined ? 'cmap-draw' : undefined;
}
function revealStyle(data: P['data']): CSSProperties | undefined {
  return data?.revealDelay !== undefined ? { animationDelay: `${data.revealDelay}ms` } : undefined;
}

/** Highlighted branches keep their type's colour and pattern, drawn thicker and brighter. */
function strokeOf(props: P, colour: string): { stroke: string; width: number; opacity: number; style: CSSProperties } {
  const d = props.data;
  return {
    stroke: colour,
    width: d?.highlighted || d?.onPath ? 2.75 : 1.5,
    opacity: d?.dimmed ? 0.15 : 1,
    style: d?.highlighted || d?.onPath ? { filter: `drop-shadow(0 0 calc(4px * var(--glow)) ${colour})` } : {},
  };
}

function pts(props: P): [Pt, Pt] {
  return [
    { x: props.sourceX, y: props.sourceY },
    { x: props.targetX, y: props.targetY },
  ];
}

const svgId = (id: string) => id.replace(/[^\w-]/g, '_');

/**
 * Comet trail: a gradient along the path from the source (opaque) to the target (faint), plus a
 * short wider "head" at the source. `dash` makes the user-drawn variant.
 */
function Comet({ props, kind, colour, dash }: { props: P; kind: 'flow' | 'user'; colour: string; dash?: string }) {
  const [s, t] = pts(props);
  const data = props.data;
  const d = cometPath(
    s,
    t,
    data?.sourceRadius ?? 0,
    data?.targetRadius ?? 0,
    data?.labelGap ?? 0,
    Boolean(data?.returning),
  );
  const [a, b] = pathEnds(d);
  const st = strokeOf(props, colour);
  const id = `cmap-comet-${svgId(props.id)}`;
  const bright = data?.highlighted || data?.onPath;
  const particles = data?.particles && data?.motion && !data?.dimmed;
  return (
    <g
      data-testid={`map-edge-${props.id}`}
      data-kind={kind}
      data-route={flowRoute(s, t, Boolean(data?.returning))}
      opacity={st.opacity}
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
          <stop offset="0" stopColor={colour} stopOpacity={1} />
          <stop offset="1" stopColor={colour} stopOpacity={bright ? 0.45 : 0.12} />
        </linearGradient>
        <linearGradient id={`${id}-head`} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
          <stop offset="0" stopColor={colour} stopOpacity={0.55} />
          <stop offset="0.3" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={`url(#${id}-head)`}
        strokeWidth={st.width + 2}
        strokeLinecap="round"
        data-testid="comet-head"
      />
      <path
        d={d}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={st.width}
        strokeLinecap="round"
        strokeDasharray={dash}
        markerEnd={props.markerEnd}
        style={st.style}
        data-testid="comet-trail"
      />
      {particles &&
        [0, 1.6].map((begin) => (
          <circle key={begin} r={1.8} fill={colour} data-testid="particle">
            <animateMotion dur="3.2s" begin={`${begin}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}
    </g>
  );
}

/**
 * Classic constellation line: thin and even, with a 5–6 px chevron at the midpoint showing the
 * direction. `dash` makes the user-drawn variant.
 */
function Constellation({ props, kind, dash }: { props: P; kind: 'flow' | 'user'; dash?: string }) {
  const [s, t] = pts(props);
  const data = props.data;
  const returning = Boolean(data?.returning);
  const d = data?.route
    ? columnFlowPath(s, t, data.sourceRadius, data.targetRadius, data.route)
    : linePath(
        s,
        t,
        data?.sourceRadius ?? 0,
        data?.targetRadius ?? 0,
        data?.labelGap ?? 0,
        returning,
        data?.labelChars ?? 12,
      );
  const mid = pathMidpoint(d);
  const bright = data?.highlighted || data?.onPath;
  const width = bright ? 1.6 : 0.9;
  return (
    <g
      data-testid={`map-edge-${props.id}`}
      data-kind={kind}
      data-route={routeName(data?.route, flowRoute(s, t, returning), returning)}
      data-style="line"
      opacity={data?.dimmed ? 0.15 : bright ? 1 : 0.8}
      className={revealClass(data)}
      style={revealStyle(data)}
    >
      <path
        d={d}
        fill="none"
        stroke={LINE_COLOUR}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dash}
        pathLength={dash ? undefined : 1}
        data-testid="constellation-line"
      />
      <path
        d="M -2.6 -2.8 L 1.6 0 L -2.6 2.8"
        fill="none"
        stroke={LINE_COLOUR}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${mid.x} ${mid.y}) rotate(${mid.angle})`}
        data-testid="chevron"
      />
    </g>
  );
}

export function FlowEdge(props: P) {
  return props.data?.comet ? (
    <Comet props={props} kind="flow" colour={EDGE_COLOR.flow} />
  ) : (
    <Constellation props={props} kind="flow" />
  );
}

export function UserEdge(props: P) {
  return props.data?.comet ? (
    <Comet props={props} kind="user" colour={EDGE_COLOR.user} dash="10 4" />
  ) : (
    <Constellation props={props} kind="user" dash="6 3" />
  );
}

export function RevisitEdge(props: P) {
  const [s, t] = pts(props);
  const route = props.data?.route;
  const d =
    route?.kind === 'line' || route?.kind === 'arc'
      ? weaveEdgePath(s, t, props.data?.sourceRadius ?? 0, props.data?.targetRadius ?? 0, route)
      : route?.kind === 'left-channel'
        ? columnChannelPath(s, t, props.data?.sourceRadius ?? 0, props.data?.targetRadius ?? 0, route.x)
        : revisitPath(s, t, props.data?.sourceRadius ?? 0, props.data?.targetRadius ?? 0);
  const st = strokeOf(props, EDGE_COLOR.revisit);
  return (
    <g data-testid={`map-edge-${props.id}`} data-kind="revisit" opacity={st.opacity}>
      <path
        d={d}
        fill="none"
        stroke={st.stroke}
        strokeWidth={st.width + 0.25}
        strokeDasharray="7 5"
        strokeLinecap="round"
        markerEnd={props.markerEnd}
        style={st.style}
      />
    </g>
  );
}

export function TetherEdge(props: P) {
  const [s, t] = pts(props);
  const route = props.data?.route;
  const d = route
    ? columnTetherPath(s, t, props.data?.sourceRadius ?? 0, props.data?.targetRadius ?? 0, route)
    : rimToRim(s, t, (props.data?.sourceRadius ?? 0) + 2, (props.data?.targetRadius ?? 0) + 2);
  const st = strokeOf(props, EDGE_COLOR.tether);
  return (
    <g
      data-testid={`map-edge-${props.id}`}
      data-kind="tether"
      data-route={route?.kind}
      opacity={st.opacity}
      className={revealClass(props.data)}
      style={revealStyle(props.data)}
    >
      <path
        d={d}
        fill="none"
        stroke={st.stroke}
        strokeWidth={st.width - 0.25}
        strokeDasharray="0.5 4"
        strokeLinecap="round"
        strokeOpacity={0.85}
        style={st.style}
      />
    </g>
  );
}

export function NoteEdge(props: P) {
  const [s, t] = pts(props);
  const d = rimToRim(s, t, 0, (props.data?.targetRadius ?? 0) + 2);
  return (
    <g data-testid={`map-edge-${props.id}`} data-kind="note" opacity={props.data?.dimmed ? 0.15 : 0.55}>
      <path d={d} fill="none" stroke={EDGE_COLOR.note} strokeWidth={1} />
    </g>
  );
}

export const edgeTypes = { flow: FlowEdge, user: UserEdge, revisit: RevisitEdge, tether: TetherEdge, note: NoteEdge };
