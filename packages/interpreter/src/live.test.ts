import { describe, expect, it } from 'vitest';
import { INTERPRETER } from '@constellate/shared';
import { createInterpreter, type DecisionRecord } from './live';
import { dec, memoryDeps, scriptedLlm, utt, windowIdsOf } from './test-utils';
import { LlmError } from './llm/errors';

const open = (label: string, starts: string, explicit = true) =>
  dec({
    action: 'new_topic',
    new_topic: { label, summary: 's', level: 1, relation: 'sibling_of_active', parent_node_id: null, starts_at_utterance: starts, explicit_shift: explicit },
  });

function setup(script: Parameters<typeof scriptedLlm>[0]) {
  const deps = memoryDeps();
  const llm = scriptedLlm(script);
  const records: DecisionRecord[] = [];
  const interp = createInterpreter(deps, { llm, scheduler: deps.clock, systemPrompt: 'SYSTEM', onDecision: (r) => records.push(r) });
  const feed = async (u: ReturnType<typeof utt>) => {
    deps.clock.advance(u.endMs);
    interp.pushUtterance(u);
    await interp.idle();
  };
  return { deps, llm, records, interp, feed };
}

describe('live interpreter', () => {
  it('waits for 20 s of speech, then calls the LLM with the window and emits ops', async () => {
    const t = setup(() => open('Hockey Game', 'u1'));
    await t.feed(utt(1, 'a', 0, 7_000));
    await t.feed(utt(2, 'b', 7_200, 14_000));
    expect(t.llm.calls).toHaveLength(0);
    await t.feed(utt(3, 'c', 14_200, 21_000));
    expect(t.llm.calls).toHaveLength(1);
    expect(t.llm.calls[0]!.system).toBe('SYSTEM');
    expect(t.llm.calls[0]!.timeoutMs).toBe(INTERPRETER.callTimeoutMs);
    expect(windowIdsOf(t.llm.calls[0]!.user)).toEqual(['u1', 'u2', 'u3']);
    const nodes = Object.values(t.deps.state.nodes);
    expect(nodes.map((n) => n.label)).toEqual(['Hockey Game']);
    expect(t.records[0]).toMatchObject({ reason: 'window', attempts: 1, error: null });
  });

  it('calls on a 1.5 s pause after 8 s of speech, without the utterance that follows the pause', async () => {
    const t = setup(() => open('Hockey Game', 'u1'));
    await t.feed(utt(1, 'a', 0, 5_000));
    await t.feed(utt(2, 'b', 5_200, 9_000));
    await t.feed(utt(3, 'c', 9_400, 12_000)); // 0.4 s gap: no call, though 3 s passed since the last final
    expect(t.llm.calls).toHaveLength(0);
    await t.feed(utt(4, 'd', 13_600, 16_000)); // 1.6 s gap
    expect(t.llm.calls).toHaveLength(1);
    expect(windowIdsOf(t.llm.calls[0]!.user)).toEqual(['u1', 'u2', 'u3']);
    expect(t.records[0]!.reason).toBe('pause');
  });

  it('calls after a long silence with no further utterance', async () => {
    const t = setup(() => open('Hockey Game', 'u1'));
    await t.feed(utt(1, 'a', 0, 5_000));
    await t.feed(utt(2, 'b', 5_200, 9_000));
    t.deps.clock.advance(20_000);
    await t.interp.idle();
    expect(t.llm.calls).toHaveLength(0);
    t.deps.clock.advance(21_000);
    await t.interp.idle();
    expect(t.llm.calls).toHaveLength(1);
  });

  it('calls immediately on a discourse marker', async () => {
    const t = setup(() => open('Hockey', 'u1'));
    await t.feed(utt(1, 'anyway, the concert', 0, 2_000));
    expect(t.llm.calls).toHaveLength(1);
    expect(t.records[0]!.reason).toBe('marker');
  });

  it('keeps one call in flight and queues utterances for the next call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup(async (_a, n) => {
      if (n === 1) {
        await gate;
        return open('Hockey', 'u1');
      }
      return dec({ action: 'continue' });
    });
    t.deps.clock.advance(2_000);
    t.interp.pushUtterance(utt(1, 'anyway hockey', 0, 2_000));
    t.interp.pushUtterance(utt(2, 'later the concert', 2_500, 4_000));
    t.interp.pushUtterance(utt(3, 'back to it', 4_500, 6_000));
    await Promise.resolve();
    expect(t.llm.calls).toHaveLength(1);
    release();
    await t.interp.idle();
    expect(t.llm.calls).toHaveLength(2);
    expect(windowIdsOf(t.llm.calls[1]!.user)).toEqual(['u2', 'u3']);
    expect(t.deps.state.nodes[t.deps.state.activeNodeId!]!.utteranceIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('retries once with the validation error appended', async () => {
    const t = setup((_a, n) => (n === 1 ? dec({ action: 'continue' }) : open('Hockey', 'u1')));
    await t.feed(utt(1, 'anyway hockey', 0, 2_000));
    expect(t.llm.calls).toHaveLength(2);
    expect(t.llm.calls[1]!.user).toContain('YOUR PREVIOUS ANSWER WAS INVALID: There is no active topic yet');
    expect(t.records[0]).toMatchObject({ attempts: 2, error: null });
    expect(Object.keys(t.deps.state.nodes)).toHaveLength(1);
  });

  it('skips the window after two failures and rolls its utterances into the next call', async () => {
    const t = setup((_a, n) => {
      if (n <= 2) throw new LlmError('timeout', 'no response within 8000 ms');
      return open('Hockey', 'u1');
    });
    await t.feed(utt(1, 'anyway hockey', 0, 2_000));
    expect(t.llm.calls).toHaveLength(2);
    expect(t.deps.emitted).toHaveLength(0);
    expect(t.records[0]!.error).toMatch(/no response/);
    await t.feed(utt(2, 'speaking of goalies', 2_500, 5_000));
    expect(windowIdsOf(t.llm.calls[2]!.user)).toEqual(['u1', 'u2']);
    expect(Object.values(t.deps.state.nodes)[0]!.utteranceIds).toEqual(['u1', 'u2']);
  });

  it('shows revisit candidates from embeddings and saves node embeddings', async () => {
    const t = setup((a, n) => {
      if (n === 1) return open('Hockey Playoffs Goalie', 'u1');
      if (n === 2) return open('Concert Tickets', 'u2');
      expect(a.user).toContain('REVISIT CANDIDATES');
      expect(a.user).toMatch(/n1 \| Hockey Playoffs Goalie \| similarity/);
      return dec({ action: 'revisit', revisit: { node_id: 'n1', starts_at_utterance: 'u3', label: null, summary: 'hockey playoffs goalie again' } });
    });
    await t.feed(utt(1, 'anyway hockey playoffs goalie', 0, 2_000));
    await t.feed(utt(2, 'anyway concert tickets', 3_000, 5_000));
    await t.feed(utt(3, 'anyway hockey playoffs goalie s', 6_000, 8_000));
    expect(t.llm.calls).toHaveLength(3);
    expect(t.deps.saved.size).toBeGreaterThanOrEqual(2);
    expect(Object.values(t.deps.state.edges).some((e) => e.kind === 'revisit')).toBe(true);
  });

  it('stop flushes the buffer, closes the active node and leaves threads unexplored', async () => {
    const t = setup((_a, n) =>
      n === 1
        ? dec({ ...open('Camping', 'u1'), intentions: [{ kind: 'deferred_topic', label: 'Soccer', quote_utterance: 'u1' }] })
        : dec({ action: 'continue' }),
    );
    await t.feed(utt(1, 'remind me to tell you about soccer', 0, 3_000));
    await t.feed(utt(2, 'tents', 3_500, 6_000));
    t.interp.park('internship question', 6_500);
    await t.interp.stop();
    expect(t.llm.calls).toHaveLength(2);
    expect(t.records[1]!.reason).toBe('flush');
    const nodes = Object.values(t.deps.state.nodes);
    expect(nodes.find((n) => n.label === 'Camping')!.status).toBe('closed');
    expect(nodes.find((n) => n.label === 'Soccer')!.status).toBe('unexplored');
    expect(nodes.find((n) => n.kind === 'parked')!.status).toBe('unexplored');
    expect(t.deps.state.activeNodeId).toBeNull();
  });
});
