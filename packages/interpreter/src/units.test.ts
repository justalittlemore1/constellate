import { describe, expect, it } from 'vitest';
import { makeGraph, makeNode } from '@constellate/shared/testing';
import type { GraphState } from '@constellate/shared';
import { msUntilPause, pauseBefore, pauseDue, SILENCE_FALLBACK_MS, speechMs, triggerOnUtterance } from './trigger';
import { granularityHint, HINT_CONSERVATIVE, HINT_SPLIT } from './granularity';
import { aliasFor, packContext } from './context';
import { DECISION_JSON_SCHEMA, parseDecision } from './decision';
import { dec, utt } from './test-utils';

const withNodes = (nodes: ReturnType<typeof makeNode>[], activeNodeId: string | null = null): GraphState => {
  const g = makeGraph();
  return { ...g, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), activeNodeId };
};

describe('trigger', () => {
  it('fires immediately on a discourse marker', () => {
    const u = utt(1, 'Anyway, how was the concert?', 0, 2_000);
    expect(triggerOnUtterance([u], u)).toBe('marker');
  });

  it('does not fire on a marker-like substring', () => {
    const u = utt(1, 'The anyways guy was later than expected', 0, 2_000);
    // "later" is a marker word; "anyways" is not
    expect(triggerOnUtterance([u], u)).toBe('marker');
    const v = utt(2, 'Laterally speaking the anyways guy', 0, 2_000);
    expect(triggerOnUtterance([v], v)).toBeNull();
  });

  it('fires after 20 s of new speech', () => {
    const w = [utt(1, 'a', 0, 7_000), utt(2, 'b', 7_500, 14_000)];
    expect(triggerOnUtterance(w, w[1]!)).toBeNull();
    const w2 = [...w, utt(3, 'c', 14_500, 20_500)];
    expect(speechMs(w2)).toBe(19_500);
    expect(triggerOnUtterance(w2, w2[2]!)).toBeNull();
    const w3 = [...w2, utt(4, 'd', 21_000, 22_500)];
    expect(triggerOnUtterance(w3, w3[3]!)).toBe('window');
  });

  it('pause rule: 8 s of speech and a 1.5 s gap before the next utterance', () => {
    const short = [utt(1, 'a', 0, 5_000)];
    expect(pauseBefore(short, utt(2, 'b', 9_000))).toBe(false);
    const long = [utt(1, 'a', 0, 5_000), utt(2, 'b', 5_200, 9_000)];
    expect(pauseBefore(long, utt(3, 'c', 10_000))).toBe(false);
    expect(pauseBefore(long, utt(3, 'c', 10_500))).toBe(true);
  });

  it('silence fallback fires only after SILENCE_FALLBACK_MS with no new final', () => {
    const short = [utt(1, 'a', 0, 5_000)];
    expect(msUntilPause(short, 5_000)).toBeNull();
    expect(pauseDue(short, 60_000)).toBe(false);
    const long = [utt(1, 'a', 0, 5_000), utt(2, 'b', 5_200, 9_000)];
    expect(msUntilPause(long, 9_000)).toBe(SILENCE_FALLBACK_MS);
    expect(pauseDue(long, 9_000 + SILENCE_FALLBACK_MS - 1)).toBe(false);
    expect(pauseDue(long, 9_000 + SILENCE_FALLBACK_MS)).toBe(true);
  });
});

describe('granularity', () => {
  it('asks to split a childless level-1 node older than 3 minutes', () => {
    const s = withNodes([makeNode('a', { startMs: 0 })], 'a');
    expect(granularityHint(s, 170_000, [])).toBe('');
    expect(granularityHint(s, 181_000, [])).toBe(HINT_SPLIT);
  });

  it('does not ask to split when the subtopic already has children', () => {
    const s = withNodes([makeNode('a', { startMs: 0 }), makeNode('b', { level: 2, parentId: 'a', seq: 2 })], 'a');
    expect(granularityHint(s, 400_000, [])).toBe('');
  });

  it('asks for restraint after 3 non-explicit nodes in 60 s', () => {
    const s = withNodes([]);
    const c = [10_000, 30_000, 50_000].map((atMs) => ({ atMs, explicit: false }));
    expect(granularityHint(s, 60_000, c)).toBe(HINT_CONSERVATIVE);
    expect(granularityHint(s, 75_000, c)).toBe('');
    expect(granularityHint(s, 60_000, c.map((x) => ({ ...x, explicit: true })))).toBe('');
  });
});

describe('context packing', () => {
  const s = withNodes(
    [
      makeNode('A', { seq: 1, label: 'Hockey Game', status: 'closed', startMs: 0, endMs: 60_000 }),
      makeNode('B', { seq: 2, label: 'Concert Plans', startMs: 60_000 }),
      makeNode('P', { seq: 3, kind: 'pending', label: 'Soccer Story', utteranceIds: ['u2'] }),
    ],
    'B',
  );
  const u2 = utt(2, 'Remind me to tell you about soccer', 5_000);
  const packed = packContext({
    state: { ...s, conversation: { ...s.conversation, macroAnchor: 'Catching up' } },
    utterancesById: new Map([['u2', u2]]),
    recent: [utt(3, 'old line', 50_000)],
    window: [utt(4, 'new line one', 61_000), utt(5, 'new line two', 66_000, 70_000, null)],
    rollingSummary: 'They talked hockey.',
    candidates: [{ id: 'A', similarity: 0.8123 }],
    hint: HINT_SPLIT,
  });

  it('uses seq-based aliases that map back to ids', () => {
    expect(aliasFor({ kind: 'topic', seq: 7 })).toBe('n7');
    expect(aliasFor({ kind: 'pending', seq: 7 })).toBe('p7');
    expect(packed.aliases.toId.get('n2')).toBe('B');
    expect(packed.aliases.toId.get('p3')).toBe('P');
  });

  it('includes anchor, outline with ACTIVE, open thread quote, candidates, summary, utterances and hint', () => {
    const t = packed.text;
    expect(t).toContain('MACRO ANCHOR: Catching up');
    expect(t).toContain('n1 | L1 | Hockey Game | parent - | closed | 00:00–01:00');
    expect(t).toContain('n2 | L1 | Concert Plans | parent - | ACTIVE | 01:00–');
    expect(t).toContain('p3 | deferred | Soccer Story | raised at u2: "Remind me to tell you about soccer"');
    expect(t).toContain('n1 | Hockey Game | similarity 0.81');
    expect(t).toContain('ROLLING SUMMARY: They talked hockey.');
    expect(t).toMatch(/RECENT UTTERANCES[^\n]*\n\[u3 00:50 S0\] old line/);
    expect(t).toMatch(/NEW UTTERANCES[^\n]*\n\[u4 01:01 S0\] new line one\n\[u5 01:06 S\?\] new line two/);
    expect(t).toContain(`GRANULARITY HINT: ${HINT_SPLIT}`);
  });

  it('tells the model the first decision must open a topic', () => {
    const p = packContext({ state: makeGraph(), utterancesById: new Map(), recent: [], window: [utt(1, 'hi', 0)], rollingSummary: '', candidates: [], hint: '' });
    expect(p.text).toContain('this decision must be new_topic');
    expect(p.text).toContain('MACRO ANCHOR: (not set yet');
    expect(p.text).not.toContain('GRANULARITY HINT');
  });
});

describe('decision schema', () => {
  it('accepts a full decision and rejects a missing payload', () => {
    expect(parseDecision(dec({ action: 'continue' })).ok).toBe(true);
    const bad = parseDecision(dec({ action: 'revisit' }));
    expect(bad.ok).toBe(false);
    expect(parseDecision({ action: 'new_topic' }).ok).toBe(false);
  });

  it('requires parent_node_id for child_of', () => {
    const d = dec({
      action: 'new_topic',
      new_topic: { label: 'X', summary: 's', level: 2, relation: 'child_of', parent_node_id: null, starts_at_utterance: 'u1', explicit_shift: false },
    });
    expect(parseDecision(d).ok).toBe(false);
  });

  it('JSON schema marks every property required and closes every object', () => {
    const check = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect(Object.keys(o.properties as object).sort()).toEqual([...(o.required as string[])].sort());
      }
      Object.values(o).forEach((v) => (Array.isArray(v) ? v.forEach(check) : check(v)));
    };
    check(DECISION_JSON_SCHEMA);
  });
});
