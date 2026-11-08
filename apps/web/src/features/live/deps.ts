/**
 * Wiring for the LiveController: the real server + Supabase, or the in-browser mock server.
 */
import { GraphStateSchema, RECORDINGS_BUCKET, recordingPath } from '@constellate/shared';
import { env } from '../../lib/env';
import { loadDemoGraph, loadDemoOps } from '../../lib/fixtures';
import { supabase } from '../../lib/supabase';
import { startCapture } from './audio';
import type { LiveDeps } from './controller';
import { MockLiveServer } from './mock-server';
import { wsTransport } from './transport';

const log = (event: string, data?: Record<string, unknown>) => console.info(`[live] ${event}`, data ?? '');

/** `clockRate`: the server's transcript-replay speed, so the replay timer matches it (mic ignores it). */
export function realDeps(opts: { clockRate?: number } = {}): LiveDeps {
  return {
    transport: wsTransport(env.serverWsUrl),
    getAuth: async () => {
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      return s ? { token: s.access_token, userId: s.user.id } : null;
    },
    fetchGraph: async (id, auth) => {
      const res = await fetch(`${env.serverHttpUrl}/conversations/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(`GET /conversations/${id} → ${res.status}`);
      return GraphStateSchema.parse(await res.json());
    },
    postOps: async (id, auth, ops) => {
      const res = await fetch(`${env.serverHttpUrl}/conversations/${encodeURIComponent(id)}/ops`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      });
      if (!res.ok) throw new Error(`POST /conversations/${id}/ops → ${res.status}`);
    },
    startCapture: (source, onFrame) => startCapture(source, onFrame),
    upload: async (blob, auth, conversationId) => {
      if (!supabase) throw new Error('Supabase is not configured');
      const { error } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .upload(recordingPath(auth.userId, conversationId), blob, {
          contentType: blob.type || 'audio/webm',
          upsert: true,
        });
      if (error) throw error;
    },
    now: () => Date.now(),
    clockRate: opts.clockRate && opts.clockRate > 0 ? opts.clockRate : 1,
    log,
  };
}

/** Mock mode: fixture op stream, no network, no microphone. */
export function mockDeps(opts: { speed?: number } = {}): { deps: LiveDeps; server: MockLiveServer } {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const server = new MockLiveServer({ ops: loadDemoOps(), finalGraph: loadDemoGraph(), speed });
  const userId = server.state.conversation.userId;
  return {
    server,
    deps: {
      transport: server.transport,
      getAuth: async () => ({ token: 'mock-token', userId }),
      fetchGraph: (id) => server.fetchGraph(id),
      postOps: (id, _auth, ops) => server.postOps(id, ops),
      // mock mode never touches the microphone: the op stream is the "audio"
      startCapture: () => Promise.reject(new Error('no audio capture in mock mode')),
      upload: async () => undefined,
      now: () => Date.now(),
      clockRate: speed,
      log,
    },
  };
}

export function defaultDeps(opts: { speed?: number } = {}): { deps: LiveDeps; dispose(): void } {
  if (env.useMocks) {
    const { deps, server } = mockDeps(opts);
    return { deps, dispose: () => server.dispose() };
  }
  return { deps: realDeps({ clockRate: opts.speed }), dispose: () => undefined };
}
