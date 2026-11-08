/**
 * Pure view-model for the conversation map: which nodes and edges are visible at a detail level,
 * node sizes, and every status / relationship put into words (for aria labels, the outline view
 * and the detail sheet). No React here, so all of it is unit-tested directly.
 *
 * Positions come only from the persisted `node.x / node.y` (placed by `placeNode` in
 * @constellate/shared). Nothing here computes a layout.
 */
import { nodesInOrder, type Annotation, type GraphState, type TopicEdge, type TopicNode } from '@constellate/shared';
import { formatClock } from '../../lib/format';

export type DetailLevel = 'broad' | 'balanced' | 'detailed';
export const DETAIL_LEVELS: readonly DetailLevel[] = ['broad', 'balanced', 'detailed'];
export const DETAIL_LABEL: Record<DetailLevel, string> = { broad: 'Broad', balanced: 'Balanced', detailed: 'Detailed' };

/** Below this zoom the map switches to Broad by itself (semantic zoom). */
export const AUTO_BROAD_ZOOM = 0.5;

export const RADIUS_MIN = 18;
export const RADIUS_MAX = 30;
/** level-2 nodes are drawn slightly smaller */
export const LEVEL2_SCALE = 0.85;
/** an unfinished node (still being discussed) counts as this long for sizing */
const OPEN_NODE_MS = 30_000;
const SHORT_MS = 20_000;
const LONG_MS = 120_000;

/** Circle radius by how long the topic was discussed: 20 s → 18 px … 2 min → 30 px. */
export function topicRadius(n: Pick<TopicNode, 'startMs' | 'endMs' | 'level'>): number {
  const dur = n.endMs === null ? OPEN_NODE_MS : Math.max(0, n.endMs - n.startMs);
  const t = Math.min(1, Math.max(0, (dur - SHORT_MS) / (LONG_MS - SHORT_MS)));
  const r = RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN);
  return Math.round((n.level === 2 ? r * LEVEL2_SCALE : r) * 10) / 10;
}

/** Hollow ring radius for pending / parked threads. */
export const THREAD_RADIUS = 16;

export function nodeRadius(n: TopicNode): number {
  return n.kind === 'topic' ? topicRadius(n) : THREAD_RADIUS;
}

export function isThread(n: Pick<TopicNode, 'kind'>): boolean {
  return n.kind === 'pending' || n.kind === 'parked';
}

/** A deferred or parked thread nobody picked up. */
export function isOpenThread(n: Pick<TopicNode, 'kind' | 'status'>): boolean {
  return isThread(n) && n.status !== 'resolved';
}

/** The earlier occurrence a node returns to, if it is a revisit. */
export function revisitTarget(state: GraphState, nodeId: string): TopicNode | null {
  for (const e of Object.values(state.edges)) {
    if (e.kind === 'revisit' && e.sourceId === nodeId) return state.nodes[e.targetId] ?? null;
  }
  return null;
}

/** Later occurrences that return to this node. */
export function revisitedBy(state: GraphState, nodeId: string): TopicNode[] {
  return Object.values(state.edges)
    .filter((e) => e.kind === 'revisit' && e.targetId === nodeId)
    .map((e) => state.nodes[e.sourceId])
    .filter((n): n is TopicNode => Boolean(n))
    .sort((a, b) => a.seq - b.seq);
}

/** The node a pending / parked thread was raised at (tether whose other end is a topic). */
export function raisedAt(state: GraphState, thread: TopicNode): TopicNode | null {
  let best: TopicNode | null = null;
  for (const e of Object.values(state.edges)) {
    if (e.kind !== 'tether') continue;
    const otherId = e.sourceId === thread.id ? e.targetId : e.targetId === thread.id ? e.sourceId : null;
    const other = otherId ? state.nodes[otherId] : undefined;
    // the earliest tethered topic is where it was raised; a later one is where it was picked up
    if (other && other.kind === 'topic' && (!best || other.seq < best.seq)) best = other;
  }
  return best;
}

/** For a resolved thread: the topic where it was picked up (a later tethered topic). */
export function pickedUpAt(state: GraphState, thread: TopicNode): TopicNode | null {
  const raised = raisedAt(state, thread);
  let best: TopicNode | null = null;
  for (const e of Object.values(state.edges)) {
    if (e.kind !== 'tether') continue;
    const otherId = e.sourceId === thread.id ? e.targetId : e.targetId === thread.id ? e.sourceId : null;
    const other = otherId ? state.nodes[otherId] : undefined;
    if (other && other.kind === 'topic' && other.id !== raised?.id && (!best || other.seq > best.seq)) best = other;
  }
  return best;
}

export function flagsOn(state: GraphState, nodeId: string): number {
  return state.flags.filter((f) => f.nodeId === nodeId).length;
}

export function childCount(state: GraphState, nodeId: string): number {
  return Object.values(state.nodes).filter((n) => n.parentId === nodeId && n.kind === 'topic').length;
}

/** "04:10–05:20", or "from 04:10" while still open, or "raised at 04:10" for threads. */
export function timeRange(n: TopicNode): string {
  if (isThread(n)) return `raised at ${formatClock(n.mentionedAtMs ?? n.startMs)}`;
  return n.endMs === null ? `from ${formatClock(n.startMs)}` : `${formatClock(n.startMs)}–${formatClock(n.endMs)}`;
}

/** Status in words. Never relies on colour. */
export function statusWords(n: TopicNode, activeNodeId: string | null): string {
  if (n.kind === 'pending')
    return n.status === 'resolved' ? 'mentioned for later, picked up' : 'mentioned for later, not picked up';
  if (n.kind === 'parked')
    return n.status === 'resolved' ? 'parked thought, picked up' : 'parked thought, not picked up';
  if (n.status === 'provisional') return 'tentative topic';
  if (n.id === activeNodeId || n.status === 'active') return 'being discussed now';
  return 'topic';
}

/** Relationships in words, e.g. "returns to Resurrection Accounts from 03:50". */
export function relationWords(state: GraphState, n: TopicNode): string[] {
  const out: string[] = [];
  const back = revisitTarget(state, n.id);
  if (back) out.push(`returns to ${back.label} from ${formatClock(back.startMs)}`);
  const later = revisitedBy(state, n.id);
  if (later.length) out.push(`picked up again at ${later.map((l) => formatClock(l.startMs)).join(', ')}`);
  if (isThread(n)) {
    const r = raisedAt(state, n);
    if (r) out.push(`raised during ${r.label}`);
    const p = n.status === 'resolved' ? pickedUpAt(state, n) : null;
    if (p) out.push(`picked up in ${p.label} at ${formatClock(p.startMs)}`);
  } else if (n.parentId && state.nodes[n.parentId]) {
    out.push(`part of ${state.nodes[n.parentId]!.label}`);
  }
  const f = flagsOn(state, n.id);
  if (f) out.push(f === 1 ? 'flagged' : `flagged ${f} times`);
  if (n.highlighted) out.push('highlighted');
  return out;
}

/** Accessible name for a node on the canvas and in the outline. */
export interface NodeSubState {
  active: boolean;
  playing: boolean;
  showTime: boolean;
}

/** The small line under a node's label on the canvas ("now", "playing", "02:40", "picked up"). */
export function nodeSubLabel(n: TopicNode, s: NodeSubState): string | undefined {
  if (n.kind === 'topic') {
    if (s.active) return 'now';
    if (s.playing) return 'playing';
    return s.showTime ? formatClock(n.startMs) : undefined;
  }
  if (s.showTime) return formatClock(n.mentionedAtMs ?? n.startMs);
  return n.status === 'resolved' ? 'picked up' : undefined;
}

/** Exactly the text a sighted person sees on the node: label, then the sub-line. */
export function nodeVisibleText(n: TopicNode, sub: string | undefined): string {
  return sub ? `${n.label} ${sub}` : n.label;
}

/**
 * Accessible name for a node on the canvas and in the outline. It starts with exactly the visible
 * text, so voice-control users can say what they see (WCAG 2.5.3, axe label-content-name-mismatch).
 */
export function nodeAccessibleName(state: GraphState, n: TopicNode, activeNodeId: string | null, sub?: string): string {
  return [nodeVisibleText(n, sub), statusWords(n, activeNodeId), timeRange(n), ...relationWords(state, n)].join(', ');
}

// ───────────────────────── visibility by detail level ─────────────────────────

export interface VisibleNode {
  node: TopicNode;
  radius: number;
  /** level-1 nodes in Broad: how many level-2 children are folded in */
  hiddenChildren: number;
  isRevisit: boolean;
  flags: number;
}

export type VisibleEdgeKind = TopicEdge['kind'] | 'note';

export interface VisibleEdge {
  id: string;
  kind: VisibleEdgeKind;
  sourceId: string;
  targetId: string;
  /** both ends highlighted: part of a highlighted branch */
  highlighted: boolean;
}

export interface VisibleGraph {
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  notes: Annotation[];
}

/** `node:` / `note:` prefixed ids keep React Flow node ids unique across both kinds. */
export const noteNodeId = (annotationId: string) => `note:${annotationId}`;

/**
 * What the canvas shows at a detail level.
 *  - broad: level-0/1 topics and every thread; each level-2 topic folds into the main topic
 *    discussed just before it (a "+N" badge counts them) and its edges are rewired there, so the
 *    order of the conversation still reads top to bottom (folding into the conceptual parent
 *    would draw flow edges back up the screen); notes hidden
 *  - balanced: every node and note
 *  - detailed: as balanced (nodes also show their time; see TopicNode)
 */
export function visibleGraph(state: GraphState, detail: DetailLevel): VisibleGraph {
  const all = nodesInOrder(state);
  const folded = new Map<string, string>(); // hidden id → visible stand-in id
  if (detail === 'broad') {
    let lastMain: TopicNode | null = null;
    for (const n of all) {
      if (n.kind !== 'topic') continue;
      if (n.level < 2) lastMain = n;
      else if (lastMain) folded.set(n.id, lastMain.id);
      // a level-2 node before any main topic stays on the map rather than vanishing
    }
  }
  const resolve = (id: string) => folded.get(id) ?? id;

  const hiddenCount = new Map<string, number>();
  for (const [, to] of folded) hiddenCount.set(to, (hiddenCount.get(to) ?? 0) + 1);

  // a folded revisit (two level-2 occurrences) still shows as a return between their stand-ins
  const revisitSources = new Set(
    Object.values(state.edges)
      .filter((e) => e.kind === 'revisit' && resolve(e.sourceId) !== resolve(e.targetId))
      .map((e) => resolve(e.sourceId)),
  );

  const nodes: VisibleNode[] = all
    .filter((n) => !folded.has(n.id))
    .map((n) => ({
      node: n,
      radius: nodeRadius(n),
      hiddenChildren: hiddenCount.get(n.id) ?? 0,
      isRevisit: revisitSources.has(n.id),
      flags: flagsOn(state, n.id),
    }));

  const edges: VisibleEdge[] = [];
  const seen = new Set<string>();
  for (const e of Object.values(state.edges)) {
    const s = resolve(e.sourceId);
    const t = resolve(e.targetId);
    if (s === t || !state.nodes[s] || !state.nodes[t]) continue;
    const key = `${e.kind}|${s}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: s === e.sourceId && t === e.targetId ? e.id : `${e.id}~${s}~${t}`,
      kind: e.kind,
      sourceId: s,
      targetId: t,
      highlighted: Boolean(state.nodes[s]!.highlighted && state.nodes[t]!.highlighted),
    });
  }

  const notes = detail === 'broad' ? [] : state.annotations;
  for (const a of notes) {
    if (a.nodeId && state.nodes[a.nodeId]) {
      edges.push({
        id: `note-link:${a.id}`,
        kind: 'note',
        sourceId: noteNodeId(a.id),
        targetId: a.nodeId,
        highlighted: false,
      });
    }
  }
  return { nodes, edges, notes };
}

/** Detail level actually drawn: Broad when zoomed far out, whatever was chosen. */
export function effectiveDetail(chosen: DetailLevel, zoom: number): DetailLevel {
  return zoom < AUTO_BROAD_ZOOM ? 'broad' : chosen;
}

// ───────────────────────── path tracer ─────────────────────────

export interface TracedPath {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/**
 * "How did we get here?": the chain of conversation steps from the first node to `targetId`,
 * following flow edges backwards (and, for a thread, the tether to where it was raised).
 * Edge ids are the contract ids; callers match folded edges by their endpoints.
 */
export function tracePath(state: GraphState, targetId: string): TracedPath {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const incomingFlow = new Map<string, TopicEdge[]>();
  for (const e of Object.values(state.edges)) {
    if (e.kind !== 'flow' && e.kind !== 'user') continue;
    const list = incomingFlow.get(e.targetId) ?? [];
    list.push(e);
    incomingFlow.set(e.targetId, list);
  }
  let cur: TopicNode | undefined = state.nodes[targetId];
  if (!cur) return { nodeIds, edgeIds };
  nodeIds.add(cur.id);
  if (isThread(cur)) {
    const r = raisedAt(state, cur);
    const tether =
      r &&
      Object.values(state.edges).find(
        (e) =>
          e.kind === 'tether' &&
          ((e.sourceId === r.id && e.targetId === cur!.id) || (e.targetId === r.id && e.sourceId === cur!.id)),
      );
    if (!r || !tether) return { nodeIds, edgeIds };
    edgeIds.add(tether.id);
    nodeIds.add(r.id);
    cur = r;
  }
  while (cur) {
    const ins: { e: TopicEdge; from: TopicNode }[] = (incomingFlow.get(cur.id) ?? [])
      .map((e) => ({ e, from: state.nodes[e.sourceId] }))
      .filter((x): x is { e: TopicEdge; from: TopicNode } => Boolean(x.from) && !nodeIds.has(x.e.sourceId))
      // the conversation came from the most recent earlier step
      .sort((a, b) => b.from.seq - a.from.seq);
    const step: { e: TopicEdge; from: TopicNode } | undefined = ins[0];
    if (!step) break;
    edgeIds.add(step.e.id);
    nodeIds.add(step.from.id);
    cur = step.from;
  }
  return { nodeIds, edgeIds };
}

/** Nodes in conversation order along a traced path (for the "How did we get here?" words). */
export function pathInOrder(state: GraphState, path: TracedPath): TopicNode[] {
  return [...path.nodeIds]
    .map((id) => state.nodes[id])
    .filter((n): n is TopicNode => Boolean(n))
    .sort((a, b) => a.seq - b.seq);
}

/** The newest node by creation order (for "Jump to now"). */
export function latestNode(state: GraphState): TopicNode | null {
  let best: TopicNode | null = null;
  for (const n of Object.values(state.nodes)) if (!best || n.seq > best.seq) best = n;
  return best;
}

/** Previous / next node in conversation order (keyboard navigation). */
export function stepNode(order: readonly string[], currentId: string | null, delta: number): string | null {
  if (!order.length) return null;
  const i = currentId ? order.indexOf(currentId) : -1;
  if (i < 0) return delta >= 0 ? order[0]! : order[order.length - 1]!;
  return order[Math.min(order.length - 1, Math.max(0, i + delta))]!;
}
