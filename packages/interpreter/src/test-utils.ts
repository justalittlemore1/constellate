/**
 * Test-only helpers: an in-memory InterpreterDeps that applies emitted ops with the real reducer,
 * a scripted LlmClient, a virtual clock/scheduler and a bag-of-words embedder.
 */
import { applyOps, type GraphOp, type GraphState, type InterpreterDeps, type Utterance } from '@constellate/shared';
import { makeGraph, TEST_CONVERSATION_ID } from '@constellate/shared/testing';
import type { Decision } from './decision';
import type { Scheduler } from './live';
import type { LlmClient, LlmJsonArgs } from './llm/types';

export function utt(n: number, text: string, startMs: number, endMs = startMs + 5_000, speaker: number | null = 0): Utterance {
  return { id: `u${n}`, conversationId: TEST_CONVERSATION_ID, speaker, startMs, endMs, text };
}

export class VirtualClock implements Scheduler {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers = this.timers.filter((t) => t.id !== h);
  }
  /** advance to `t`, firing due timers in order */
  advance(t: number) {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > t) break;
      this.timers.shift();
      this.now = Math.max(this.now, next.at);
      next.fn();
    }
    this.now = Math.max(this.now, t);
  }
}

/** Deterministic toy embedding: hashed bag of lowercase words, unit length. */
export function bagEmbed(text: string, dims = 64): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % dims]! += 1;
  }
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

export interface MemoryDeps extends InterpreterDeps {
  state: GraphState;
  emitted: GraphOp[][];
  saved: Map<string, number[]>;
  clock: VirtualClock;
}

export function memoryDeps(clock = new VirtualClock(), embed = async (ts: string[]) => ts.map((t) => bagEmbed(t))): MemoryDeps {
  let n = 0;
  let seq = 0;
  const deps: MemoryDeps = {
    state: makeGraph(),
    emitted: [],
    saved: new Map(),
    clock,
    conversationId: TEST_CONVERSATION_ID,
    getState: () => deps.state,
    emit: (ops) => {
      deps.emitted.push(ops);
      deps.state = applyOps(deps.state, {
        conversationId: TEST_CONVERSATION_ID,
        seq: ++seq,
        at: new Date(0).toISOString(),
        source: 'live',
        ops,
      });
    },
    newId: () => `id-${++n}`,
    embed,
    matchNodes: async (v, k, excludeId) =>
      [...deps.saved.entries()]
        .filter(([id]) => id !== excludeId && deps.state.nodes[id]?.kind === 'topic')
        .map(([id, e]) => ({ id, similarity: e.reduce((s, x, i) => s + x * (v[i] ?? 0), 0) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k),
    saveEmbedding: async (id, v) => {
      deps.saved.set(id, v);
    },
    nowMs: () => clock.now,
  };
  return deps;
}

/** Full decision with defaults, for scripting. */
export function dec(partial: Partial<Decision> & Pick<Decision, 'action'>): Decision {
  return {
    continue: null,
    new_topic: null,
    revisit: null,
    intentions: [],
    resolved_thread_ids: [],
    macro_anchor: null,
    rolling_summary: 'summary',
    ...partial,
  };
}

export type Script = (args: LlmJsonArgs, call: number) => unknown | Promise<unknown>;

/** LlmClient answering from a script; records every request. */
export function scriptedLlm(script: Script): LlmClient & { calls: LlmJsonArgs[] } {
  const calls: LlmJsonArgs[] = [];
  return {
    calls,
    async json<T>(args: LlmJsonArgs) {
      calls.push(args);
      const data = await script(args, calls.length);
      return { data: data as T, ms: 100, inTok: 1000, outTok: 100 };
    },
  };
}

/** Ids of the NEW utterances in a packed prompt, in order. */
export function windowIdsOf(user: string): string[] {
  const part = user.split('NEW UTTERANCES (decide about these):')[1] ?? '';
  return [...part.matchAll(/^\[(u\d+) /gm)].map((m) => m[1]!);
}
