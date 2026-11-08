/**
 * Fixture loaders for mock mode (VITE_USE_MOCKS=1) and tests. Built on the shared contract fixtures,
 * so the UI is developed against exactly the data shapes the server will send.
 */
import {
  GraphStateSchema,
  OpBatchSchema,
  UtteranceSchema,
  type GraphState,
  type OpBatch,
  type Utterance,
} from '@constellate/shared';
import demoGraph from '@constellate/shared/fixtures/graphs/religion-demo.json';
import demoOps from '@constellate/shared/fixtures/ops/religion-demo.jsonl?raw';
import breadDemo from './mockDemos/demo-bread.json';
import religionDemo from './mockDemos/demo-religion.json';
import travelDemo from './mockDemos/demo-travel.json';

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

export interface MockDemo {
  graph: GraphState;
  utterances: Utterance[];
}

/**
 * Mock mode only: the three conversations the humans kept in the real demo account, exported
 * read-only from the server's store (fixture transcript → Claude interpreter → finalisation, so real
 * pipeline output, not hand-made). Owned by the mock user, like the contract demo graph. Unit tests
 * keep using `loadDemoGraph()` alone.
 */
export function loadMockDemos(): MockDemo[] {
  const userId = loadDemoGraph().conversation.userId;
  return [breadDemo, travelDemo, religionDemo].map((d) => {
    const graph = GraphStateSchema.parse(d.graph);
    return {
      graph: { ...graph, conversation: { ...graph.conversation, userId } },
      utterances: UtteranceSchema.array().parse(d.utterances),
    };
  });
}
