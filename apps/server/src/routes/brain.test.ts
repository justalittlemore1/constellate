import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MergeDecider } from '../brain/merge-llm';
import type { BrainResponse } from '../brain/rebuild';
import { makeHarness, recordConversation, type Harness } from '../test-utils';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const auth = (token = 'token-a') => ({ authorization: `Bearer ${token}` });

async function readyConversation(token = 'token-a') {
  const id = await recordConversation(h, token);
  const res = await h.app.inject({ method: 'POST', url: `/conversations/${id}/finalize?wait=1`, headers: auth(token) });
  expect(res.json().status).toBe('ready');
  return id;
}

const rebuild = (token = 'token-a') => h.app.inject({ method: 'POST', url: '/brain/rebuild', headers: auth(token) });
const brain = async (token = 'token-a') =>
  (await h.app.inject({ method: 'GET', url: '/brain', headers: auth(token) })).json() as BrainResponse;

describe('Brain', () => {
  it('folds ready conversations into concepts with occurrences, incrementally, per user', async () => {
    h = await makeHarness();
    const c1 = await readyConversation();
    const c2 = await readyConversation(); // same two topics again

    const first = await rebuild();
    expect(first.json()).toMatchObject({ conversations: 2, newConcepts: 2, concepts: 2 });

    const b = await brain();
    expect(b.concepts.map((c) => c.mentionCount)).toEqual([2, 2]);
    expect(b.concepts.every((c) => !('embedding' in c))).toBe(true);
    for (const c of b.concepts) {
      expect(b.occurrences[c.id]!.map((o) => o.conversationId).sort()).toEqual([c1, c2].sort());
    }
    expect(b.links.some((l) => l.relation === 'co_discussed')).toBe(true);

    // nothing new → nothing re-merged, counts unchanged
    expect((await rebuild()).json()).toMatchObject({ conversations: 0, newConcepts: 0, concepts: 2 });

    // another user's Brain is separate
    expect(await brain('token-b')).toEqual({ concepts: [], links: [], occurrences: {} });
    expect((await h.app.inject({ method: 'GET', url: '/brain' })).statusCode).toBe(401);
  });

  it('live and processing conversations are not folded in', async () => {
    h = await makeHarness();
    await recordConversation(h); // processing, never finalised
    expect((await rebuild()).json()).toMatchObject({ conversations: 0, concepts: 0 });
  });

  it('uses the merge decider, and falls back to the heuristic when it fails', async () => {
    const decideMerge = vi.fn<MergeDecider>(async (req) =>
      req.nodes.map((n) => ({ nodeId: n.id, newConcept: { name: 'Everything', description: 'One concept for all.' } })),
    );
    h = await makeHarness({ decideMerge });
    await readyConversation();
    expect((await rebuild()).json()).toMatchObject({ newConcepts: 1, concepts: 1 });
    expect(decideMerge).toHaveBeenCalledOnce();
    expect((await brain()).concepts).toMatchObject([{ name: 'Everything', mentionCount: 2 }]);

    decideMerge.mockRejectedValueOnce(new Error('overloaded'));
    await readyConversation();
    const res = await rebuild();
    expect(res.statusCode).toBe(200);
    expect(res.json().conversations).toBe(1);
  });

  it('deleting a conversation removes its mentions on the next rebuild', async () => {
    h = await makeHarness();
    const c1 = await readyConversation();
    await readyConversation();
    await rebuild();
    await h.app.inject({ method: 'DELETE', url: `/conversations/${c1}`, headers: auth() });
    await rebuild();
    expect((await brain()).concepts.map((c) => c.mentionCount)).toEqual([1, 1]);
  });

  it('searches concepts by meaning', async () => {
    h = await makeHarness();
    await readyConversation();
    await rebuild();
    const res = await h.app.inject({
      method: 'GET',
      url: '/brain/search?q=Did%20you%20see%20the%20hockey%20game',
      headers: auth(),
    });
    const results = res.json().results as { name: string; similarity: number }[];
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.similarity).toBeGreaterThan(0.9);
    expect((await h.app.inject({ method: 'GET', url: '/brain/search', headers: auth() })).statusCode).toBe(400);
  });
});
