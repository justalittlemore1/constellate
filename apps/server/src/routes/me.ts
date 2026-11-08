import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../deps';
import type { Log } from '../live/session';
import { requireUser } from './auth';

/**
 *   DELETE /me/data   everything the token's user owns: every conversation (with transcript,
 *                     graph, embeddings, flags, notes, recall cards), its recording, folders,
 *                     concepts and concept links. The auth account itself stays.
 *
 * Order: live sessions are aborted (no finalisation), then the rows go in one database
 * transaction, then the recordings. A storage failure answers 502 with what was deleted; calling
 * again removes the leftover recordings (they are found by the `{userId}/` prefix, not by rows).
 */
export function meRoutes(app: FastifyInstance, deps: ServerDeps, log: Log): void {
  app.delete('/me/data', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;

    for (const session of [...deps.registry.sessions.values()]) {
      if (session.userId === userId) await session.abort('your data was deleted');
    }

    let rows;
    try {
      rows = await deps.store.deleteUserData(userId);
    } catch (err) {
      log('me.delete_failed', { userId, message: String(err) });
      return reply.code(503).send({ error: 'db', message: 'nothing was deleted; try again' });
    }
    deps.hub.evictUser(userId);

    let recordings: number;
    try {
      recordings = await deps.store.deleteUserRecordings(userId);
    } catch (err) {
      log('me.delete_recordings_failed', { userId, message: String(err) });
      return reply.code(502).send({
        error: 'storage',
        message: 'your data was deleted but some recordings were not; call again to remove them',
        deleted: rows,
      });
    }

    log('me.data_deleted', { userId, ...rows, recordings });
    return { deleted: { ...rows, recordings } };
  });
}
