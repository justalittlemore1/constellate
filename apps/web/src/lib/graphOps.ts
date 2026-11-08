import { applyOps, type GraphOp, type GraphState, type OpBatch } from '@constellate/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from './api';

export const graphQueryKey = (id: string) => ['graph', id] as const;

/** The local optimistic batch: next seq after what the cache has seen. */
export function optimisticBatch(state: GraphState, ops: GraphOp[], at = new Date().toISOString()): OpBatch {
  return { conversationId: state.conversation.id, seq: state.lastSeq + 1, at, source: 'user', ops };
}

/**
 * `submit(ops)` applies user ops to the cached graph at once (with the shared `applyOps`, so an
 * invalid edit throws before anything changes), then saves them through `api.postOps`
 * (`POST /conversations/:id/ops`, `source: 'user'`). If the server refuses, the graph is refetched
 * — dropping the optimistic change — and the promise rejects so the caller can say so.
 */
export function useGraphOps(conversationId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useCallback(
    async (ops: GraphOp[]) => {
      if (!ops.length) return;
      const key = graphQueryKey(conversationId);
      const before = qc.getQueryData<GraphState>(key);
      if (!before) throw new Error('The conversation is not loaded yet.');
      await qc.cancelQueries({ queryKey: key }); // a refetch in flight must not overwrite the edit
      qc.setQueryData<GraphState>(key, applyOps(before, optimisticBatch(before, ops)));
      try {
        const res = await api.postOps(conversationId, ops);
        const seq = res.batch?.seq;
        if (seq !== undefined) {
          qc.setQueryData<GraphState>(key, (s) => (s && s.lastSeq < seq ? { ...s, lastSeq: seq } : s));
        }
      } catch (err) {
        await qc.invalidateQueries({ queryKey: key });
        throw err;
      }
    },
    [api, qc, conversationId],
  );
}
