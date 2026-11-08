import { randomUUID } from 'node:crypto';
import {
  emptyGraph,
  type Conversation,
  type GraphState,
  type OpBatch,
  type TopicNode,
  type Utterance,
} from '@constellate/shared';
import { diffStates } from './diff';
import { replayGraph } from './replay';
import type { BrainNodeRow, ConceptLinkRow, ConceptRow, NodeMatch, OwnedConversation, Store } from './types';

const clone = <T>(v: T): T => structuredClone(v);

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

interface ConvRecord {
  row: OwnedConversation;
  graph: GraphState;
  opLog: Map<number, OpBatch>;
  utterances: Utterance[];
  recallCards: { nodeId: string; prompt: string }[];
}

/**
 * In-memory Store for tests and for running the server without Supabase. It applies the same
 * row diff as the real store, so a reload round-trips exactly what was persisted.
 */
export class MemoryStore implements Store {
  readonly convs = new Map<string, ConvRecord>();
  readonly recordings = new Map<string, Buffer>();
  readonly embeddings = new Map<string, number[]>();
  readonly nodeConcepts = new Map<string, string>();
  concepts = new Map<string, ConceptRow & { userId: string }>();
  links: (ConceptLinkRow & { userId: string })[] = [];
  /** set to make the next call of that method throw (failure injection in tests) */
  failNext: Partial<Record<keyof Store, Error>> = {};

  private check(method: keyof Store): void {
    const err = this.failNext[method];
    if (err) {
      delete this.failNext[method];
      throw err;
    }
  }

  private rec(id: string): ConvRecord {
    const r = this.convs.get(id);
    if (!r) throw new Error(`conversation ${id} not found`);
    return r;
  }

  async createConversation(userId: string, init: Partial<Pick<Conversation, 'isSolo' | 'title'>> = {}) {
    this.check('createConversation');
    const conversation: Conversation = {
      id: randomUUID(),
      userId,
      folderId: null,
      title: init.title ?? 'Untitled conversation',
      summary: null,
      macroAnchor: null,
      status: 'live',
      isSolo: init.isSolo ?? false,
      isFavorite: false,
      location: null,
      reflection: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      audioPath: null,
    };
    this.convs.set(conversation.id, {
      row: { conversation, lastSeq: 0, brainBuiltAt: null },
      graph: emptyGraph(conversation),
      opLog: new Map(),
      utterances: [],
      recallCards: [],
    });
    return clone(conversation);
  }

  async getConversation(id: string) {
    this.check('getConversation');
    const r = this.convs.get(id);
    return r ? clone(r.row) : null;
  }

  async loadGraph(conversationId: string) {
    this.check('loadGraph');
    const r = this.convs.get(conversationId);
    if (!r) return null;
    const batches = [...r.opLog.values()].sort((a, b) => a.seq - b.seq);
    return replayGraph(clone(r.row.conversation), clone(batches));
  }

  /** the materialised rows as a GraphState (what other clients read through RLS) */
  materialized(conversationId: string): GraphState {
    const r = this.rec(conversationId);
    const g = clone(r.graph);
    g.conversation = clone(r.row.conversation);
    g.lastSeq = r.row.lastSeq;
    g.activeNodeId = null;
    return g;
  }

  async appendBatch(_userId: string, batch: OpBatch, prev: GraphState, next: GraphState) {
    this.check('appendBatch');
    const r = this.rec(batch.conversationId);
    // like the real store: a retried batch is ignored by the op_log, the row upserts are idempotent
    if (!r.opLog.has(batch.seq)) r.opLog.set(batch.seq, clone(batch));
    const d = diffStates(prev, next);
    const g = r.graph;
    for (const n of d.upsertNodes) g.nodes[n.id] = clone(n);
    for (const e of d.upsertEdges) g.edges[e.id] = clone(e);
    for (const id of d.deleteEdgeIds) delete g.edges[id];
    const upsert = <T extends { id: string }>(list: T[], items: T[]) => {
      for (const it of items) {
        const i = list.findIndex((x) => x.id === it.id);
        if (i === -1) list.push(clone(it));
        else list[i] = clone(it);
      }
    };
    upsert(g.flags, d.upsertFlags);
    upsert(g.commitments, d.upsertCommitments);
    upsert(g.annotations, d.upsertAnnotations);
    for (const id of d.deleteNodeIds) {
      delete g.nodes[id];
      this.embeddings.delete(id);
      for (const e of Object.values(g.edges)) if (e.sourceId === id || e.targetId === id) delete g.edges[e.id];
      for (const n of Object.values(g.nodes)) if (n.parentId === id) n.parentId = null;
      for (const list of [g.flags, g.commitments, g.annotations])
        for (const x of list) if (x.nodeId === id) x.nodeId = null;
    }
    r.row.conversation = { ...r.row.conversation, ...clone(d.conversationPatch) };
    r.row.lastSeq = batch.seq;
  }

  async insertUtterance(_userId: string, u: Utterance) {
    this.check('insertUtterance');
    const r = this.rec(u.conversationId);
    if (r.utterances.some((x) => x.id === u.id)) throw new Error(`duplicate utterance ${u.id}`);
    r.utterances.push(clone(u));
  }

  async listUtterances(conversationId: string) {
    this.check('listUtterances');
    return clone(this.rec(conversationId).utterances).sort((a, b) => a.startMs - b.startMs);
  }

  async replaceUtterances(_userId: string, conversationId: string, utterances: Utterance[]) {
    this.check('replaceUtterances');
    this.rec(conversationId).utterances = clone(utterances);
  }

  async saveEmbedding(nodeId: string, embedding: number[]) {
    this.check('saveEmbedding');
    this.embeddings.set(nodeId, [...embedding]);
  }

  async matchNodes(conversationId: string, embedding: number[], k: number, excludeId?: string): Promise<NodeMatch[]> {
    this.check('matchNodes');
    const g = this.rec(conversationId).graph;
    return Object.values(g.nodes)
      .filter((n) => n.kind === 'topic' && n.id !== excludeId && this.embeddings.has(n.id))
      .map((n) => ({ id: n.id, similarity: cosine(this.embeddings.get(n.id)!, embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  async insertRecallCards(_userId: string, conversationId: string, cards: { nodeId: string; prompt: string }[]) {
    this.check('insertRecallCards');
    this.rec(conversationId).recallCards.push(...clone(cards));
  }

  recallCards(conversationId: string) {
    return this.rec(conversationId).recallCards;
  }

  async deleteConversation(conversationId: string) {
    this.check('deleteConversation');
    const r = this.convs.get(conversationId);
    if (!r) return;
    for (const id of Object.keys(r.graph.nodes)) {
      this.embeddings.delete(id);
      this.nodeConcepts.delete(id);
    }
    this.convs.delete(conversationId);
  }

  async downloadRecording(path: string) {
    this.check('downloadRecording');
    return this.recordings.get(path) ?? null;
  }

  async deleteRecording(path: string) {
    this.check('deleteRecording');
    this.recordings.delete(path);
  }

  // ── Brain ──

  async listConversations(userId: string) {
    return [...this.convs.values()].filter((r) => r.row.conversation.userId === userId).map((r) => clone(r.row));
  }

  async listBrainNodes(conversationIds: string[]): Promise<BrainNodeRow[]> {
    const out: BrainNodeRow[] = [];
    for (const id of conversationIds) {
      const r = this.convs.get(id);
      if (!r) continue;
      for (const n of Object.values(r.graph.nodes) as TopicNode[]) {
        if (n.kind !== 'topic') continue;
        out.push({
          id: n.id,
          conversationId: id,
          label: n.label,
          summary: n.summary,
          level: n.level,
          startMs: n.startMs,
          embedding: this.embeddings.get(n.id) ?? null,
          conceptId: this.nodeConcepts.get(n.id) ?? null,
        });
      }
    }
    return out;
  }

  async listConcepts(userId: string) {
    return [...this.concepts.values()].filter((c) => c.userId === userId).map(({ userId: _u, ...c }) => clone(c));
  }

  async listConceptLinks(userId: string) {
    return this.links.filter((l) => l.userId === userId).map(({ userId: _u, ...l }) => ({ ...l }));
  }

  async matchConcepts(userId: string, embedding: number[], k: number) {
    return [...this.concepts.values()]
      .filter((c) => c.userId === userId && c.embedding)
      .map((c) => ({ id: c.id, similarity: cosine(c.embedding!, embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  async upsertConcepts(userId: string, concepts: ConceptRow[]) {
    for (const c of concepts) this.concepts.set(c.id, { ...clone(c), userId });
  }

  async setNodeConcepts(assignments: { nodeId: string; conceptId: string }[]) {
    for (const a of assignments) this.nodeConcepts.set(a.nodeId, a.conceptId);
  }

  async replaceConceptLinks(userId: string, links: ConceptLinkRow[]) {
    this.links = [...this.links.filter((l) => l.userId !== userId), ...links.map((l) => ({ ...l, userId }))];
  }

  async markBrainBuilt(conversationIds: string[], at: string) {
    for (const id of conversationIds) {
      const r = this.convs.get(id);
      if (r) r.row.brainBuiltAt = at;
    }
  }
}
