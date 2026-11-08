import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';
import { createRuntime, rebuildBrainFor, seedFixtureConversation } from './seed';
import { MemoryStore } from './store/memory';
import { fakeAuth, stubInterpreter, unitVector, USER_A } from './test-utils';

describe('seed runtime', () => {
  it('replays a fixture through the real pipeline, finalises it and builds the Brain', async () => {
    const store = new MemoryStore();
    const rt = createRuntime(loadEnv({ LOG_LEVEL: 'silent', REPLAY_SPEED: '1000' }), {
      store,
      auth: fakeAuth,
      createInterpreter: stubInterpreter,
      embed: async (texts) => texts.map((t) => unitVector(t)),
      transcribeFile: null,
      decideMerge: null,
    });
    const res = await seedFixtureConversation(rt, USER_A, '01-simple-shift');
    expect(res.finalize.status).toBe('ready');
    const fixture = await rt.deps.loadFixture('01-simple-shift');
    expect(res.utterances).toBe(fixture.utterances.length);
    expect((await store.listUtterances(res.conversationId)).length).toBe(fixture.utterances.length);
    const g = (await store.loadGraph(res.conversationId))!;
    expect(g.conversation).toMatchObject({ userId: USER_A, status: 'ready' });
    expect(Object.keys(g.nodes).length).toBeGreaterThan(0);
    expect((await rebuildBrainFor(rt, USER_A)).conversations).toBe(1);
  });
});
