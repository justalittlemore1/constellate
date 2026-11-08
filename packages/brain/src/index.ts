/**
 * Cross-conversation concept graph ("the Brain"). Pure logic + prompts; the server (A1) does I/O.
 * Owner: A1, with prompts and merge logic from A2 from H7. See docs/PLAN.md → "The Brain".
 */
import { BRAIN } from '@constellate/shared';

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

/** Per-node decision returned by the merge LLM call. */
export type MergeDecision =
  | { nodeId: string; sameAs: string }
  | { nodeId: string; newConcept: { name: string; description: string; broaderThan?: string; narrowerThan?: string } };

/** Brain view payload served by GET /brain. */
export interface BrainGraph {
  concepts: Concept[];
  links: ConceptLink[];
}

/** Layout edge weight: w = 0.5·S + 0.3·C + 0.2·R, each input in [0, 1]. */
export function linkWeight(semantic: number, cooccurrence: number, relation: number): number {
  const w = BRAIN.weights;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return w.semantic * clamp(semantic) + w.cooccurrence * clamp(cooccurrence) + w.relation * clamp(relation);
}

/** Jaccard-style co-occurrence: conversations containing both ÷ conversations containing either. */
export function cooccurrence(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let both = 0;
  for (const c of a) if (b.has(c)) both++;
  const either = a.size + b.size - both;
  return either === 0 ? 0 : both / either;
}

export * from './merge';
export * from './build';
