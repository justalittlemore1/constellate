/**
 * Interpreter evaluation harness (A2 implements). Contract for its behaviour:
 *
 *   pnpm eval                 run every transcript fixture through the real interpreter with live LLM calls
 *                             (INTERPRETER_PROVIDER, or --provider gemini|anthropic|both)
 *   pnpm eval:replay          same, using recorded LLM responses from eval/.cache — deterministic, used in CI
 *
 * Writes eval/reports/<timestamp>-<provider>.md with, per scenario: pass/fail against `expect`,
 * boundary precision/recall (±tolerance utterances), revisit accuracy, thread precision/recall,
 * nodes per minute vs target, decision latency p50/p95, tokens per minute, and the produced graph
 * as an indented outline. Exit code 1 if the release gate fails (see docs/PLAN.md, testing section).
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../shared/fixtures/transcripts', import.meta.url));
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json'));
const replay = process.argv.includes('--replay');

console.log(`[eval stub] ${fixtures.length} transcript fixture(s) found; mode=${replay ? 'replay' : 'live'}.`);
console.log('[eval stub] Not implemented yet — A2 owns this harness. See docs/briefs/a2-interpreter.md.');
