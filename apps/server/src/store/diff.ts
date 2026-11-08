import type {
  Annotation,
  Commitment,
  ConversationPatch,
  Flag,
  GraphState,
  TopicEdge,
  TopicNode,
} from '@constellate/shared';

/** Row-level changes needed to move the materialised tables from one GraphState to the next. */
export interface StateDiff {
  upsertNodes: TopicNode[];
  deleteNodeIds: string[];
  upsertEdges: TopicEdge[];
  deleteEdgeIds: string[];
  upsertFlags: Flag[];
  upsertCommitments: Commitment[];
  upsertAnnotations: Annotation[];
  conversationPatch: ConversationPatch;
}

function byIdChanges<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((x) => [x.id, x]));
  return next.filter((x) => before.get(x.id) !== x && JSON.stringify(before.get(x.id)) !== JSON.stringify(x));
}

function recordChanges<T>(prev: Record<string, T>, next: Record<string, T>): { upsert: T[]; deleted: string[] } {
  const upsert: T[] = [];
  for (const [id, v] of Object.entries(next)) {
    const p = prev[id];
    if (p !== v && JSON.stringify(p) !== JSON.stringify(v)) upsert.push(v);
  }
  const deleted = Object.keys(prev).filter((id) => !(id in next));
  return { upsert, deleted };
}

/**
 * Pure. `applyOps` copies only what changed, but values are compared structurally too so the diff
 * is correct for any two states (e.g. one loaded from the database).
 */
export function diffStates(prev: GraphState, next: GraphState): StateDiff {
  const nodes = recordChanges(prev.nodes, next.nodes);
  const edges = recordChanges(prev.edges, next.edges);
  const conversationPatch: ConversationPatch = {};
  for (const [k, v] of Object.entries(next.conversation) as [keyof typeof next.conversation, unknown][]) {
    if (k === 'id' || k === 'userId') continue;
    if (prev.conversation[k] !== v) (conversationPatch as Record<string, unknown>)[k] = v;
  }
  return {
    upsertNodes: nodes.upsert,
    deleteNodeIds: nodes.deleted,
    upsertEdges: edges.upsert,
    deleteEdgeIds: edges.deleted,
    upsertFlags: byIdChanges(prev.flags, next.flags),
    upsertCommitments: byIdChanges(prev.commitments, next.commitments),
    upsertAnnotations: byIdChanges(prev.annotations, next.annotations),
    conversationPatch,
  };
}
