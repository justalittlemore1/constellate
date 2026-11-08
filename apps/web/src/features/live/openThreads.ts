import { nodesInOrder, type GraphState, type TopicNode } from '@constellate/shared';

/** Pending and parked threads nobody has closed yet — the "Before you go" list. */
export function openThreads(graph: GraphState | null): TopicNode[] {
  if (!graph) return [];
  return nodesInOrder(graph).filter(
    (n) => (n.kind === 'pending' || n.kind === 'parked') && n.status !== 'resolved' && n.status !== 'closed',
  );
}

/** mm:ss, or h:mm:ss after an hour */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
