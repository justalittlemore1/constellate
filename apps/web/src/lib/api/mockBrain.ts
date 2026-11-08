import type { GraphState } from '@constellate/shared';
import type { BrainPayload, Concept, ConceptLink, Occurrence } from './types';

/**
 * Mock-mode stand-in for `POST /brain/rebuild` + `GET /brain`, derived deterministically from the
 * fixture graphs (no invented content): one concept per topic thread, `broader` links from the
 * node hierarchy, `co_discussed` links where the conversation flowed from one thread to another.
 * The real Brain is built by the server pipeline (packages/brain).
 */
export function mockBrainFromGraphs(graphs: GraphState[]): BrainPayload {
  const concepts = new Map<string, Concept>();
  const occurrences: Record<string, Occurrence[]> = {};
  const links = new Map<string, ConceptLink>();

  const addLink = (a: string, b: string, relation: ConceptLink['relation'], weight: number) => {
    if (a === b) return;
    const [s, t] = relation === 'broader' ? [a, b] : [a, b].sort();
    const key = `${s}|${t}|${relation}`;
    if (!links.has(key)) links.set(key, { sourceId: s!, targetId: t!, relation, weight });
  };

  for (const g of graphs) {
    const c = g.conversation;
    const topics = Object.values(g.nodes)
      .filter((n) => n.kind === 'topic' && n.status !== 'provisional' && n.level > 0)
      .sort((a, b) => a.seq - b.seq);
    for (const n of topics) {
      const existing = concepts.get(n.threadId);
      if (existing) existing.mentionCount += 1;
      else
        concepts.set(n.threadId, {
          id: n.threadId,
          name: n.label,
          description: n.summary,
          parentConceptId: null,
          mentionCount: 1,
        });
      (occurrences[n.threadId] ??= []).push({
        conversationId: c.id,
        conversationTitle: c.title,
        startedAt: c.startedAt,
        audioPath: c.audioPath,
        nodeId: n.id,
        label: n.label,
        summary: n.summary,
        startMs: n.startMs,
      });
    }
    for (const n of topics) {
      const parent = n.parentId ? g.nodes[n.parentId] : undefined;
      if (parent && concepts.has(parent.threadId)) {
        addLink(parent.threadId, n.threadId, 'broader', 0.8);
        const child = concepts.get(n.threadId)!;
        if (!child.parentConceptId) child.parentConceptId = parent.threadId;
      }
    }
    for (const e of Object.values(g.edges)) {
      if (e.kind !== 'flow') continue;
      const a = g.nodes[e.sourceId];
      const b = g.nodes[e.targetId];
      if (a && b && concepts.has(a.threadId) && concepts.has(b.threadId))
        addLink(a.threadId, b.threadId, 'co_discussed', 0.45);
    }
  }

  return { concepts: [...concepts.values()], links: [...links.values()], occurrences };
}
