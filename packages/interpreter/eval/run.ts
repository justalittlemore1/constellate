/**
 * Interpreter evaluation CLI. Reasoning runs on Claude only (AGENTS.md › API budget, issue #12):
 * there is no Gemini text-model path. Gemini is used only for embeddings, which are recorded in
 * eval/recordings by a hash of the text and reused, so repeat runs cost nothing.
 *
 *   pnpm eval                      every fixture on MODELS.interpreter.anthropic, reusing recordings
 *     --only 03,07                 a subset (comma-separated id prefixes)
 *     --fresh                      ignore recorded LLM answers (fresh latency); embeddings stay reused
 *     --note "what changed"        recorded in the report
 *   pnpm eval:replay               recordings only, no network; exit 1 on any miss
 *
 * Each report states how many Gemini embedding requests the run made. Exit code 1 if the release
 * gate fails.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from '@constellate/shared';
import {
  createAnthropicClient,
  createGeminiEmbedder,
  createReplayClient,
  createReplayEmbedder,
  geminiUsage,
  newReplayStore,
  type ReplayMode,
  type ReplayStore,
} from '../src/llm';
import { loadFixtures, renderReport, runFixture, score, summarise, type RunResult } from './harness';

export { RECORDINGS } from './recordings-path';
import { RECORDINGS } from './recordings-path';
const REPORTS = fileURLToPath(new URL('./reports', import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

async function main() {
  const asked = arg('provider');
  if ((asked && asked !== 'anthropic') || arg('model')) {
    console.error(
      '[eval] Gemini text models are off-budget (AGENTS.md › API budget, #12): the eval runs on Claude only.',
    );
    process.exitCode = 1;
    return;
  }
  const replay = flag('replay');
  // LLM answers: reuse unless --fresh. Embeddings: always reuse (1,000/day quota).
  const llmMode: ReplayMode = replay ? 'replay' : flag('fresh') ? 'record' : 'auto';
  const embedMode: ReplayMode = replay ? 'replay' : 'auto';
  const only = arg('only')?.split(',');
  const fixtures = loadFixtures(only);
  const store: ReplayStore = newReplayStore();
  const embed = createReplayEmbedder(replay ? null : createGeminiEmbedder(), RECORDINGS, embedMode, store);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const model = MODELS.interpreter.anthropic;

  if (replay && !existsSync(join(RECORDINGS, safe(model)))) {
    console.error(`[eval] replay: no recordings for ${model}. Run \`pnpm eval\` first.`);
    process.exitCode = 1;
    return;
  }
  const llm = createReplayClient(replay ? null : createAnthropicClient(), RECORDINGS, llmMode, store);
  const runs: RunResult[] = [];
  for (const f of fixtures) {
    process.stdout.write(`[eval] ${model} ${f.id} … `);
    const run = await runFixture(f, llm, embed, model);
    const sc = score(run);
    console.log(
      `${sc.pass ? 'pass' : 'FAIL'} (${sc.topics} topics, ${run.records.length} calls${run.error ? `, error: ${run.error}` : ''})`,
    );
    runs.push(run);
  }
  const scores = runs.map(score);
  const s = summarise(runs, scores);
  const usage = geminiUsage()[MODELS.embed] ?? { requests: 0, items: 0, throttled: 0 };
  const budget = `Gemini requests this run: ${usage.requests} embedding request(s) for ${usage.items} new text(s), ${usage.throttled} throttled; 0 Gemini text-model requests`;
  console.log(
    `[eval] ${model}: ${s.passed}/${s.total} passed · p50 ${(s.p50 / 1000).toFixed(2)} s · p95 ${(s.p95 / 1000).toFixed(2)} s · gate ${s.gate ? 'PASS' : 'FAIL'}`,
  );
  console.log(`[eval] ${budget}`);
  if (!replay || flag('report')) {
    mkdirSync(REPORTS, { recursive: true });
    const file = join(REPORTS, `${stamp}-${model}.md`);
    const mode = replay ? 'replay' : llmMode === 'record' ? 'fresh LLM calls' : 'recordings reused';
    writeFileSync(
      file,
      renderReport({ provider: 'anthropic', model, mode, note: arg('note'), extra: [budget], runs, scores }),
    );
    console.log(`[eval] report: ${file}`);
  }

  // A full run keeps the recordings in step with the current prompt.
  if (!replay && !only) pruneUnused(store);
  if (replay && store.misses > 0) {
    console.error(`[eval] replay: ${store.misses} request(s) had no recording; re-run \`pnpm eval\`.`);
    process.exitCode = 1;
  }
  if (!s.gate && !flag('no-gate')) process.exitCode = 1;
}

function pruneUnused(store: ReplayStore) {
  const dirs = new Set([...store.used].map((f) => dirname(f)));
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (!store.used.has(p)) rmSync(p);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
