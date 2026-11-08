/**
 * Seed the demo account with the five demo-* conversations through the real pipeline
 * (A1's seed.ts: replay → interpreter → persistence → finalisation → Brain build).
 *
 *   pnpm tsx scripts/seed-demo.ts --estimate
 *       no network: the dry run with a counting embedder → distinct texts and expected requests
 *
 *   pnpm tsx scripts/seed-demo.ts --dry-run
 *       fakes only (in-memory store, stand-in model answers, offline vectors): no network, no database
 *
 *   EMBEDDINGS=gemini pnpm tsx --env-file=.env scripts/seed-demo.ts --user <demo-account-uuid> --confirm-h10 [--skip-existing] [--only a,b]
 *       THE REAL RUN — humans only, once, at H10. Writes to the shared database, calls Claude and up
 *       to a few hundred Gemini embedding requests (the server's 500/day cap applies). Reuses the eval
 *       recordings and the server's embedding cache where texts match, and prints the requests used.
 *
 * Replay is paced and clock-free in both modes (seed-demo-lib: pacedReplaySpeech): speech-to-text is
 * skipped in transcript replay anyway, and everything after it is the real interpreter → finalisation
 * → Brain pipeline. A1's wall-clock replay could drop opening utterances under load (#63).
 *
 * --skip-existing leaves out fixtures the demo user already has a ready conversation from (matched by
 * the first utterance; titles are rewritten by finalisation) and prints them; --only seeds just the
 * listed fixtures. Both work with --dry-run and --estimate too.
 *
 * A PID file stops a second run from starting, and a hard timeout (30 min) ends a stuck run
 * (AGENTS.md › API budget: interrupting a command does not stop the process it started).
 */
import { join } from 'node:path';
import { guardProcess } from '../packages/interpreter/eval/guard';
import { RECORDINGS } from '../packages/interpreter/eval/recordings-path';
import {
  DRY_RUN_USER,
  dryRunRuntime,
  estimateEmbeddings,
  parseArgs,
  realRuntime,
  refusal,
  seedDemo,
  withEvalCache,
} from './seed-demo-lib';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const why = refusal(args, process.env);
  if (why) {
    console.error(`[seed] ${why}`);
    process.exitCode = 1;
    return;
  }
  const fixtures = args.only ?? undefined;
  if (args.estimate) {
    const e = await estimateEmbeddings(fixtures);
    for (const c of e.perConversation)
      console.log(`[estimate] ${c.fixture}: ${c.requests} request(s), ${c.texts} new text(s)`);
    console.log(
      `[estimate] ${e.conversations} conversations: ${e.distinctTexts} distinct texts, about ${e.requests} embedding requests (batched; no network used for this estimate)`,
    );
    return;
  }
  guardProcess(join(RECORDINGS, '..', '.cache', 'seed-demo.pid'), 30 * 60_000);
  if (args.dryRun) {
    const summary = await seedDemo(dryRunRuntime(), DRY_RUN_USER, { fixtures, skipExisting: args.skipExisting });
    console.log(`[seed] dry run done: ${summary.conversations.length} conversations, no network, nothing persisted`);
    return;
  }
  const { rt, stats } = withEvalCache(realRuntime());
  await seedDemo(rt, args.userId!, { evalStats: stats, fixtures, skipExisting: args.skipExisting });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
