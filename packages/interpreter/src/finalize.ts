/**
 * Post-recording refinement (docs/PLAN.md → Finalisation pass): one call to MODELS.refine with the
 * whole transcript and the live graph; the result becomes an OpBatch with source 'finalize'.
 * Every id is preserved, layout and user highlights/annotations are never touched, and each
 * suggestion is validated on its own (a bad item is dropped, not the whole pass). If the call
 * fails twice the live graph stands.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  applyOps,
  MODELS,
  type FinalizeConversation,
  type FinalizeInput,
  type FinalizeResult,
  type GraphOp,
  type GraphState,
  type TopicNode,
  type Utterance,
} from '@constellate/shared';
import { aliasFor, buildAliases, fmtTime, fmtUtterance, type Aliases } from './context';
import { cleanLabel } from './translate';
import { createAnthropicClient } from './llm/anthropic';
import type { LlmClient } from './llm/types';

export const FINALIZE_TIMEOUT_MS = 120_000;
export const TITLE_MAX_WORDS = 6;
export const CONVERSATION_SUMMARY_MAX = 200;

const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] });
const str = { type: 'string' } as const;
const obj = (properties: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

export const FINALIZE_JSON_SCHEMA = obj({
  renames: { type: 'array', items: obj({ node: str, label: str }) },
  merges: { type: 'array', items: obj({ from: str, into: str }) },
  details: { type: 'array', items: obj({ node: str, text: str, evidence: { type: 'array', items: str } }) },
  parents: { type: 'array', items: obj({ node: str, parent: nullable(str) }) },
  thread_status: {
    type: 'array',
    items: obj({
      node: str,
      status: { type: 'string', enum: ['resolved', 'unexplored'] },
      discussed_in: nullable(str),
    }),
  },
  commitments: { type: 'array', items: obj({ text: str, utterance: str, node: nullable(str) }) },
  title: str,
  summary: str,
  recall_prompts: { type: 'array', items: obj({ node: str, prompt: str }) },
});

export const FinalizeOutputSchema = z.object({
  renames: z.array(z.object({ node: z.string(), label: z.string() })),
  merges: z.array(z.object({ from: z.string(), into: z.string() })),
  details: z.array(z.object({ node: z.string(), text: z.string(), evidence: z.array(z.string()) })),
  parents: z.array(z.object({ node: z.string(), parent: z.string().nullable() })),
  thread_status: z.array(
    z.object({ node: z.string(), status: z.enum(['resolved', 'unexplored']), discussed_in: z.string().nullable() }),
  ),
  commitments: z.array(z.object({ text: z.string(), utterance: z.string(), node: z.string().nullable() })),
  title: z.string(),
  summary: z.string(),
  recall_prompts: z.array(z.object({ node: z.string(), prompt: z.string() })),
});
export type FinalizeOutput = z.infer<typeof FinalizeOutputSchema>;

let cachedPrompt: string | null = null;
export function finalizePrompt(): string {
  cachedPrompt ??= readFileSync(new URL('../prompts/finalize.md', import.meta.url), 'utf8');
  return cachedPrompt;
}

const byStart = (a: TopicNode, b: TopicNode) => a.startMs - b.startMs || a.seq - b.seq;
const uNum = (id: string) => Number(id.replace(/^u/, '')) || 0;

/** The user message: transcript, map outline, flags and commitments. */
export function packFinalize(state: GraphState, utterances: readonly Utterance[]): { text: string; aliases: Aliases } {
  const aliases = buildAliases(state);
  const al = (id: string | null) => (id ? (aliases.toAlias.get(id) ?? '-') : '-');
  const nodes = Object.values(state.nodes).sort(byStart);
  const threadAlias = new Map<string, string>();
  for (const n of nodes) if (!threadAlias.has(n.threadId)) threadAlias.set(n.threadId, `t${threadAlias.size + 1}`);
  const lines = ['TRANSCRIPT:', ...utterances.map(fmtUtterance), '', 'MAP:'];
  for (const n of nodes) {
    const ids = [...n.utteranceIds].sort((a, b) => uNum(a) - uNum(b));
    const range = ids.length ? `${ids[0]}–${ids[ids.length - 1]}` : '-';
    const span = `${fmtTime(n.startMs)}–${n.endMs !== null ? fmtTime(n.endMs) : ''}`;
    lines.push(
      `${al(n.id)} | ${n.kind} | L${n.level} | ${n.label} | parent ${al(n.parentId)} | thread ${threadAlias.get(n.threadId)} | ${n.status} | ${span} | ${range}`,
    );
  }
  lines.push('', 'FLAGS:');
  if (state.flags.length === 0) lines.push('(none)');
  for (const f of state.flags) lines.push(`${fmtTime(f.atMs)} in ${al(f.nodeId)}${f.note ? ` — ${f.note}` : ''}`);
  lines.push('', 'COMMITMENTS:');
  if (state.commitments.length === 0) lines.push('(none)');
  for (const c of state.commitments) lines.push(`${fmtTime(c.atMs)} "${c.text}" in ${al(c.nodeId)}`);
  return { text: lines.join('\n'), aliases };
}

class FinalizeBuilder {
  ops: GraphOp[] = [];
  warnings: string[] = [];
  private seq: number;
  constructor(public state: GraphState) {
    this.seq = state.lastSeq;
  }
  push(op: GraphOp): boolean {
    try {
      this.state = applyOps(this.state, {
        conversationId: this.state.conversation.id,
        seq: ++this.seq,
        at: new Date(0).toISOString(),
        source: 'finalize',
        ops: [op],
      });
      this.ops.push(op);
      return true;
    } catch (e) {
      this.warnings.push(`dropped ${op.op}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}

export function truncateWords(s: string, max: number): string {
  return s.replace(/["“”]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

/** Convert a validated output into ops (pure). Returns ops, recall prompts and dropped items. */
export function translateFinalize(
  input: FinalizeInput,
  out: FinalizeOutput,
  aliases: Aliases,
): FinalizeResult & { warnings: string[] } {
  const b = new FinalizeBuilder(input.state);
  const byUid = new Map(input.utterances.map((u) => [u.id, u]));
  const node = (alias: string | null | undefined): TopicNode | undefined => {
    const id = alias ? aliases.toId.get(alias) : undefined;
    return id ? b.state.nodes[id] : undefined;
  };
  const topic = (alias: string | null | undefined) => {
    const n = node(alias);
    return n?.kind === 'topic' ? n : undefined;
  };

  // merges first: only adjacent occurrences (no other topic starts between them)
  for (const m of out.merges) {
    const from = topic(m.from);
    const into = topic(m.into);
    if (!from || !into || from.id === into.id) {
      b.warnings.push(`merge ${m.from}→${m.into}: not two topic nodes`);
      continue;
    }
    const [lo, hi] = from.startMs < into.startMs ? [from, into] : [into, from];
    const between = Object.values(b.state.nodes).some(
      (n) => n.kind === 'topic' && n.id !== lo.id && n.id !== hi.id && n.startMs > lo.startMs && n.startMs < hi.startMs,
    );
    if (between) {
      b.warnings.push(`merge ${m.from}→${m.into}: another topic lies between them (a revisit, not a duplicate)`);
      continue;
    }
    b.push({ op: 'node.merge', fromId: from.id, intoId: into.id });
  }

  for (const r of out.renames) {
    const n = node(r.node);
    if (!n || n.createdBy === 'user') continue;
    const label = cleanLabel(r.label);
    if (label !== n.label) b.push({ op: 'node.update', id: n.id, patch: { label } });
  }

  for (const p of out.parents) {
    const n = topic(p.node);
    if (!n) continue;
    if (p.parent === null) {
      if (n.level === 1 && n.parentId !== null) b.push({ op: 'node.update', id: n.id, patch: { parentId: null } });
      continue;
    }
    const parent = topic(p.parent);
    if (!parent || parent.level >= n.level || parent.startMs > n.startMs) {
      b.warnings.push(`parent ${p.node}→${p.parent}: must be an earlier topic of a lower level`);
      continue;
    }
    if (parent.id !== n.parentId) b.push({ op: 'node.update', id: n.id, patch: { parentId: parent.id } });
  }

  for (const t of out.thread_status) {
    const n = node(t.node);
    if (!n || n.kind === 'topic') continue;
    if (n.status !== t.status) b.push({ op: 'node.update', id: n.id, patch: { status: t.status } });
    const target = t.status === 'resolved' ? topic(t.discussed_in) : undefined;
    if (
      target &&
      !Object.values(b.state.edges).some((e) => e.kind === 'tether' && e.sourceId === n.id && e.targetId === target.id)
    ) {
      b.push({
        op: 'edge.add',
        edge: {
          id: input.newId(),
          conversationId: n.conversationId,
          sourceId: n.id,
          targetId: target.id,
          kind: 'tether',
        },
      });
    }
  }

  for (const d of out.details) {
    const n = topic(d.node);
    if (!n) continue;
    const evidence = [...new Set(d.evidence)]
      .filter((u) => n.utteranceIds.includes(u))
      .sort((a, c) => uNum(a) - uNum(c));
    const text = d.text.trim();
    if (!text) continue;
    const details = evidence.length ? `${text}\n\nEvidence: ${evidence.join(', ')}` : text;
    b.push({ op: 'node.update', id: n.id, patch: { details } });
  }

  for (const c of out.commitments) {
    const u = byUid.get(c.utterance);
    const text = c.text.trim();
    if (!u || !text) continue;
    const dup = b.state.commitments.some((x) => {
      const a = x.text.toLowerCase();
      const z2 = text.toLowerCase();
      return a === z2 || a.includes(z2) || z2.includes(a) || Math.abs(x.atMs - u.startMs) < 2_000;
    });
    if (dup) continue;
    const n =
      node(c.node) ?? Object.values(b.state.nodes).find((x) => x.kind === 'topic' && x.utteranceIds.includes(u.id));
    b.push({
      op: 'commitment.add',
      commitment: {
        id: input.newId(),
        conversationId: b.state.conversation.id,
        nodeId: n?.id ?? null,
        text,
        speaker: u.speaker,
        atMs: u.startMs,
        done: false,
      },
    });
  }

  // speakers from the (diarized) transcript — deterministic, no model involved
  for (const n of Object.values(b.state.nodes)) {
    const speakers = [
      ...new Set(n.utteranceIds.map((id) => byUid.get(id)?.speaker).filter((s): s is number => typeof s === 'number')),
    ].sort((a, c) => a - c);
    if (speakers.length && speakers.join() !== n.speakers.join())
      b.push({ op: 'node.update', id: n.id, patch: { speakers } });
  }

  const title = truncateWords(out.title, TITLE_MAX_WORDS);
  const summary = out.summary.trim().slice(0, CONVERSATION_SUMMARY_MAX);
  if (title || summary)
    b.push({ op: 'conversation.update', patch: { ...(title ? { title } : {}), ...(summary ? { summary } : {}) } });

  const recallPrompts = out.recall_prompts
    .map((r) => ({ nodeId: b.state.nodes[aliases.toId.get(r.node) ?? '']?.id, prompt: r.prompt.trim() }))
    .filter((r): r is { nodeId: string; prompt: string } => !!r.nodeId && !!r.prompt)
    .slice(0, 3);

  return { ops: b.ops, recallPrompts, warnings: b.warnings };
}

export interface FinalizerOptions {
  llm?: LlmClient;
  model?: string;
  systemPrompt?: string;
  log?(event: string, data?: Record<string, unknown>): void;
}

export function createFinalizer(opts: FinalizerOptions = {}): FinalizeConversation {
  return async (input) => {
    const topics = Object.values(input.state.nodes).filter((n) => n.kind === 'topic');
    if (topics.length === 0 || input.utterances.length === 0) return { ops: [], recallPrompts: [] };
    const llm = opts.llm ?? createAnthropicClient();
    const system = opts.systemPrompt ?? finalizePrompt();
    const packed = packFinalize(input.state, input.utterances);
    let user = packed.text;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await llm.json<unknown>({
          system,
          user,
          schema: FINALIZE_JSON_SCHEMA,
          model: opts.model ?? MODELS.refine,
          timeoutMs: FINALIZE_TIMEOUT_MS,
        });
        const parsed = FinalizeOutputSchema.safeParse(res.data);
        if (!parsed.success) {
          const err = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          user = `${packed.text}\n\nYOUR PREVIOUS ANSWER WAS INVALID: ${err}\nAnswer again.`;
          continue;
        }
        const r = translateFinalize(input, parsed.data, packed.aliases);
        opts.log?.('finalize.done', { ops: r.ops.length, warnings: r.warnings, ms: Math.round(res.ms) });
        return { ops: r.ops, recallPrompts: r.recallPrompts };
      } catch (e) {
        opts.log?.('finalize.error', { attempt, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ops: [], recallPrompts: [] };
  };
}

export { aliasFor };
