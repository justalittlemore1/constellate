/**
 * Deterministic, incremental layout. A node is placed once, when it is created, and keeps that
 * position forever (stable maps support visual memory). Time flows DOWN (portrait phone).
 *
 *  - topic nodes: y = (max y of existing topic nodes) + ROW_HEIGHT; x = lane × LANE_WIDTH + jitter
 *    where lane = node.level, or the level of the earlier occurrence for a revisit
 *  - pending / parked nodes: right-hand gutter at the y of the node where they were raised,
 *    nudged down to avoid overlapping other gutter nodes
 *  - jitter is ±JITTER px from a hash of the node id, for an organic "constellation" feel
 *
 * The interpreter calls this when it creates a node; React Flow only reads x/y.
 */
import type { GraphState, TopicNode } from './domain';

export const LANE_WIDTH = 140;
export const ROW_HEIGHT = 96;
export const JITTER = 18;
export const GUTTER_X = 3 * LANE_WIDTH + 40;
export const GUTTER_MIN_GAP = 44;

export interface PlaceOptions {
  /** for revisits: the earlier occurrence whose lane the new node joins */
  revisitOfId?: string;
  /** for pending/parked: the node where the thread was raised (defaults to the active node) */
  anchorNodeId?: string;
}

/** FNV-1a 32-bit — tiny, deterministic, good enough for jitter. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function jitterFor(id: string): number {
  return (hashId(id) % (2 * JITTER + 1)) - JITTER;
}

type Placeable = Pick<TopicNode, 'id' | 'kind' | 'level'>;

export function placeNode(
  state: GraphState,
  node: Placeable,
  opts: PlaceOptions = {},
): { x: number; y: number } {
  const all = Object.values(state.nodes).filter((n) => n.id !== node.id);
  const topics = all.filter((n) => n.kind === 'topic');

  if (node.kind === 'topic') {
    const y = topics.length === 0 ? 0 : Math.max(...topics.map((n) => n.y)) + ROW_HEIGHT;
    const revisitOf = opts.revisitOfId ? state.nodes[opts.revisitOfId] : undefined;
    const lane = revisitOf ? revisitOf.level : node.level;
    return { x: lane * LANE_WIDTH + jitterFor(node.id), y };
  }

  const anchorId = opts.anchorNodeId ?? state.activeNodeId ?? undefined;
  const anchor = anchorId ? state.nodes[anchorId] : undefined;
  const fallbackY = topics.length === 0 ? 0 : Math.max(...topics.map((n) => n.y));
  let y = anchor ? anchor.y : fallbackY;
  const gutter = all.filter((n) => n.kind !== 'topic').map((n) => n.y);
  // Nudge down until clear of every other gutter node.
  for (let guard = 0; guard < 1000 && gutter.some((gy) => Math.abs(gy - y) < GUTTER_MIN_GAP); guard++) {
    y += GUTTER_MIN_GAP;
  }
  return { x: GUTTER_X + Math.round(jitterFor(node.id) / 3), y };
}
