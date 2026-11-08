/**
 * Optimistic user edits. The batch is applied to the cached graph (`['graph', id]`, the key A4's
 * `useGraph` uses) with the real `applyOps` at once, then posted to
 * `POST /conversations/:id/ops` (`source: 'user'` on the server). On failure the graph is
 * refetched from the server, which drops the optimistic change, and the caller shows a toast.
 *
 * Local adapter: `Api` has no `postOps` yet, so the request is made here with the same base URL
 * and bearer token as `createRealApi`. Once A4 adds `api.postOps`, this switches to it.
 */
import { applyOps, type GraphOp, type GraphState, type OpBatch } from '@constellate/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { env } from '../../lib/env';

export type PostOps = (conversationId: string, ops: GraphOp[]) => Promise<{ batch?: OpBatch } | void>;

export const graphKey = (id: string) => ['graph', id] as const;

/** POST the ops to the server; throws with the server's message on a non-2xx answer. */
export function createPostOps(
  serverHttpUrl: string,
  accessToken: string | null,
  f: typeof fetch = (...a) => fetch(...a),
): PostOps {
  const base = serverHttpUrl.replace(/\/$/, '');
  return async (conversationId, ops) => {
    const res = await f(`${base}/conversations/${encodeURIComponent(conversationId)}/ops`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ops }),
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* not JSON */
      }
      throw new Error(message);
    }
    return (await res.json()) as { batch?: OpBatch };
  };
}

/** The local optimistic batch: next seq after what the cache has seen. */
export function optimisticBatch(state: GraphState, ops: GraphOp[], at = new Date().toISOString()): OpBatch {
  return { conversationId: state.conversation.id, seq: state.lastSeq + 1, at, source: 'user', ops };
}

/**
 * `submit(ops)` applies the ops to the cached graph at once and saves them. Resolves when the
 * server accepted them; rejects (after rolling back by refetching) when it did not.
 * In mock mode there is no server: the change lives in the cache for the session.
 */
export function useUserOps(conversationId: string, postOverride?: PostOps) {
  const qc = useQueryClient();
  const auth = useAuth();
  const api = useApi() as ReturnType<typeof useApi> & { postOps?: PostOps };

  return useCallback(
    async (ops: GraphOp[]) => {
      if (!ops.length) return;
      const key = graphKey(conversationId);
      const before = qc.getQueryData<GraphState>(key);
      if (!before) throw new Error('The conversation is not loaded yet.');
      // throws OpError before anything changes if the edit is invalid
      qc.setQueryData<GraphState>(key, applyOps(before, optimisticBatch(before, ops)));
      const post: PostOps | null =
        postOverride ??
        (api.postOps
          ? (id, o) => api.postOps!(id, o)
          : auth.mock || env.useMocks
            ? null
            : createPostOps(env.serverHttpUrl, auth.accessToken));
      if (!post) return;
      try {
        const res = await post(conversationId, ops);
        const seq = res && res.batch ? res.batch.seq : null;
        if (seq !== null) {
          qc.setQueryData<GraphState>(key, (s) => (s && s.lastSeq < seq ? { ...s, lastSeq: seq } : s));
        }
      } catch (err) {
        await qc.invalidateQueries({ queryKey: key });
        throw err;
      }
    },
    [qc, conversationId, postOverride, api, auth.mock, auth.accessToken],
  );
}
