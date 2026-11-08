import { describe, expect, it } from 'vitest';
import { makeGraph } from '@constellate/shared/testing';
import type { GraphOp, InterpreterDeps } from '@constellate/shared';
import { createLiveInterpreter, finalizeConversation } from './index';

function fakeDeps(): InterpreterDeps & { emitted: GraphOp[][] } {
  const emitted: GraphOp[][] = [];
  let n = 0;
  return {
    emitted,
    conversationId: 'c1',
    getState: () => makeGraph(),
    emit: (ops) => emitted.push(ops),
    newId: () => `id-${++n}`,
    embed: async (texts) => texts.map(() => new Array(768).fill(0)),
    matchNodes: async () => [],
    saveEmbedding: async () => {},
    nowMs: () => 0,
  };
}

// Contract smoke test: keeps the public API callable as A2 replaces the stub.
describe('interpreter public API', () => {
  it('accepts utterances, parks and stops without throwing', async () => {
    const deps = fakeDeps();
    const interp = createLiveInterpreter(deps);
    interp.pushUtterance({ id: 'u1', conversationId: 'c1', speaker: null, startMs: 0, endMs: 1000, text: 'hello' });
    interp.park('ask about soccer', 500);
    await expect(interp.stop()).resolves.toBeUndefined();
  });

  it('finalize returns ops and recall prompts', async () => {
    const r = await finalizeConversation({ state: makeGraph(), utterances: [], newId: () => 'x' });
    expect(Array.isArray(r.ops)).toBe(true);
    expect(Array.isArray(r.recallPrompts)).toBe(true);
  });
});
