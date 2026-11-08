/**
 * Demo-account seeding (docs/PLAN.md → The Brain, "Demo data"): the five demo-* transcript fixtures go
 * through the REAL pipeline — A1's replay adapter → interpreter → persistence → finalisation → Brain
 * build — so the demo Brain is produced by the product, not hand-made (AGENTS.md hard rule 3).
 *
 * The humans run the real mode ONCE, at H10, against the shared database. Agents only use --dry-run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { MODELS } from '../packages/shared/src/config';
import type { CreateLiveInterpreter } from '../packages/shared/src/interpreter';
import { createFinalizer, type FinalizeOutput } from '../packages/interpreter/src/finalize';
import { createInterpreter } from '../packages/interpreter/src/live';
import type { LlmClient, LlmJsonArgs } from '../packages/interpreter/src/llm/types';
import { dequantise, embeddingsFile, requestKey } from '../packages/interpreter/src/llm/replay';
import { bagEmbed, windowIdsOf } from '../packages/interpreter/src/test-utils';
import { RECORDINGS } from '../packages/interpreter/eval/recordings-path';
import { loadEnv } from '../apps/server/src/env';
import { Finalizer } from '../apps/server/src/finalize/finalizer';
import { createRuntime, rebuildBrainFor, seedFixtureConversation, type SeedRuntime } from '../apps/server/src/seed';
import { MemoryStore } from '../apps/server/src/store/memory';

export const DEMO_FIXTURES = ['demo-philosophy', 'demo-religion', 'demo-fitness', 'demo-career', 'demo-journal'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SeedArgs {
  dryRun: boolean;
  userId: string | null;
  confirmH10: boolean;
}

export function parseArgs(argv: readonly string[]): SeedArgs {
  const i = argv.indexOf('--user');
  return {
    dryRun: argv.includes('--dry-run'),
    userId: i >= 0 ? (argv[i + 1] ?? null) : null,
    confirmH10: argv.includes('--confirm-h10'),
  };
}

/** Why the real run must not start, or null. The dry run has no requirements. */
export function refusal(args: SeedArgs, env: Record<string, string | undefined>): string | null {
  if (args.dryRun) return null;
  if (env.EMBEDDINGS !== 'gemini') {
    return 'refusing: set EMBEDDINGS=gemini — demo data needs real embeddings (counts toward the 500/day server cap)';
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'refusing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to seed the demo account';
  }
  if (!args.userId || !UUID.test(args.userId)) return 'refusing: pass the demo account id: --user <uuid>';
  if (!args.confirmH10) {
    return 'refusing: this writes to the shared database and is run once by the humans at H10 — add --confirm-h10';
  }
  return null;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

/**
 * Reuse the eval's committed recordings where the text matches (read-only), then send every miss
 * to `inner` (A1's capped, disk-cached Gemini embedder) in ONE batched call.
 */
export function evalCacheEmbedder(
  inner: Embedder,
  dir = RECORDINGS,
): { embed: Embedder; stats: { evalHits: number; passedOn: number } } {
  const known = new Map<string, { q: string; s: number }>();
  const file = embeddingsFile(dir);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as { key: string; q: string; s: number };
      known.set(e.key, e);
    }
  }
  const stats = { evalHits: 0, passedOn: 0 };
  const embed: Embedder = async (texts) => {
    const out: (number[] | null)[] = texts.map((t) => {
      const e = known.get(requestKey({ embed: t }));
      return e ? dequantise(e) : null;
    });
    const missing = texts.filter((_, i) => out[i] === null);
    stats.evalHits += texts.length - missing.length;
    if (missing.length > 0) {
      stats.passedOn += missing.length;
      const got = await inner(missing);
      let j = 0;
      for (let i = 0; i < out.length; i++) if (out[i] === null) out[i] = got[j++]!;
    }
    return out as number[][];
  };
  return { embed, stats };
}

/** Wire the eval-cache embedder into a runtime (live sessions and finalisation both use it). */
export function withEvalCache(
  rt: SeedRuntime,
  dir = RECORDINGS,
): { rt: SeedRuntime; stats: { evalHits: number; passedOn: number } } {
  const { embed, stats } = evalCacheEmbedder(rt.deps.embed, dir);
  const deps = { ...rt.deps, embed };
  return { rt: { ...rt, deps, finalizer: new Finalizer({ ...deps, log: rt.log }) }, stats };
}

export function embedRequests(rt: SeedRuntime): { thisRun: number; today: number; cap: number | null } {
  const u = rt.deps.gemini?.usage();
  return {
    thisRun: u?.requests[MODELS.embed] ?? 0,
    today: u?.today.requests[MODELS.embed] ?? 0,
    cap: u?.caps[MODELS.embed] ?? null,
  };
}

export interface SeedSummary {
  conversations: { fixture: string; conversationId: string; utterances: number; status: string; nodes: number }[];
  brainConversations: number;
  embeddings: { thisRun: number; today: number; cap: number | null; evalCacheHits: number; sentToGemini: number };
}

export async function seedDemo(
  rt: SeedRuntime,
  userId: string,
  opts: { fixtures?: string[]; evalStats?: { evalHits: number; passedOn: number }; log?: (m: string) => void } = {},
): Promise<SeedSummary> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const conversations: SeedSummary['conversations'] = [];
  for (const fixture of opts.fixtures ?? DEMO_FIXTURES) {
    const r = await seedFixtureConversation(rt, userId, fixture);
    const g = await rt.deps.store.loadGraph(r.conversationId).catch(() => null);
    const nodes = g ? Object.values(g.nodes).filter((n) => n.kind === 'topic').length : 0;
    conversations.push({
      fixture,
      conversationId: r.conversationId,
      utterances: r.utterances,
      status: r.finalize.status,
      nodes,
    });
    log(`[seed] ${fixture}: ${r.utterances} utterances, ${nodes} topic nodes, finalisation ${r.finalize.status}`);
  }
  const brain = await rebuildBrainFor(rt, userId);
  const e = embedRequests(rt);
  const embeddings = {
    ...e,
    evalCacheHits: opts.evalStats?.evalHits ?? 0,
    sentToGemini: opts.evalStats?.passedOn ?? 0,
  };
  log(`[seed] Brain rebuilt from ${brain.conversations} conversation(s)`);
  log(
    `[seed] embedding requests: ${e.thisRun} this run; today ${e.today}${e.cap ? `/${e.cap}` : ''} on the server cap; ` +
      `${embeddings.evalCacheHits} text(s) reused from the eval recordings, ${embeddings.sentToGemini} passed to the server embedder (its disk cache may answer some)`,
  );
  return { conversations, brainConversations: brain.conversations, embeddings };
}

// ── dry run: the real pipeline code with fakes, no network, no database ────────────────────────

/** Deterministic stand-in for Claude in the live interpreter: a new topic every third window. */
export function fakeDecisions(): LlmClient {
  let call = 0;
  return {
    async json<T>(args: LlmJsonArgs) {
      call++;
      const ids = windowIdsOf(args.user);
      const first = ids[0] ?? 'u1';
      const open = call === 1 || call % 3 === 0;
      const data = open
        ? {
            action: 'new_topic',
            continue: null,
            new_topic: {
              label: `Dry Run Topic ${call}`,
              summary: `Stand-in topic opened at ${first}`,
              level: 1,
              relation: 'new_theme',
              parent_node_id: null,
              starts_at_utterance: first,
              explicit_shift: true,
            },
            revisit: null,
            intentions: [],
            resolved_thread_ids: [],
            macro_anchor: call === 1 ? 'Dry run' : null,
            rolling_summary: 'dry run',
          }
        : {
            action: 'continue',
            continue: null,
            new_topic: null,
            revisit: null,
            intentions: [],
            resolved_thread_ids: [],
            macro_anchor: null,
            rolling_summary: 'dry run',
          };
      return { data: data as T, ms: 1, inTok: 0, outTok: 0 };
    },
  };
}

const emptyFinalize: FinalizeOutput = {
  renames: [],
  merges: [],
  details: [],
  parents: [],
  thread_status: [],
  commitments: [],
  title: 'Dry Run Conversation',
  summary: 'A dry run of the demo seed.',
  recall_prompts: [],
};

export function dryRunRuntime(): SeedRuntime {
  const env = loadEnv({ LOG_LEVEL: 'silent', REPLAY_SPEED: '1000', EMBEDDINGS: 'local' });
  const llm = fakeDecisions();
  const createInterp: CreateLiveInterpreter = (deps) => createInterpreter(deps, { llm });
  return createRuntime(env, {
    store: new MemoryStore(),
    auth: { verifyToken: async () => null },
    gemini: null,
    embed: async (texts) => texts.map((t) => bagEmbed(t, MODELS.embedDims)),
    createInterpreter: createInterp,
    finalizeConversation: createFinalizer({
      llm: { json: async <T>() => ({ data: emptyFinalize as T, ms: 1, inTok: 0, outTok: 0 }) },
    }),
    transcribeFile: null,
    decideMerge: null,
  });
}

export const DRY_RUN_USER = 'd0000000-0000-4000-8000-0000000000d1';
