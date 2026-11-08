import type { Conversation, GraphState, OpBatch, Utterance } from '@constellate/shared';

export interface OwnedConversation {
  conversation: Conversation;
  lastSeq: number;
  brainBuiltAt: string | null;
}

export interface NodeMatch {
  id: string;
  similarity: number;
}

/** Topic node row as the Brain build needs it (server-only columns included). */
export interface BrainNodeRow {
  id: string;
  conversationId: string;
  label: string;
  summary: string;
  level: number;
  startMs: number;
  embedding: number[] | null;
  conceptId: string | null;
}

export interface ConceptRow {
  id: string;
  name: string;
  description: string | null;
  parentConceptId: string | null;
  mentionCount: number;
  embedding: number[] | null;
}

export interface ConceptLinkRow {
  sourceId: string;
  targetId: string;
  relation: 'broader' | 'related' | 'co_discussed';
  weight: number;
}

/**
 * Every database and storage call the server makes. `SupabaseStore` is the real one;
 * `MemoryStore` backs the tests and keyless local development. Callers do owner checks
 * (`conversation.userId === userId`) before acting; the store trusts its inputs.
 */
export interface Store {
  createConversation(userId: string, init?: Partial<Pick<Conversation, 'isSolo' | 'title'>>): Promise<Conversation>;
  getConversation(id: string): Promise<OwnedConversation | null>;
  /** GraphState from the materialised tables; null if the conversation does not exist */
  loadGraph(conversationId: string): Promise<GraphState | null>;
  /**
   * Persist one applied batch: insert into op_log (unique on conversation + seq), then bring the
   * materialised rows from `prev` to `next`, then set conversations.last_seq.
   */
  appendBatch(userId: string, batch: OpBatch, prev: GraphState, next: GraphState): Promise<void>;

  insertUtterance(userId: string, u: Utterance): Promise<void>;
  listUtterances(conversationId: string): Promise<Utterance[]>;
  replaceUtterances(userId: string, conversationId: string, utterances: Utterance[]): Promise<void>;

  saveEmbedding(nodeId: string, embedding: number[]): Promise<void>;
  matchNodes(conversationId: string, embedding: number[], k: number, excludeId?: string): Promise<NodeMatch[]>;

  insertRecallCards(userId: string, conversationId: string, cards: { nodeId: string; prompt: string }[]): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;

  /** recordings bucket */
  downloadRecording(path: string): Promise<Buffer | null>;
  deleteRecording(path: string): Promise<void>;

  // ── Brain ──
  listConversations(userId: string): Promise<OwnedConversation[]>;
  listBrainNodes(conversationIds: string[]): Promise<BrainNodeRow[]>;
  listConcepts(userId: string): Promise<ConceptRow[]>;
  listConceptLinks(userId: string): Promise<ConceptLinkRow[]>;
  matchConcepts(userId: string, embedding: number[], k: number): Promise<NodeMatch[]>;
  upsertConcepts(userId: string, concepts: ConceptRow[]): Promise<void>;
  setNodeConcepts(assignments: { nodeId: string; conceptId: string }[]): Promise<void>;
  replaceConceptLinks(userId: string, links: ConceptLinkRow[]): Promise<void>;
  markBrainBuilt(conversationIds: string[], at: string): Promise<void>;
}
