/**
 * Demo-account seeding (docs/PLAN.md → The Brain, "Demo data"): the five demo-* transcript fixtures go
 * through the REAL pipeline — A1's replay adapter → interpreter → persistence → finalisation → Brain
 * build — so the demo Brain is produced by the product, not hand-made (AGENTS.md hard rule 3).
 *
 * The humans run the real mode ONCE, at H10, against the shared database. Agents only use --dry-run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODELS } from '../packages/shared/src/config';
import type { CreateLiveInterpreter, TranscriptFixture } from '../packages/shared/src/interpreter';
import { createFinalizer, type FinalizeOutput } from '../packages/interpreter/src/finalize';
import { createInterpreter, type Scheduler, type TestableInterpreter } from '../packages/interpreter/src/live';
import type { LlmClient, LlmJsonArgs } from '../packages/interpreter/src/llm/types';
import { dequantise, embeddingsFile, requestKey } from '../packages/interpreter/src/llm/replay';
import { bagEmbed, windowIdsOf } from '../packages/interpreter/src/test-utils';
import { RECORDINGS } from '../packages/interpreter/eval/recordings-path';
import { loadEnv } from '../apps/server/src/env';
import { Finalizer } from '../apps/server/src/finalize/finalizer';
import { createRuntime, rebuildBrainFor, seedFixtureConversation, type SeedRuntime } from '../apps/server/src/seed';
import { MemoryStore } from '../apps/server/src/store/memory';
import type { ServerDeps } from '../apps/server/src/deps';
import { SpeechUnavailableError } from '../apps/server/src/live/session';
import type { SpeechAdapter, SpeechSegment } from '../apps/server/src/speech/types';

/** The demo account's conversations, oldest first (each fixture's `daysAgo` places it in the last ~3 weeks). */
export const DEMO_FIXTURES = [
  'demo-fitness',
  'demo-philosophy',
  'demo-religion',
  'demo-career',
  'demo-journal',
  'demo-book-club',
  'demo-concert',
  'demo-cooking',
  'demo-travel',
  'demo-stoicism-again',
  'demo-startup',
  'demo-run-debrief',
  'demo-first-week',
  'demo-money-talk',
  'demo-guitar',
  'demo-bread',
  'demo-trip-recap',
  'demo-reading-slump',
  'demo-prototype-feedback',
  'demo-tune-up-race',
];

const TRANSCRIPTS = fileURLToPath(new URL('../packages/shared/fixtures/transcripts/', import.meta.url));
const DAY_MS = 24 * 60 * 60_000;

/**
 * `daysAgo` (optional, top level in a demo fixture; the fixture schema ignores it): how many days
 * before the seed run the conversation took place, so the library and Brain show varied dates.
 */
export function fixtureDaysAgo(fixtureId: string): number | null {
  try {
    const raw = JSON.parse(readFileSync(`${TRANSCRIPTS}${fixtureId}.json`, 'utf8')) as { daysAgo?: unknown };
    return typeof raw.daysAgo === 'number' && raw.daysAgo >= 0 ? raw.daysAgo : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SeedArgs {
  dryRun: boolean;
  userId: string | null;
  confirmH10: boolean;
  /** --skip-existing: leave out fixtures the demo user already has a ready conversation from */
  skipExisting: boolean;
  /** --only a,b: seed just these fixtures (null = all) */
  only: string[] | null;
  /** --estimate: no network, like --dry-run */
  estimate: boolean;
}

export function parseArgs(argv: readonly string[]): SeedArgs {
  const i = argv.indexOf('--user');
  const o = argv.indexOf('--only');
  const only =
    o >= 0
      ? (argv[o + 1] ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : null;
  return {
    dryRun: argv.includes('--dry-run'),
    userId: i >= 0 ? (argv[i + 1] ?? null) : null,
    confirmH10: argv.includes('--confirm-h10'),
    skipExisting: argv.includes('--skip-existing'),
    only,
    estimate: argv.includes('--estimate'),
  };
}

/** Why the real run must not start, or null. The dry run has no requirements. */
export function refusal(args: SeedArgs, env: Record<string, string | undefined>): string | null {
  if (args.only) {
    const unknown = args.only.filter((id) => !DEMO_FIXTURES.includes(id));
    if (args.only.length === 0) return 'refusing: --only needs fixture ids, e.g. --only demo-guitar,demo-bread';
    if (unknown.length) return `refusing: unknown fixture(s) for --only: ${unknown.join(', ')}`;
  }
  if (args.dryRun || args.estimate) return null;
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
  /** fixtures left out by --skip-existing, with the ready conversation that already has them */
  skipped: { fixture: string; conversationId: string }[];
  conversations: { fixture: string; conversationId: string; utterances: number; status: string; nodes: number }[];
  brainConversations: number;
  embeddings: { thisRun: number; today: number; cap: number | null; evalCacheHits: number; sentToGemini: number };
}

export type SeedStep = 'replay' | 'stop' | 'finalise' | 'brain';

export class SeedStepTimeout extends Error {
  constructor(
    readonly fixture: string,
    readonly step: SeedStep,
    readonly ms: number,
  ) {
    super(`seeding ${fixture}: no result after ${ms} ms, stuck in step "${step}"`);
    this.name = 'SeedStepTimeout';
  }
}

interface Progress {
  fixture: string;
  step: SeedStep;
}

/**
 * Track which step a conversation is in, without changing A1's seed flow: the speech adapter's last
 * final caption ends "replay" (→ "stop"), and the finaliser's run() starts "finalise".
 */
function instrument(rt: SeedRuntime, progress: Progress): SeedRuntime {
  const createSpeech: ServerDeps['createSpeech'] = (req) => {
    const inner = rt.deps.createSpeech(req);
    const total = req.fixture?.utterances.length ?? Infinity;
    let finals = 0;
    return {
      start: (onSegment) =>
        inner.start((seg) => {
          onSegment(seg);
          if (seg.final && ++finals >= total && progress.step === 'replay') progress.step = 'stop';
        }),
      push: (pcm) => inner.push(pcm),
      stop: () => inner.stop(),
    };
  };
  const deps = { ...rt.deps, createSpeech };
  const finalizer = new Finalizer({ ...deps, log: rt.log });
  const run = finalizer.run.bind(finalizer);
  finalizer.run = (conversationId, o) => {
    progress.step = 'finalise';
    return run(conversationId, o);
  };
  return { ...rt, deps, finalizer };
}

function withStepTimeout<T>(p: Promise<T>, ms: number | undefined, progress: Progress): Promise<T> {
  if (!ms) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SeedStepTimeout(progress.fixture, progress.step, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Which of `fixtures` the user already has, keyed by fixture id. A seeded conversation keeps the live
 * transcript (file transcription is off on our key), so its first utterance is the fixture's first
 * utterance — titles can't be used, finalisation rewrites them. Reads only; no API calls.
 */
export async function existingFixtures(
  rt: SeedRuntime,
  userId: string,
  fixtures: readonly string[],
): Promise<Map<string, { conversationId: string; status: string; ready: boolean }>> {
  const byFirstLine = new Map<string, string>();
  for (const id of fixtures) {
    const fx = await rt.deps.loadFixture(id);
    const first = fx.utterances[0]?.text;
    if (first) byFirstLine.set(first, id);
  }
  const found = new Map<string, { conversationId: string; status: string; ready: boolean }>();
  for (const { conversation } of await rt.deps.store.listConversations(userId)) {
    const [first] = await rt.deps.store.listUtterances(conversation.id);
    const id = first ? byFirstLine.get(first.text) : undefined;
    if (!id) continue;
    const ready = conversation.status === 'ready';
    const prev = found.get(id);
    if (!prev || (ready && !prev.ready))
      found.set(id, { conversationId: conversation.id, status: conversation.status, ready });
  }
  return found;
}

export async function seedDemo(
  rtIn: SeedRuntime,
  userId: string,
  opts: {
    fixtures?: string[];
    evalStats?: { evalHits: number; passedOn: number };
    log?: (m: string) => void;
    /** fail with the stuck step's name when a conversation (or the Brain build) takes longer */
    stepTimeoutMs?: number;
    /** called before each conversation, and with "the Brain" before the Brain build */
    onFixture?: (fixture: string) => void;
    /** the seed run's "now" (dates are placed `daysAgo` before it) */
    now?: Date;
    /** leave out fixtures the user already has a ready conversation from */
    skipExisting?: boolean;
  } = {},
): Promise<SeedSummary> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const progress: Progress = { fixture: '', step: 'replay' };
  const rt = instrument(rtIn, progress);
  const conversations: SeedSummary['conversations'] = [];
  const skipped: SeedSummary['skipped'] = [];
  const existing = opts.skipExisting ? await existingFixtures(rt, userId, opts.fixtures ?? DEMO_FIXTURES) : new Map();
  for (const fixture of opts.fixtures ?? DEMO_FIXTURES) {
    const found = existing.get(fixture);
    if (found?.ready) {
      skipped.push({ fixture, conversationId: found.conversationId });
      log(`[seed] ${fixture}: skipped, already seeded (conversation ${found.conversationId})`);
      continue;
    }
    if (found) {
      log(
        `[seed] ${fixture}: found an incomplete conversation ${found.conversationId} (${found.status}); seeding it again (delete the old one if you like)`,
      );
    }
    progress.fixture = fixture;
    progress.step = 'replay';
    opts.onFixture?.(fixture);
    const r = await withStepTimeout(seedFixtureConversation(rt, userId, fixture), opts.stepTimeoutMs, progress);
    await correctTimes(rt, r.conversationId, fixture, opts.now ?? new Date());
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
  progress.fixture = 'the Brain';
  progress.step = 'brain';
  opts.onFixture?.('the Brain');
  const brain = await withStepTimeout(rebuildBrainFor(rt, userId), opts.stepTimeoutMs, progress);
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
  if (opts.skipExisting)
    log(
      `[seed] skipped ${skipped.length} already-seeded fixture(s)${skipped.length ? `: ${skipped.map((x) => x.fixture).join(', ')}` : ''}`,
    );
  return { skipped, conversations, brainConversations: brain.conversations, embeddings };
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

/**
 * Replay pacing for seeding (dry run AND the real run). A1's TranscriptReplayAdapter starts from
 * `fromMs` = a wall clock running at REPLAY_SPEED, so under load it skips the first utterances and
 * the seed waits forever for their captions (#63). And a fully instant replay would hand the real
 * Claude interpreter almost the whole conversation in its second window. So utterances are emitted
 * one at a time, each after the session's interpreter is idle again, with the interpreter's clock at
 * the last utterance's end — exactly how the eval drives the interpreter.
 */
export interface Pacer {
  interpreter: TestableInterpreter | null;
  lastEndMs: number;
}

export const newPacer = (): Pacer => ({ interpreter: null, lastEndMs: 0 });

/** Every fixture utterance, in order, with no timers; waits for `pacer`'s interpreter between them. */
export function pacedReplaySpeech(fixture: TranscriptFixture, pacer: Pacer | null = null): SpeechAdapter {
  let stopped = false;
  return {
    async start(onSegment: (s: SpeechSegment) => void) {
      for (const u of fixture.utterances) {
        if (stopped) return;
        await Promise.resolve();
        onSegment({ text: u.text, final: true, startMs: u.startMs, endMs: u.endMs, speaker: null });
        if (pacer?.interpreter) await pacer.interpreter.idle();
      }
    },
    push() {},
    async stop() {
      stopped = true;
    },
  };
}

/** Back-compat name used by tests: the unpaced variant. */
export const instantReplaySpeech = (fixture: TranscriptFixture) => pacedReplaySpeech(fixture, null);

/** The interpreter's silence timers never fire while seeding; stop() flushes the last window. */
export const inertScheduler: Scheduler = { setTimeout: () => null, clearTimeout: () => {} };

/** The real interpreter (Claude unless `llm` is given), clocked by the replayed utterances. */
export function pacedInterpreter(pacer: Pacer, llm?: LlmClient): CreateLiveInterpreter {
  return (deps) => {
    pacer.lastEndMs = 0;
    const interp = createInterpreter({ ...deps, nowMs: () => pacer.lastEndMs }, { llm, scheduler: inertScheduler });
    pacer.interpreter = interp;
    return {
      pushUtterance(u) {
        pacer.lastEndMs = Math.max(pacer.lastEndMs, u.endMs);
        interp.pushUtterance(u);
      },
      park: (text, atMs) => interp.park(text, atMs),
      stop: () => interp.stop(),
    };
  };
}

function pacedSpeechFactory(pacer: Pacer): ServerDeps['createSpeech'] {
  return (req) => {
    if (req.source !== 'replay-transcript' || !req.fixture)
      throw new SpeechUnavailableError('seeding replays fixtures only');
    return pacedReplaySpeech(req.fixture, pacer);
  };
}

/**
 * The live session stamps `durationMs` from its wall clock (meaningless under paced replay) and dates
 * the conversation at seeding time. Set the real length (last utterance end) and, when the fixture has
 * `daysAgo`, `startedAt`/`endedAt` that many days before `now` — through the normal graph commit path
 * (A1's store persists started_at, ended_at and duration_ms from conversation patches).
 */
async function correctTimes(rt: SeedRuntime, conversationId: string, fixtureId: string, now: Date): Promise<void> {
  const fixture = await rt.deps.loadFixture(fixtureId);
  const durationMs = Math.max(0, ...fixture.utterances.map((u) => u.endMs));
  const daysAgo = fixtureDaysAgo(fixtureId);
  const patch: { durationMs: number; startedAt?: string; endedAt?: string } = { durationMs };
  if (daysAgo !== null) {
    const started = new Date(now.getTime() - daysAgo * DAY_MS);
    patch.startedAt = started.toISOString();
    patch.endedAt = new Date(started.getTime() + durationMs).toISOString();
  }
  const cell = await rt.deps.hub.acquire(conversationId);
  if (!cell) return;
  try {
    await cell.commit([{ op: 'conversation.update', patch }], 'finalize').persisted; // server-side correction by the seeder (not a user edit)
    await cell.flush();
  } finally {
    rt.deps.hub.release(cell);
  }
}

/** The real run's runtime: A1's server dependencies (.env, Supabase, capped Gemini, Claude) with paced replay. */
export function realRuntime(): SeedRuntime {
  const pacer = newPacer();
  return createRuntime(undefined, {
    createSpeech: pacedSpeechFactory(pacer),
    createInterpreter: pacedInterpreter(pacer),
  });
}

export function dryRunRuntime(overrides: Partial<ServerDeps> = {}): SeedRuntime {
  // no shared on-disk state: no usage ledger, no embedding cache, no Gemini client, memory store
  const env = loadEnv({
    LOG_LEVEL: 'silent',
    REPLAY_SPEED: '1000',
    EMBEDDINGS: 'local',
    GEMINI_USAGE_FILE: 'off',
    EMBED_CACHE_FILE: 'off',
  });
  const pacer = newPacer();
  return createRuntime(env, {
    store: new MemoryStore(),
    auth: { verifyToken: async () => null },
    gemini: null,
    embed: async (texts) => texts.map((t) => bagEmbed(t, MODELS.embedDims)),
    createInterpreter: pacedInterpreter(pacer, fakeDecisions()),
    createSpeech: pacedSpeechFactory(pacer),
    finalizeConversation: createFinalizer({
      llm: { json: async <T>() => ({ data: emptyFinalize as T, ms: 1, inTok: 0, outTok: 0 }) },
    }),
    transcribeFile: null,
    decideMerge: null,
    waitForRecordingMs: 0,
    ...overrides,
  });
}

export interface EmbeddingEstimate {
  conversations: number;
  /** distinct texts that would be embedded (the server caches by text) */
  distinctTexts: number;
  /** expected Gemini embedding requests: one per embed call that has an uncached text, chunks of 100 */
  requests: number;
  perConversation: { fixture: string; requests: number; texts: number }[];
}

/**
 * --estimate: the dry run (no network) with a counting embedder that mirrors the server's
 * text-keyed cache, so repeated texts cost nothing. Interpreter decisions are the dry run's stand-ins
 * (a new topic every third window), which is close to the real ~1 node/minute density.
 */
export async function estimateEmbeddings(fixtures = DEMO_FIXTURES): Promise<EmbeddingEstimate> {
  const seen = new Set<string>();
  let requests = 0;
  let current: { requests: number; texts: number } = { requests: 0, texts: 0 };
  const embed = async (texts: string[]) => {
    const fresh = [...new Set(texts)].filter((t) => !seen.has(t));
    if (fresh.length > 0) {
      const n = Math.ceil(fresh.length / 100);
      requests += n;
      current.requests += n;
      current.texts += fresh.length;
      fresh.forEach((t) => seen.add(t));
    }
    return texts.map((t) => bagEmbed(t, MODELS.embedDims));
  };
  const rt = dryRunRuntime({ embed });
  const perConversation: EmbeddingEstimate['perConversation'] = [];
  await seedDemo(rt, DRY_RUN_USER, {
    fixtures,
    log: () => {},
    onFixture: (fixture) => {
      const bucket = { fixture, requests: 0, texts: 0 };
      perConversation.push(bucket);
      current = bucket;
    },
  });
  return { conversations: fixtures.length, distinctTexts: seen.size, requests, perConversation };
}

export const DRY_RUN_USER = 'd0000000-0000-4000-8000-0000000000d1';
