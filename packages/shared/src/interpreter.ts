/**
 * The contract between apps/server (A1) and packages/interpreter (A2).
 * The server owns I/O (database, sockets, ids, embeddings API); the interpreter owns decisions.
 */
import type { GraphState, Ms, Utterance } from './domain';
import type { GraphOp } from './ops';

export interface InterpreterDeps {
  conversationId: string;
  /** latest state, after every batch emitted so far has been applied */
  getState(): GraphState;
  /** the server wraps ops into an OpBatch (assigns seq), applies, persists and broadcasts */
  emit(ops: GraphOp[]): void;
  /** new UUID v4 */
  newId(): string;
  /** unit-normalised embeddings, MODELS.embedDims long, one per input text */
  embed(texts: string[]): Promise<number[][]>;
  /** nearest topic nodes in this conversation by cosine similarity (pgvector `match_nodes`) */
  matchNodes(embedding: number[], k: number, excludeId?: string): Promise<{ id: string; similarity: number }[]>;
  /** store an embedding for a node (server writes nodes.embedding) */
  saveEmbedding(nodeId: string, embedding: number[]): Promise<void>;
  /** current audio clock */
  nowMs(): Ms;
  /** `thinking` while an LLM call is in flight, `listening` otherwise */
  setStage?(stage: 'listening' | 'thinking'): void;
  log?(event: string, data?: Record<string, unknown>): void;
}

export interface LiveInterpreter {
  /** feed a finalised utterance; the interpreter decides when to think */
  pushUtterance(u: Utterance): void;
  /** user typed "Park a thought" */
  park(text: string, atMs: Ms): void;
  /** flush the buffer, close the active node, turn pending/parked threads into `unexplored` */
  stop(): Promise<void>;
}

export type CreateLiveInterpreter = (deps: InterpreterDeps) => LiveInterpreter;

export interface FinalizeInput {
  state: GraphState;
  /** diarized transcript when available, otherwise the live transcript */
  utterances: Utterance[];
  newId(): string;
}

export interface FinalizeResult {
  ops: GraphOp[];
  /** up to 3 recall prompts, stored by the server in recall_cards */
  recallPrompts: { nodeId: string; prompt: string }[];
}

export type FinalizeConversation = (input: FinalizeInput) => Promise<FinalizeResult>;

/** Shape of packages/shared/fixtures/transcripts/*.json (written by A2). */
export interface TranscriptFixture {
  id: string;
  title: string;
  description: string;
  /** display names, index = speaker number */
  speakers: string[];
  utterances: { speaker: number; startMs: Ms; endMs: Ms; text: string }[];
  /** hand-labelled expectations used by the eval harness; shape owned by packages/interpreter */
  expect?: Record<string, unknown>;
}
