/**
 * Eval harness core: run one transcript fixture through the real live interpreter on a simulated
 * clock, then score the produced graph against the fixture's hand-labelled `expect`.
 *
 * `expect` shape (owned by packages/interpreter; utterance references are ids like "u7"):
 *   topicCount / topicCountRange      committed topic nodes after stop
 *   boundaries + tolerance            utterances where a new topic occurrence starts (excluding the first)
 *   anchorKeywords                    macro anchor contains one of these (case-insensitive)
 *   nesting [{parent, child}]         the node holding `child` descends from the node (thread) holding `parent`
 *   revisits [{at, of}]               exactly these revisit edges: occurrence starting near `at` → thread holding `of`
 *   sameThread / differentThreads     the nodes holding both utterances share / do not share a thread
 *   noBoundaryWithin [[a, b]]         no topic occurrence starts in this utterance range
 *   pending [{keywords, raisedAt, final, resolvedAt?}]   exactly these pending threads, final status, where resolved
 *   commitments [{keywords, at}]      exactly these commitments
 *   maxChildlessLevel1Ms              no childless level-1 node lasts longer than this
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphState, TopicNode, TranscriptFixture, Utterance } from '@constellate/shared';
import { INTERPRETER } from '@constellate/shared';
import { createInterpreter, type DecisionRecord } from '../src/live';
import type { LlmClient } from '../src/llm/types';
import { memoryDeps, VirtualClock } from '../src/test-utils';

export const FIXTURE_DIR = fileURLToPath(new URL('../../shared/fixtures/transcripts', import.meta.url));

export interface Expect {
  topicCount?: number;
  topicCountRange?: [number, number];
  boundaries?: string[];
  tolerance?: number;
  anchorKeywords?: string[];
  nesting?: { parent: string; child: string }[];
  revisits?: { at: string; of: string }[];
  sameThread?: [string, string][];
  differentThreads?: [string, string][];
  noBoundaryWithin?: [string, string][];
  pending?: { keywords: string[]; raisedAt: string; final: 'unexplored' | 'resolved'; resolvedAt?: string }[];
  commitments?: { keywords: string[]; at: string }[];
  maxChildlessLevel1Ms?: number;
}

export function loadFixtures(only?: string[]): TranscriptFixture[] {
  return readdirSync(FIXTURE_DIR)
    // demo-*.json are demo-account conversations (scripts/seed-demo.ts), not scored scenarios
    .filter((f) => f.endsWith('.json') && !f.startsWith('demo-'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as TranscriptFixture)
    .filter((f) => !only || only.length === 0 || only.some((o) => f.id.startsWith(o)));
}

export function fixtureUtterances(f: TranscriptFixture, conversationId: string): Utterance[] {
  return f.utterances.map((u, i) => ({
    id: `u${i + 1}`,
    conversationId,
    speaker: u.speaker,
    startMs: u.startMs,
    endMs: u.endMs,
    text: u.text,
  }));
}

export interface RunResult {
  fixture: TranscriptFixture;
  state: GraphState;
  records: DecisionRecord[];
  durationMs: number;
  error: string | null;
}

export async function runFixture(
  fixture: TranscriptFixture,
  llm: LlmClient,
  embed: (texts: string[]) => Promise<number[][]>,
  model: string,
  opts: { keepPrompts?: boolean } = {},
): Promise<RunResult> {
  const clock = new VirtualClock();
  const deps = memoryDeps(clock, embed);
  const records: DecisionRecord[] = [];
  const interp = createInterpreter(deps, {
    llm,
    model,
    scheduler: clock,
    keepPrompts: opts.keepPrompts,
    onDecision: (r) => records.push(r),
  });
  const utterances = fixtureUtterances(fixture, deps.conversationId);
  let error: string | null = null;
  try {
    for (const u of utterances) {
      clock.advance(u.endMs);
      await interp.idle();
      interp.pushUtterance(u);
      await interp.idle();
    }
    clock.advance(utterances[utterances.length - 1]!.endMs + 2_000);
    await interp.idle();
    await interp.stop();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { fixture, state: deps.state, records, durationMs: utterances[utterances.length - 1]?.endMs ?? 0, error };
}

// ── scoring ──────────────────────────────────────────────────────────────────

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Score {
  id: string;
  pass: boolean;
  checks: Check[];
  topics: number;
  nodesPerMin: number;
  boundary: { tp: number; produced: number; expected: number } | null;
  threads: { matched: number; produced: number; expected: number } | null;
  revisitOk: boolean | null;
}

const uNum = (id: string) => Number(id.replace(/^u/, ''));

export function topicNodes(state: GraphState): TopicNode[] {
  return Object.values(state.nodes)
    .filter((n) => n.kind === 'topic')
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
}

function firstUtterance(n: TopicNode): number {
  return Math.min(...n.utteranceIds.map(uNum));
}

export function score(run: RunResult): Score {
  const ex = (run.fixture.expect ?? {}) as Expect;
  const tol = ex.tolerance ?? 1;
  const { state } = run;
  const topics = topicNodes(state);
  const holding = (uid: string) => topics.find((n) => n.utteranceIds.includes(uid));
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  const starts = topics
    .slice(1)
    .filter((n) => n.utteranceIds.length > 0)
    .map(firstUtterance);
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  if (run.error) add('ran without error', false, run.error);
  if (ex.topicCount !== undefined)
    add('topic count', topics.length === ex.topicCount, `${topics.length} (want ${ex.topicCount})`);
  if (ex.topicCountRange) {
    const [lo, hi] = ex.topicCountRange;
    add('topic count range', topics.length >= lo && topics.length <= hi, `${topics.length} (want ${lo}–${hi})`);
  }

  let boundary: Score['boundary'] = null;
  if (ex.boundaries) {
    const want = ex.boundaries.map(uNum);
    const used = new Set<number>();
    let tp = 0;
    for (const w of want) {
      const hit = starts.findIndex((s, i) => !used.has(i) && near(s, w));
      if (hit >= 0) {
        used.add(hit);
        tp++;
      }
    }
    boundary = { tp, produced: starts.length, expected: want.length };
    add(
      'boundaries',
      tp === want.length,
      `found ${tp}/${want.length}; starts at ${starts.map((s) => `u${s}`).join(', ') || '—'} (want ${ex.boundaries.join(', ')} ±${tol})`,
    );
  }

  if (ex.anchorKeywords) {
    const a = (state.conversation.macroAnchor ?? '').toLowerCase();
    add(
      'macro anchor',
      ex.anchorKeywords.some((k) => a.includes(k.toLowerCase())),
      `"${state.conversation.macroAnchor ?? ''}"`,
    );
  }

  for (const { parent, child } of ex.nesting ?? []) {
    const p = holding(parent);
    const c = holding(child);
    let ok = false;
    for (
      let n: TopicNode | undefined = c?.parentId ? state.nodes[c.parentId] : undefined;
      n;
      n = n.parentId ? state.nodes[n.parentId] : undefined
    ) {
      if (p && n.threadId === p.threadId) ok = true;
    }
    add(
      `nesting ${parent} ⊃ ${child}`,
      ok,
      `${c?.label ?? '—'} → parent ${c?.parentId ? state.nodes[c.parentId]?.label : '—'} (want under ${p?.label ?? '—'})`,
    );
  }

  let revisitOk: boolean | null = null;
  if (ex.revisits) {
    const edges = Object.values(state.edges).filter((e) => e.kind === 'revisit');
    const matched = new Set<string>();
    let found = 0;
    for (const r of ex.revisits) {
      const target = holding(r.of);
      const e = edges.find((ed) => {
        const src = state.nodes[ed.sourceId];
        const dst = state.nodes[ed.targetId];
        return (
          !matched.has(ed.id) &&
          src &&
          dst &&
          target &&
          near(firstUtterance(src), uNum(r.at)) &&
          dst.threadId === target.threadId
        );
      });
      if (e) {
        matched.add(e.id);
        found++;
      }
    }
    revisitOk = found === ex.revisits.length && edges.length === ex.revisits.length;
    add('revisits', revisitOk, `${edges.length} revisit edge(s), ${found}/${ex.revisits.length} expected found`);
  }

  for (const [a, b] of ex.sameThread ?? []) {
    const na = holding(a);
    const nb = holding(b);
    add(
      `same thread ${a}/${b}`,
      !!na && !!nb && na.threadId === nb.threadId,
      `${na?.label ?? '—'} / ${nb?.label ?? '—'}`,
    );
  }
  for (const [a, b] of ex.differentThreads ?? []) {
    const na = holding(a);
    const nb = holding(b);
    add(
      `different threads ${a}/${b}`,
      !!na && !!nb && na.threadId !== nb.threadId,
      `${na?.label ?? '—'} / ${nb?.label ?? '—'}`,
    );
  }
  for (const [a, b] of ex.noBoundaryWithin ?? []) {
    const bad = starts.filter((s) => s >= uNum(a) && s <= uNum(b));
    add(
      `no boundary in ${a}–${b}`,
      bad.length === 0,
      bad.length ? `starts at ${bad.map((s) => `u${s}`).join(', ')}` : 'none',
    );
  }

  let threads: Score['threads'] = null;
  if (ex.pending) {
    const produced = Object.values(state.nodes).filter((n) => n.kind === 'pending');
    const used = new Set<string>();
    let matched = 0;
    for (const p of ex.pending) {
      const n = produced.find(
        (x) =>
          !used.has(x.id) &&
          p.keywords.some((k) => `${x.label} ${x.summary}`.toLowerCase().includes(k.toLowerCase())) &&
          x.utteranceIds.some((u) => near(uNum(u), uNum(p.raisedAt))),
      );
      if (!n) {
        add(`pending "${p.keywords[0]}"`, false, `no pending thread matching the keywords raised near ${p.raisedAt}`);
        continue;
      }
      used.add(n.id);
      matched++;
      let ok = n.status === p.final;
      let detail = `${n.label}: ${n.status} (want ${p.final})`;
      if (p.resolvedAt) {
        const want = uNum(p.resolvedAt);
        const linked = Object.values(state.edges).some((e) => {
          const t = state.nodes[e.targetId];
          return (
            e.kind === 'tether' &&
            e.sourceId === n.id &&
            t?.kind === 'topic' &&
            t.utteranceIds.some((u) => near(uNum(u), want))
          );
        });
        ok &&= linked;
        detail += linked ? ', linked to the later topic' : ', NOT linked to the later topic';
      }
      add(`pending "${p.keywords[0]}"`, ok, detail);
    }
    threads = { matched, produced: produced.length, expected: ex.pending.length };
    add(
      'pending count',
      produced.length === ex.pending.length,
      `${produced.length} (want ${ex.pending.length})${produced.length ? `: ${produced.map((x) => x.label).join(', ')}` : ''}`,
    );
  }

  if (ex.commitments) {
    const cs = state.commitments;
    // a commitment's atMs is its quote utterance's startMs → map back to the utterance number
    const uttAt = (ms: number) => run.fixture.utterances.findIndex((u) => u.startMs === ms) + 1;
    const used = new Set<string>();
    const matchedAll = ex.commitments.every((c) => {
      const hit = cs.find(
        (x) =>
          !used.has(x.id) &&
          c.keywords.some((k) => x.text.toLowerCase().includes(k.toLowerCase())) &&
          near(uttAt(x.atMs), uNum(c.at)),
      );
      if (hit) used.add(hit.id);
      return !!hit;
    });
    const ok = cs.length === ex.commitments.length && matchedAll;
    add(
      'commitments',
      ok,
      `${cs.length ? cs.map((c) => `"${c.text}"`).join(', ') : 'none'} (want ${ex.commitments.length})`,
    );
  }

  if (ex.maxChildlessLevel1Ms !== undefined) {
    const long = topics.filter(
      (n) =>
        n.level === 1 &&
        !topics.some((c) => c.parentId === n.id) &&
        (n.endMs ?? run.durationMs) - n.startMs > ex.maxChildlessLevel1Ms!,
    );
    add(
      'no long childless level-1 node',
      long.length === 0,
      long.length
        ? long.map((n) => `${n.label} ${Math.round(((n.endMs ?? run.durationMs) - n.startMs) / 1000)} s`).join(', ')
        : 'ok',
    );
  }

  const minutes = run.durationMs / 60_000;
  return {
    id: run.fixture.id,
    pass: checks.every((c) => c.pass),
    checks,
    topics: topics.length,
    nodesPerMin: minutes > 0 ? topics.length / minutes : 0,
    boundary,
    threads,
    revisitOk,
  };
}

// ── report ───────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function outline(state: GraphState): string {
  const nodes = Object.values(state.nodes).sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  const revisitOf = new Map(
    Object.values(state.edges)
      .filter((e) => e.kind === 'revisit')
      .map((e) => [e.sourceId, e.targetId]),
  );
  const lines = [`anchor: ${state.conversation.macroAnchor ?? '(none)'}`];
  for (const n of nodes) {
    const ids = n.utteranceIds.map(uNum).sort((a, b) => a - b);
    const range = ids.length ? `u${ids[0]}–u${ids[ids.length - 1]}` : '';
    if (n.kind === 'topic') {
      const back = revisitOf.get(n.id);
      const mark = back ? ` ↺ revisits "${state.nodes[back]?.label}"` : '';
      lines.push(
        `${'  '.repeat(n.level - 1)}- [L${n.level}] ${n.label} (${fmt(n.startMs)}, ${range})${mark} — ${n.summary}`,
      );
    } else {
      const tethers = Object.values(state.edges)
        .filter((e) => e.kind === 'tether' && e.sourceId === n.id)
        .map((e) => state.nodes[e.targetId]?.label);
      lines.push(
        `- (${n.kind}, ${n.status}) ${n.label} at ${fmt(n.startMs)}${tethers.length ? ` → discussed in "${tethers.join('", "')}"` : ''}`,
      );
    }
  }
  for (const c of state.commitments) lines.push(`- (promise) "${c.text}" at ${fmt(c.atMs)}`);
  return lines.join('\n');
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export interface Summary {
  passed: number;
  total: number;
  p50: number;
  p95: number;
  boundaryP: number;
  boundaryR: number;
  threadP: number;
  threadR: number;
  revisitAcc: number;
  nodesPerMin: number;
  tokensPerMin: number;
  calls: number;
  failedCalls: number;
  retries: number;
  gate: boolean;
}

export function summarise(runs: RunResult[], scores: Score[]): Summary {
  const lat = runs.flatMap((r) => r.records.filter((d) => d.decision).map((d) => d.ms));
  const sum = (f: (s: Score) => number) => scores.reduce((a, s) => a + f(s), 0);
  const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b);
  const minutes = runs.reduce((a, r) => a + r.durationMs, 0) / 60_000;
  const tokens = runs.reduce((a, r) => a + r.records.reduce((b, d) => b + d.inTok + d.outTok, 0), 0);
  const rv = scores.filter((s) => s.revisitOk !== null);
  const passed = scores.filter((s) => s.pass).length;
  const p50 = percentile(lat, 50);
  return {
    passed,
    total: scores.length,
    p50,
    p95: percentile(lat, 95),
    boundaryP: ratio(
      sum((s) => s.boundary?.tp ?? 0),
      sum((s) => s.boundary?.produced ?? 0),
    ),
    boundaryR: ratio(
      sum((s) => s.boundary?.tp ?? 0),
      sum((s) => s.boundary?.expected ?? 0),
    ),
    threadP: ratio(
      sum((s) => s.threads?.matched ?? 0),
      sum((s) => s.threads?.produced ?? 0),
    ),
    threadR: ratio(
      sum((s) => s.threads?.matched ?? 0),
      sum((s) => s.threads?.expected ?? 0),
    ),
    revisitAcc: ratio(rv.filter((s) => s.revisitOk).length, rv.length),
    nodesPerMin: ratio(
      sum((s) => s.topics),
      minutes,
    ),
    tokensPerMin: ratio(tokens, minutes),
    calls: runs.reduce((a, r) => a + r.records.length, 0),
    failedCalls: runs.reduce((a, r) => a + r.records.filter((d) => !d.decision).length, 0),
    retries: runs.reduce((a, r) => a + r.records.filter((d) => d.attempts > 1).length, 0),
    gate: passed >= Math.min(8, scores.length) && scores.length >= 10 && p50 < 3_000,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function renderReport(opts: {
  provider: string;
  model: string;
  mode: string;
  note?: string;
  runs: RunResult[];
  scores: Score[];
}): string {
  const s = summarise(opts.runs, opts.scores);
  const target = 60 / INTERPRETER.targetSecondsPerNode;
  const out: string[] = [];
  out.push(`# Interpreter eval — ${opts.provider} (${opts.model})`, '');
  out.push(`- When: ${new Date().toISOString()}  ·  mode: ${opts.mode}`);
  if (opts.note) out.push(`- Change under test: ${opts.note}`);
  out.push(
    `- **Scenarios passed: ${s.passed}/${s.total}**  ·  release gate (≥ 8/10, median < 3 s): **${s.gate ? 'PASS' : 'FAIL'}**`,
    `- Decision latency p50 ${(s.p50 / 1000).toFixed(2)} s · p95 ${(s.p95 / 1000).toFixed(2)} s · ${s.calls} calls (${s.retries} retried, ${s.failedCalls} skipped)`,
    `- Boundary precision ${pct(s.boundaryP)} · recall ${pct(s.boundaryR)} (±1 utterance) · revisit accuracy ${pct(s.revisitAcc)} · thread precision ${pct(s.threadP)} · recall ${pct(s.threadR)}`,
    `- Nodes per minute ${s.nodesPerMin.toFixed(2)} (target ≈ ${target.toFixed(2)}) · tokens per minute ${Math.round(s.tokensPerMin)}`,
    '',
    '| Scenario | Result | Topics | Nodes/min | p50 latency | Failed checks |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  opts.scores.forEach((sc, i) => {
    const lat = percentile(
      opts.runs[i]!.records.filter((d) => d.decision).map((d) => d.ms),
      50,
    );
    const failed =
      sc.checks
        .filter((c) => !c.pass)
        .map((c) => `${c.name}: ${c.detail}`)
        .join('; ') || '—';
    out.push(
      `| ${sc.id} | ${sc.pass ? 'pass' : '**FAIL**'} | ${sc.topics} | ${sc.nodesPerMin.toFixed(2)} | ${(lat / 1000).toFixed(2)} s | ${failed.replace(/\|/g, '/')} |`,
    );
  });
  out.push('');
  opts.scores.forEach((sc, i) => {
    const run = opts.runs[i]!;
    out.push(`## ${sc.id} — ${sc.pass ? 'pass' : 'FAIL'}`, '');
    for (const c of sc.checks) out.push(`- ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`);
    const errs = run.records.filter((d) => d.error || d.warnings.length);
    for (const d of errs)
      out.push(
        `- note (${d.windowIds[0]}…${d.windowIds[d.windowIds.length - 1]}): ${[d.error, ...d.warnings].filter(Boolean).join('; ')}`,
      );
    out.push('', '```', outline(run.state), '```', '');
  });
  return out.join('\n');
}
