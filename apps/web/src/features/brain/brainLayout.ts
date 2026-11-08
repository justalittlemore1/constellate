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
  /** strongest explicit relation: broader > related > co_discussed (comet trail / line / stardust);
   *  for `broader`, `source` is the broader concept */
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
  const broaderOf = new Map<string, string>(); // pair key → the broader concept's id
  for (const l of payload.links) {
    if (!ids.has(l.sourceId) || !ids.has(l.targetId) || l.sourceId === l.targetId) continue;
    const [a, b] = [l.sourceId, l.targetId].sort() as [string, string];
    const key = `${a}|${b}`;
    if (l.relation === 'broader') broaderOf.set(key, l.sourceId); // server/mock: source is the broader
    const prev = pairs.get(key);
    if (!prev) {
      pairs.set(key, { source: a, target: b, weight: l.weight, relation: l.relation });
    } else {
      prev.weight = Math.max(prev.weight, l.weight);
      if (RELATION_RANK[l.relation] > RELATION_RANK[prev.relation]) prev.relation = l.relation;
    }
  }
  // a broader link runs from the broader concept, so its comet trail starts bright there
  for (const [key, link] of pairs) {
    const broader = broaderOf.get(key);
    if (link.relation === 'broader' && broader && link.source !== broader) {
      [link.source, link.target] = [link.target, link.source];
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

/** Space a concept takes on the canvas: the node plus (if labelled) its label underneath. */
export interface Footprint {
  /** half the width */
  hw: number;
  /** extent above / below the node centre */
  up: number;
  down: number;
}

export const LABEL_GAP = 3;
export const LABEL_LINE = 14;

export function footprint(radius: number, labelWidth: number | null, pad = 4): Footprint {
  if (labelWidth === null) return { hw: radius + pad, up: radius + pad, down: radius + pad };
  return {
    hw: Math.max(radius, labelWidth / 2) + pad,
    up: radius + pad,
    down: radius + LABEL_GAP + LABEL_LINE + pad,
  };
}

export interface Body {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/**
 * One step of box collision: every overlapping pair is nudged apart along the axis of least
 * overlap (by velocity, like d3's forceCollide), so labels stop sitting on nodes and on each other.
 * O(n²) — fine for a personal Brain of a few hundred concepts.
 */
export function separateFootprints<T extends Body>(nodes: T[], fp: (n: T) => Footprint, strength: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const fa = fp(a);
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      const fb = fp(b);
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const bx = b.x ?? 0;
      const by = b.y ?? 0;
      const overlapX = Math.min(ax + fa.hw, bx + fb.hw) - Math.max(ax - fa.hw, bx - fb.hw);
      const overlapY = Math.min(ay + fa.down, by + fb.down) - Math.max(ay - fa.up, by - fb.up);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) {
        const s = (bx > ax || (bx === ax && j % 2 === 0) ? 1 : -1) * (overlapX / 2) * strength;
        a.vx = (a.vx ?? 0) - s;
        b.vx = (b.vx ?? 0) + s;
      } else {
        const ca = ay + (fa.down - fa.up) / 2;
        const cb = by + (fb.down - fb.up) / 2;
        const s = (cb > ca || (cb === ca && j % 2 === 0) ? 1 : -1) * (overlapY / 2) * strength;
        a.vy = (a.vy ?? 0) - s;
        b.vy = (b.vy ?? 0) + s;
      }
    }
  }
}

/**
 * Pull towards the vertical centre line, stronger the taller the canvas is than wide, so the
 * galaxy takes the shape of a portrait phone screen and the fit can zoom in instead of leaving
 * a wide, short strip in the middle.
 */
export function aspectPull(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.min(0.12, Math.max(0, 0.06 * (height / width - 1)));
}

export function pullToCentreLine<T extends Body>(nodes: T[], k: number, alpha: number): void {
  for (const n of nodes) n.vx = (n.vx ?? 0) - (n.x ?? 0) * k * alpha;
}
