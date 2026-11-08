/**
 * Context packing (docs/PLAN.md → What it sees). Builds the user message for one decision and the
 * alias table that maps the short ids the model sees (`n3`, `p4`) back to node UUIDs.
 * Aliases come from the node's `seq`, so they are stable across calls.
 */
import type { GraphState, TopicNode, Utterance } from '@constellate/shared';

export interface Aliases {
  toId: Map<string, string>;
  toAlias: Map<string, string>;
}

export function aliasFor(node: Pick<TopicNode, 'kind' | 'seq'>): string {
  return `${node.kind === 'topic' ? 'n' : 'p'}${node.seq}`;
}

export function buildAliases(state: GraphState): Aliases {
  const toId = new Map<string, string>();
  const toAlias = new Map<string, string>();
  for (const n of Object.values(state.nodes)) {
    const a = aliasFor(n);
    toId.set(a, n.id);
    toAlias.set(n.id, a);
  }
  return { toId, toAlias };
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtUtterance(u: Utterance): string {
  return `[${u.id} ${fmtTime(u.startMs)} S${u.speaker ?? '?'}] ${u.text}`;
}

export interface PackInput {
  state: GraphState;
  /** the node the conversation is in (a provisional node while the commit gate is open); defaults to state.activeNodeId */
  effectiveActiveId?: string | null;
  /** every utterance seen so far, by id (for thread quotes) */
  utterancesById: ReadonlyMap<string, Utterance>;
  /** already-decided utterances shown for context (the last N) */
  recent: readonly Utterance[];
  /** the new window the model must decide about */
  window: readonly Utterance[];
  rollingSummary: string;
  candidates: readonly { id: string; similarity: number }[];
  hint: string;
}

export interface Packed {
  text: string;
  aliases: Aliases;
}

const byTime = (a: TopicNode, b: TopicNode) => a.seq - b.seq;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function packContext(input: PackInput): Packed {
  const { state } = input;
  const aliases = buildAliases(state);
  const al = (id: string | null) => (id ? (aliases.toAlias.get(id) ?? '-') : '-');
  const nodes = Object.values(state.nodes).sort(byTime);
  const topics = nodes.filter((n) => n.kind === 'topic');
  const threads = nodes.filter((n) => n.kind !== 'topic' && n.status !== 'resolved' && n.status !== 'unexplored');
  const lines: string[] = [];

  const anchor = state.conversation.macroAnchor;
  lines.push(`MACRO ANCHOR: ${anchor ?? '(not set yet — set macro_anchor once you can tell the broad theme)'}`);

  lines.push('', 'OUTLINE (chronological):');
  if (topics.length === 0) {
    lines.push('(no topics yet — this decision must be new_topic, starting at the first utterance that belongs to it)');
  }
  const activeId = input.effectiveActiveId !== undefined ? input.effectiveActiveId : state.activeNodeId;
  for (const n of topics) {
    const isActive = n.id === activeId;
    const status =
      n.status === 'provisional' ? (isActive ? 'ACTIVE (provisional)' : 'provisional') : isActive ? 'ACTIVE' : n.status;
    const span = `${fmtTime(n.startMs)}–${n.endMs !== null ? fmtTime(n.endMs) : ''}`;
    const thread =
      topics.filter((t) => t.threadId === n.threadId).length > 1
        ? ` | thread of ${al(topics.find((t) => t.threadId === n.threadId)!.id)}`
        : '';
    lines.push(`${al(n.id)} | L${n.level} | ${n.label} | parent ${al(n.parentId)} | ${status} | ${span}${thread}`);
  }

  lines.push('', 'OPEN THREADS:');
  if (threads.length === 0) lines.push('(none)');
  for (const t of threads) {
    const quoteId = t.utteranceIds[0];
    const quote = quoteId ? input.utterancesById.get(quoteId) : undefined;
    const how = t.kind === 'pending' ? 'deferred' : 'parked by user';
    lines.push(
      `${al(t.id)} | ${how} | ${t.label}${quote ? ` | raised at ${quote.id}: "${truncate(quote.text, 160)}"` : ''}`,
    );
  }

  const candidates = input.candidates.filter((c) => aliases.toAlias.has(c.id));
  if (candidates.length > 0) {
    lines.push('', 'REVISIT CANDIDATES (similar wording only — check the meaning):');
    for (const c of candidates) {
      lines.push(`${al(c.id)} | ${state.nodes[c.id]!.label} | similarity ${c.similarity.toFixed(2)}`);
    }
  }

  lines.push('', `ROLLING SUMMARY: ${input.rollingSummary || '(empty — this is the start of the conversation)'}`);

  if (input.recent.length > 0) {
    lines.push('', 'RECENT UTTERANCES (already mapped, for context only):');
    for (const u of input.recent) lines.push(fmtUtterance(u));
  }

  lines.push('', 'NEW UTTERANCES (decide about these):');
  for (const u of input.window) lines.push(fmtUtterance(u));

  if (input.hint) lines.push('', `GRANULARITY HINT: ${input.hint}`);

  return { text: lines.join('\n'), aliases };
}
