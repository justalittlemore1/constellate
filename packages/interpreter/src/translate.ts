/**
 * Decision → GraphOp[] (docs/PLAN.md → From decision to ops). Deterministic: the model never
 * invents ids, coordinates or timestamps. Every op is applied to a working copy as it is produced,
 * so the emitted list is guaranteed to pass the shared reducer.
 *
 * Commit gate (the fixture convention from scripts/build-fixtures.ts): a gated new topic is added
 * as a standalone `provisional` node while the previous node stays active. The next decision either
 * promotes it (close previous, flow edge, active.set) or — if it returns to the previous node within
 * `commitAfterMs` — removes it and folds its utterances back.
 */
import {
  applyOps,
  type Commitment,
  INTERPRETER,
  LABEL_MAX_WORDS,
  placeNode,
  SUMMARY_MAX_CHARS,
  type GraphOp,
  type GraphState,
  type Level,
  type TopicEdge,
  type TopicNode,
  type Utterance,
} from '@constellate/shared';
import type { Aliases } from './context';
import type { Decision } from './decision';

export interface GateMemory {
  provisional: {
    nodeId: string;
    prevActiveId: string | null;
    startMs: number;
    /**
     * Commitments made while the node is provisional. There is no op to re-point a commitment, so they
     * are emitted when the gate settles: on the promoted node, or on the node it folds back into.
     */
    held?: Commitment[];
  } | null;
  /** highest seq ever assigned (removed provisional nodes do not free their seq) */
  lastSeq: number;
  /** when macro_anchor was last set (ms on the audio clock) */
  anchorSetAtMs: number | null;
}

export const emptyMemory = (): GateMemory => ({ provisional: null, lastSeq: 0, anchorSetAtMs: null });

export interface TranslateInput {
  state: GraphState;
  decision: Decision;
  aliases: Aliases;
  window: readonly Utterance[];
  utterancesById: ReadonlyMap<string, Utterance>;
  memory: GateMemory;
  newId(): string;
  nowMs: number;
  /** pending/parked node ids whose embedding matched the new topic label (≥ pendingAutoResolveMin) */
  autoResolveIds?: readonly string[];
}

export interface TranslateResult {
  ops: GraphOp[];
  memory: GateMemory;
  state: GraphState;
  /** nodes created as new topics this decision (for the granularity burst rule) */
  created: { nodeId: string; explicit: boolean }[];
  /** nodes created this decision (embed them; summary refinements are not re-embedded) */
  touched: string[];
  /** non-fatal problems, for logs */
  warnings: string[];
}

/** The node the conversation is "in" right now: a pending provisional node, else the active one. */
export function effectiveActiveId(state: GraphState, memory: GateMemory): string | null {
  const p = memory.provisional;
  if (p && state.nodes[p.nodeId]) return p.nodeId;
  return state.activeNodeId;
}

/** Check a parsed decision against the context it was made from. Returns an error to retry with. */
export function validateDecision(
  d: Decision,
  aliases: Aliases,
  window: readonly Utterance[],
  state: GraphState,
  memory: GateMemory,
): string | null {
  const windowIds = new Set(window.map((u) => u.id));
  const range = `${window[0]?.id}…${window[window.length - 1]?.id}`;
  const topicAlias = (a: string | null | undefined) => {
    const id = a ? aliases.toId.get(a) : undefined;
    return id && state.nodes[id]?.kind === 'topic' ? id : undefined;
  };
  if (d.action === 'continue' && !effectiveActiveId(state, memory)) {
    return 'There is no active topic yet, so action cannot be continue: open the first topic with new_topic.';
  }
  if (d.action === 'new_topic') {
    const t = d.new_topic!;
    if (!windowIds.has(t.starts_at_utterance)) {
      return `new_topic.starts_at_utterance "${t.starts_at_utterance}" must be one of the NEW utterances (${range}).`;
    }
    if (t.relation === 'child_of' && !topicAlias(t.parent_node_id)) {
      return `new_topic.parent_node_id "${t.parent_node_id}" is not a topic node id from the OUTLINE.`;
    }
  }
  if (d.action === 'revisit') {
    const r = d.revisit!;
    if (!topicAlias(r.node_id)) return `revisit.node_id "${r.node_id}" is not a topic node id from the OUTLINE.`;
    if (!windowIds.has(r.starts_at_utterance)) {
      return `revisit.starts_at_utterance "${r.starts_at_utterance}" must be one of the NEW utterances (${range}).`;
    }
  }
  return null;
}

/** 1–4 words, no trailing punctuation, first letters capitalised. */
export function cleanLabel(raw: string): string {
  const words = raw.replace(/["“”]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, LABEL_MAX_WORDS);
  const label = words.map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return label.replace(/[.,;:!?…-]+$/, '') || 'Untitled';
}

export function cleanSummary(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length <= SUMMARY_MAX_CHARS ? s : `${s.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

class Builder {
  ops: GraphOp[] = [];
  warnings: string[] = [];
  touched = new Set<string>();
  private seq: number;

  constructor(
    public state: GraphState,
    public memory: GateMemory,
    private readonly newIdFn: () => string,
  ) {
    this.seq = state.lastSeq;
    const maxNodeSeq = Math.max(0, ...Object.values(state.nodes).map((n) => n.seq));
    this.memory = { ...memory, lastSeq: Math.max(memory.lastSeq, maxNodeSeq) };
  }

  newId() {
    return this.newIdFn();
  }

  nextNodeSeq() {
    this.memory = { ...this.memory, lastSeq: this.memory.lastSeq + 1 };
    return this.memory.lastSeq;
  }

  push(op: GraphOp) {
    this.state = applyOps(this.state, {
      conversationId: this.state.conversation.id,
      seq: ++this.seq,
      at: new Date(0).toISOString(),
      source: 'live',
      ops: [op],
    });
    this.ops.push(op);
  }

  node(id: string): TopicNode {
    const n = this.state.nodes[id];
    if (!n) throw new Error(`translate: missing node ${id}`);
    return n;
  }

  edge(sourceId: string, targetId: string, kind: TopicEdge['kind']) {
    const dup = Object.values(this.state.edges).some(
      (e) => e.sourceId === sourceId && e.targetId === targetId && e.kind === kind,
    );
    if (dup || sourceId === targetId) return;
    this.push({
      op: 'edge.add',
      edge: { id: this.newId(), conversationId: this.state.conversation.id, sourceId, targetId, kind },
    });
  }

  addUtterances(nodeId: string, us: readonly Utterance[]) {
    if (us.length === 0) return;
    const n = this.node(nodeId);
    const ids = [...n.utteranceIds];
    for (const u of us) if (!ids.includes(u.id)) ids.push(u.id);
    this.push({ op: 'node.update', id: nodeId, patch: { utteranceIds: ids } });
  }

  /** close `fromId` (if any) and make `toId` the active node with a flow edge */
  moveTo(fromId: string | null, toId: string, atMs: number) {
    if (fromId && fromId !== toId) {
      this.push({ op: 'node.update', id: fromId, patch: { status: 'closed', endMs: atMs } });
      this.edge(fromId, toId, 'flow');
    }
    this.push({ op: 'active.set', nodeId: toId });
  }

  /** commit the pending provisional node, if any */
  promote() {
    const p = this.memory.provisional;
    if (!p) return;
    this.memory = { ...this.memory, provisional: null };
    if (!this.state.nodes[p.nodeId]) return;
    this.push({ op: 'node.update', id: p.nodeId, patch: { status: 'active' } });
    const prev = p.prevActiveId && this.state.nodes[p.prevActiveId] ? p.prevActiveId : null;
    this.moveTo(prev, p.nodeId, p.startMs);
    for (const c of p.held ?? []) this.push({ op: 'commitment.add', commitment: { ...c, nodeId: p.nodeId } });
  }

  /** remove the provisional node and fold its utterances into the node it interrupted */
  reverse() {
    const p = this.memory.provisional!;
    this.memory = { ...this.memory, provisional: null };
    const node = this.state.nodes[p.nodeId];
    if (!node) return;
    const back = p.prevActiveId ? this.state.nodes[p.prevActiveId] : undefined;
    // tethers (threads raised here, threads resolved here) move to the node we fold back into,
    // so removing the provisional node never orphans a thread
    const tethers = Object.values(this.state.edges).filter(
      (e) => e.kind === 'tether' && (e.sourceId === p.nodeId || e.targetId === p.nodeId),
    );
    this.push({ op: 'node.remove', id: p.nodeId });
    if (back) {
      const ids = [...back.utteranceIds, ...node.utteranceIds.filter((u) => !back.utteranceIds.includes(u))];
      this.push({ op: 'node.update', id: back.id, patch: { utteranceIds: ids } });
      for (const e of tethers) {
        const s = e.sourceId === p.nodeId ? back.id : e.sourceId;
        const t = e.targetId === p.nodeId ? back.id : e.targetId;
        if (this.state.nodes[s] && this.state.nodes[t]) this.edge(s, t, 'tether');
      }
    }
    for (const c of p.held ?? []) this.push({ op: 'commitment.add', commitment: { ...c, nodeId: back?.id ?? null } });
  }

  addTopic(input: {
    label: string;
    summary: string;
    level: Level;
    parentId: string | null;
    threadId?: string;
    status: TopicNode['status'];
    startMs: number;
    utterances: readonly Utterance[];
    revisitOfId?: string;
  }): string {
    const id = this.newId();
    const base: TopicNode = {
      id,
      conversationId: this.state.conversation.id,
      kind: 'topic',
      status: input.status,
      level: input.level,
      label: cleanLabel(input.label),
      summary: cleanSummary(input.summary),
      details: null,
      parentId: input.parentId,
      threadId: input.threadId ?? this.newId(),
      seq: this.nextNodeSeq(),
      startMs: input.startMs,
      endMs: null,
      mentionedAtMs: null,
      utteranceIds: input.utterances.map((u) => u.id),
      speakers: [],
      highlighted: false,
      createdBy: 'ai',
      x: 0,
      y: 0,
    };
    const pos = placeNode(this.state, base, input.revisitOfId ? { revisitOfId: input.revisitOfId } : {});
    this.push({ op: 'node.add', node: { ...base, ...pos } });
    this.touched.add(id);
    return id;
  }

  addThread(input: {
    kind: 'pending' | 'parked';
    label: string;
    summary: string;
    atMs: number;
    utteranceIds: string[];
    anchorId: string | null;
    createdBy: 'ai' | 'user';
  }): string {
    const id = this.newId();
    const base: TopicNode = {
      id,
      conversationId: this.state.conversation.id,
      kind: input.kind,
      status: 'active',
      level: 1,
      label: cleanLabel(input.label),
      summary: cleanSummary(input.summary),
      details: null,
      parentId: null,
      threadId: this.newId(),
      seq: this.nextNodeSeq(),
      startMs: input.atMs,
      endMs: null,
      mentionedAtMs: input.atMs,
      utteranceIds: input.utteranceIds,
      speakers: [],
      highlighted: false,
      createdBy: input.createdBy,
      x: 0,
      y: 0,
    };
    const anchorNodeId = input.anchorId && this.state.nodes[input.anchorId] ? input.anchorId : undefined;
    const pos = placeNode(this.state, base, anchorNodeId ? { anchorNodeId } : {});
    this.push({ op: 'node.add', node: { ...base, ...pos } });
    if (anchorNodeId) this.edge(anchorNodeId, id, 'tether');
    this.touched.add(id);
    return id;
  }

  resolveThread(threadId: string, discussedInId: string | null) {
    const t = this.state.nodes[threadId];
    if (!t || t.kind === 'topic' || t.status !== 'active') return;
    this.push({ op: 'node.update', id: threadId, patch: { status: 'resolved' } });
    if (discussedInId && this.state.nodes[discussedInId]) this.edge(threadId, discussedInId, 'tether');
  }
}

/** Parent and level for a new topic, enforcing 1 ≤ level ≤ 2 and parent.level < level. */
function placement(
  b: Builder,
  relation: NonNullable<Decision['new_topic']>['relation'],
  wantLevel: 1 | 2,
  activeId: string | null,
  explicitParentId: string | undefined,
): { level: Level; parentId: string | null } {
  const active = activeId ? b.state.nodes[activeId] : undefined;
  const asChildOf = (p: TopicNode | undefined): { level: Level; parentId: string | null } => {
    if (!p || p.kind !== 'topic') return { level: 1, parentId: null };
    if (p.level >= 2) return asChildOf(p.parentId ? b.state.nodes[p.parentId] : undefined);
    return { level: (p.level + 1) as Level, parentId: p.id };
  };
  switch (relation) {
    case 'new_theme':
      return { level: 1, parentId: null };
    case 'child_of':
      return asChildOf(explicitParentId ? b.state.nodes[explicitParentId] : undefined);
    case 'child_of_active':
      return asChildOf(active);
    case 'sibling_of_active': {
      if (!active || active.kind !== 'topic') return { level: 1, parentId: null };
      if (wantLevel === 1 && active.level === 2) return { level: 1, parentId: null };
      return { level: active.level, parentId: active.parentId };
    }
  }
}

export function translate(input: TranslateInput): TranslateResult {
  const { decision: d, aliases, window } = input;
  const b = new Builder(input.state, input.memory, input.newId);
  const created: TranslateResult['created'] = [];
  const idOf = (alias: string | null | undefined) => (alias ? aliases.toId.get(alias) : undefined);
  const indexOf = (uid: string) =>
    Math.max(
      0,
      window.findIndex((u) => u.id === uid),
    );

  // 1 ─ settle the pending provisional node
  let action = d.action;
  const prov = b.memory.provisional;
  if (prov && b.state.nodes[prov.nodeId]) {
    const backTo = action === 'revisit' ? idOf(d.revisit!.node_id) : undefined;
    const startU = action === 'revisit' ? input.utterancesById.get(d.revisit!.starts_at_utterance) : undefined;
    const span = (startU?.startMs ?? input.nowMs) - prov.startMs;
    if (backTo && backTo === prov.prevActiveId && span < INTERPRETER.commitAfterMs) {
      b.reverse();
      action = 'continue';
    } else {
      b.promote();
    }
  } else if (prov) {
    b.memory = { ...b.memory, provisional: null };
  }
  let current = b.state.activeNodeId;

  // 2 ─ the action
  let discussedIn: string | null = current;
  if (action === 'revisit') {
    const target = idOf(d.revisit!.node_id)!;
    if (target === current) action = 'continue';
  }
  if (action === 'continue') {
    if (current) {
      b.addUtterances(current, window);
      const upd = d.continue?.summary_update;
      if (upd && d.action === 'continue') {
        b.push({ op: 'node.update', id: current, patch: { summary: cleanSummary(upd) } });
      }
    }
  } else if (action === 'new_topic') {
    const t = d.new_topic!;
    const k = current ? indexOf(t.starts_at_utterance) : 0;
    if (current) b.addUtterances(current, window.slice(0, k));
    const { level, parentId } = placement(b, t.relation, t.level, current, idOf(t.parent_node_id));
    const startMs = window[k]!.startMs;
    const gated = current !== null && !t.explicit_shift;
    const id = b.addTopic({
      label: t.label,
      summary: t.summary,
      level,
      parentId,
      status: gated ? 'provisional' : 'active',
      startMs,
      utterances: window.slice(k),
    });
    created.push({ nodeId: id, explicit: t.explicit_shift });
    if (gated) {
      b.memory = { ...b.memory, provisional: { nodeId: id, prevActiveId: current, startMs } };
    } else {
      b.moveTo(current, id, startMs);
      current = id;
    }
    discussedIn = id;
  } else if (action === 'revisit') {
    const r = d.revisit!;
    const target = b.node(idOf(r.node_id)!);
    const k = indexOf(r.starts_at_utterance);
    if (current) b.addUtterances(current, window.slice(0, k));
    const startMs = window[k]!.startMs;
    const id = b.addTopic({
      label: r.label || target.label,
      summary: r.summary,
      level: target.level,
      parentId: target.parentId,
      threadId: target.threadId,
      status: 'active',
      startMs,
      utterances: window.slice(k),
      revisitOfId: target.id,
    });
    b.moveTo(current, id, startMs);
    b.edge(id, target.id, 'revisit');
    current = id;
    discussedIn = id;
  }

  // 3 ─ threads resolved by the model or by label similarity
  const resolveIds = new Set<string>(input.autoResolveIds ?? []);
  for (const a of d.resolved_thread_ids) {
    const id = idOf(a);
    if (id) resolveIds.add(id);
    else b.warnings.push(`unknown resolved_thread_id ${a}`);
  }
  for (const id of resolveIds) b.resolveThread(id, discussedIn);

  // 4 ─ intentions
  const anchorForThreads = effectiveActiveId(b.state, b.memory);
  for (const it of d.intentions) {
    const quote = input.utterancesById.get(it.quote_utterance);
    if (!quote) {
      b.warnings.push(`dropped ${it.kind} "${it.label}": unknown quote_utterance ${it.quote_utterance}`);
      continue;
    }
    if (it.kind === 'deferred_topic') {
      const label = cleanLabel(it.label);
      const exists = Object.values(b.state.nodes).some(
        (n) => n.kind !== 'topic' && n.label.toLowerCase() === label.toLowerCase(),
      );
      if (exists) continue;
      b.addThread({
        kind: 'pending',
        label,
        summary: cleanSummary(`Deferred: "${quote.text}"`),
        atMs: quote.startMs,
        utteranceIds: [quote.id],
        anchorId: anchorForThreads,
        createdBy: 'ai',
      });
    } else {
      const text = it.label.trim();
      const held = b.memory.provisional?.held ?? [];
      if ([...b.state.commitments, ...held].some((c) => c.text.toLowerCase() === text.toLowerCase())) continue;
      const commitment: Commitment = {
        id: b.newId(),
        conversationId: b.state.conversation.id,
        nodeId: anchorForThreads && b.state.nodes[anchorForThreads] ? anchorForThreads : null,
        text,
        speaker: quote.speaker,
        atMs: quote.startMs,
        done: false,
      };
      const prov = b.memory.provisional;
      if (prov && commitment.nodeId === prov.nodeId) {
        b.memory = { ...b.memory, provisional: { ...prov, held: [...held, commitment] } };
      } else {
        b.push({ op: 'commitment.add', commitment });
      }
    }
  }

  // 5 ─ macro anchor: set once, change only after a long while
  const anchor = d.macro_anchor?.trim();
  if (anchor && anchor !== b.state.conversation.macroAnchor) {
    const last = b.memory.anchorSetAtMs;
    if (last === null || input.nowMs - last >= 3 * 60_000) {
      b.push({ op: 'conversation.update', patch: { macroAnchor: anchor } });
      b.memory = { ...b.memory, anchorSetAtMs: input.nowMs };
    }
  }

  return {
    ops: b.ops,
    memory: b.memory,
    state: b.state,
    created,
    touched: [...b.touched],
    warnings: b.warnings,
  };
}

/** Ops for "the user parked a thought". */
export function parkOps(
  state: GraphState,
  memory: GateMemory,
  text: string,
  atMs: number,
  newId: () => string,
): { ops: GraphOp[]; memory: GateMemory; state: GraphState; nodeId: string } {
  const b = new Builder(state, memory, newId);
  const nodeId = b.addThread({
    kind: 'parked',
    label: text,
    summary: `Parked by the user: ${text}`,
    atMs,
    utteranceIds: [],
    anchorId: effectiveActiveId(state, memory),
    createdBy: 'user',
  });
  return { ops: b.ops, memory: b.memory, state: b.state, nodeId };
}

/** Ops for stop: commit the provisional node, close the active one, open threads → unexplored. */
export function stopOps(
  state: GraphState,
  memory: GateMemory,
  endMs: number,
  newId: () => string,
): { ops: GraphOp[]; memory: GateMemory; state: GraphState } {
  const b = new Builder(state, memory, newId);
  b.promote();
  const active = b.state.activeNodeId;
  if (active) {
    b.push({ op: 'node.update', id: active, patch: { status: 'closed', endMs } });
    b.push({ op: 'active.set', nodeId: null });
  }
  for (const n of Object.values(b.state.nodes)) {
    if (n.kind !== 'topic' && n.status === 'active') {
      b.push({ op: 'node.update', id: n.id, patch: { status: 'unexplored' } });
    }
  }
  return { ops: b.ops, memory: b.memory, state: b.state };
}
