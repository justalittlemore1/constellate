/** Offline: replay every fixture from recordings and count misses by kind (no API calls). */
import { MODELS } from '@constellate/shared';
import { tuning } from '../src/llm/anthropic';
import { createReplayClient, createReplayEmbedder, newReplayStore } from '../src/llm/replay';
import { loadFixtures, runFixture } from './harness';
import { RECORDINGS } from './recordings-path';
for (const f of loadFixtures()) {
  const llmRs = newReplayStore();
  const embRs = newReplayStore();
  await runFixture(
    f,
    createReplayClient(null, RECORDINGS, 'replay', llmRs, tuning),
    createReplayEmbedder(null, RECORDINGS, 'replay', embRs),
    MODELS.interpreter.anthropic,
  );
  console.log(`${f.id}: ${llmRs.misses} Claude misses, ${embRs.misses} embedding misses`);
}
