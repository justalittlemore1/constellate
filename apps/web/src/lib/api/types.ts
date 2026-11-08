/**
 * Web-side data shapes that are not (yet) in `@constellate/shared`. These are local adapters for
 * rows the browser reads directly from Supabase and for the `GET /brain` payload served by A1
 * (`apps/server/src/brain/rebuild.ts → BrainResponse`). If they move into the contract, switch to it.
 */
import type { Commitment, Conversation, GraphState, Ms, TopicNode, Utterance } from '@constellate/shared';

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

  updateCommitment(id: string, patch: Partial<Pick<Commitment, 'text' | 'done'>>): Promise<void>;

  listRecallCards(conversationId: string): Promise<RecallCard[]>;
  recordRecall(id: string, result: 'remembered' | 'forgot'): Promise<void>;

  listFavoriteMoments(): Promise<FavoriteMoment[]>;

  getBrain(): Promise<BrainPayload>;
  rebuildBrain(): Promise<RebuildResult>;
  searchConcepts(query: string): Promise<ConceptSearchResult[]>;

  /** signed URL for a recording (null when there is none, e.g. in mock mode) */
  audioUrl(audioPath: string | null): Promise<string | null>;

  /** delete every conversation (recording + rows), folder and concept of the signed-in user */
  deleteMyData(): Promise<void>;
}

/** A topic node is "an open thread" when it was deferred or parked and never picked up. */
export function isOpenThread(n: TopicNode): boolean {
  return (n.kind === 'pending' || n.kind === 'parked') && n.status !== 'resolved';
}
