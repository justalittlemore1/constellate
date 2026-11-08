import type { FastifyInstance } from 'fastify';
import { BRAIN } from '@constellate/shared';
import { loadBrain, rebuildBrain } from '../brain/rebuild';
import type { ServerDeps } from '../deps';
import type { Log } from '../live/session';
import { requireUser } from './auth';

/**
 *   POST /brain/rebuild     fold every new `ready` conversation into the caller's Brain → counts
 *   GET  /brain             { concepts, links, occurrences } for the caller
 *   GET  /brain/search?q=   concepts by meaning (embed the query, match_concepts)
 */
export function brainRoutes(app: FastifyInstance, deps: ServerDeps, log: Log): void {
  const brainDeps = { ...deps, log };

  app.post('/brain/rebuild', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    return rebuildBrain(brainDeps, userId);
  });

  app.get('/brain', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    return loadBrain(deps.store, userId);
  });

  app.get<{ Querystring: { q?: string } }>('/brain/search', async (req, reply) => {
    const userId = await requireUser(deps.auth, req, reply);
    if (!userId) return;
    const q = (req.query.q ?? '').trim().slice(0, 200);
    if (!q) return reply.code(400).send({ error: 'invalid', message: 'q is required' });
    let embedding: number[];
    try {
      [embedding] = (await deps.embed([q])) as [number[]];
    } catch (err) {
      return reply.code(503).send({ error: 'embed', message: err instanceof Error ? err.message : 'unavailable' });
    }
    const [matches, concepts] = await Promise.all([
      deps.store.matchConcepts(userId, embedding, 10),
      deps.store.listConcepts(userId),
    ]);
    const byId = new Map(concepts.map((c) => [c.id, c]));
    return {
      results: matches
        .filter((m) => byId.get(m.id)?.mentionCount && m.similarity >= BRAIN.relatedMin / 2)
        .map((m) => ({ id: m.id, name: byId.get(m.id)!.name, similarity: m.similarity })),
    };
  });
}
