/**
 * Fixture loaders for mock mode (VITE_USE_MOCKS=1) and tests. Built on the shared contract fixtures,
 * so the UI is developed against exactly the data shapes the server will send.
 */
import { GraphStateSchema, OpBatchSchema, type GraphState, type OpBatch } from '@constellate/shared';
import demoGraph from '@constellate/shared/fixtures/graphs/religion-demo.json';
import demoOps from '@constellate/shared/fixtures/ops/religion-demo.jsonl?raw';

export function loadDemoGraph(): GraphState {
  return GraphStateSchema.parse(demoGraph);
}

/** Timed op batches; replay them by the difference between consecutive `at` values. */
export function loadDemoOps(): OpBatch[] {
  return demoOps
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => OpBatchSchema.parse(JSON.parse(l)));
}
