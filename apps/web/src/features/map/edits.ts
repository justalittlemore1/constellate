/**
 * User edits on the map as contract ops (pure). They go to `POST /conversations/:id/ops` as a
 * `source: 'user'` batch and are applied optimistically with `applyOps` (see userOps.ts).
 */
import type { Annotation, GraphOp, GraphState, TopicNode } from '@constellate/shared';

export const NOTE_MAX_CHARS = 280;
/** a new note sits up and to the right of its node; each further note on the same node steps down */
export const NOTE_OFFSET = { x: 44, y: -40, step: 34 } as const;

/** Paint (or clear) gold on one node. */
export function highlightOps(node: TopicNode, on: boolean): GraphOp[] {
  return [{ op: 'node.update', id: node.id, patch: { highlighted: on } }];
}

export function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : // RFC 4122 v4 from Math.random: only for very old browsers without randomUUID
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

/**
 * Create a sticky note on a node, or change the text of an existing one. A new note gets a fixed
 * position next to its node once; editing never moves it.
 */
export function noteOps(
  state: GraphState,
  node: TopicNode,
  text: string,
  existing?: Annotation,
  id: string = newId(),
): GraphOp[] {
  const clean = text.trim().slice(0, NOTE_MAX_CHARS);
  if (!clean) return [];
  if (existing) return [{ op: 'annotation.upsert', annotation: { ...existing, text: clean } }];
  const siblings = state.annotations.filter((a) => a.nodeId === node.id).length;
  return [
    {
      op: 'annotation.upsert',
      annotation: {
        id,
        conversationId: state.conversation.id,
        nodeId: node.id,
        text: clean,
        x: Math.round(node.x + NOTE_OFFSET.x),
        y: Math.round(node.y + NOTE_OFFSET.y + siblings * NOTE_OFFSET.step),
      },
    },
  ];
}
