/**
 * Granularity controller (docs/PLAN.md → Granularity controller): a feedback loop on node density
 * that nudges the model to split long subtopics or to stop fragmenting.
 */
import type { GraphState } from '@constellate/shared';
import { INTERPRETER } from '@constellate/shared';

export const HINT_SPLIT =
  'The current subtopic has run long; split it into specific level-2 ideas where the question genuinely changes.';
export const HINT_CONSERVATIVE = 'Be conservative: prefer continue.';

export interface NodeCreation {
  atMs: number;
  explicit: boolean;
}

export function granularityHint(state: GraphState, nowMs: number, creations: readonly NodeCreation[]): string {
  const recent = creations.filter((c) => nowMs - c.atMs <= INTERPRETER.burstWindowMs && !c.explicit);
  if (recent.length >= INTERPRETER.burstNodes) return HINT_CONSERVATIVE;

  const active = state.activeNodeId ? state.nodes[state.activeNodeId] : undefined;
  if (active && active.kind === 'topic' && active.level === 1) {
    const hasChildren = Object.values(state.nodes).some((n) => n.kind === 'topic' && n.parentId === active.id);
    if (!hasChildren && nowMs - active.startMs > INTERPRETER.longSubtopicMs) return HINT_SPLIT;
  }
  return '';
}
