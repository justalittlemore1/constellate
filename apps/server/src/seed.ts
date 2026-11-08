/**
 * Server functions for `scripts/seed-demo.ts` (A2): run transcript fixtures through the REAL
 * pipeline (replay adapter → interpreter → persistence → finalisation → Brain) for one user,
 * with no sockets or tokens involved. Import with a relative path from the script:
 *
 *   import { createRuntime, seedFixtureConversation, rebuildBrainFor } from '../apps/server/src/seed';
 *   const rt = createRuntime();   // reads .env like the server; needs EMBEDDINGS=gemini for Supabase
 *   const id = await seedFixtureConversation(rt, demoUserId, '01-simple-shift');
 *   await rebuildBrainFor(rt, demoUserId);
 */
import type { ServerMsg } from '@constellate/shared';
import { rebuildBrain, type RebuildResult } from './brain/rebuild';
import { createDefaultDeps, isPersistent, type ServerDeps } from './deps';
import { embeddingsMode, forceClaudeReasoning, loadEnv, type Env } from './env';
import { Finalizer, type FinalizeOutcome } from './finalize/finalizer';
import { LiveSession, type LiveDeps, type Log } from './live/session';

export interface SeedRuntime {
  deps: ServerDeps;
  finalizer: Finalizer;
  log: Log;
}

/** Same dependencies as the running server. `REPLAY_SPEED` defaults to 50× here. */
export function createRuntime(
  env: Env = loadEnv({ REPLAY_SPEED: '50', ...process.env }),
  overrides: Partial<ServerDeps> = {},
): SeedRuntime {
  const log: Log = (event, data) => {
    if (env.LOG_LEVEL !== 'silent') console.log(event, data ?? {});
  };
  // demo data must come from the real pipeline (AGENTS.md hard rule 3): never seed a shared
  // database with stand-in vectors
  const persistent = overrides.store
    ? isPersistent(overrides.store)
    : Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (persistent && embeddingsMode(env) !== 'gemini') {
    throw new Error(
      'seeding a persistent store needs real embeddings: set EMBEDDINGS=gemini (counts toward the 500/day cap)',
    );
  }
  forceClaudeReasoning(env, (msg) => console.warn(msg));
  const deps = createDefaultDeps(env, log, overrides);
  return { deps, finalizer: new Finalizer({ ...deps, log }), log };
}

export interface SeedResult {
  conversationId: string;
  utterances: number;
  finalize: FinalizeOutcome;
}

/** Replays one transcript fixture as `userId`, stops, and finalises. */
export async function seedFixtureConversation(
  rt: SeedRuntime,
  userId: string,
  fixtureId: string,
  opts: { timeoutMs?: number } = {},
): Promise<SeedResult> {
  const fixture = await rt.deps.loadFixture(fixtureId);
  const total = fixture.utterances.length;
  let finals = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const sink = {
    send(msg: ServerMsg) {
      if (msg.t === 'caption' && msg.final && ++finals >= total) resolveDone();
      if (msg.t === 'error') rt.log('seed.error', { ...msg });
    },
    close() {},
  };
  const liveDeps: LiveDeps = { ...rt.deps, log: rt.log, onStopped: () => {} };
  const session = await LiveSession.open(
    liveDeps,
    userId,
    { t: 'hello', token: '', source: 'replay-transcript', fixture: fixtureId, consent: true },
    fixture,
    sink,
  );
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    done,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`seeding ${fixtureId} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  await session.stop();
  const finalize = await rt.finalizer.run(session.conversationId);
  return { conversationId: session.conversationId, utterances: finals, finalize };
}

export function rebuildBrainFor(rt: SeedRuntime, userId: string): Promise<RebuildResult> {
  return rebuildBrain({ ...rt.deps, log: rt.log }, userId);
}
