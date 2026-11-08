/**
 * The live interpreter: buffers utterances, decides when to think, calls the LLM (one call in flight,
 * 8 s timeout, one retry with the validation error, then skip), and turns decisions into ops.
 */
import { readFileSync } from 'node:fs';
import {
  INTERPRETER,
  type GraphState,
  type InterpreterDeps,
  type InterpreterProvider,
  type LiveInterpreter,
  type Utterance,
} from '@constellate/shared';
import { packContext } from './context';
import { DECISION_JSON_SCHEMA, parseDecision, type Decision } from './decision';
import { granularityHint, type NodeCreation } from './granularity';
import { createLlmClient, interpreterModel, providerFromEnv } from './llm';
import { withTimeout } from './llm/errors';
import type { LlmClient } from './llm/types';
import {
  cleanLabel,
  cleanSummary,
  emptyMemory,
  effectiveActiveId,
  parkOps,
  stopOps,
  translate,
  validateDecision,
  type GateMemory,
} from './translate';
import { msUntilPause, pauseBefore, pauseDue, triggerOnUtterance, type TriggerReason } from './trigger';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** One record per decision attempt, for the eval report and logs. */
export interface DecisionRecord {
  reason: TriggerReason;
  windowIds: string[];
  atMs: number;
  ms: number;
  inTok: number;
  outTok: number;
  attempts: number;
  decision: Decision | null;
  error: string | null;
  opCount: number;
  warnings: string[];
  prompt?: string;
}

export interface InterpreterOptions {
  provider?: InterpreterProvider;
  model?: string;
  llm?: LlmClient;
  scheduler?: Scheduler;
  systemPrompt?: string;
  onDecision?(record: DecisionRecord): void;
  /** include the packed prompt in each DecisionRecord (eval debugging) */
  keepPrompts?: boolean;
}

export interface TestableInterpreter extends LiveInterpreter {
  /** resolves once no LLM call, queued run or embedding task is pending */
  idle(): Promise<void>;
}

let cachedPrompt: string | null = null;
export function livePrompt(): string {
  cachedPrompt ??= readFileSync(new URL('../prompts/live.md', import.meta.url), 'utf8');
  return cachedPrompt;
}

/** The text a node is embedded with. */
export const nodeText = (label: string, summary: string) => `${label}. ${summary}`;

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length && i < b.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function createInterpreter(deps: InterpreterDeps, opts: InterpreterOptions = {}): TestableInterpreter {
  const provider = opts.provider ?? providerFromEnv();
  if (provider === 'gemini') {
    deps.log?.('interpreter.provider.ignored', {
      requested: 'gemini',
      using: 'anthropic',
      reason: 'Gemini text models are off-budget',
    });
  }
  const model = opts.model ?? interpreterModel(provider);
  if (model.startsWith('gemini'))
    throw new Error(`refusing Gemini text model ${model}: reasoning runs on Claude (AGENTS.md › API budget)`);
  let llm = opts.llm ?? null;
  const getLlm = () => (llm ??= createLlmClient(provider));
  const scheduler = opts.scheduler ?? realScheduler;
  const system = opts.systemPrompt ?? livePrompt();
  const log = (event: string, data?: Record<string, unknown>) => deps.log?.(event, data);

  const all: Utterance[] = [];
  const byId = new Map<string, Utterance>();
  let window: Utterance[] = [];
  let memory: GateMemory = emptyMemory();
  let rollingSummary = '';
  const creations: NodeCreation[] = [];
  /** node id → embedding of `label. summary` (also saved through deps.saveEmbedding) */
  const embeddings = new Map<string, number[]>();
  /** node texts waiting to ride along with the next embedding request (AGENTS.md › API budget) */
  const pendingEmbeds = new Map<string, string>();
  /** text → vector, so no text is ever embedded twice in a session */
  const memo = new Map<string, number[]>();
  const tasks = new Set<Promise<unknown>>();

  let running: Promise<void> | null = null;
  let queued: TriggerReason | null = null;
  let pauseTimer: unknown = null;
  let stopped = false;

  const track = <T>(p: Promise<T>): Promise<T> => {
    tasks.add(p);
    void p.finally(() => tasks.delete(p)).catch(() => {});
    return p;
  };

  function request(reason: TriggerReason) {
    if (window.length === 0) return;
    if (running) {
      queued ??= reason;
      return;
    }
    running = track(run(reason)).finally(() => {
      running = null;
      const next = queued;
      queued = null;
      if (next && window.length > 0 && !stopped) request(next);
    });
  }

  function armPauseTimer() {
    if (pauseTimer !== null) scheduler.clearTimeout(pauseTimer);
    pauseTimer = null;
    const ms = msUntilPause(window, deps.nowMs());
    if (ms === null) return;
    pauseTimer = scheduler.setTimeout(() => {
      pauseTimer = null;
      if (pauseDue(window, deps.nowMs())) request('pause');
    }, ms);
  }

  /**
   * One embedding request for `extra` plus every queued node text (deduplicated, memoised), then
   * save the node vectors. Returns the vectors for `extra`, or null if the request failed (e.g. a
   * 429): the caller degrades and the queued nodes wait for the next request.
   */
  async function embedBatch(extra: string[]): Promise<number[][] | null> {
    const queued = [...pendingEmbeds];
    const texts = [...new Set([...extra, ...queued.map(([, t]) => t)])].filter((t) => !memo.has(t));
    try {
      if (texts.length > 0) {
        const vs = await deps.embed(texts);
        texts.forEach((t, i) => {
          const v = vs[i];
          if (v) memo.set(t, v);
        });
      }
      await Promise.all(
        queued.map(async ([id, t]) => {
          const v = memo.get(t);
          if (!v || pendingEmbeds.get(id) !== t) return;
          pendingEmbeds.delete(id);
          embeddings.set(id, v);
          await deps.saveEmbedding(id, v);
        }),
      );
      return extra.map((t) => memo.get(t) ?? []);
    } catch (e) {
      log('interpreter.embed.error', { message: String(e), texts: texts.length, degraded: true });
      return null;
    }
  }

  function queueEmbeds(state: GraphState, ids: string[]) {
    for (const id of ids) {
      const n = state.nodes[id];
      if (n) pendingEmbeds.set(id, nodeText(n.label, n.summary));
    }
  }

  async function revisitCandidates(state: GraphState, batch: Utterance[]) {
    const topics = Object.values(state.nodes).filter((n) => n.kind === 'topic');
    if (topics.length < 2) return [];
    try {
      const vs = await embedBatch([batch.map((u) => u.text).join(' ')]);
      const v = vs?.[0];
      if (!v || v.length === 0) return [];
      const exclude = effectiveActiveId(state, memory) ?? undefined;
      const matches = await deps.matchNodes(v, INTERPRETER.revisitCandidateK, exclude);
      return matches.filter(
        (m) => m.similarity >= INTERPRETER.revisitCandidateMin && state.nodes[m.id]?.kind === 'topic',
      );
    } catch (e) {
      log('interpreter.candidates.error', { message: String(e) });
      return [];
    }
  }

  async function autoResolve(state: GraphState, d: Decision): Promise<string[]> {
    if (d.action !== 'new_topic' || !d.new_topic) return [];
    const open = () => Object.values(state.nodes).filter((n) => n.kind !== 'topic' && n.status === 'active');
    if (open().length === 0) return [];
    try {
      // same text the new node will be embedded with, so this vector is reused (memo) afterwards
      const vs = await embedBatch([nodeText(cleanLabel(d.new_topic.label), cleanSummary(d.new_topic.summary))]);
      const v = vs?.[0];
      if (!v || v.length === 0) return [];
      return open()
        .filter((n) => embeddings.has(n.id) && cosine(v, embeddings.get(n.id)!) >= INTERPRETER.pendingAutoResolveMin)
        .map((n) => n.id);
    } catch (e) {
      log('interpreter.autoresolve.error', { message: String(e) });
      return [];
    }
  }

  async function run(reason: TriggerReason): Promise<void> {
    const batch = window;
    window = [];
    if (pauseTimer !== null) scheduler.clearTimeout(pauseTimer);
    pauseTimer = null;
    deps.setStage?.('thinking');
    const record: DecisionRecord = {
      reason,
      windowIds: batch.map((u) => u.id),
      atMs: deps.nowMs(),
      ms: 0,
      inTok: 0,
      outTok: 0,
      attempts: 0,
      decision: null,
      error: null,
      opCount: 0,
      warnings: [],
    };
    try {
      const before = deps.getState();
      const candidates = await revisitCandidates(before, batch);
      const firstIdx = all.indexOf(batch[0]!);
      const recent = all.slice(Math.max(0, firstIdx - INTERPRETER.recentUtterances), firstIdx);
      const packed = packContext({
        state: before,
        effectiveActiveId: effectiveActiveId(before, memory),
        utterancesById: byId,
        recent,
        window: batch,
        rollingSummary,
        candidates,
        hint: granularityHint(before, deps.nowMs(), creations),
      });
      if (opts.keepPrompts) record.prompt = packed.text;

      let user = packed.text;
      let decision: Decision | null = null;
      for (let attempt = 1; attempt <= 2 && !decision; attempt++) {
        record.attempts = attempt;
        try {
          const res = await withTimeout(
            getLlm().json<unknown>({
              system,
              user,
              schema: DECISION_JSON_SCHEMA,
              model,
              timeoutMs: INTERPRETER.callTimeoutMs,
            }),
            INTERPRETER.callTimeoutMs + 500,
          );
          record.ms += res.ms;
          record.inTok += res.inTok;
          record.outTok += res.outTok;
          const parsed = parseDecision(res.data);
          const error = parsed.ok
            ? validateDecision(parsed.decision, packed.aliases, batch, deps.getState(), memory)
            : parsed.error;
          if (parsed.ok && !error) decision = parsed.decision;
          else {
            record.error = error;
            user = `${packed.text}\n\nYOUR PREVIOUS ANSWER WAS INVALID: ${error}\nAnswer again with a corrected decision.`;
          }
        } catch (e) {
          record.error = e instanceof Error ? e.message : String(e);
          user = `${packed.text}\n\nYOUR PREVIOUS ATTEMPT FAILED: ${record.error}\nAnswer again.`;
        }
      }

      if (!decision) {
        // skip: the window rolls into the next one
        window = [...batch, ...window];
        armPauseTimer();
        log('interpreter.skip', { reason, error: record.error, window: record.windowIds });
        return;
      }
      record.error = null;
      record.decision = decision;

      const state = deps.getState();
      const autoResolveIds = await autoResolve(state, decision);
      const fresh = deps.getState();
      const result = translate({
        state: fresh,
        decision,
        aliases: packContext({
          state: fresh,
          utterancesById: byId,
          recent: [],
          window: batch,
          rollingSummary: '',
          candidates: [],
          hint: '',
        }).aliases,
        window: batch,
        utterancesById: byId,
        memory,
        newId: deps.newId,
        nowMs: deps.nowMs(),
        autoResolveIds,
      });
      memory = result.memory;
      rollingSummary = decision.rolling_summary.slice(0, INTERPRETER.rollingSummaryMaxChars);
      for (const c of result.created) creations.push({ atMs: deps.nowMs(), explicit: c.explicit });
      record.opCount = result.ops.length;
      record.warnings = result.warnings;
      if (result.ops.length > 0) deps.emit(result.ops);
      queueEmbeds(deps.getState(), result.touched);
    } catch (e) {
      record.error = e instanceof Error ? e.message : String(e);
      log('interpreter.error', { message: record.error });
    } finally {
      deps.setStage?.('listening');
      log('interpreter.decision', {
        reason,
        ms: Math.round(record.ms),
        attempts: record.attempts,
        ops: record.opCount,
        error: record.error,
      });
      opts.onDecision?.(record);
    }
  }

  async function idle(): Promise<void> {
    while (tasks.size > 0) await Promise.allSettled([...tasks]);
  }

  return {
    pushUtterance(u) {
      if (stopped || byId.has(u.id)) return;
      all.push(u);
      byId.set(u.id, u);
      // a pause before this utterance closes the window it follows
      if (pauseBefore(window, u)) request('pause');
      window.push(u);
      const reason = triggerOnUtterance(window, u);
      if (reason) request(reason);
      else armPauseTimer();
    },
    park(text, atMs) {
      if (stopped) return;
      const r = parkOps(deps.getState(), memory, text, atMs, deps.newId);
      memory = r.memory;
      deps.emit(r.ops);
      queueEmbeds(deps.getState(), [r.nodeId]);
    },
    async stop() {
      if (pauseTimer !== null) scheduler.clearTimeout(pauseTimer);
      pauseTimer = null;
      await idle();
      if (window.length > 0) request('flush');
      await idle();
      stopped = true;
      const endMs = all.length > 0 ? all[all.length - 1]!.endMs : deps.nowMs();
      const r = stopOps(deps.getState(), memory, endMs, deps.newId);
      memory = r.memory;
      if (r.ops.length > 0) deps.emit(r.ops);
      // every node needs an embedding (revisits next time, the Brain build): one final batch
      if (pendingEmbeds.size > 0) await embedBatch([]);
    },
    idle,
  };
}
