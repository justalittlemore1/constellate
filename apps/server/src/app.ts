import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { MODELS } from '@constellate/shared';
import type { Env } from './env';
import { parseClientFrame, send } from './live/protocol';

/**
 * Builds the Fastify app. A1 owns everything here; this is the H1 skeleton:
 *   GET  /health   liveness + configured providers (no secrets)
 *   WS   /live     validates the first frame; the live pipeline is not implemented yet
 * Planned (see docs/briefs/a1-server.md): GET /conversations/:id, POST /conversations/:id/ops,
 * POST /conversations/:id/finalize, DELETE /conversations/:id, POST /brain/rebuild, GET /brain.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

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
      let greeted = false;
      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (!greeted) send(socket, { t: 'error', code: 'protocol', message: 'send hello before audio', fatal: true });
          return; // A1: forward PCM to the speech adapter
        }
        const parsed = parseClientFrame(data.toString('utf8'));
        if (!parsed.ok) {
          send(socket, parsed.error);
          if (parsed.error.t === 'error' && parsed.error.fatal) socket.close();
          return;
        }
        const msg = parsed.msg;
        if (msg.t === 'ping') return send(socket, { t: 'pong' });
        if (!greeted && msg.t !== 'hello') {
          send(socket, { t: 'error', code: 'protocol', message: 'first message must be hello', fatal: true });
          socket.close();
          return;
        }
        greeted = true;
        // A1 replaces this with LiveSession (auth, conversation row, speech adapter, interpreter).
        send(socket, { t: 'error', code: 'protocol', message: 'live pipeline not implemented yet', fatal: true });
        socket.close();
      });
    });
  });

  return app;
}
