/**
 * React Flow node / edge records built from the view-model. Positions come only from the
 * persisted `node.x / node.y`: the circle's centre sits exactly on (x, y).
 */
import type { Annotation, GraphState } from '@constellate/shared';
import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { ColumnLayout, ColumnRoute, PlacedNode } from './layout';
import type { TracedPath, VisibleEdge, VisibleEdgeKind, VisibleGraph, VisibleNode } from './model';
import { noteNodeId } from './model';

/** Half the side of a node's square hit box: at least 26 px, so every target is ≥ 52 px (> 44). */
export function boxRadius(radius: number): number {
  return Math.max(26, Math.ceil(radius + 8));
}

export const NOTE_WIDTH = 148;
export const NOTE_HEIGHT_ESTIMATE = 56;

export interface MapNodeFlags {
  activeNodeId: string | null;
  playingNodeId: string | null;
  selectedNodeId: string | null;
  showTime: boolean;
  motion: boolean;
  traced: TracedPath | null;
  /** id of the visually hidden keyboard instructions every node points at */
  describedBy?: string;
  /** dots drifting along flow edges (flag `particles`) */
  particles?: boolean;
  /** flag `cometTrails` */
  comet?: boolean;
  /** flag `facetedStars`: the wave-2 Y4 art instead of the Y3 compass */
  starArt?: 'y3' | 'y4';
  /** display column layout (round 4); absent = the persisted x/y (flag `storedLayout`) */
  layout?: ColumnLayout;
  /** saved-map reveal: delay between stars in conversation order (ms); absent = no reveal */
  revealStepMs?: number;
}

export type TopicFlowData = {
  view: VisibleNode;
  box: number;
  active: boolean;
  playing: boolean;
  selected: boolean;
  dimmed: boolean;
  showTime: boolean;
  motion: boolean;
  /** which star art to draw ('y3' compass by default; 'y4' faceted behind a flag) */
  art?: 'y3' | 'y4';
  /** column layout: where the label goes and how wide it may be */
  place?: PlacedNode;
  /** column layout: sticky notes show as a badge on the star instead of a card */
  noteCount?: number;
  /** saved-map reveal: when this star fades in (ms) */
  revealDelay?: number;
};
export type NoteFlowData = { annotation: Annotation; dimmed: boolean };
export type MapEdgeData = {
  kind: VisibleEdgeKind;
  sourceRadius: number;
  targetRadius: number;
  highlighted: boolean;
  dimmed: boolean;
  /** part of the "How did we get here?" chain: drawn brighter and thicker */
  onPath?: boolean;
  motion: boolean;
  /** height of the source's label block, so forward edges start below the text */
  labelGap: number;
  /** flow back to an earlier (merged) star: drawn as a loop */
  returning?: boolean;
  particles?: boolean;
  /** flag `cometTrails`: the earlier comet-trail style instead of constellation lines */
  comet?: boolean;
  /** source label length, so a straight line can avoid crossing it */
  labelChars?: number;
  /** column layout route (round 4) */
  route?: ColumnRoute;
  /** saved-map reveal: when this line draws in (ms) */
  revealDelay?: number;
};

export type TopicFlowNode = Node<TopicFlowData, 'topic' | 'thread'>;
export type NoteFlowNode = Node<NoteFlowData, 'note'>;
export type MapFlowNode = TopicFlowNode | NoteFlowNode;
export type MapFlowEdge = Edge<MapEdgeData, VisibleEdgeKind>;

export const EDGE_COLOR: Record<VisibleEdgeKind, string> = {
  flow: 'var(--topic)',
  user: 'var(--text)',
  revisit: 'var(--revisit)',
  tether: 'var(--thread)',
  note: 'var(--text-2)',
};
/**
 * Literal colours for SVG markers (React Flow writes them into <marker> fill attributes). Flow and
 * user edges are comet trails whose fade shows the direction, so only revisit arcs keep an arrow.
 */
const MARKER_COLOR: Partial<Record<VisibleEdgeKind, string>> = {
  revisit: '#C79BFF',
};

export function toFlowNodes(
  graph: VisibleGraph,
  flags: MapNodeFlags,
  accessibleName: (v: VisibleNode) => string,
): MapFlowNode[] {
  const layout = flags.layout;
  const notesByStar = new Map<string, number>();
  for (const a of graph.notes) {
    if (!a.nodeId) continue;
    const star = graph.starOf(a.nodeId);
    notesByStar.set(star, (notesByStar.get(star) ?? 0) + 1);
  }
  const out: MapFlowNode[] = graph.nodes.map((v, index) => {
    const box = boxRadius(v.radius);
    const n = v.node;
    const side = box * 2;
    const place = layout?.nodes.get(n.id);
    const at = place ?? n;
    const has = (id: string | null) => id !== null && v.occurrences.some((o) => o.id === id);
    return {
      id: n.id,
      type: n.kind === 'topic' ? 'topic' : 'thread',
      position: { x: at.x - box, y: at.y - box },
      width: side,
      height: side,
      // handles at the centre; given up front so edges draw before (or without) DOM measurement
      handles: [
        { type: 'source', position: Position.Top, x: box, y: box, width: 1, height: 1 },
        { type: 'target', position: Position.Top, x: box, y: box, width: 1, height: 1 },
      ],
      draggable: false,
      connectable: false,
      selectable: false,
      ariaRole: 'button',
      ariaLabel: accessibleName(v),
      ...(flags.describedBy ? { domAttributes: { 'aria-describedby': flags.describedBy } } : {}),
      zIndex: 2,
      data: {
        view: v,
        box,
        active: has(flags.activeNodeId),
        playing: has(flags.playingNodeId),
        selected: has(flags.selectedNodeId),
        dimmed: Boolean(flags.traced && !flags.traced.nodeIds.has(n.id)),
        showTime: flags.showTime,
        motion: flags.motion,
        art: flags.starArt ?? 'y3',
        ...(place ? { place, noteCount: notesByStar.get(n.id) ?? 0 } : {}),
        ...(flags.revealStepMs !== undefined ? { revealDelay: index * flags.revealStepMs } : {}),
      },
    };
  });
  // the column layout has no room for cards: notes show as a badge on their star (and in the sheet)
  for (const a of layout ? [] : graph.notes) {
    out.push({
      id: noteNodeId(a.id),
      type: 'note',
      position: { x: a.x, y: a.y },
      width: NOTE_WIDTH,
      initialHeight: NOTE_HEIGHT_ESTIMATE,
      handles: [
        { type: 'source', position: Position.Left, x: 0, y: NOTE_HEIGHT_ESTIMATE / 2, width: 1, height: 1 },
        { type: 'target', position: Position.Left, x: 0, y: NOTE_HEIGHT_ESTIMATE / 2, width: 1, height: 1 },
      ],
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
      zIndex: 3,
      data: { annotation: a, dimmed: Boolean(flags.traced) },
    });
  }
  return out;
}

function edgeTraced(e: VisibleEdge, traced: TracedPath): boolean {
  if (e.kind === 'revisit' || e.kind === 'note') return false;
  return traced.nodeIds.has(e.sourceId) && traced.nodeIds.has(e.targetId);
}

export function toFlowEdges(graph: VisibleGraph, state: GraphState, flags: MapNodeFlags): MapFlowEdge[] {
  const radius = new Map(graph.nodes.map((v) => [v.node.id, v.radius]));
  const byId = new Map(graph.nodes.map((v) => [v.node.id, v.node]));
  const layout = flags.layout;
  const linesAt = flags.revealStepMs !== undefined ? graph.nodes.length * flags.revealStepMs + 150 : undefined;
  return graph.edges
    .filter((e) => !(layout && e.kind === 'note'))
    .map((e) => {
      const color = MARKER_COLOR[e.kind];
      const route = layout?.routes.get(e.id);
      const highlighted = e.highlighted;
      const src = byId.get(e.sourceId);
      return {
        id: e.id,
        type: e.kind,
        source: e.sourceId,
        target: e.targetId,
        selectable: false,
        focusable: false,
        zIndex: e.kind === 'note' ? 1 : 0,
        ariaLabel: edgeAccessibleName(e, state),
        markerEnd: color ? { type: MarkerType.ArrowClosed, color, width: 14, height: 14, strokeWidth: 1 } : undefined,
        data: {
          kind: e.kind,
          sourceRadius: radius.get(e.sourceId) ?? 0,
          targetRadius: radius.get(e.targetId) ?? (state.nodes[e.targetId] ? 18 : 0),
          highlighted,
          dimmed: Boolean(flags.traced && !edgeTraced(e, flags.traced)),
          onPath: Boolean(flags.traced && edgeTraced(e, flags.traced)),
          motion: flags.motion,
          particles: Boolean(flags.particles),
          comet: Boolean(flags.comet),
          labelChars: src?.label.length ?? 12,
          ...(route ? { route } : {}),
          ...(linesAt !== undefined ? { revealDelay: linesAt } : {}),
          ...(e.returning ? { returning: true } : {}),
          labelGap: src
            ? labelBlockHeight(
                src.label,
                flags.showTime || src.id === flags.activeNodeId || src.id === flags.playingNodeId,
              )
            : 0,
        },
      };
    });
}

/** Characters that fit on one 136 px label line at 14 px semibold (approximate). */
const LABEL_LINE_CHARS = 16;

/** Height of the label under a node: 5 px gap + one or two 17 px lines (+ a 15 px sub-line). */
export function labelBlockHeight(label: string, withSub: boolean): number {
  const lines = label.length > LABEL_LINE_CHARS ? 2 : 1;
  return 5 + lines * 17 + (withSub ? 15 : 0) + 4;
}

/** Edge names in words (React Flow otherwise reads "Edge from <uuid> to <uuid>"). */
export function edgeAccessibleName(e: VisibleEdge, state: GraphState): string {
  const label = (id: string) => state.nodes[id]?.label ?? 'a topic';
  const note = (id: string) => state.annotations.find((a) => noteNodeId(a.id) === id)?.text ?? '';
  switch (e.kind) {
    case 'flow':
      return e.returning
        ? `Came back from ${label(e.sourceId)} to ${label(e.targetId)}`
        : `Moved on from ${label(e.sourceId)} to ${label(e.targetId)}`;
    case 'user':
      return `Your link from ${label(e.sourceId)} to ${label(e.targetId)}`;
    case 'revisit':
      return `${label(e.sourceId)} returns to the earlier ${label(e.targetId)}`;
    case 'tether': {
      const s = state.nodes[e.sourceId];
      const [thread, topic] = s && s.kind !== 'topic' ? [e.sourceId, e.targetId] : [e.targetId, e.sourceId];
      return `Thread ${label(thread)} linked to ${label(topic)}`;
    }
    case 'note':
      return `Note on ${label(e.targetId)}: ${note(e.sourceId)}`;
  }
}
