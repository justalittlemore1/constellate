/**
 * Core domain types. Frozen at the H1 checkpoint — change only through a PR labelled `contract`
 * (additive changes only: new optional fields or new union members). See AGENTS.md.
 *
 * TypeScript uses camelCase; Postgres uses snake_case. `db.ts` converts between them.
 */

/** Milliseconds on the server audio clock (bytes of 16 kHz s16le mono PCM received ÷ 32). */
export type Ms = number;

/**
 * topic   – something actually discussed
 * pending – a speaker deferred it ("remind me to tell you about soccer")
 * parked  – the user typed it mid-conversation with "Park a thought"
 */
export type NodeKind = 'topic' | 'pending' | 'parked';

/**
 * provisional – created but not yet confirmed by the commit gate (rendered faint)
 * active      – the topic currently being discussed (at most one)
 * closed      – a topic the conversation has moved on from
 * unexplored  – a pending/parked thread never picked up before the conversation ended
 * resolved    – a pending/parked thread that was later discussed
 */
export type NodeStatus = 'provisional' | 'active' | 'closed' | 'unexplored' | 'resolved';

/** 0 = theme (reserved; the macro anchor lives on the conversation) · 1 = subtopic · 2 = specific idea */
export type Level = 0 | 1 | 2;

export interface TopicNode {
  id: string;
  conversationId: string;
  kind: NodeKind;
  status: NodeStatus;
  level: Level;
  /** 1–4 words, Title Case, no trailing punctuation */
  label: string;
  /** one sentence, ≤ 140 chars (hover / preview card) */
  summary: string;
  /** markdown, filled by the finalisation pass */
  details: string | null;
  /** conceptual parent (subtopic → idea) */
  parentId: string | null;
  /** shared by every occurrence of the same topic (revisits reuse it) */
  threadId: string;
  /** creation order within the conversation, from 1 */
  seq: number;
  startMs: Ms;
  endMs: Ms | null;
  /** pending/parked only: when it was raised */
  mentionedAtMs: Ms | null;
  /** evidence, e.g. ['u41', 'u42'] */
  utteranceIds: string[];
  /** diarized speaker indices; empty until finalised */
  speakers: number[];
  highlighted: boolean;
  createdBy: 'ai' | 'user';
  /** persisted layout position — computed once by `placeNode`, never recomputed */
  x: number;
  y: number;
}

/**
 * flow    – the conversation moved A → B
 * revisit – new occurrence → earlier occurrence of the same thread
 * tether  – pending/parked node ↔ node where it was raised, or → node that resolved it
 * user    – drawn by the user
 */
export type EdgeKind = 'flow' | 'revisit' | 'tether' | 'user';

export interface TopicEdge {
  id: string;
  conversationId: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
}

export interface Utterance {
  /** 'u1', 'u2', … stable within a conversation */
  id: string;
  conversationId: string;
  speaker: number | null;
  startMs: Ms;
  endMs: Ms;
  text: string;
}

export type FlagSource = 'button' | 'key' | 'media' | 'tap';

export interface Flag {
  id: string;
  conversationId: string;
  atMs: Ms;
  nodeId: string | null;
  note: string | null;
  source: FlagSource;
}

export interface Commitment {
  id: string;
  conversationId: string;
  nodeId: string | null;
  text: string;
  speaker: number | null;
  atMs: Ms;
  done: boolean;
}

export interface Annotation {
  id: string;
  conversationId: string;
  nodeId: string | null;
  text: string;
  x: number;
  y: number;
}

export type ConversationStatus = 'live' | 'processing' | 'ready' | 'failed';

export interface Conversation {
  id: string;
  userId: string;
  folderId: string | null;
  title: string;
  summary: string | null;
  macroAnchor: string | null;
  status: ConversationStatus;
  isSolo: boolean;
  isFavorite: boolean;
  location: string | null;
  reflection: string | null;
  /** ISO 8601 */
  startedAt: string;
  endedAt: string | null;
  durationMs: Ms | null;
  audioPath: string | null;
}

export interface GraphState {
  conversation: Conversation;
  nodes: Record<string, TopicNode>;
  edges: Record<string, TopicEdge>;
  activeNodeId: string | null;
  flags: Flag[];
  commitments: Commitment[];
  annotations: Annotation[];
  /** seq of the last applied OpBatch; 0 for a fresh conversation */
  lastSeq: number;
}

export function emptyGraph(conversation: Conversation): GraphState {
  return {
    conversation,
    nodes: {},
    edges: {},
    activeNodeId: null,
    flags: [],
    commitments: [],
    annotations: [],
    lastSeq: 0,
  };
}

/** Nodes sorted by creation order. */
export function nodesInOrder(state: GraphState): TopicNode[] {
  return Object.values(state.nodes).sort((a, b) => a.seq - b.seq);
}

/**
 * The topic node being discussed at time `ms` (latest-created topic whose span covers it),
 * used to attach flags to nodes. Returns null before the first topic.
 */
export function topicAt(state: GraphState, ms: Ms): TopicNode | null {
  let best: TopicNode | null = null;
  for (const n of Object.values(state.nodes)) {
    if (n.kind !== 'topic' || n.status === 'provisional') continue;
    const end = n.endMs ?? Number.POSITIVE_INFINITY;
    if (n.startMs <= ms && ms < end && (!best || n.seq > best.seq)) best = n;
  }
  return best;
}
