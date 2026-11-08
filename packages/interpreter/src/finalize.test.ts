import { describe, expect, it } from 'vitest';
import { applyOps, type GraphState, type Utterance } from '@constellate/shared';
import { makeEdge, makeGraph, makeNode } from '@constellate/shared/testing';
import {
  createFinalizer,
  FINALIZE_JSON_SCHEMA,
  packFinalize,
  translateFinalize,
  type FinalizeOutput,
} from './finalize';
import { scriptedLlm, utt } from './test-utils';

/** Live graph: A (u1–u3) → A' duplicate (u4–u5) → B (u6–u8) → A2 revisit of A (u9–u10); pending P resolved never; parked Q. */
function liveGraph(): { state: GraphState; utterances: Utterance[] } {
  const g = makeGraph();
  const nodes = [
    makeNode('A', {
      seq: 1,
      label: 'Free Will',
      status: 'closed',
      startMs: 0,
      endMs: 15_000,
      utteranceIds: ['u1', 'u2', 'u3'],
      x: 5,
      y: 0,
    }),
    makeNode('A1', {
      seq: 2,
      label: 'Determinism',
      status: 'closed',
      startMs: 15_000,
      endMs: 25_000,
      utteranceIds: ['u4', 'u5'],
      y: 96,
    }),
    makeNode('B', {
      seq: 3,
      label: 'Job Stuff',
      status: 'closed',
      startMs: 25_000,
      endMs: 40_000,
      utteranceIds: ['u6', 'u7', 'u8'],
      y: 192,
      highlighted: true,
    }),
    makeNode('C', {
      seq: 4,
      level: 2,
      label: 'Salary',
      status: 'closed',
      startMs: 30_000,
      endMs: 40_000,
      parentId: null,
      utteranceIds: [],
      y: 250,
    }),
    makeNode('A2', {
      seq: 5,
      label: 'Free Will',
      threadId: 'A',
      status: 'closed',
      startMs: 40_000,
      endMs: 50_000,
      utteranceIds: ['u9', 'u10'],
      y: 288,
    }),
    makeNode('P', {
      seq: 6,
      kind: 'pending',
      label: 'Sister Wedding',
      status: 'unexplored',
      startMs: 20_000,
      mentionedAtMs: 20_000,
      utteranceIds: ['u5'],
      x: 460,
      y: 96,
    }),
    makeNode('Q', {
      seq: 7,
      kind: 'parked',
      label: 'ask internship',
      status: 'unexplored',
      createdBy: 'user',
      startMs: 30_000,
      x: 460,
      y: 192,
    }),
  ];
  const state: GraphState = {
    ...g,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(
      [
        makeEdge('e1', 'A', 'A1'),
        makeEdge('e2', 'A1', 'B'),
        makeEdge('e3', 'B', 'A2'),
        makeEdge('e4', 'A2', 'A', 'revisit'),
        makeEdge('e5', 'A1', 'P', 'tether'),
      ].map((e) => [e.id, e]),
    ),
    annotations: [{ id: 'note1', conversationId: g.conversation.id, nodeId: 'B', text: 'mine', x: 1, y: 2 }],
    lastSeq: 9,
  };
  const utterances = Array.from({ length: 10 }, (_, i) =>
    utt(i + 1, `line ${i + 1}`, i * 5_000, i * 5_000 + 4_000, i % 2),
  );
  return { state, utterances };
}

const empty: FinalizeOutput = {
  renames: [],
  merges: [],
  details: [],
  parents: [],
  thread_status: [],
  commitments: [],
  title: '',
  summary: '',
  recall_prompts: [],
};

function run(out: Partial<FinalizeOutput>) {
  const { state, utterances } = liveGraph();
  let n = 0;
  const input = { state, utterances, newId: () => `f-${++n}` };
  const { aliases } = packFinalize(state, utterances);
  const r = translateFinalize(input, { ...empty, ...out }, aliases);
  const after = applyOps(state, {
    conversationId: state.conversation.id,
    seq: 10,
    at: '',
    source: 'finalize',
    ops: r.ops,
  });
  return { r, before: state, after };
}

describe('finalize translation', () => {
  it('packs transcript, map with thread aliases, flags and commitments', () => {
    const { state, utterances } = liveGraph();
    const p = packFinalize(state, utterances).text;
    expect(p).toContain('[u1 00:00 S0] line 1');
    expect(p).toContain('n1 | topic | L1 | Free Will | parent - | thread t1 | closed | 00:00–00:15 | u1–u3');
    expect(p).toContain('n5 | topic | L1 | Free Will | parent - | thread t1 |');
    expect(p).toContain('p6 | pending | L1 | Sister Wedding');
    expect(p).toContain('FLAGS:\n(none)');
  });

  it('merges an adjacent duplicate but refuses to merge across a revisit', () => {
    const { r, after } = run({
      merges: [
        { from: 'n2', into: 'n1' },
        { from: 'n5', into: 'n1' },
      ],
    });
    expect(after.nodes.A1).toBeUndefined();
    expect(after.nodes.A!.utteranceIds).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(after.nodes.A2).toBeDefined();
    expect(r.warnings.some((w) => w.includes('revisit'))).toBe(true);
    // the tether from the merged node now hangs off its survivor
    expect(
      Object.values(after.edges).some((e) => e.kind === 'tether' && e.sourceId === 'A' && e.targetId === 'P'),
    ).toBe(true);
  });

  it('renames (4 words max), never renames user-created nodes, never moves layout or touches highlights and notes', () => {
    const { after, before } = run({
      renames: [
        { node: 'n3', label: 'the job offer at the agency' },
        { node: 'p7', label: 'Internship' },
      ],
    });
    expect(after.nodes.B!.label).toBe('The Job Offer At');
    expect(after.nodes.Q!.label).toBe('ask internship');
    for (const id of Object.keys(before.nodes)) {
      expect([after.nodes[id]!.x, after.nodes[id]!.y]).toEqual([before.nodes[id]!.x, before.nodes[id]!.y]);
    }
    expect(after.nodes.B!.highlighted).toBe(true);
    expect(after.annotations).toEqual(before.annotations);
  });

  it('writes details with evidence restricted to the node’s own utterances', () => {
    const { after } = run({
      details: [{ node: 'n3', text: 'Marcus weighed the offer. He leaned yes.', evidence: ['u7', 'u2', 'u6', 'u7'] }],
    });
    expect(after.nodes.B!.details).toBe('Marcus weighed the offer. He leaned yes.\n\nEvidence: u6, u7');
  });

  it('fixes parents only to earlier lower-level topics', () => {
    const ok = run({ parents: [{ node: 'n4', parent: 'n3' }] });
    expect(ok.after.nodes.C!.parentId).toBe('B');
    const bad = run({
      parents: [
        { node: 'n4', parent: 'n5' },
        { node: 'n1', parent: 'n3' },
      ],
    });
    expect(bad.after.nodes.C!.parentId).toBeNull();
    expect(bad.after.nodes.A!.parentId).toBeNull();
    expect(bad.r.warnings).toHaveLength(2);
  });

  it('corrects thread status and links a resolved thread to where it was discussed', () => {
    const { after } = run({
      thread_status: [
        { node: 'p6', status: 'resolved', discussed_in: 'n3' },
        { node: 'n1', status: 'resolved', discussed_in: null },
      ],
    });
    expect(after.nodes.P!.status).toBe('resolved');
    expect(after.nodes.A!.status).toBe('closed');
    expect(
      Object.values(after.edges).some((e) => e.kind === 'tether' && e.sourceId === 'P' && e.targetId === 'B'),
    ).toBe(true);
  });

  it('adds missed commitments with speaker and time from the transcript, skipping duplicates', () => {
    const { after } = run({
      commitments: [
        { text: 'Send Lena the lecture link', utterance: 'u8', node: null },
        { text: 'send lena the lecture link', utterance: 'u9', node: null },
        { text: 'bogus', utterance: 'u99', node: null },
      ],
    });
    expect(after.commitments).toHaveLength(1);
    expect(after.commitments[0]).toMatchObject({
      text: 'Send Lena the lecture link',
      speaker: 1,
      atMs: 35_000,
      nodeId: 'B',
    });
  });

  it('sets speakers from the diarized transcript, title (≤ 6 words), summary and up to 3 recall prompts', () => {
    const { r, after } = run({
      title: '"Free Will, a Job Offer and Another Return"',
      summary: 'They argued about free will, then the job, then free will again.',
      recall_prompts: [
        { node: 'n3', prompt: 'What made Marcus lean yes?' },
        { node: 'n99', prompt: 'dropped' },
        { node: 'n1', prompt: 'a' },
        { node: 'n5', prompt: 'b' },
        { node: 'n2', prompt: 'c' },
      ],
    });
    expect(after.nodes.A!.speakers).toEqual([0, 1]);
    expect(after.conversation.title).toBe('Free Will, a Job Offer and');
    expect(after.conversation.summary).toContain('free will again');
    expect(r.recallPrompts).toEqual([
      { nodeId: 'B', prompt: 'What made Marcus lean yes?' },
      { nodeId: 'A', prompt: 'a' },
      { nodeId: 'A2', prompt: 'b' },
    ]);
  });
});

describe('createFinalizer', () => {
  it('calls the refine model with the schema, retries an invalid answer once, and returns ops', async () => {
    const { state, utterances } = liveGraph();
    const llm = scriptedLlm((_a, n) => (n === 1 ? { title: 1 } : { ...empty, title: 'Free Will Talk', summary: 's' }));
    const fin = createFinalizer({ llm, systemPrompt: 'SYS' });
    const r = await fin({ state, utterances, newId: () => 'x' });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]!.schema).toBe(FINALIZE_JSON_SCHEMA);
    expect(llm.calls[1]!.user).toContain('YOUR PREVIOUS ANSWER WAS INVALID');
    expect(r.ops.some((o) => o.op === 'conversation.update')).toBe(true);
  });

  it('leaves the live graph standing when the model fails twice', async () => {
    const { state, utterances } = liveGraph();
    const llm = scriptedLlm(() => {
      throw new Error('boom');
    });
    const r = await createFinalizer({ llm, systemPrompt: 'SYS' })({ state, utterances, newId: () => 'x' });
    expect(r).toEqual({ ops: [], recallPrompts: [] });
    expect(llm.calls).toHaveLength(2);
  });

  it('skips the call for an empty conversation', async () => {
    const llm = scriptedLlm(() => empty);
    const r = await createFinalizer({ llm })({ state: makeGraph(), utterances: [], newId: () => 'x' });
    expect(r.ops).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });
});
