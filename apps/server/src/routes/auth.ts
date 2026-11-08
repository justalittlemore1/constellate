import type { FastifyReply, FastifyRequest } from 'fastify';
import { bearer, type Auth } from '../supabase';

/** Resolve the caller from `Authorization: Bearer <supabase access token>`; replies 401 if invalid. */
export async function requireUser(auth: Auth, req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const token = bearer(req.headers.authorization);
  const userId = token ? await auth.verifyToken(token).catch(() => null) : null;
  if (!userId) {
    void reply.code(401).send({ error: 'auth', message: 'missing or invalid access token' });
    return null;
  }
  return userId;
}

/** Same response for "does not exist" and "not yours", so ids cannot be probed. */
export function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: 'not_found', message: 'conversation not found' });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
