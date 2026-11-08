/**
 * Pure steps of the Brain build (PLAN → The Brain, steps 3–4): turn merge decisions into concept
 * rows and node assignments, recompute counts and embeddings, and derive the link graph.
 */
import { BRAIN } from '@constellate/shared';
import { cooccurrence, linkWeight, type ConceptLink, type MergeDecision } from './index';

export interface ConceptState {
  id: string;
  name: string;
  description: string | null;
  parentConceptId: string | null;
  mentionCount: number;
  embedding: number[] | null;
}

export interface AssignedNode {
  id: string;
  conversationId: string;
  conceptId: string | null;
  embedding: number[] | null;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

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

/** Unit-normalised mean; null for no vectors. */
export function meanEmbedding(vectors: number[][]): number[] | null {
  if (!vectors.length) return null;
  const sum = new Array<number>(vectors[0]!.length).fill(0);
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i]! += v[i] ?? 0;
  return normalize(sum);
}

export interface ConceptPlan {
  /** concepts created by this conversation */
  created: ConceptState[];
  /** existing concepts whose parent changed (a new concept is broader than them) */
  reparented: { id: string; parentConceptId: string }[];
  assignments: { nodeId: string; conceptId: string }[];
}

/**
 * Apply one conversation's decisions. New concepts with the same name (case-insensitive) — within
 * this conversation or already existing — collapse into one, so two topics never mint duplicates.
 */
export function planConcepts(
  existing: readonly ConceptState[],
  decisions: readonly MergeDecision[],
  newId: () => string,
): ConceptPlan {
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  const created: ConceptState[] = [];
  const reparented: { id: string; parentConceptId: string }[] = [];
  const assignments: { nodeId: string; conceptId: string }[] = [];
  for (const d of decisions) {
    if ('sameAs' in d) {
      assignments.push({ nodeId: d.nodeId, conceptId: d.sameAs });
      continue;
    }
    const key = d.newConcept.name.toLowerCase();
    let id = byName.get(key);
    if (!id) {
      id = newId();
      byName.set(key, id);
      created.push({
        id,
        name: d.newConcept.name,
        description: d.newConcept.description,
        parentConceptId: d.newConcept.narrowerThan ?? null,
        mentionCount: 0,
        embedding: null,
      });
      if (d.newConcept.broaderThan) reparented.push({ id: d.newConcept.broaderThan, parentConceptId: id });
    }
    assignments.push({ nodeId: d.nodeId, conceptId: id });
  }
  return { created, reparented, assignments };
}

/** mention_count = nodes assigned; embedding = normalised mean of member node embeddings. */
export function recomputeConcepts(concepts: readonly ConceptState[], nodes: readonly AssignedNode[]): ConceptState[] {
  const members = new Map<string, AssignedNode[]>();
  for (const n of nodes) {
    if (!n.conceptId) continue;
    const list = members.get(n.conceptId) ?? [];
    list.push(n);
    members.set(n.conceptId, list);
  }
  return concepts.map((c) => {
    const m = members.get(c.id) ?? [];
    const vectors = m.flatMap((n) => (n.embedding ? [n.embedding] : []));
    return { ...c, mentionCount: m.length, embedding: meanEmbedding(vectors) ?? c.embedding };
  });
}

/**
 * Links for the whole Brain: `broader` (parent → child), `co_discussed` (both concepts in a
 * conversation; C = Jaccard over conversations) and `related` (concept cosine ≥ relatedMin, top
 * relatedPerConcept each). Every row carries the layout weight w = 0.5·S + 0.3·C + 0.2·R for its pair.
 */
export function computeLinks(concepts: readonly ConceptState[], nodes: readonly AssignedNode[]): ConceptLink[] {
  const live = concepts.filter((c) => c.mentionCount > 0);
  const convsOf = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!n.conceptId) continue;
    const set = convsOf.get(n.conceptId) ?? new Set<string>();
    set.add(n.conversationId);
    convsOf.set(n.conceptId, set);
  }
  const byId = new Map(live.map((c) => [c.id, c]));
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const broaderPairs = new Set<string>();
  for (const c of live)
    if (c.parentConceptId && byId.has(c.parentConceptId)) broaderPairs.add(pairKey(c.id, c.parentConceptId));

  const weight = (a: ConceptState, b: ConceptState) => {
    const s = a.embedding && b.embedding ? cosine(a.embedding, b.embedding) : 0;
    const co = cooccurrence(convsOf.get(a.id) ?? new Set(), convsOf.get(b.id) ?? new Set());
    const r = broaderPairs.has(pairKey(a.id, b.id)) ? 1 : 0;
    return linkWeight(s, co, r);
  };

  const links: ConceptLink[] = [];
  for (const c of live) {
    const parent = c.parentConceptId ? byId.get(c.parentConceptId) : undefined;
    if (parent) links.push({ sourceId: parent.id, targetId: c.id, relation: 'broader', weight: weight(parent, c) });
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      const [s, t] = a.id < b.id ? [a, b] : [b, a];
      if (cooccurrence(convsOf.get(a.id) ?? new Set(), convsOf.get(b.id) ?? new Set()) > 0) {
        links.push({ sourceId: s.id, targetId: t.id, relation: 'co_discussed', weight: weight(a, b) });
      }
    }
  }
  const related = new Set<string>();
  for (const c of live) {
    if (!c.embedding) continue;
    const near = live
      .filter((o) => o.id !== c.id && o.embedding)
      .map((o) => ({ o, sim: cosine(c.embedding!, o.embedding!) }))
      .filter((x) => x.sim >= BRAIN.relatedMin)
      .sort((x, y) => y.sim - x.sim)
      .slice(0, BRAIN.relatedPerConcept);
    for (const { o } of near) {
      const key = pairKey(c.id, o.id);
      if (related.has(key)) continue;
      related.add(key);
      const [s, t] = c.id < o.id ? [c, o] : [o, c];
      links.push({ sourceId: s.id, targetId: t.id, relation: 'related', weight: weight(c, o) });
    }
  }
  return links;
}
