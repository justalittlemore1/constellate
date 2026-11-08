/**
 * Graph operations and the pure reducer shared by server and client.
 * The screen and the database cannot disagree because both apply batches with `applyOps`.
 */
import type {
  Annotation,
  Commitment,
  Conversation,
  Flag,
  GraphState,
  TopicEdge,
  TopicNode,
} from './domain';

export type NodePatch = Partial<Omit<TopicNode, 'id' | 'conversationId' | 'seq'>>;
export type ConversationPatch = Partial<Omit<Conversation, 'id' | 'userId'>>;

export type GraphOp =
  | { op: 'node.add'; node: TopicNode }
  | { op: 'node.update'; id: string; patch: NodePatch }
  /** finalisation only; edges are rewired onto `intoId` */
  | { op: 'node.merge'; fromId: string; intoId: string }
  /** provisional nodes only */
  | { op: 'node.remove'; id: string }
  | { op: 'edge.add'; edge: TopicEdge }
  | { op: 'edge.remove'; id: string }
  | { op: 'active.set'; nodeId: string | null }
  | { op: 'flag.add'; flag: Flag }
  | { op: 'commitment.add'; commitment: Commitment }
  | { op: 'annotation.upsert'; annotation: Annotation }
  | { op: 'conversation.update'; patch: ConversationPatch };

export type OpSource = 'live' | 'finalize' | 'user';

export interface OpBatch {
  conversationId: string;
  /** assigned by the server, strictly increasing from 1 */
  seq: number;
  /** ISO 8601 */
  at: string;
  source: OpSource;
  ops: GraphOp[];
}

export type OpErrorCode =
  | 'conversation_mismatch'
  | 'duplicate_node'
  | 'duplicate_edge'
  | 'unknown_node'
  | 'unknown_edge'
  | 'not_provisional'
  | 'self_loop'
  | 'layout_locked'
  | 'invalid_merge';

export class OpError extends Error {
  constructor(
    public readonly code: OpErrorCode,
    message: string,
    public readonly opIndex: number,
  ) {
    super(`${code} (op ${opIndex}): ${message}`);
    this.name = 'OpError';
  }
}

/**
 * Apply one batch. Pure: never mutates `state`. All-or-nothing: if any op is invalid the whole
 * batch is rejected with an OpError and the input state is untouched.
 *
 * Invariants (each has a unit test in ops.test.ts):
 *  - batches with seq ≤ lastSeq are ignored (idempotent replay) — the same state object is returned
 *  - an edge whose endpoints do not exist is rejected; self-loops are rejected
 *  - node.remove on a non-provisional node is rejected
 *  - node.merge rewires every edge, unions utteranceIds, widens the time span, drops self-loops
 *    and duplicate edges, and re-points children, flags, commitments and annotations
 *  - x/y of an existing node may change only in batches with source 'user' or 'finalize'
 */
export function applyOps(state: GraphState, batch: OpBatch): GraphState {
  if (batch.conversationId !== state.conversation.id) {
    throw new OpError(
      'conversation_mismatch',
      `batch for ${batch.conversationId}, state is ${state.conversation.id}`,
      -1,
    );
  }
  if (batch.seq <= state.lastSeq) return state;

  const s: GraphState = {
    conversation: { ...state.conversation },
    nodes: { ...state.nodes },
    edges: { ...state.edges },
    activeNodeId: state.activeNodeId,
    flags: [...state.flags],
    commitments: [...state.commitments],
    annotations: [...state.annotations],
    lastSeq: batch.seq,
  };

  batch.ops.forEach((op, i) => applyOne(s, op, batch.source, i));
  return s;
}

/** Apply many batches in order (convenience for loading op logs and fixtures). */
export function applyBatches(state: GraphState, batches: readonly OpBatch[]): GraphState {
  return batches.reduce(applyOps, state);
}

function requireNode(s: GraphState, id: string, i: number): TopicNode {
  const n = s.nodes[id];
  if (!n) throw new OpError('unknown_node', `node ${id} does not exist`, i);
  return n;
}

function requireOptionalNode(s: GraphState, id: string | null, i: number): void {
  if (id !== null) requireNode(s, id, i);
}

function applyOne(s: GraphState, op: GraphOp, source: OpSource, i: number): void {
  switch (op.op) {
    case 'node.add': {
      const { node } = op;
      if (s.nodes[node.id]) throw new OpError('duplicate_node', `node ${node.id} exists`, i);
      if (node.conversationId !== s.conversation.id) {
        throw new OpError('conversation_mismatch', `node ${node.id} belongs elsewhere`, i);
      }
      requireOptionalNode(s, node.parentId, i);
      s.nodes[node.id] = { ...node, utteranceIds: [...node.utteranceIds], speakers: [...node.speakers] };
      return;
    }
    case 'node.update': {
      const prev = requireNode(s, op.id, i);
      const movesLayout =
        (op.patch.x !== undefined && op.patch.x !== prev.x) ||
        (op.patch.y !== undefined && op.patch.y !== prev.y);
      if (movesLayout && source === 'live') {
        throw new OpError('layout_locked', `live batches may not move node ${op.id}`, i);
      }
      if (op.patch.parentId !== undefined) {
        requireOptionalNode(s, op.patch.parentId, i);
        if (op.patch.parentId === op.id) throw new OpError('self_loop', `node ${op.id} as own parent`, i);
      }
      s.nodes[op.id] = { ...prev, ...op.patch };
      return;
    }
    case 'node.merge': {
      const { fromId, intoId } = op;
      if (fromId === intoId) throw new OpError('invalid_merge', `cannot merge ${fromId} into itself`, i);
      const from = requireNode(s, fromId, i);
      const into = requireNode(s, intoId, i);
      const remap = (id: string) => (id === fromId ? intoId : id);

      const seen = new Set<string>();
      const edges: Record<string, TopicEdge> = {};
      for (const e of Object.values(s.edges)) {
        const sourceId = remap(e.sourceId);
        const targetId = remap(e.targetId);
        if (sourceId === targetId) continue;
        const key = `${sourceId}|${targetId}|${e.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges[e.id] = { ...e, sourceId, targetId };
      }
      s.edges = edges;

      const ends = [from.endMs, into.endMs].filter((v): v is number => v !== null);
      s.nodes[intoId] = {
        ...into,
        utteranceIds: [...new Set([...into.utteranceIds, ...from.utteranceIds])],
        speakers: [...new Set([...into.speakers, ...from.speakers])].sort((a, b) => a - b),
        startMs: Math.min(into.startMs, from.startMs),
        endMs: into.endMs === null || from.endMs === null ? null : Math.max(...ends),
        highlighted: into.highlighted || from.highlighted,
      };
      delete s.nodes[fromId];
      for (const n of Object.values(s.nodes)) {
        // into's parent was `from` → inherit from's parent rather than pointing at itself
        if (n.parentId === fromId) s.nodes[n.id] = { ...n, parentId: n.id === intoId ? from.parentId : intoId };
      }
      if (s.activeNodeId === fromId) s.activeNodeId = intoId;
      s.flags = s.flags.map((f) => (f.nodeId === fromId ? { ...f, nodeId: intoId } : f));
      s.commitments = s.commitments.map((c) => (c.nodeId === fromId ? { ...c, nodeId: intoId } : c));
      s.annotations = s.annotations.map((a) => (a.nodeId === fromId ? { ...a, nodeId: intoId } : a));
      return;
    }
    case 'node.remove': {
      const n = requireNode(s, op.id, i);
      if (n.status !== 'provisional') {
        throw new OpError('not_provisional', `node ${op.id} is ${n.status}`, i);
      }
      delete s.nodes[op.id];
      for (const e of Object.values(s.edges)) {
        if (e.sourceId === op.id || e.targetId === op.id) delete s.edges[e.id];
      }
      for (const c of Object.values(s.nodes)) {
        if (c.parentId === op.id) s.nodes[c.id] = { ...c, parentId: n.parentId };
      }
      if (s.activeNodeId === op.id) s.activeNodeId = null;
      s.flags = s.flags.map((f) => (f.nodeId === op.id ? { ...f, nodeId: null } : f));
      s.commitments = s.commitments.map((c) => (c.nodeId === op.id ? { ...c, nodeId: null } : c));
      s.annotations = s.annotations.map((a) => (a.nodeId === op.id ? { ...a, nodeId: null } : a));
      return;
    }
    case 'edge.add': {
      const { edge } = op;
      if (s.edges[edge.id]) throw new OpError('duplicate_edge', `edge ${edge.id} exists`, i);
      if (edge.sourceId === edge.targetId) throw new OpError('self_loop', `edge ${edge.id}`, i);
      requireNode(s, edge.sourceId, i);
      requireNode(s, edge.targetId, i);
      s.edges[edge.id] = { ...edge };
      return;
    }
    case 'edge.remove': {
      if (!s.edges[op.id]) throw new OpError('unknown_edge', `edge ${op.id} does not exist`, i);
      delete s.edges[op.id];
      return;
    }
    case 'active.set': {
      requireOptionalNode(s, op.nodeId, i);
      s.activeNodeId = op.nodeId;
      return;
    }
    case 'flag.add': {
      requireOptionalNode(s, op.flag.nodeId, i);
      if (!s.flags.some((f) => f.id === op.flag.id)) s.flags.push({ ...op.flag });
      return;
    }
    case 'commitment.add': {
      requireOptionalNode(s, op.commitment.nodeId, i);
      if (!s.commitments.some((c) => c.id === op.commitment.id)) s.commitments.push({ ...op.commitment });
      return;
    }
    case 'annotation.upsert': {
      requireOptionalNode(s, op.annotation.nodeId, i);
      const idx = s.annotations.findIndex((a) => a.id === op.annotation.id);
      if (idx === -1) s.annotations.push({ ...op.annotation });
      else s.annotations[idx] = { ...op.annotation };
      return;
    }
    case 'conversation.update': {
      s.conversation = { ...s.conversation, ...op.patch };
      return;
    }
    default: {
      const never: never = op;
      throw new Error(`unknown op ${JSON.stringify(never)}`);
    }
  }
}
