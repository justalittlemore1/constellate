import type { GraphOp, GraphState } from '@constellate/shared';

/**
 * Conversation fields only the server may set: lifecycle and the recording location. A user who
 * could set `audioPath` could point delete/finalise at someone else's recording; `status` would
 * let them skip or block finalisation.
 */
export const SERVER_ONLY_CONVERSATION_FIELDS = ['status', 'audioPath', 'startedAt', 'endedAt', 'durationMs'] as const;

/** The conversation id an op's payload carries, if any. */
function embeddedConversationId(op: GraphOp): string | null {
  switch (op.op) {
    case 'node.add':
      return op.node.conversationId;
    case 'edge.add':
      return op.edge.conversationId;
    case 'flag.add':
      return op.flag.conversationId;
    case 'commitment.add':
      return op.commitment.conversationId;
    case 'annotation.upsert':
      return op.annotation.conversationId;
    default:
      return null;
  }
}

/**
 * Policy for `source: 'user'` batches (POST /conversations/:id/ops), on top of the reducer.
 * `commitment.update` is allowed: its schema only takes `text`/`done`, and the reducer finds the
 * id only among this conversation's commitments (another conversation's id is `unknown_commitment`).
 * Returns a reason when the batch must be refused, null when it is allowed.
 */
export function checkUserOps(ops: readonly GraphOp[], conversationId: string): string | null {
  for (const [i, op] of ops.entries()) {
    const cid = embeddedConversationId(op);
    if (cid !== null && cid !== conversationId) return `op ${i}: belongs to another conversation`;
    if (op.op === 'node.merge') return `op ${i}: node.merge is reserved for finalisation`;
    if (op.op === 'conversation.update') {
      const forbidden = SERVER_ONLY_CONVERSATION_FIELDS.filter((k) => k in op.patch);
      if (forbidden.length) return `op ${i}: ${forbidden.join(', ')} can only be set by the server`;
    }
  }
  return null;
}

export interface NewEntityIds {
  nodes: string[];
  edges: string[];
  flags: string[];
  commitments: string[];
  annotations: string[];
}

/**
 * Ids this batch would create (not yet in this conversation's state). Rows are upserted on their
 * global primary key, so each of these must not already exist anywhere else in the database.
 */
export function newEntityIds(ops: readonly GraphOp[], state: GraphState): NewEntityIds {
  const out: NewEntityIds = { nodes: [], edges: [], flags: [], commitments: [], annotations: [] };
  const has = (list: readonly { id: string }[], id: string) => list.some((x) => x.id === id);
  for (const op of ops) {
    if (op.op === 'node.add' && !state.nodes[op.node.id]) out.nodes.push(op.node.id);
    if (op.op === 'edge.add' && !state.edges[op.edge.id]) out.edges.push(op.edge.id);
    if (op.op === 'flag.add' && !has(state.flags, op.flag.id)) out.flags.push(op.flag.id);
    if (op.op === 'commitment.add' && !has(state.commitments, op.commitment.id)) out.commitments.push(op.commitment.id);
    if (op.op === 'annotation.upsert' && !has(state.annotations, op.annotation.id))
      out.annotations.push(op.annotation.id);
  }
  return out;
}
