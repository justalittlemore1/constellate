import type { GraphOp, GraphState, Utterance } from '@constellate/shared';

const overlap = (a: Utterance, b: Utterance) => Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
const mid = (u: Utterance) => (u.startMs + u.endMs) / 2;

/** For each live utterance id, the post-recording utterance ids that cover it in time. */
export function mapUtterances(live: readonly Utterance[], fresh: readonly Utterance[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const u of live) {
    let ids = fresh.filter((f) => overlap(u, f) > 0).map((f) => f.id);
    if (!ids.length && fresh.length) {
      // no overlap (e.g. a zero-length live utterance): take the nearest by midpoint
      const nearest = fresh.reduce((best, f) => (Math.abs(mid(f) - mid(u)) < Math.abs(mid(best) - mid(u)) ? f : best));
      ids = [nearest.id];
    }
    map.set(u.id, ids);
  }
  return map;
}

/**
 * Node evidence survives the transcript swap: every node's `utteranceIds` are rewritten to the new
 * ids by time overlap, and `speakers` are filled from the diarized turns. Pure; returns ops.
 */
export function remapEvidence(state: GraphState, live: readonly Utterance[], fresh: readonly Utterance[]): GraphOp[] {
  const map = mapUtterances(live, fresh);
  const order = new Map(fresh.map((f, i) => [f.id, i]));
  const speakerOf = new Map(fresh.map((f) => [f.id, f.speaker]));
  const ops: GraphOp[] = [];
  for (const n of Object.values(state.nodes).sort((a, b) => a.seq - b.seq)) {
    if (!n.utteranceIds.length) continue;
    const ids = [...new Set(n.utteranceIds.flatMap((id) => map.get(id) ?? []))].sort(
      (a, b) => order.get(a)! - order.get(b)!,
    );
    const speakers = [...new Set(ids.map((id) => speakerOf.get(id)).filter((s): s is number => s != null))].sort(
      (a, b) => a - b,
    );
    const same =
      JSON.stringify(ids) === JSON.stringify(n.utteranceIds) && JSON.stringify(speakers) === JSON.stringify(n.speakers);
    if (!same) ops.push({ op: 'node.update', id: n.id, patch: { utteranceIds: ids, speakers } });
  }
  return ops;
}
