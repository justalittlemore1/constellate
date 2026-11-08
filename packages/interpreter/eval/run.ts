/**
 * Interpreter evaluation CLI. Reasoning runs on Claude only; Gemini is used just for embeddings
 * (AGENTS.md › API budget), and every LLM and embedding response is recorded in eval/recordings
 * (committed) by a hash of its input, so a repeat run with unchanged prompts costs nothing and
 * `eval:replay` works with no keys. A full run (no --only) drops recordings it no longer used.
 *
 *   pnpm eval                      every fixture on MODELS.interpreter.anthropic (cached where possible)
 *     --compare                    also run MODELS.refine on Claude as a second opinion
 *     --only 03,07                 a subset (comma-separated id prefixes)
 *     --fresh                      bypass recorded LLM answers (fresh latency; embeddings stay reused)
 *     --cached                     the default: reuse every recorded answer and embedding
 *     --note "what changed"        recorded in the report
 *   pnpm eval:replay               cache only, no network; exit 1 on any miss
 *
 * Writes eval/reports/<timestamp>-<model>.md (not in replay mode unless --report) and prints how many
 * Gemini requests the run made. Exit code 1 if the release gate fails for the default model.
 */
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
  newReplayStore,
  pruneUnused,
  type ReplayMode,
} from '../src/llm';
import { loadFixtures, renderReport, runFixture, score, summarise, type RunResult } from './harness';
import { RECORDINGS } from './recordings-path';

export { RECORDINGS } from './recordings-path';
const REPORTS = fileURLToPath(new URL('./reports', import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if ((arg('provider') && arg('provider') !== 'anthropic') || arg('model')) {
    console.error('[eval] Gemini text models are off-budget (AGENTS.md › API budget); the eval runs on Claude only.');
    process.exitCode = 1;
    return;
  }
  const replay = flag('replay');
  const llmMode: ReplayMode = replay ? 'replay' : flag('fresh') ? 'record' : 'auto';
  const embedMode: ReplayMode = replay ? 'replay' : 'auto';
  const models: string[] = [MODELS.interpreter.anthropic, ...(flag('compare') ? [MODELS.refine] : [])];
  const fixtures = loadFixtures(arg('only')?.split(','));
  const store = newReplayStore();
  const embed = createReplayEmbedder(replay ? null : createGeminiEmbedder(), RECORDINGS, embedMode, store);
  const claude = replay ? null : createAnthropicClient();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let gateFailed = false;

  for (const model of models) {
    const llm = createReplayClient(claude, RECORDINGS, llmMode, store);
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
    const budget = `Gemini requests so far this run: ${usage.requests} embedding request(s) for ${usage.items} new text(s), ${usage.throttled} throttled; 0 Gemini text-model requests (cache: ${RECORDINGS.split(/[\\/]/).slice(-2).join('/')})`;
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
        renderReport({ provider: 'anthropic', model, mode, note: arg('note'), extra: [budget], runs, scores }),
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
