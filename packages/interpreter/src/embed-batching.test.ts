/** Batched, memoised embeddings in the live interpreter (AGENTS.md › API budget). */
import { describe, expect, it } from 'vitest';
import { createInterpreter } from './live';
import { bagEmbed, dec, memoryDeps, scriptedLlm, utt } from './test-utils';

const open = (label: string, starts: string) =>
  dec({
    action: 'new_topic',
    new_topic: {
      label,
      summary: `${label} talk`,
      level: 1,
      relation: 'sibling_of_active',
      parent_node_id: null,
      starts_at_utterance: starts,
      explicit_shift: true,
    },
  });

function setup(script: Parameters<typeof scriptedLlm>[0], failEmbed: (call: number) => boolean = () => false) {
  const embedCalls: string[][] = [];
  const deps = memoryDeps(undefined, async (texts) => {
    embedCalls.push(texts);
    if (failEmbed(embedCalls.length)) throw new Error('429 RESOURCE_EXHAUSTED');
    return texts.map((t) => bagEmbed(t));
  });
  const llm = scriptedLlm(script);
  const interp = createInterpreter(deps, { llm, scheduler: deps.clock, systemPrompt: 'S' });
  const feed = async (u: ReturnType<typeof utt>) => {
    deps.clock.advance(u.endMs);
    interp.pushUtterance(u);
    await interp.idle();
  };
  return { deps, llm, interp, feed, embedCalls };
}

describe('batched embeddings', () => {
  it('sends one embedding request per decision, carrying queued node texts, and flushes at stop', async () => {
    const t = setup((_a, n) =>
      n === 1
        ? open('Hockey', 'u1')
        : n === 2
          ? open('Concert', 'u2')
          : dec({ action: 'continue', continue: { summary_update: 'new summary' } }),
    );
    await t.feed(utt(1, 'anyway hockey', 0, 2_000));
    await t.feed(utt(2, 'anyway concert', 3_000, 5_000));
    // < 2 topics before each of these decisions: no embedding request yet, nodes are queued
    expect(t.embedCalls).toHaveLength(0);
    await t.feed(utt(3, 'anyway the opener band', 6_000, 8_000));
    // third decision: window text + both queued node texts in ONE request
    expect(t.embedCalls).toHaveLength(1);
    expect(t.embedCalls[0]).toEqual(['anyway the opener band', 'Hockey. Hockey talk', 'Concert. Concert talk']);
    expect(t.deps.saved.size).toBe(2);
    await t.interp.stop();
    // the summary refinement was not re-embedded and nothing was left queued
    expect(t.embedCalls).toHaveLength(1);
  });

  it('never embeds the same text twice (auto-resolve vector is reused for the new node)', async () => {
    const t = setup((_a, n) => {
      if (n === 1)
        return dec({
          ...open('Camping', 'u1'),
          intentions: [{ kind: 'deferred_topic', label: 'Lease', quote_utterance: 'u1' }],
        });
      if (n === 2) return open('Hockey', 'u2');
      return open('Rent Increase', 'u3');
    });
    await t.feed(utt(1, 'remind me about the lease', 0, 2_000));
    await t.feed(utt(2, 'anyway hockey', 3_000, 5_000));
    await t.feed(utt(3, 'anyway the rent', 6_000, 8_000));
    await t.interp.stop();
    const all = t.embedCalls.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain('Rent Increase. Rent Increase talk');
  });

  it('degrades on a 429: skips candidates for that window, keeps captions/decisions flowing, retries the queue later', async () => {
    const t = setup(
      (_a, n) => (n <= 2 ? open(n === 1 ? 'Hockey' : 'Concert', `u${n}`) : dec({ action: 'continue' })),
      (call) => call === 1,
    );
    await t.feed(utt(1, 'anyway hockey', 0, 2_000));
    await t.feed(utt(2, 'anyway concert', 3_000, 5_000));
    await t.feed(utt(3, 'anyway opener', 6_000, 8_000)); // embed fails → no candidates, decision still applied
    expect(t.llm.calls).toHaveLength(3);
    expect(t.deps.saved.size).toBe(0);
    await t.interp.stop(); // queued nodes go out in the final batch
    expect(t.embedCalls).toHaveLength(2);
    expect(t.deps.saved.size).toBe(2);
  });
});
