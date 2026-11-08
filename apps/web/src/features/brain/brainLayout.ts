import type { BrainPayload, Concept, ConceptRelation } from '../../lib/api';

/** PLAN → The Brain → View: node radius 6 + 3·√mentionCount. */
export function nodeRadius(mentionCount: number): number {
  return 6 + 3 * Math.sqrt(Math.max(0, mentionCount));
}

/** PLAN → The Brain → View: link distance 40 + 160·(1 − w), w clamped to [0, 1]. */
export function linkDistance(weight: number): number {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0));
  return 40 + 160 * (1 - w);
}

export const LABELLED_CONCEPTS = 15;

/** Ids of the `n` most-mentioned concepts (ties broken by name, so it's stable). */
export function topConceptIds(concepts: Concept[], n = LABELLED_CONCEPTS): Set<string> {
  return new Set(
    [...concepts]
      .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((c) => c.id),
  );
}

export interface GalaxyNode {
  id: string;
  name: string;
  mentionCount: number;
  radius: number;
}

export interface GalaxyLink {
  source: string;
  target: string;
  /** strongest weight between the pair, drives the link distance */
  weight: number;
  /** strongest explicit relation: broader > related > co_discussed (drawn as solid / dashed / dotted) */
  relation: ConceptRelation;
}

const RELATION_RANK: Record<ConceptRelation, number> = { broader: 3, related: 2, co_discussed: 1 };

/** One undirected link per concept pair (several relations may connect the same two concepts). */
export function toGalaxy(payload: BrainPayload): { nodes: GalaxyNode[]; links: GalaxyLink[] } {
  const ids = new Set(payload.concepts.map((c) => c.id));
  const nodes = payload.concepts.map((c) => ({
    id: c.id,
    name: c.name,
    mentionCount: c.mentionCount,
    radius: nodeRadius(c.mentionCount),
  }));
  const pairs = new Map<string, GalaxyLink>();
  for (const l of payload.links) {
    if (!ids.has(l.sourceId) || !ids.has(l.targetId) || l.sourceId === l.targetId) continue;
    const [a, b] = [l.sourceId, l.targetId].sort() as [string, string];
    const key = `${a}|${b}`;
    const prev = pairs.get(key);
    if (!prev) {
      pairs.set(key, { source: a, target: b, weight: l.weight, relation: l.relation });
    } else {
      prev.weight = Math.max(prev.weight, l.weight);
      if (RELATION_RANK[l.relation] > RELATION_RANK[prev.relation]) prev.relation = l.relation;
    }
  }
  return { nodes, links: [...pairs.values()] };
}

/** Concept ids directly linked to `id` (not including `id`). */
export function neighbours(payload: BrainPayload, id: string): Set<string> {
  const out = new Set<string>();
  for (const l of payload.links) {
    if (l.sourceId === id) out.add(l.targetId);
    if (l.targetId === id) out.add(l.sourceId);
  }
  out.delete(id);
  return out;
}

export const RELATION_WORDS: Record<ConceptRelation, string> = {
  broader: 'broader or narrower',
  related: 'related in meaning',
  co_discussed: 'discussed together',
};

/** Line pattern per relation, so relations never depend on colour alone. */
export const RELATION_DASH: Record<ConceptRelation, number[] | null> = {
  broader: null,
  related: [6, 4],
  co_discussed: [1.5, 3.5],
};
