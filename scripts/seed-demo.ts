/**
 * Seed the demo account with the five demo-* conversations through the real pipeline
 * (A1's seed.ts: replay → interpreter → persistence → finalisation → Brain build).
 *
 *   pnpm tsx scripts/seed-demo.ts --dry-run
 *       fakes only (in-memory store, stand-in model answers, offline vectors): no network, no database
 *
 *   EMBEDDINGS=gemini pnpm tsx --env-file=.env scripts/seed-demo.ts --user <demo-account-uuid> --confirm-h10
 *       THE REAL RUN — humans only, once, at H10. Writes to the shared database, calls Claude and up
 *       to a few hundred Gemini embedding requests (the server's 500/day cap applies). Reuses the eval
 *       recordings and the server's embedding cache where texts match, and prints the requests used.
 *
 * A PID file stops a second run from starting, and a hard timeout (30 min) ends a stuck run
 * (AGENTS.md › API budget: interrupting a command does not stop the process it started).
 */
import { join } from 'node:path';
import { guardProcess } from '../packages/interpreter/eval/guard';
import { RECORDINGS } from '../packages/interpreter/eval/recordings-path';
import { createRuntime } from '../apps/server/src/seed';
import { DRY_RUN_USER, dryRunRuntime, parseArgs, refusal, seedDemo, withEvalCache } from './seed-demo-lib';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const why = refusal(args, process.env);
  if (why) {
    console.error(`[seed] ${why}`);
    process.exitCode = 1;
    return;
  }
  guardProcess(join(RECORDINGS, '..', '.cache', 'seed-demo.pid'), 30 * 60_000);
  if (args.dryRun) {
    const summary = await seedDemo(dryRunRuntime(), DRY_RUN_USER);
    console.log(`[seed] dry run done: ${summary.conversations.length} conversations, no network, nothing persisted`);
    return;
  }
  const { rt, stats } = withEvalCache(createRuntime());
  await seedDemo(rt, args.userId!, { evalStats: stats });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
