/**
 * Interpreter evaluation CLI. Reasoning runs on Claude only; Gemini is used only for embeddings,
 * under a hard cap of 150 embedding requests per Pacific day (AGENTS.md › API budget).
 *
 *   pnpm eval                      = --cached: reuse every recorded Claude answer and embedding; only
 *                                    text that changed is embedded, all of a fixture's new texts in
 *                                    one batched request per pass
 *     --only 03,07                 a subset (comma-separated id prefixes)
 *     --note "what changed"        recorded in the report
 *     --resample                   fresh Claude answers (a second sample); embeddings stay reused
 *     --score-against <git ref>    also score the runs with that ref's fixture expectations
 *     --timeout-min 15             hard timeout (a PID file also stops a second run from starting)
 *     --record                     full re-record of Claude answers AND embeddings (needs the
 *                                  humans' OK: it spends the embedding quota)
 *   pnpm eval:replay               recordings only, no network; exit 1 on any miss
 *
 * Each report states the run's Gemini requests and the day's total against the cap.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from '@constellate/shared';
import {
  createAnthropicClient,
  createGeminiEmbedder,
  createReplayClient,
  createReplayEmbedder,
  geminiUsage,
  createDailyCap,
  EVAL_EMBED_CAP_PER_DAY,
  flushDeferred,
  newReplayStore,
  pruneUnused,
  type ReplayMode,
} from '../src/llm';
import { tuning } from '../src/llm/anthropic';
import { loadFixtures, renderReport, runFixture, score, summarise, type RunResult } from './harness';
import { guardProcess } from './guard';
import { RECORDINGS } from './recordings-path';

export { RECORDINGS } from './recordings-path';
const REPORTS = fileURLToPath(new URL('./reports', import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  // PR #25: a timeout and a PID-file guard, so a stopped shell can't leave a run spending quota
  try {
    guardProcess(join(RECORDINGS, '..', '.cache', 'eval.pid'), Number(arg('timeout-min') ?? 15) * 60_000);
  } catch (e) {
    console.error(`[eval] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  if ((arg('provider') && arg('provider') !== 'anthropic') || arg('model')) {
    console.error('[eval] Gemini text models are off-budget (AGENTS.md › API budget); the eval runs on Claude only.');
    process.exitCode = 1;
    return;
  }
  const replay = flag('replay');
  const record = flag('record');
  if (flag('fresh')) console.warn('[eval] --fresh is gone: the default is --cached; --record re-records everything.');
  // --resample: a fresh Claude sample (for the >= 2 samples rule); embeddings stay reused
  const llmMode: ReplayMode = replay ? 'replay' : record || flag('resample') ? 'record' : 'auto';
  // misses are collected per fixture pass and embedded in one batched request (flushDeferred)
  const embedMode: ReplayMode = replay ? 'replay' : record ? 'record' : 'defer';
  const cap = createDailyCap({ limit: EVAL_EMBED_CAP_PER_DAY });
  const models: string[] = [MODELS.interpreter.anthropic, ...(flag('compare') ? [MODELS.refine] : [])];
  const fixtures = loadFixtures(arg('only')?.split(','));
  const store = newReplayStore();
  const gemini = replay ? null : createGeminiEmbedder({ cap, log: (e, d) => console.warn(`[eval] ${e}`, d ?? {}) });
  const embed = createReplayEmbedder(gemini, RECORDINGS, embedMode, store);
  const flushEmbeddings = gemini && embedMode === 'defer' ? () => flushDeferred(store, gemini, RECORDINGS) : undefined;
  const claude = replay ? null : createAnthropicClient();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let gateFailed = false;

  for (const model of models) {
    const llm = createReplayClient(claude, RECORDINGS, llmMode, store, tuning);
    // later passes of --resample reuse the answers pass 1 just recorded
    const reuse = createReplayClient(claude, RECORDINGS, 'auto', store, tuning);
    const runs: RunResult[] = [];
    for (const f of fixtures) {
      process.stdout.write(`[eval] ${model} ${f.id} … `);
      const run = await runFixture(f, llm, embed, model, {
        flushEmbeddings,
        llmForPass: flag('resample') ? (pass) => (pass === 1 ? llm : reuse) : undefined,
      });
      const sc = score(run);
      console.log(
        `${sc.pass ? 'pass' : 'FAIL'} (${sc.topics} topics, ${run.records.length} calls${run.error ? `, error: ${run.error}` : ''})`,
      );
      runs.push(run);
    }
    const scores = runs.map(score);
    // --score-against <git ref>: the same runs scored with that ref's fixture expectations
    const ref = arg('score-against');
    const extra: string[] = [];
    if (ref) {
      const old = runs.map((r) => {
        const raw = execFileSync('git', ['show', `${ref}:packages/shared/fixtures/transcripts/${r.fixture.id}.json`], {
          encoding: 'utf8',
        });
        const expect = (JSON.parse(raw) as { expect?: Record<string, unknown> }).expect;
        return score({ ...r, fixture: { ...r.fixture, expect } });
      });
      const failed = old.filter((o) => !o.pass).map((o) => o.id);
      extra.push(
        `Same runs scored with the fixture expectations at \`${ref}\`: ${old.length - failed.length}/${old.length} passed${failed.length ? ` (failing: ${failed.join(', ')})` : ''}`,
      );
      console.log(`[eval] ${extra[extra.length - 1]}`);
    }
    const s = summarise(runs, scores);
    const usage = geminiUsage()[MODELS.embed] ?? { requests: 0, items: 0, throttled: 0 };
    const budget = `Gemini requests this run: ${usage.requests} embedding request(s) for ${usage.items} new text(s), ${usage.throttled} throttled, 0 text-model requests; today (Pacific) ${cap.used(MODELS.embed)}/${cap.limit} embedding requests on the eval cap`;
    console.log(
      `[eval] ${model}: ${s.passed}/${s.total} passed · p50 ${(s.p50 / 1000).toFixed(2)} s · p95 ${(s.p95 / 1000).toFixed(2)} s · gate ${s.gate ? 'PASS' : 'FAIL'}`,
    );
    console.log(`[eval] ${budget}`);
    if (!replay || flag('report')) {
      mkdirSync(REPORTS, { recursive: true });
      const file = join(REPORTS, `${stamp}-${model}.md`);
      const mode = replay ? 'replay (cache only)' : llmMode === 'record' ? 'fresh LLM calls' : 'cached where possible';
      writeFileSync(
        file,
        renderReport({
          provider: 'anthropic',
          model,
          mode,
          note: arg('note'),
          extra: [budget, ...extra],
          runs,
          scores,
        }),
      );
      console.log(`[eval] report: ${file}`);
    }
    if (model === MODELS.interpreter.anthropic && !s.gate) gateFailed = true;
  }

  if (!replay && !arg('only')) pruneUnused(store);
  if (replay && store.misses > 0) {
    console.error(`[eval] replay: ${store.misses} request(s) had no cached response; run \`pnpm eval\` first.`);
    process.exitCode = 1;
  }
  if (gateFailed && !flag('no-gate')) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
