/**
 * Web-side data shapes that are not (yet) in `@constellate/shared`. These are local adapters for
 * rows the browser reads directly from Supabase and for the `GET /brain` payload served by A1
 * (`apps/server/src/brain/rebuild.ts → BrainResponse`). If they move into the contract, switch to it.
 */
import type { Conversation, GraphOp, GraphState, Ms, OpBatch, TopicNode, Utterance } from '@constellate/shared';

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface Participant {
  id: string;
  conversationId: string;
  displayName: string;
  speakerIndex: number | null;
}

export interface RecallCard {
  id: string;
  conversationId: string;
  nodeId: string | null;
  prompt: string;
  dueAt: string | null;
  lastResult: string | null;
}

export type ConceptRelation = 'broader' | 'related' | 'co_discussed';

export interface Concept {
  id: string;
  name: string;
  description: string | null;
  parentConceptId: string | null;
  mentionCount: number;
}

export interface ConceptLink {
  sourceId: string;
  targetId: string;
  relation: ConceptRelation;
  weight: number;
}

/** One moment a concept was discussed. */
export interface Occurrence {
  conversationId: string;
  conversationTitle: string;
  startedAt: string;
  audioPath: string | null;
  nodeId: string;
  label: string;
  summary: string;
  startMs: Ms;
}

export interface BrainPayload {
  concepts: Concept[];
  links: ConceptLink[];
  /** by concept id, in conversation order */
  occurrences: Record<string, Occurrence[]>;
}

export interface RebuildResult {
  conversations: number;
  newConcepts: number;
  concepts: number;
  links: number;
}

export interface ConceptSearchResult {
  id: string;
  name: string;
  similarity: number;
}

/** A highlighted node or a flagged moment, for /favorites. */
export interface FavoriteMoment {
  kind: 'highlight' | 'flag';
  id: string;
  conversationId: string;
  conversationTitle: string;
  audioPath: string | null;
  nodeId: string | null;
  label: string;
  summary: string;
  atMs: Ms;
}

/** Fields the user may edit (the server owns status, timing and the recording path). */
export type ConversationPatch = Partial<
  Pick<Conversation, 'title' | 'folderId' | 'isFavorite' | 'isSolo' | 'location' | 'reflection'>
>;

/**
 * Everything the shell, library, diary, favourites, settings and Brain screens read or write.
 * `createRealApi` talks to Supabase (lists, RLS) and the server REST API (graphs, Brain);
 * `createMockApi` serves the fixtures in memory for VITE_USE_MOCKS=1 and tests.
 */
export interface Api {
  listConversations(): Promise<Conversation[]>;
  updateConversation(id: string, patch: ConversationPatch): Promise<void>;

  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  /** conversations inside move back to "no folder" (FK on delete set null) */
  deleteFolder(id: string): Promise<void>;

  getGraph(conversationId: string): Promise<GraphState>;
  listUtterances(conversationId: string): Promise<Utterance[]>;

  listParticipants(conversationIds: string[]): Promise<Participant[]>;
  addParticipant(conversationId: string, displayName: string): Promise<Participant>;
  removeParticipant(id: string): Promise<void>;

  /**
   * Save user edits as a `source: 'user'` batch (`POST /conversations/:id/ops`). The server validates
   * them with the shared reducer; a refusal rejects with the server's message.
   */
  postOps(conversationId: string, ops: GraphOp[]): Promise<{ batch?: OpBatch }>;

  listRecallCards(conversationId: string): Promise<RecallCard[]>;
  recordRecall(id: string, result: 'remembered' | 'forgot'): Promise<void>;

  listFavoriteMoments(): Promise<FavoriteMoment[]>;

  getBrain(): Promise<BrainPayload>;
  rebuildBrain(): Promise<RebuildResult>;
  searchConcepts(query: string): Promise<ConceptSearchResult[]>;

  /** signed URL for a recording (null when there is none, e.g. in mock mode) */
  audioUrl(audioPath: string | null): Promise<string | null>;

  /**
   * `DELETE /me/data`: every conversation (rows + recording), folder and Brain concept of the
   * signed-in user, in one server transaction. Throws only when the request itself fails.
   */
  deleteMyData(): Promise<DeleteResult>;

  readonly capabilities: ApiCapabilities;
}

export interface ApiCapabilities {
  /** promise (commitment) edits, saved as `commitment.update` user ops */
  editCommitments: boolean;
}

/** What `DELETE /me/data` removed (A1: apps/server/src/routes/me.ts). */
export interface DeletedCounts {
  conversations: number;
  folders: number;
  concepts: number;
  conceptLinks: number;
  /** absent when the recordings step failed (502) */
  recordings?: number;
}

export type DeleteResult =
  /** 200: everything is gone */
  | { outcome: 'deleted'; deleted: DeletedCounts }
  /** 502: every row is gone, but some recordings are left; calling again removes them */
  | { outcome: 'recordings-left'; deleted: DeletedCounts }
  /** 503: the database step failed, so nothing was deleted */
  | { outcome: 'nothing-deleted' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 conversations, 2 folders, 8 Brain concepts and 3 recordings" */
export function describeDeleted(d: DeletedCounts): string {
  const parts = [
    plural(d.conversations, 'conversation', 'conversations'),
    plural(d.folders, 'folder', 'folders'),
    plural(d.concepts, 'Brain concept', 'Brain concepts'),
  ];
  if (d.recordings !== undefined) parts.push(plural(d.recordings, 'recording', 'recordings'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
}

/** A topic node is "an open thread" when it was deferred or parked and never picked up. */
export function isOpenThread(n: TopicNode): boolean {
  return (n.kind === 'pending' || n.kind === 'parked') && n.status !== 'resolved';
}
