import {
  computeLinks,
  heuristicDecisions,
  planConcepts,
  recomputeConcepts,
  type ConceptLink,
  type MergeRequest,
} from '@constellate/brain';
import { BRAIN, type Ms } from '@constellate/shared';
import type { Embedder } from '../ai/embed';
import type { Log } from '../live/session';
import type { BrainNodeRow, ConceptRow, Store } from '../store/types';
import type { MergeDecider } from './merge-llm';

export interface BrainDeps {
  store: Store;
  embed: Embedder;
  /** null → the conservative heuristic decides every merge */
  decideMerge: MergeDecider | null;
  newId(): string;
  log: Log;
}

export interface RebuildResult {
  conversations: number;
  newConcepts: number;
  concepts: number;
  links: number;
}

/** One concept occurrence: the exact moment it was discussed. */
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

export interface BrainResponse {
  concepts: Omit<ConceptRow, 'embedding'>[];
  links: ConceptLink[];
  /** by concept id, in conversation order */
  occurrences: Record<string, Occurrence[]>;
}

const running = new Map<string, Promise<RebuildResult>>();

/** concepts offered by name to nodes that have no embedding */
const NAME_CANDIDATES = 40;

/** Incremental build (PLAN → The Brain). One run per user at a time. */
export function rebuildBrain(deps: BrainDeps, userId: string): Promise<RebuildResult> {
  let p = running.get(userId);
  if (!p) {
    p = doRebuild(deps, userId).finally(() => running.delete(userId));
    running.set(userId, p);
  }
  return p;
}

async function doRebuild(deps: BrainDeps, userId: string): Promise<RebuildResult> {
  const { store } = deps;
  const conversations = await store.listConversations(userId);
  const pending = conversations
    .filter((c) => c.conversation.status === 'ready' && !c.brainBuiltAt)
    .sort((a, b) => a.conversation.startedAt.localeCompare(b.conversation.startedAt));
  let concepts = await store.listConcepts(userId);
  let newConcepts = 0;

  for (const conv of pending) {
    const nodes = (await store.listBrainNodes([conv.conversation.id])).filter(
      (n) => n.level >= 1 && n.level <= 2 && !n.conceptId,
    );
    if (!nodes.length) continue;
    await ensureEmbeddings(deps, nodes);

    const byId = new Map(concepts.map((c) => [c.id, c]));
    const req: MergeRequest = {
      conversationTitle: conv.conversation.title,
      conversationDate: conv.conversation.startedAt,
      conversationSummary: conv.conversation.summary,
      nodes: [],
    };
    // without an embedding (daily cap reached, or the provider failed) a node is matched by name:
    // Claude sees the user's most-mentioned concepts as candidates, with no similarity score
    const byName = [...concepts]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, NAME_CANDIDATES)
      .map((c) => ({ id: c.id, name: c.name, description: c.description, similarity: null }));
    for (const n of nodes) {
      let candidates;
      if (n.embedding) {
        const matches = await store.matchConcepts(userId, n.embedding, BRAIN.conceptCandidateK);
        candidates = matches
          .filter((m) => m.similarity >= BRAIN.conceptCandidateMin && byId.has(m.id))
          .map((m) => ({
            id: m.id,
            name: byId.get(m.id)!.name,
            description: byId.get(m.id)!.description,
            similarity: m.similarity,
          }));
      } else {
        candidates = byName;
      }
      req.nodes.push({ id: n.id, level: n.level, label: n.label, summary: n.summary, candidates });
    }

    let decisions;
    try {
      decisions = deps.decideMerge ? await deps.decideMerge(req) : heuristicDecisions(req);
    } catch (err) {
      deps.log('brain.merge_failed', { conversationId: conv.conversation.id, message: String(err) });
      decisions = heuristicDecisions(req);
    }

    const plan = planConcepts(concepts, decisions, deps.newId);
    newConcepts += plan.created.length;
    const reparent = new Map(plan.reparented.map((r) => [r.id, r.parentConceptId]));
    // embed new concepts now (centroid of their members) so later conversations can match them;
    // exact counts and centroids for everything come from the whole-Brain pass below
    const conceptOf = new Map(plan.assignments.map((a) => [a.nodeId, a.conceptId]));
    const created = recomputeConcepts(
      plan.created,
      nodes.map((n) => ({ ...n, conceptId: conceptOf.get(n.id) ?? null })),
    );
    concepts = [
      ...concepts.map((c) => (reparent.has(c.id) ? { ...c, parentConceptId: reparent.get(c.id)! } : c)),
      ...created,
    ];
    const changed = new Set([...created.map((c) => c.id), ...reparent.keys()]);
    await store.upsertConcepts(
      userId,
      concepts.filter((c) => changed.has(c.id)),
    );
    await store.setNodeConcepts(plan.assignments);
  }

  // Whole-Brain pass: exact counts and centroids (also corrects deletions), then links.
  const allNodes = await store.listBrainNodes(conversations.map((c) => c.conversation.id));
  concepts = recomputeConcepts(concepts, allNodes);
  await store.upsertConcepts(userId, concepts);
  const links = computeLinks(concepts, allNodes);
  await store.replaceConceptLinks(userId, links);
  await store.markBrainBuilt(
    pending.map((c) => c.conversation.id),
    new Date().toISOString(),
  );
  const result = {
    conversations: pending.length,
    newConcepts,
    concepts: concepts.filter((c) => c.mentionCount > 0).length,
    links: links.length,
  };
  deps.log('brain.rebuilt', { userId, ...result });
  return result;
}

/** Nodes without an embedding (e.g. the interpreter's embed call failed live) get one now. */
async function ensureEmbeddings(deps: BrainDeps, nodes: BrainNodeRow[]): Promise<void> {
  const missing = nodes.filter((n) => !n.embedding);
  if (!missing.length) return;
  try {
    const vectors = await deps.embed(missing.map((n) => `${n.label}. ${n.summary}`));
    if (vectors.length === 0) {
      deps.log('brain.embeddings_unavailable', { nodes: missing.length, fallback: 'merge by name' });
      return;
    }
    for (let i = 0; i < missing.length; i++) {
      missing[i]!.embedding = vectors[i]!;
      await deps.store.saveEmbedding(missing[i]!.id, vectors[i]!);
    }
  } catch (err) {
    deps.log('brain.embed_failed', { message: String(err) });
  }
}

/** GET /brain payload: live concepts, links, and every occurrence per concept. */
export async function loadBrain(store: Store, userId: string): Promise<BrainResponse> {
  const conversations = await store.listConversations(userId);
  const convById = new Map(conversations.map((c) => [c.conversation.id, c.conversation]));
  const [concepts, links, nodes] = await Promise.all([
    store.listConcepts(userId),
    store.listConceptLinks(userId),
    store.listBrainNodes([...convById.keys()]),
  ]);
  const occurrences: Record<string, Occurrence[]> = {};
  for (const n of nodes) {
    const conv = n.conceptId ? convById.get(n.conversationId) : undefined;
    if (!conv || !n.conceptId) continue;
    (occurrences[n.conceptId] ??= []).push({
      conversationId: conv.id,
      conversationTitle: conv.title,
      startedAt: conv.startedAt,
      audioPath: conv.audioPath,
      nodeId: n.id,
      label: n.label,
      summary: n.summary,
      startMs: n.startMs,
    });
  }
  for (const list of Object.values(occurrences)) {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.startMs - b.startMs);
  }
  const liveIds = new Set(concepts.filter((c) => c.mentionCount > 0).map((c) => c.id));
  return {
    concepts: concepts.filter((c) => liveIds.has(c.id)).map(({ embedding: _e, ...c }) => c),
    links: links.filter((l) => liveIds.has(l.sourceId) && liveIds.has(l.targetId)),
    occurrences,
  };
}
