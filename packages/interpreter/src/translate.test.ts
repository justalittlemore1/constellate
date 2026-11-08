import { describe, expect, it } from 'vitest';
import { applyOps, GUTTER_X, LANE_WIDTH, type GraphState, type Utterance } from '@constellate/shared';
import { makeGraph } from '@constellate/shared/testing';
import { buildAliases } from './context';
import type { Decision } from './decision';
import { cleanLabel, emptyMemory, parkOps, stopOps, translate, validateDecision, type GateMemory } from './translate';
import { dec, utt } from './test-utils';

/** Drives translate over successive windows, applying ops like the server would. */
function session() {
  let state: GraphState = makeGraph();
  let memory: GateMemory = emptyMemory();
  let id = 0;
  let seq = 0;
  const byId = new Map<string, Utterance>();
  const newId = () => `id-${++id}`;
  const step = (window: Utterance[], d: Decision, opts: { nowMs?: number; autoResolveIds?: string[] } = {}) => {
    window.forEach((u) => byId.set(u.id, u));
    const aliases = buildAliases(state);
    const err = validateDecision(d, aliases, window, state, memory);
    if (err) throw new Error(err);
    const r = translate({
      state,
      decision: d,
      aliases,
      window,
      utterancesById: byId,
      memory,
      newId,
      nowMs: opts.nowMs ?? window[window.length - 1]!.endMs,
      autoResolveIds: opts.autoResolveIds,
    });
    // the emitted ops must pass the real reducer as one batch
    state = applyOps(state, { conversationId: state.conversation.id, seq: ++seq, at: '', source: 'live', ops: r.ops });
    memory = r.memory;
    return r;
  };
  return {
    step,
    get state() {
      return state;
    },
    get memory() {
      return memory;
    },
    stop(endMs: number) {
      const r = stopOps(state, memory, endMs, newId);
      state = applyOps(state, {
        conversationId: state.conversation.id,
        seq: ++seq,
        at: '',
        source: 'live',
        ops: r.ops,
      });
      memory = r.memory;
    },
    park(text: string, atMs: number) {
      const r = parkOps(state, memory, text, atMs, newId);
      state = applyOps(state, {
        conversationId: state.conversation.id,
        seq: ++seq,
        at: '',
        source: 'user',
        ops: r.ops,
      });
      memory = r.memory;
      return r.nodeId;
    },
    node(label: string) {
      const n = Object.values(state.nodes).filter((x) => x.label === label);
      if (n.length === 0) throw new Error(`no node ${label}`);
      return n[n.length - 1]!;
    },
    edges(kind?: string) {
      return Object.values(state.edges).filter((e) => !kind || e.kind === kind);
    },
  };
}

const newTopic = (label: string, starts: string, extra: Partial<NonNullable<Decision['new_topic']>> = {}): Decision =>
  dec({
    action: 'new_topic',
    new_topic: {
      label,
      summary: `${label} summary`,
      level: 1,
      relation: 'sibling_of_active',
      parent_node_id: null,
      starts_at_utterance: starts,
      explicit_shift: false,
      ...extra,
    },
  });

const W1 = [utt(1, 'hockey talk', 0), utt(2, 'more hockey', 5_000)];
const W2 = [utt(3, 'goalie', 10_000), utt(4, 'playoffs', 15_000)];
const W3 = [utt(5, 'so the concert', 20_000), utt(6, 'floor tickets', 25_000)];
const W4 = [utt(7, 'opener band', 30_000), utt(8, 'new album', 35_000)];

describe('translate', () => {
  it('the first topic is active immediately and owns the whole window', () => {
    const s = session();
    s.step(W1, newTopic('Hockey Game', 'u2'));
    const n = s.node('Hockey Game');
    expect(n.status).toBe('active');
    expect(n.utteranceIds).toEqual(['u1', 'u2']);
    expect(n.startMs).toBe(0);
    expect(s.state.activeNodeId).toBe(n.id);
    expect(n.seq).toBe(1);
  });

  it('continue appends utterances and can refine the summary', () => {
    const s = session();
    s.step(W1, newTopic('Hockey Game', 'u1'));
    s.step(W2, dec({ action: 'continue', continue: { summary_update: 'Goalie stole the game' } }));
    const n = s.node('Hockey Game');
    expect(n.utteranceIds).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(n.summary).toBe('Goalie stole the game');
  });

  it('a non-explicit new topic is provisional and standalone until the next decision promotes it', () => {
    const s = session();
    s.step([...W1, ...W2], newTopic('Hockey Game', 'u1'));
    s.step(W3, newTopic('Concert Plans', 'u5'));
    const hockey = s.node('Hockey Game');
    const concert = s.node('Concert Plans');
    expect(concert.status).toBe('provisional');
    expect(hockey.status).toBe('active');
    expect(s.state.activeNodeId).toBe(hockey.id);
    expect(s.edges('flow')).toHaveLength(0);

    s.step(W4, dec({ action: 'continue' }));
    const c2 = s.node('Concert Plans');
    expect(c2.status).toBe('active');
    expect(c2.utteranceIds).toEqual(['u5', 'u6', 'u7', 'u8']);
    expect(s.node('Hockey Game').status).toBe('closed');
    expect(s.node('Hockey Game').endMs).toBe(20_000);
    expect(s.edges('flow').map((e) => [e.sourceId, e.targetId])).toEqual([[hockey.id, concert.id]]);
    expect(s.state.activeNodeId).toBe(concert.id);
  });

  it('an explicit shift commits immediately: close previous, flow edge, active', () => {
    const s = session();
    s.step(W1, newTopic('Hockey Game', 'u1'));
    s.step(W2, newTopic('Concert Plans', 'u4', { explicit_shift: true }));
    const hockey = s.node('Hockey Game');
    const concert = s.node('Concert Plans');
    expect(concert.status).toBe('active');
    expect(hockey.utteranceIds).toEqual(['u1', 'u2', 'u3']);
    expect(hockey.status).toBe('closed');
    expect(hockey.endMs).toBe(15_000);
    expect(s.edges('flow')).toHaveLength(1);
    expect(s.state.activeNodeId).toBe(concert.id);
  });

  it('commit gate: returning to the interrupted node within 15 s removes the provisional node and folds it back', () => {
    const s = session();
    s.step([...W1, ...W2], newTopic('Study Plan', 'u1'));
    const joke = [utt(5, 'a pigeon!', 20_000, 23_000), utt(6, 'ha', 23_500, 26_000)];
    s.step(joke, newTopic('Pigeon Joke', 'u5', { level: 2, relation: 'child_of_active' }));
    expect(s.node('Pigeon Joke').status).toBe('provisional');
    const back = [utt(7, 'okay so chair flips', 28_000), utt(8, 'model kit', 33_000)];
    s.step(
      back,
      dec({
        action: 'revisit',
        revisit: { node_id: 'n1', starts_at_utterance: 'u7', label: null, summary: 'back to studying' },
      }),
    );
    expect(Object.values(s.state.nodes).filter((n) => n.kind === 'topic')).toHaveLength(1);
    const study = s.node('Study Plan');
    expect(study.status).toBe('active');
    expect(study.utteranceIds).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8']);
    expect(s.edges()).toHaveLength(0);
    expect(s.memory.provisional).toBeNull();
  });

  it('a return after ≥ 15 s on the provisional topic is a real revisit, not a reversal', () => {
    const s = session();
    s.step([...W1, ...W2], newTopic('Free Will', 'u1'));
    s.step([utt(5, 'job offer!', 20_000, 25_000), utt(6, 'congrats', 25_500, 30_000)], newTopic('Job Offer', 'u5'));
    s.step([utt(7, 'salary', 31_000, 36_000)], dec({ action: 'continue' }));
    s.step(
      [utt(8, 'back to free will', 40_000)],
      dec({
        action: 'revisit',
        revisit: { node_id: 'n1', starts_at_utterance: 'u8', label: null, summary: 'free will again' },
      }),
    );
    const occurrences = Object.values(s.state.nodes).filter((n) => n.label === 'Free Will');
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.threadId).toBe(occurrences[1]!.threadId);
    const revisit = s.edges('revisit');
    expect(revisit).toHaveLength(1);
    expect(revisit[0]!.sourceId).toBe(occurrences[1]!.id);
    expect(revisit[0]!.targetId).toBe(occurrences[0]!.id);
    expect(s.edges('flow')).toHaveLength(2);
    expect(s.node('Job Offer').status).toBe('closed');
  });

  it('a revisit joins the lane of the earlier occurrence and keeps its parent', () => {
    const s = session();
    s.step(W1, newTopic('Christianity', 'u1', { explicit_shift: true }));
    s.step(W2, newTopic('Resurrection', 'u3', { level: 2, relation: 'child_of_active', explicit_shift: true }));
    s.step(W3, newTopic('Weekend', 'u5', { relation: 'new_theme', explicit_shift: true }));
    s.step(
      W4,
      dec({
        action: 'revisit',
        revisit: { node_id: 'n2', starts_at_utterance: 'u7', label: null, summary: 'tomb again' },
      }),
    );
    const [first, again] = Object.values(s.state.nodes).filter((n) => n.label === 'Resurrection');
    expect(first!.level).toBe(2);
    expect(first!.parentId).toBe(s.node('Christianity').id);
    expect(again!.level).toBe(2);
    expect(again!.parentId).toBe(first!.parentId);
    expect(Math.round(again!.x / LANE_WIDTH)).toBe(2);
    expect(again!.y).toBeGreaterThan(s.node('Weekend').y);
  });

  it('nests child_of_active and never goes deeper than level 2', () => {
    const s = session();
    s.step(W1, newTopic('Religion Talk', 'u1'));
    s.step(W2, newTopic('Christianity', 'u3', { level: 2, relation: 'child_of_active', explicit_shift: true }));
    s.step(W3, newTopic('Resurrection', 'u5', { level: 2, relation: 'child_of_active', explicit_shift: true }));
    expect(s.node('Christianity').parentId).toBe(s.node('Religion Talk').id);
    // child of a level-2 node attaches to its level-1 parent instead
    expect(s.node('Resurrection').level).toBe(2);
    expect(s.node('Resurrection').parentId).toBe(s.node('Religion Talk').id);
  });

  it('deferred topics become pending nodes tethered to the active node; promises become commitments', () => {
    const s = session();
    s.step(W1, newTopic('Camping Trip', 'u1'));
    s.step(
      [
        utt(3, 'remind me to tell you about soccer', 10_000),
        utt(4, "I'll send you the map tonight", 15_000, 18_000, 1),
      ],
      dec({
        action: 'continue',
        intentions: [
          { kind: 'deferred_topic', label: 'Soccer Story.', quote_utterance: 'u3' },
          { kind: 'promise', label: 'Send the map tonight', quote_utterance: 'u4' },
        ],
      }),
    );
    const p = s.node('Soccer Story');
    expect(p.kind).toBe('pending');
    expect(p.status).toBe('active');
    expect(p.mentionedAtMs).toBe(10_000);
    expect(p.utteranceIds).toEqual(['u3']);
    expect(p.x).toBeGreaterThanOrEqual(GUTTER_X - 10);
    const tether = s.edges('tether');
    expect(tether.map((e) => [e.sourceId, e.targetId])).toEqual([[s.node('Camping Trip').id, p.id]]);
    expect(s.state.commitments).toHaveLength(1);
    expect(s.state.commitments[0]).toMatchObject({
      text: 'Send the map tonight',
      speaker: 1,
      atMs: 15_000,
      nodeId: s.node('Camping Trip').id,
    });

    // the same deferral again is not duplicated
    s.step(
      [utt(5, 'soccer later ok', 20_000)],
      dec({
        action: 'continue',
        intentions: [{ kind: 'deferred_topic', label: 'Soccer Story', quote_utterance: 'u5' }],
      }),
    );
    expect(Object.values(s.state.nodes).filter((n) => n.kind === 'pending')).toHaveLength(1);

    s.stop(25_000);
    expect(s.node('Soccer Story').status).toBe('unexplored');
    expect(s.node('Camping Trip').status).toBe('closed');
    expect(s.node('Camping Trip').endMs).toBe(25_000);
    expect(s.state.activeNodeId).toBeNull();
  });

  it('resolved threads turn resolved and link to the node where they were discussed', () => {
    const s = session();
    s.step(W1, newTopic('Presentation', 'u1', { explicit_shift: true }));
    s.step(
      W2,
      dec({
        action: 'continue',
        intentions: [{ kind: 'deferred_topic', label: 'Apartment Lease', quote_utterance: 'u3' }],
      }),
    );
    s.step(W3, newTopic('Lease Renewal', 'u5', { explicit_shift: true }), {});
    s.step(W4, dec({ action: 'continue', resolved_thread_ids: ['p2', 'p99'] }));
    const p = s.node('Apartment Lease');
    expect(p.status).toBe('resolved');
    expect(s.edges('tether').some((e) => e.sourceId === p.id && e.targetId === s.node('Lease Renewal').id)).toBe(true);
    s.stop(40_000);
    expect(s.node('Apartment Lease').status).toBe('resolved');
  });

  it('auto-resolves threads matched by embedding when a new topic opens', () => {
    const s = session();
    s.step(W1, newTopic('Presentation', 'u1', { explicit_shift: true }));
    s.step(
      W2,
      dec({ action: 'continue', intentions: [{ kind: 'deferred_topic', label: 'Apartment', quote_utterance: 'u3' }] }),
    );
    const pid = s.node('Apartment').id;
    const r = s.step(W3, newTopic('Rent Increase', 'u5', { explicit_shift: true }), { autoResolveIds: [pid] });
    expect(r.ops.some((o) => o.op === 'node.update' && o.id === pid)).toBe(true);
    expect(s.node('Apartment').status).toBe('resolved');
  });

  it('parked thoughts are user-created thread nodes in the gutter', () => {
    const s = session();
    s.step(W1, newTopic('Hockey', 'u1'));
    const id = s.park('ask about the internship offer details', 6_000);
    const n = s.state.nodes[id]!;
    expect(n).toMatchObject({ kind: 'parked', createdBy: 'user', status: 'active', label: 'Ask About The Internship' });
    s.stop(10_000);
    expect(s.state.nodes[id]!.status).toBe('unexplored');
  });

  it('sets the macro anchor once and ignores quick changes', () => {
    const s = session();
    s.step(W1, { ...newTopic('Hockey', 'u1'), macro_anchor: 'Sports' });
    expect(s.state.conversation.macroAnchor).toBe('Sports');
    s.step(W2, dec({ action: 'continue', macro_anchor: 'Music' }));
    expect(s.state.conversation.macroAnchor).toBe('Sports');
    s.step([utt(5, 'x', 300_000)], dec({ action: 'continue', macro_anchor: 'Music' }), { nowMs: 300_000 });
    expect(s.state.conversation.macroAnchor).toBe('Music');
  });

  it('stop promotes a still-provisional node', () => {
    const s = session();
    s.step(W1, newTopic('Hockey', 'u1'));
    s.step(W2, newTopic('Music', 'u3'));
    s.stop(20_000);
    expect(s.node('Music').status).toBe('closed');
    expect(s.node('Hockey').endMs).toBe(10_000);
    expect(s.edges('flow')).toHaveLength(1);
  });

  it('removed provisional nodes never free their seq', () => {
    const s = session();
    s.step([...W1, ...W2], newTopic('Study', 'u1'));
    s.step([utt(5, 'joke', 20_000, 22_000)], newTopic('Joke', 'u5'));
    s.step(
      [utt(6, 'back', 23_000)],
      dec({ action: 'revisit', revisit: { node_id: 'n1', starts_at_utterance: 'u6', label: null, summary: 's' } }),
    );
    s.step([utt(7, 'music', 30_000)], newTopic('Music', 'u7', { explicit_shift: true }));
    expect(s.node('Music').seq).toBe(3);
  });
});

describe('validation', () => {
  const state = (): GraphState => makeGraph();
  it('rejects continue with no topic, unknown ids and starts outside the window', () => {
    const w = [utt(5, 'x', 0)];
    const a = buildAliases(state());
    expect(validateDecision(dec({ action: 'continue' }), a, w, state(), emptyMemory())).toMatch(/new_topic/);
    expect(validateDecision(newTopic('X', 'u4'), a, w, state(), emptyMemory())).toMatch(
      /must be one of the NEW utterances \(u5…u5\)/,
    );
    expect(
      validateDecision(
        dec({ action: 'revisit', revisit: { node_id: 'n9', starts_at_utterance: 'u5', label: null, summary: '' } }),
        a,
        w,
        state(),
        emptyMemory(),
      ),
    ).toMatch(/not a topic node id/);
    expect(
      validateDecision(
        newTopic('X', 'u5', { relation: 'child_of', parent_node_id: 'n3' }),
        a,
        w,
        state(),
        emptyMemory(),
      ),
    ).toMatch(/parent_node_id/);
    expect(validateDecision(newTopic('X', 'u5'), a, w, state(), emptyMemory())).toBeNull();
  });

  it('labels are truncated to 4 words without trailing punctuation', () => {
    expect(cleanLabel('the long and winding road home.')).toBe('The Long And Winding');
    expect(cleanLabel('  "Rent increase!" ')).toBe('Rent Increase');
    expect(cleanLabel('...')).toBe('Untitled');
  });
});

describe('commit gate keeps threads and promises attached', () => {
  const joke = [utt(5, 'a pigeon!', 20_000, 23_000), utt(6, 'remind me about soccer', 23_500, 26_000)];
  const back = [utt(7, 'okay so chair flips', 28_000)];
  const toStudy = dec({
    action: 'revisit',
    revisit: { node_id: 'n1', starts_at_utterance: 'u7', label: null, summary: 's' },
  });

  it('re-points a thread raised in a reversed provisional node to the node it folds into', () => {
    const s = session();
    s.step([...W1, ...W2], newTopic('Study Plan', 'u1'));
    s.step(joke, {
      ...newTopic('Pigeon', 'u5'),
      intentions: [{ kind: 'deferred_topic', label: 'Soccer Story', quote_utterance: 'u6' }],
    });
    expect(s.edges('tether')[0]!.sourceId).toBe(s.node('Pigeon').id);
    s.step(back, toStudy);
    const tethers = s.edges('tether');
    expect(tethers).toHaveLength(1);
    expect(tethers[0]).toMatchObject({ sourceId: s.node('Study Plan').id, targetId: s.node('Soccer Story').id });
  });

  it('re-points a resolution link made in a reversed provisional node', () => {
    const s = session();
    s.step(W1, newTopic('Study Plan', 'u1'));
    s.step(
      W2,
      dec({ action: 'continue', intentions: [{ kind: 'deferred_topic', label: 'Apartment', quote_utterance: 'u3' }] }),
    );
    s.step(joke, { ...newTopic('Lease', 'u5'), resolved_thread_ids: ['p2'] });
    s.step(back, toStudy);
    const p = s.node('Apartment');
    expect(p.status).toBe('resolved');
    expect(s.edges('tether').some((e) => e.sourceId === p.id && e.targetId === s.node('Study Plan').id)).toBe(true);
  });

  it('holds a promise made in a provisional node until the gate settles', () => {
    const promise = { kind: 'promise' as const, label: 'Send the notes', quote_utterance: 'u6' };
    const reversed = session();
    reversed.step([...W1, ...W2], newTopic('Study Plan', 'u1'));
    reversed.step(joke, { ...newTopic('Pigeon', 'u5'), intentions: [promise] });
    expect(reversed.state.commitments).toHaveLength(0);
    reversed.step(back, toStudy);
    expect(reversed.state.commitments).toHaveLength(1);
    expect(reversed.state.commitments[0]!.nodeId).toBe(reversed.node('Study Plan').id);

    const promoted = session();
    promoted.step([...W1, ...W2], newTopic('Study Plan', 'u1'));
    promoted.step(joke, { ...newTopic('Notes', 'u5'), intentions: [promise] });
    promoted.step(back, dec({ action: 'continue' }));
    expect(promoted.state.commitments[0]!.nodeId).toBe(promoted.node('Notes').id);

    const stopped = session();
    stopped.step([...W1, ...W2], newTopic('Study Plan', 'u1'));
    stopped.step(joke, { ...newTopic('Notes', 'u5'), intentions: [promise] });
    stopped.stop(30_000);
    expect(stopped.state.commitments[0]!.nodeId).toBe(stopped.node('Notes').id);
  });

  it('drops an intention whose quote utterance is unknown', () => {
    const s = session();
    const r = s.step(W1, {
      ...newTopic('Hockey', 'u1'),
      intentions: [
        { kind: 'deferred_topic', label: 'Soccer', quote_utterance: 'u42' },
        { kind: 'promise', label: 'Call mom', quote_utterance: 'nope' },
      ],
    });
    expect(Object.values(s.state.nodes).filter((n) => n.kind === 'pending')).toHaveLength(0);
    expect(s.state.commitments).toHaveLength(0);
    expect(r.warnings.filter((w) => w.includes('unknown quote_utterance'))).toHaveLength(2);
  });
});
