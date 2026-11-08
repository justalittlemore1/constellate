/**
 * The per-conversation concept-merge step (PLAN → The Brain, step 2). Pure: builds the request,
 * defines the structured-output schema, and validates the model's answer. The server makes the
 * actual `MODELS.brain` call. Prompt wording is A2's (`packages/brain/prompts/merge.md`); the
 * default below is used until that file exists.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MergeDecision } from './index';

export interface CandidateConcept {
  id: string;
  name: string;
  description: string | null;
  similarity: number;
}

export interface MergeNode {
  id: string;
  label: string;
  summary: string;
  candidates: CandidateConcept[];
}

export interface MergeRequest {
  conversationTitle: string;
  nodes: MergeNode[];
}

export const DEFAULT_MERGE_SYSTEM = `You maintain a personal map of concepts discussed across many conversations.
For each topic from one new conversation, decide whether it is the SAME concept as one of its candidate concepts, or a NEW concept.
Similar is not the same: "Existentialism" and "Personal Philosophy" are different concepts; "Java" the language and "Java" the island are different concepts. Choose same_as only when the topic is genuinely the same subject, and only from that topic's own candidates.
For a new concept, give a short name (1-4 words, Title Case) and a one-sentence description of the subject itself, never of the people talking. You may say it is broader_than or narrower_than one of the topic's candidates.
Never describe or infer traits of participants (health, religion, politics); name topics only.
Return exactly one decision per topic, using the topic ids given.`;

/** Loads A2's prompt if present, else the default. */
export async function loadMergeSystemPrompt(): Promise<string> {
  try {
    const text = await readFile(new URL('../prompts/merge.md', import.meta.url), 'utf8');
    return text.trim() || DEFAULT_MERGE_SYSTEM;
  } catch {
    return DEFAULT_MERGE_SYSTEM;
  }
}

export function buildMergeUserMessage(req: MergeRequest): string {
  const lines = [`Conversation: ${req.conversationTitle}`, '', 'Topics:'];
  for (const n of req.nodes) {
    lines.push(`- topic ${n.id}: ${n.label} — ${n.summary || '(no summary)'}`);
    if (!n.candidates.length) lines.push('  candidates: none (must be a new concept)');
    for (const c of n.candidates) {
      lines.push(
        `  candidate ${c.id}: ${c.name}${c.description ? ` — ${c.description}` : ''} (similarity ${c.similarity.toFixed(2)})`,
      );
    }
  }
  return lines.join('\n');
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

/** JSON schema for structured output (`output_config.format`). */
export const MERGE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['node_id', 'same_as', 'new_concept'],
        properties: {
          node_id: { type: 'string' },
          same_as: nullableString,
          new_concept: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'description', 'broader_than', 'narrower_than'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  broader_than: nullableString,
                  narrower_than: nullableString,
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const MergeResponseSchema = z.object({
  decisions: z.array(
    z.object({
      node_id: z.string(),
      same_as: z.string().nullable(),
      new_concept: z
        .object({
          name: z.string(),
          description: z.string(),
          broader_than: z.string().nullable(),
          narrower_than: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
});
export type MergeResponse = z.infer<typeof MergeResponseSchema>;

const titleWords = (s: string, max = 4) => s.trim().split(/\s+/).slice(0, max).join(' ');

/** A new concept named after the node itself — used when the model gives nothing usable. */
export function fallbackDecision(n: MergeNode): MergeDecision {
  return { nodeId: n.id, newConcept: { name: titleWords(n.label), description: n.summary || n.label } };
}

/**
 * Validate the model's answer against the request: `same_as` must be one of that node's own
 * candidates, relation targets must be candidates too, names are trimmed to 4 words. Nodes the
 * model skipped or answered invalidly get a fallback new concept. Exactly one decision per node.
 */
export function normalizeDecisions(raw: MergeResponse, req: MergeRequest): MergeDecision[] {
  const byNode = new Map(raw.decisions.map((d) => [d.node_id, d]));
  return req.nodes.map((n) => {
    const d = byNode.get(n.id);
    const candidateIds = new Set(n.candidates.map((c) => c.id));
    if (d?.same_as && candidateIds.has(d.same_as)) return { nodeId: n.id, sameAs: d.same_as };
    if (d?.new_concept && d.new_concept.name.trim()) {
      const nc = d.new_concept;
      return {
        nodeId: n.id,
        newConcept: {
          name: titleWords(nc.name),
          description: nc.description.trim() || n.summary || n.label,
          ...(nc.broader_than && candidateIds.has(nc.broader_than) ? { broaderThan: nc.broader_than } : {}),
          ...(nc.narrower_than && candidateIds.has(nc.narrower_than) ? { narrowerThan: nc.narrower_than } : {}),
        },
      };
    }
    return fallbackDecision(n);
  });
}

/**
 * Used when the merge call fails: join a candidate only when it is nearly identical, otherwise a
 * new concept. Conservative on purpose — a missed merge is cheaper than a wrong one.
 */
export function heuristicDecisions(req: MergeRequest, sameMin = 0.92): MergeDecision[] {
  return req.nodes.map((n) => {
    const best = [...n.candidates].sort((a, b) => b.similarity - a.similarity)[0];
    return best && best.similarity >= sameMin ? { nodeId: n.id, sameAs: best.id } : fallbackDecision(n);
  });
}
