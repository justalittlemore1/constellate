import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fromRow,
  OpBatchSchema,
  RECORDINGS_BUCKET,
  snakeKeys,
  TABLES,
  toRow,
  type Conversation,
  type GraphState,
  type OpBatch,
  type Utterance,
} from '@constellate/shared';
import { diffStates } from './diff';
import { replayGraph } from './replay';
import type { BrainNodeRow, ConceptLinkRow, ConceptRow, NodeMatch, OwnedConversation, Store } from './types';

type Row = Record<string, unknown>;

export class DbError extends Error {
  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = 'DbError';
  }
}

function check<T>(where: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new DbError(where, res.error.message);
  return res.data;
}

/** pgvector text format; PostgREST casts it into vector(768). */
const vec = (v: number[]) => `[${v.join(',')}]`;
const parseVec = (v: unknown): number[] | null =>
  v == null ? null : Array.isArray(v) ? (v as number[]) : (JSON.parse(String(v)) as number[]);

function owned(r: Row): OwnedConversation {
  return {
    conversation: fromRow.conversation(r),
    lastSeq: Number(r.last_seq ?? 0),
    brainBuiltAt: (r.brain_built_at as string | null) ?? null,
  };
}

const CONVERSATION_COLUMNS = new Set([
  'folder_id',
  'title',
  'summary',
  'macro_anchor',
  'status',
  'is_solo',
  'is_favorite',
  'location',
  'reflection',
  'started_at',
  'ended_at',
  'duration_ms',
  'audio_path',
]);

/**
 * Store backed by Supabase with the service-role key. Every row it writes carries the `user_id`
 * the caller verified from the access token; it never takes a user id from client input.
 */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  async createConversation(userId: string, init: Partial<Pick<Conversation, 'isSolo' | 'title'>> = {}) {
    const data = check(
      'createConversation',
      await this.db
        .from(TABLES.conversations)
        .insert({ user_id: userId, ...snakeKeys(init) })
        .select()
        .single(),
    );
    return fromRow.conversation(data as Row);
  }

  async getConversation(id: string) {
    const data = check(
      'getConversation',
      await this.db.from(TABLES.conversations).select('*').eq('id', id).maybeSingle(),
    );
    return data ? owned(data as Row) : null;
  }

  async loadGraph(conversationId: string) {
    const conv = await this.getConversation(conversationId);
    if (!conv) return null;
    const rows = check(
      'loadGraph',
      await this.db
        .from(TABLES.opLog)
        .select('conversation_id, seq, source, ops, created_at')
        .eq('conversation_id', conversationId)
        .order('seq', { ascending: true }),
    ) as Row[];
    const batches: OpBatch[] = rows.map((r) =>
      OpBatchSchema.parse({
        conversationId: r.conversation_id,
        seq: r.seq,
        at: new Date(String(r.created_at)).toISOString(),
        source: r.source,
        ops: r.ops,
      }),
    );
    return replayGraph(conv.conversation, batches);
  }

  async appendBatch(userId: string, batch: OpBatch, prev: GraphState, next: GraphState) {
    const cid = batch.conversationId;
    check(
      'op_log',
      await this.db.from(TABLES.opLog).upsert(
        {
          conversation_id: cid,
          seq: batch.seq,
          user_id: userId,
          source: batch.source,
          ops: batch.ops,
          created_at: batch.at,
        },
        // a retried batch must not fail on the primary key; the row upserts below are idempotent
        { onConflict: 'conversation_id,seq', ignoreDuplicates: true },
      ),
    );
    const d = diffStates(prev, next);
    if (d.upsertNodes.length) {
      check('nodes', await this.db.from(TABLES.nodes).upsert(d.upsertNodes.map((n) => toRow(n, userId))));
    }
    if (d.upsertEdges.length) {
      check('edges', await this.db.from(TABLES.edges).upsert(d.upsertEdges.map((e) => toRow(e, userId))));
    }
    if (d.deleteEdgeIds.length) {
      check('edges.delete', await this.db.from(TABLES.edges).delete().in('id', d.deleteEdgeIds));
    }
    if (d.upsertFlags.length) {
      check('flags', await this.db.from(TABLES.flags).upsert(d.upsertFlags.map((f) => toRow(f, userId))));
    }
    if (d.upsertCommitments.length) {
      check(
        'commitments',
        await this.db.from(TABLES.commitments).upsert(d.upsertCommitments.map((c) => toRow(c, userId))),
      );
    }
    if (d.upsertAnnotations.length) {
      check(
        'annotations',
        await this.db
          .from(TABLES.annotations)
          .upsert(d.upsertAnnotations.map((a) => ({ ...toRow(a, userId), updated_at: new Date().toISOString() }))),
      );
    }
    if (d.deleteNodeIds.length) {
      check('nodes.delete', await this.db.from(TABLES.nodes).delete().in('id', d.deleteNodeIds));
    }
    const patch = Object.fromEntries(
      Object.entries(snakeKeys(d.conversationPatch as Row)).filter(([k]) => CONVERSATION_COLUMNS.has(k)),
    );
    check(
      'conversations.update',
      await this.db
        .from(TABLES.conversations)
        .update({ ...patch, last_seq: batch.seq })
        .eq('id', cid),
    );
  }

  async insertUtterance(userId: string, u: Utterance) {
    check('utterances', await this.db.from(TABLES.utterances).insert(toRow(u, userId)));
  }

  async listUtterances(conversationId: string) {
    const rows = check(
      'listUtterances',
      await this.db
        .from(TABLES.utterances)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('start_ms', { ascending: true }),
    ) as Row[];
    return rows.map((r) => fromRow.utterance(r));
  }

  async replaceUtterances(userId: string, conversationId: string, utterances: Utterance[]) {
    check('utterances.delete', await this.db.from(TABLES.utterances).delete().eq('conversation_id', conversationId));
    if (utterances.length) {
      check('utterances.insert', await this.db.from(TABLES.utterances).insert(utterances.map((u) => toRow(u, userId))));
    }
  }

  async saveEmbedding(nodeId: string, embedding: number[]) {
    check(
      'saveEmbedding',
      await this.db
        .from(TABLES.nodes)
        .update({ embedding: vec(embedding) })
        .eq('id', nodeId),
    );
  }

  async matchNodes(conversationId: string, embedding: number[], k: number, excludeId?: string): Promise<NodeMatch[]> {
    const rows = check(
      'match_nodes',
      await this.db.rpc('match_nodes', {
        p_conversation: conversationId,
        p_embedding: vec(embedding),
        p_k: k,
        p_exclude: excludeId ?? null,
      }),
    ) as { id: string; similarity: number }[];
    return rows.map((r) => ({ id: r.id, similarity: Number(r.similarity) }));
  }

  async insertRecallCards(userId: string, conversationId: string, cards: { nodeId: string; prompt: string }[]) {
    if (!cards.length) return;
    check(
      'recall_cards',
      await this.db
        .from(TABLES.recallCards)
        .insert(
          cards.map((c) => ({ user_id: userId, conversation_id: conversationId, node_id: c.nodeId, prompt: c.prompt })),
        ),
    );
  }

  async deleteConversation(conversationId: string) {
    check('deleteConversation', await this.db.from(TABLES.conversations).delete().eq('id', conversationId));
  }

  async downloadRecording(path: string) {
    const { data, error } = await this.db.storage.from(RECORDINGS_BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async deleteRecording(path: string) {
    const { error } = await this.db.storage.from(RECORDINGS_BUCKET).remove([path]);
    if (error) throw new DbError('deleteRecording', error.message);
  }

  // ── Brain ──

  async listConversations(userId: string) {
    const rows = check(
      'listConversations',
      await this.db.from(TABLES.conversations).select('*').eq('user_id', userId),
    ) as Row[];
    return rows.map(owned);
  }

  async listBrainNodes(conversationIds: string[]): Promise<BrainNodeRow[]> {
    if (!conversationIds.length) return [];
    const rows = check(
      'listBrainNodes',
      await this.db
        .from(TABLES.nodes)
        .select('id, conversation_id, label, summary, level, start_ms, embedding, concept_id')
        .in('conversation_id', conversationIds)
        .eq('kind', 'topic'),
    ) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      conversationId: String(r.conversation_id),
      label: String(r.label),
      summary: String(r.summary ?? ''),
      level: Number(r.level),
      startMs: Number(r.start_ms),
      embedding: parseVec(r.embedding),
      conceptId: (r.concept_id as string | null) ?? null,
    }));
  }

  async listConcepts(userId: string): Promise<ConceptRow[]> {
    const rows = check('listConcepts', await this.db.from(TABLES.concepts).select('*').eq('user_id', userId)) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: (r.description as string | null) ?? null,
      parentConceptId: (r.parent_concept_id as string | null) ?? null,
      mentionCount: Number(r.mention_count ?? 0),
      embedding: parseVec(r.embedding),
    }));
  }

  async listConceptLinks(userId: string): Promise<ConceptLinkRow[]> {
    const rows = check(
      'listConceptLinks',
      await this.db.from(TABLES.conceptLinks).select('*').eq('user_id', userId),
    ) as Row[];
    return rows.map((r) => ({
      sourceId: String(r.source_id),
      targetId: String(r.target_id),
      relation: r.relation as ConceptLinkRow['relation'],
      weight: Number(r.weight),
    }));
  }

  async matchConcepts(userId: string, embedding: number[], k: number): Promise<NodeMatch[]> {
    const rows = check(
      'match_concepts',
      await this.db.rpc('match_concepts', { p_user: userId, p_embedding: vec(embedding), p_k: k }),
    ) as { id: string; similarity: number }[];
    return rows.map((r) => ({ id: r.id, similarity: Number(r.similarity) }));
  }

  async upsertConcepts(userId: string, concepts: ConceptRow[]) {
    if (!concepts.length) return;
    // parents first so the self-referencing foreign key is satisfied
    const ordered = [...concepts].sort(
      (a, b) => Number(Boolean(a.parentConceptId)) - Number(Boolean(b.parentConceptId)),
    );
    check(
      'concepts',
      await this.db.from(TABLES.concepts).upsert(
        ordered.map((c) => ({
          id: c.id,
          user_id: userId,
          name: c.name,
          description: c.description,
          parent_concept_id: c.parentConceptId,
          mention_count: c.mentionCount,
          embedding: c.embedding ? vec(c.embedding) : null,
        })),
      ),
    );
  }

  async setNodeConcepts(assignments: { nodeId: string; conceptId: string }[]) {
    for (const a of assignments) {
      check('nodes.concept', await this.db.from(TABLES.nodes).update({ concept_id: a.conceptId }).eq('id', a.nodeId));
    }
  }

  async replaceConceptLinks(userId: string, links: ConceptLinkRow[]) {
    check('concept_links.delete', await this.db.from(TABLES.conceptLinks).delete().eq('user_id', userId));
    if (!links.length) return;
    check(
      'concept_links.insert',
      await this.db.from(TABLES.conceptLinks).insert(
        links.map((l) => ({
          user_id: userId,
          source_id: l.sourceId,
          target_id: l.targetId,
          relation: l.relation,
          weight: l.weight,
        })),
      ),
    );
  }

  async markBrainBuilt(conversationIds: string[], at: string) {
    if (!conversationIds.length) return;
    check(
      'markBrainBuilt',
      await this.db.from(TABLES.conversations).update({ brain_built_at: at }).in('id', conversationIds),
    );
  }
}
