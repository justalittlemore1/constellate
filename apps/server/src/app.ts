import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { MODELS } from '@constellate/shared';
import type { Env } from './env';
import { createDefaultDeps, type ServerDeps } from './deps';
import { send } from './live/protocol';
import { LiveConnection, type LiveDeps, type Log } from './live/session';

/**
 * Builds the Fastify app. A1 owns everything here; this is the H1 skeleton:
 *   GET  /health   liveness + configured providers (no secrets)
 *   WS   /live     live pipeline (see live/session.ts)
 * Planned (see docs/briefs/a1-server.md): GET /conversations/:id, POST /conversations/:id/ops,
 * POST /conversations/:id/finalize, DELETE /conversations/:id, POST /brain/rebuild, GET /brain.
 */
export async function buildApp(env: Env, overrides: Partial<ServerDeps> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  const log: Log = (event, data) => app.log.info({ event, ...data }, event);
  const deps = createDefaultDeps(env, log, overrides);
  const liveDeps: LiveDeps = { ...deps, log };

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
  });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  app.get('/health', async () => ({
    ok: true,
    stt: env.STT_PROVIDER,
    interpreter: env.INTERPRETER_PROVIDER,
    interpreterModel: MODELS.interpreter[env.INTERPRETER_PROVIDER],
    keys: {
      gemini: Boolean(env.GEMINI_API_KEY),
      anthropic: Boolean(env.ANTHROPIC_API_KEY),
      supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    },
  }));

  app.register(async (scope) => {
    scope.get('/live', { websocket: true }, (socket) => {
      const conn = new LiveConnection(
        {
          send: (msg) => {
            if (socket.readyState === socket.OPEN) send(socket, msg);
          },
          close: (code, reason) => socket.close(code, reason),
        },
        liveDeps,
      );
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) conn.onBinary(data);
        else conn.onText(data.toString('utf8'));
      });
      socket.on('close', () => conn.onClose());
      socket.on('error', (err) => app.log.warn({ err }, 'live socket error'));
    });
  });

  return app;
}
