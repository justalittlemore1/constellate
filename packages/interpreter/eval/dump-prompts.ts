/** Offline: replay one fixture from recordings and print each packed prompt and decision. */
import { MODELS } from '@constellate/shared';
import { tuning } from '../src/llm/anthropic';
import { createReplayClient, createReplayEmbedder, newReplayStore } from '../src/llm/replay';
import { loadFixtures, runFixture } from './harness';
import { RECORDINGS } from './recordings-path';
const id = process.argv[2] ?? '07';
const rs = newReplayStore();
const [f] = loadFixtures([id]);
const run = await runFixture(
  f!,
  createReplayClient(null, RECORDINGS, 'replay', rs, tuning),
  createReplayEmbedder(null, RECORDINGS, 'replay', rs),
  MODELS.interpreter.anthropic,
  { keepPrompts: true },
);
for (const r of run.records) {
  console.log('=====', r.windowIds.join(','), r.error ?? '');
  console.log(r.prompt?.split('ROLLING SUMMARY')[0]);
  console.log('DECISION', JSON.stringify(r.decision));
}
console.log('misses', rs.misses);
