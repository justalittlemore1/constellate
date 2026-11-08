import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GraphOpSchema, OpError, recordingPath } from '@constellate/shared';
import type { ServerDeps } from '../deps';
import type { Finalizer } from '../finalize/finalizer';
import type { Log } from '../live/session';
import { notFound, requireUser, UUID } from './auth';
import { checkUserOps, newEntityIds } from './user-ops';

const OpsBody = z.object({ ops: z.array(GraphOpSchema).min(1).max(500) });
type IdParams = { Params: { id: string } };

/**
 *   GET    /conversations/:id             full GraphState (owner only)
 *   GET    /conversations/:id/utterances  transcript (owner only)
 *   POST   /conversations/:id/ops         { ops } from the user → policy (user-ops.ts) → applied with
 *                                          source 'user' → { batch }
 *   POST   /conversations/:id/finalize    run the post-recording pass (202; ?wait=1 waits for it)
 *   DELETE /conversations/:id             recording + every row (cascade)
 */
export function conversationRoutes(app: FastifyInstance, deps: ServerDeps, finalizer: Finalizer, log: Log): void {
  /** owner check against the live cell when present (freshest), else the database */
  async function owned(id: string, userId: string) {
    if (!UUID.test(id)) return null;
    const cell = deps.hub.peek(id);
    if (cell) return cell.userId === userId ? cell.state.conversation : null;
    const conv = await deps.store.getConversation(id);
    return conv && conv.conversation.userId === userId ? conv.conversation : null;
  }

  app.get<IdParams>('/conversations/:id', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    if (!(await owned(req.params.id, userId))) return notFound(reply);
    const cell = deps.hub.peek(req.params.id);
    const state = cell ? cell.state : await deps.store.loadGraph(req.params.id);
    if (!state) return notFound(reply);
    return state;
  });

  app.get<IdParams>('/conversations/:id/utterances', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    if (!(await owned(req.params.id, userId))) return notFound(reply);
    const cell = deps.hub.peek(req.params.id);
    if (cell) await cell.flush();
    return { utterances: await deps.store.listUtterances(req.params.id) };
  });

  app.post<IdParams>('/conversations/:id/ops', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    const body = OpsBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid', message: body.error.issues[0]?.message ?? 'invalid body' });
    }
    if (!UUID.test(req.params.id)) return notFound(reply);
    const cell = await deps.hub.acquire(req.params.id);
    if (!cell) return notFound(reply);
    try {
      if (cell.userId !== userId) return notFound(reply);
      const refused = checkUserOps(body.data.ops, cell.conversationId);
      if (refused) return reply.code(403).send({ error: 'forbidden_op', message: refused });
      // rows are upserted on their global id: a "new" id must not already belong to another conversation
      const taken = await deps.store.idsTakenElsewhere(cell.conversationId, newEntityIds(body.data.ops, cell.state));
      if (taken.length)
        return reply.code(409).send({ error: 'id_in_use', message: `ids already in use: ${taken.join(', ')}` });
      let committed;
      try {
        committed = cell.commit(body.data.ops, 'user');
      } catch (err) {
        if (err instanceof OpError) return reply.code(409).send({ error: err.code, message: err.message });
        throw err;
      }
      try {
        await committed.persisted;
      } catch (err) {
        return reply.code(503).send({ error: 'db', message: err instanceof Error ? err.message : 'not saved' });
      }
      return { batch: committed.batch };
    } finally {
      deps.hub.release(cell);
    }
  });

  app.post<IdParams & { Querystring: { wait?: string; force?: string } }>(
    '/conversations/:id/finalize',
    async (req, reply) => {
      const userId = await requireUser(deps.auth, req, reply);
      if (!userId) return;
      const conv = await owned(req.params.id, userId);
      if (!conv) return notFound(reply);
      if (deps.registry.sessions.has(conv.id) || conv.status === 'live') {
        return reply.code(409).send({ error: 'live', message: 'stop the recording before finalising' });
      }
      const run = finalizer.run(conv.id, { force: req.query.force === '1' });
      if (req.query.wait === '1') return run;
      void run;
      return reply.code(202).send({ status: 'processing' });
    },
  );

  app.delete<IdParams>('/conversations/:id', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    const conv = await owned(req.params.id, userId);
    if (!conv) return notFound(reply);
    const session = deps.registry.sessions.get(conv.id);
    if (session) await session.stop();
    try {
      // always the owner's canonical path, never a stored value
      await deps.store.deleteRecording(recordingPath(userId, conv.id));
    } catch (err) {
      // a missing object is fine; anything else is logged, rows are still deleted
      log('delete.recording_failed', { conversationId: conv.id, message: String(err) });
    }
    await deps.store.deleteConversation(conv.id);
    deps.hub.evict(conv.id);
    return reply.code(204).send();
  });
}
