/**
 * Generates packages/shared/fixtures/ops/religion-demo.jsonl and graphs/religion-demo.json by
 * building the conversation through the real reducer and layout, so the two fixtures can never
 * disagree with each other or with the contracts.
 *
 *   pnpm fixtures        (tsx scripts/build-fixtures.ts)
 *
 * Owned by A0. Exercises every node kind, status and edge kind, a provisional node that is
 * removed, two revisits, a resolved and an unresolved pending thread, a parked thought,
 * two flags, a commitment, a note, a highlighted branch and a finalisation batch.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Import modules directly (not the index) so this script runs without zod installed.
import { emptyGraph, type Conversation, type GraphState, type Level, type NodeKind, type TopicNode } from '../packages/shared/src/domain';
import { applyOps, type GraphOp, type OpBatch, type OpSource } from '../packages/shared/src/ops';
import { placeNode } from '../packages/shared/src/layout';
import { recordingPath } from '../packages/shared/src/db';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'packages', 'shared', 'fixtures');

function uuid(name: string): string {
  const h = createHash('sha1').update(`constellate-fixture:${name}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const USER = uuid('user:demo');
const CONV = uuid('conversation:religion-demo');
const T0 = Date.parse('2026-11-07T20:00:00.000Z');

const startConversation: Conversation = {
  id: CONV,
  userId: USER,
  folderId: null,
  title: 'Untitled conversation',
  summary: null,
  macroAnchor: null,
  status: 'live',
  isSolo: false,
  isFavorite: true,
  location: 'Koerner Library cafe',
  reflection: 'Sam surprised me on the historical evidence. Follow up on Camus.',
  startedAt: new Date(T0).toISOString(),
  endedAt: null,
  durationMs: null,
  audioPath: null,
};

let state: GraphState = emptyGraph(startConversation);
const batches: OpBatch[] = [];
let nodeSeq = 0;
let uttCounter = 0;

function commit(atMs: number, ops: GraphOp[], source: OpSource = 'live'): void {
  const b: OpBatch = {
    conversationId: CONV,
    seq: batches.length + 1,
    at: new Date(T0 + atMs).toISOString(),
    source,
    ops,
  };
  state = applyOps(state, b);
  batches.push(b);
}

function utterances(n: number): string[] {
  return Array.from({ length: n }, () => `u${++uttCounter}`);
}

interface NewNode {
  key: string;
  kind?: NodeKind;
  status?: TopicNode['status'];
  level: Level;
  label: string;
  summary: string;
  parentKey?: string;
  threadKey?: string;
  startMs: number;
  mentionedAtMs?: number;
  utts?: number;
  createdBy?: 'ai' | 'user';
  revisitOfKey?: string;
  anchorKey?: string;
}

function makeNode(n: NewNode): TopicNode {
  const id = uuid(`node:${n.key}`);
  const base = {
    id,
    kind: n.kind ?? ('topic' as const),
    level: n.level,
  };
  const pos = placeNode(state, base, {
    revisitOfId: n.revisitOfKey ? uuid(`node:${n.revisitOfKey}`) : undefined,
    anchorNodeId: n.anchorKey ? uuid(`node:${n.anchorKey}`) : undefined,
  });
  return {
    ...base,
    conversationId: CONV,
    status: n.status ?? 'active',
    label: n.label,
    summary: n.summary,
    details: null,
    parentId: n.parentKey ? uuid(`node:${n.parentKey}`) : null,
    threadId: uuid(`thread:${n.threadKey ?? n.key}`),
    seq: ++nodeSeq,
    startMs: n.startMs,
    endMs: null,
    mentionedAtMs: n.mentionedAtMs ?? null,
    utteranceIds: utterances(n.utts ?? 4),
    speakers: [],
    highlighted: false,
    createdBy: n.createdBy ?? 'ai',
    x: pos.x,
    y: pos.y,
  };
}

const id = (key: string) => uuid(`node:${key}`);
const edge = (key: string, from: string, to: string, kind: 'flow' | 'revisit' | 'tether') => ({
  op: 'edge.add' as const,
  edge: { id: uuid(`edge:${key}`), conversationId: CONV, sourceId: id(from), targetId: id(to), kind },
});

/** Close the active topic and open a new one with a flow edge (plus a revisit edge if given). */
function moveTo(prevKey: string | null, n: NewNode): void {
  const ops: GraphOp[] = [];
  if (prevKey) ops.push({ op: 'node.update', id: id(prevKey), patch: { status: 'closed', endMs: n.startMs } });
  const node = makeNode(n);
  ops.push({ op: 'node.add', node });
  if (prevKey) ops.push(edge(`flow:${prevKey}->${n.key}`, prevKey, n.key, 'flow'));
  if (n.revisitOfKey) ops.push(edge(`revisit:${n.key}->${n.revisitOfKey}`, n.key, n.revisitOfKey, 'revisit'));
  ops.push({ op: 'active.set', nodeId: node.id });
  commit(n.startMs + 2_500, ops);
}

function thread(n: NewNode, atMs: number): void {
  const node = makeNode({ ...n, status: 'active' });
  commit(atMs, [
    { op: 'node.add', node },
    edge(`tether:${n.key}`, n.anchorKey!, n.key, 'tether'),
  ]);
}

// ── live phase ───────────────────────────────────────────────────────────────
moveTo(null, { key: 'n1', level: 1, label: 'Sunday Service', summary: 'Sam describes the new church he has started attending on Sundays.', startMs: 0, utts: 6 });
moveTo('n1', { key: 'n2', level: 1, label: 'Historical Jesus', summary: 'Whether Jesus existed as a historical figure and what historians agree on.', startMs: 70_000, utts: 8 });
commit(90_000, [{ op: 'conversation.update', patch: { macroAnchor: 'Religion and belief' } }]);
moveTo('n2', { key: 'n3', level: 2, label: 'Gospel Sources', summary: 'How the gospels were written, dated and copied, and the Q source idea.', parentKey: 'n2', startMs: 160_000, utts: 6 });
commit(195_000, [{ op: 'flag.add', flag: { id: uuid('flag:f1'), conversationId: CONV, atMs: 195_000, nodeId: id('n3'), note: null, source: 'key' } }]);
thread({ key: 'p1', kind: 'pending', level: 1, label: 'Intramural Soccer', summary: 'Alex wanted to tell Sam about intramural soccer later.', startMs: 200_000, mentionedAtMs: 200_000, anchorKey: 'n3', utts: 1 }, 201_000);
moveTo('n3', { key: 'n4', level: 2, label: 'Resurrection Accounts', summary: 'Comparing the gospel accounts of the empty tomb and what they agree on.', parentKey: 'n2', startMs: 230_000, utts: 7 });
commit(270_000, [{ op: 'commitment.add', commitment: { id: uuid('commitment:c1'), conversationId: CONV, nodeId: id('n4'), text: 'Send Sam the reading list on the resurrection debate', speaker: 0, atMs: 270_000, done: false } }]);
moveTo('n4', { key: 'n5', level: 1, label: 'Faith vs Evidence', summary: 'Whether belief needs evidence, or whether faith is a different kind of knowing.', startMs: 310_000, utts: 7 });
// a ten-second joke the commit gate rejects
const joke = makeNode({ key: 'x1', status: 'provisional', level: 2, label: 'Pizza Toppings', summary: 'A quick joke about pineapple on pizza.', parentKey: 'n5', startMs: 355_000, utts: 1 });
commit(357_000, [{ op: 'node.add', node: joke }]);
commit(370_000, [{ op: 'node.remove', id: joke.id }]);
moveTo('n5', { key: 'n6', level: 2, label: 'Personal Doubts', summary: 'Alex shares the moments that made them doubt what they were raised with.', parentKey: 'n5', startMs: 380_000, utts: 5 });
thread({ key: 'q1', kind: 'parked', level: 1, label: 'Ask About Internship', summary: 'Parked by the user: ask Sam about the internship.', startMs: 400_000, mentionedAtMs: 400_000, anchorKey: 'n6', createdBy: 'user', utts: 0 }, 400_500);
moveTo('n6', { key: 'n7', level: 2, label: 'Resurrection Accounts', summary: 'Back to the resurrection: could the accounts be read metaphorically?', parentKey: 'n2', threadKey: 'n4', revisitOfKey: 'n4', startMs: 420_000, utts: 5 });
commit(445_000, [{ op: 'flag.add', flag: { id: uuid('flag:f2'), conversationId: CONV, atMs: 445_000, nodeId: id('n7'), note: null, source: 'media' } }]);
moveTo('n7', { key: 'n8', level: 1, label: 'Camus and Absurdism', summary: 'Camus on meaning without God, and the myth of Sisyphus.', startMs: 470_000, utts: 5 });
thread({ key: 'p2', kind: 'pending', level: 1, label: 'Summer Road Trip', summary: 'Sam said they should plan the summer road trip before leaving.', startMs: 480_000, mentionedAtMs: 480_000, anchorKey: 'n8', utts: 1 }, 481_000);
moveTo('n8', { key: 'n9', level: 1, label: 'Summer Road Trip', summary: 'Planning a road trip through the Rockies in July.', startMs: 520_000, utts: 5 });
commit(523_000, [
  { op: 'node.update', id: id('p2'), patch: { status: 'resolved' } },
  edge('tether:p2->n9', 'p2', 'n9', 'tether'),
]);
moveTo('n9', { key: 'n10', level: 1, label: 'Faith vs Evidence', summary: 'Returning to faith and evidence, now through Camus.', threadKey: 'n5', revisitOfKey: 'n5', startMs: 570_000, utts: 5 });

// stop: close the active topic, unpicked threads become unexplored
commit(620_000, [
  { op: 'node.update', id: id('n10'), patch: { status: 'closed', endMs: 620_000 } },
  { op: 'active.set', nodeId: null },
  { op: 'node.update', id: id('p1'), patch: { status: 'unexplored' } },
  { op: 'node.update', id: id('q1'), patch: { status: 'unexplored' } },
  { op: 'conversation.update', patch: { status: 'processing', endedAt: new Date(T0 + 620_000).toISOString(), durationMs: 620_000 } },
]);

// ── user edits after the conversation ───────────────────────────────────────
const n4 = state.nodes[id('n4')]!;
commit(700_000, [
  { op: 'node.update', id: id('n4'), patch: { highlighted: true } },
  { op: 'node.update', id: id('n7'), patch: { highlighted: true } },
  { op: 'annotation.upsert', annotation: { id: uuid('annotation:a1'), conversationId: CONV, nodeId: id('n4'), text: 'Look up the Q source hypothesis', x: n4.x + 70, y: n4.y - 36 } },
], 'user');

// ── finalisation pass ───────────────────────────────────────────────────────
const details: Record<string, string> = {
  n1: 'Sam has started attending a small evangelical church near campus and likes the community more than the services.',
  n2: 'Both agree most historians accept a historical Jesus; they disagree on how much the gospels can tell us about him.',
  n3: 'Alex explains Markan priority and the Q hypothesis; Sam had never heard the gospels were written decades later.',
  n4: 'They compare the empty-tomb stories across Mark, Matthew, Luke and John and note where the details diverge.',
  n5: 'Sam argues faith is trust rather than a claim about evidence; Alex is unconvinced but finds the distinction useful.',
  n6: 'Alex describes growing up religious and the specific moments that started their doubts.',
  n7: 'Returning to the resurrection, they discuss metaphorical readings and whether those still count as belief.',
  n8: 'Alex introduces Camus: meaning is made, not found, and Sisyphus can be imagined happy.',
  n9: 'They sketch a two-week trip through the Rockies in July, starting in Banff.',
  n10: 'Bringing Camus back to faith: both think choosing to live meaningfully is a kind of faith.',
};
commit(
  760_000,
  [
    ...Object.entries(details).map(([k, d]): GraphOp => ({ op: 'node.update', id: id(k), patch: { details: d, speakers: [0, 1] } })),
    {
      op: 'conversation.update',
      patch: {
        title: 'Faith, Camus and a Road Trip',
        summary: 'From church and the historical Jesus to Camus, with a road trip planned and soccer left for next time.',
        status: 'ready',
        audioPath: recordingPath(USER, CONV),
      },
    },
  ],
  'finalize',
);

mkdirSync(join(out, 'ops'), { recursive: true });
mkdirSync(join(out, 'graphs'), { recursive: true });
writeFileSync(join(out, 'ops', 'religion-demo.jsonl'), batches.map((b) => JSON.stringify(b)).join('\n') + '\n');
writeFileSync(join(out, 'graphs', 'religion-demo.json'), JSON.stringify(state, null, 2) + '\n');
console.log(`wrote ${batches.length} batches, ${Object.keys(state.nodes).length} nodes, ${Object.keys(state.edges).length} edges`);
