/**
 * Interpreter evaluation CLI.
 *
 *   pnpm eval                      live LLM + embedding calls for every fixture; records responses
 *                                  (--provider gemini|anthropic|both, default both; --model fast;
 *                                  --only 03,07; --note "what changed"; --cached reuses recordings)
 *   pnpm eval:replay               recorded responses only (eval/recordings) — deterministic, no keys
 *
 * Writes eval/reports/<timestamp>-<provider>.md. Exit code 1 if the release gate fails for the
 * provider in INTERPRETER_PROVIDER (default gemini). Replay mode writes no report unless --report
 * is given, so CI does not create files.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, type InterpreterProvider } from '@constellate/shared';
import {
  createGeminiEmbedder,
  createLlmClient,
  createReplayClient,
  createReplayEmbedder,
  newReplayStore,
  providerFromEnv,
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
  const replay = flag('replay');
  const mode: ReplayMode = replay ? 'replay' : flag('cached') ? 'auto' : 'record';
  const which = arg('provider') ?? 'both';
  const providers: InterpreterProvider[] = which === 'both' ? ['gemini', 'anthropic'] : [which as InterpreterProvider];
  const only = arg('only')?.split(',');
  const fixtures = loadFixtures(only);
  const store: ReplayStore = newReplayStore();
  let ran = 0;
  const embed = createReplayEmbedder(mode === 'replay' ? null : createGeminiEmbedder(), RECORDINGS, mode, store);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const gateProvider = providerFromEnv();
  let gateFailed = false;

  for (const provider of providers) {
    const fast = arg('model') === 'fast';
    const model = fast ? MODELS.interpreter.fast : MODELS.interpreter[provider];
    if (replay && !existsSync(join(RECORDINGS, safe(model)))) {
      console.log(`[eval] ${provider}: no recordings for ${model}, skipped`);
      continue;
    }
    const llm = createReplayClient(
      mode === 'replay' ? null : createLlmClient(fast ? 'gemini' : provider),
      RECORDINGS,
      mode,
      store,
    );
    ran++;
    const runs: RunResult[] = [];
    for (const f of fixtures) {
      process.stdout.write(`[eval] ${provider} ${f.id} … `);
      const run = await runFixture(f, llm, embed, model);
      const sc = score(run);
      console.log(
        `${sc.pass ? 'pass' : 'FAIL'} (${sc.topics} topics, ${run.records.length} calls${run.error ? `, error: ${run.error}` : ''})`,
      );
      runs.push(run);
    }
    const scores = runs.map(score);
    const s = summarise(runs, scores);
    console.log(
      `[eval] ${provider}: ${s.passed}/${s.total} passed · p50 ${(s.p50 / 1000).toFixed(2)} s · p95 ${(s.p95 / 1000).toFixed(2)} s · gate ${s.gate ? 'PASS' : 'FAIL'}`,
    );
    if (!replay || flag('report')) {
      mkdirSync(REPORTS, { recursive: true });
      const file = join(REPORTS, `${stamp}-${provider}${fast ? '-fast' : ''}.md`);
      writeFileSync(file, renderReport({ provider, model, mode, note: arg('note'), runs, scores }));
      console.log(`[eval] report: ${file}`);
    }
    if (provider === gateProvider && !s.gate) gateFailed = true;
  }

  // A full recording run replaces the previous recordings of the models (and embeddings) it used.
  if (mode === 'record' && !only && which === 'both') pruneUnused(store);
  if (replay && ran === 0) {
    console.error('[eval] replay: no recordings for any provider. Run `pnpm eval` with API keys first.');
    process.exitCode = 1;
  }
  if (replay && store.misses > 0) {
    console.error(`[eval] replay: ${store.misses} request(s) had no recording; re-run \`pnpm eval\`.`);
    process.exitCode = 1;
  }
  if (gateFailed && !flag('no-gate')) process.exitCode = 1;
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
