/**
 * Edge components. Types differ by line shape, not only hue:
 *  flow    — comet trail: a solid curve, bright and thicker at the source, fading toward the target,
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

export function FlowEdge(props: P) {
  return <Comet props={props} kind="flow" colour={EDGE_COLOR.flow} />;
}

export function UserEdge(props: P) {
  return <Comet props={props} kind="user" colour={EDGE_COLOR.user} dash="10 4" />;
}

export function RevisitEdge(props: P) {
  const [s, t] = pts(props);
  const d = revisitPath(s, t, props.data?.sourceRadius ?? 0, props.data?.targetRadius ?? 0);
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
  const d = rimToRim(s, t, (props.data?.sourceRadius ?? 0) + 2, (props.data?.targetRadius ?? 0) + 2);
  const st = strokeOf(props, EDGE_COLOR.tether);
  return (
    <g data-testid={`map-edge-${props.id}`} data-kind="tether" opacity={st.opacity}>
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
