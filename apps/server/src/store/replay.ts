import { applyOps, emptyGraph, OpError, type Conversation, type GraphState, type OpBatch } from '@constellate/shared';

/**
 * The authoritative GraphState: the op log replayed through the shared reducer, with the
 * conversation row laid over the result (the row also carries fields the web app edits directly,
 * such as folder, favourite, place and reflection). A batch the reducer rejects is skipped and
 * reported, so one bad batch can never make a conversation unreadable.
 */
export function replayGraph(
  conversation: Conversation,
  batches: readonly OpBatch[],
  onSkip?: (seq: number, err: OpError) => void,
): GraphState {
  let state = emptyGraph(conversation);
  for (const b of batches) {
    try {
      state = applyOps(state, b);
    } catch (err) {
      if (!(err instanceof OpError)) throw err;
      onSkip?.(b.seq, err);
    }
  }
  return { ...state, conversation };
}
