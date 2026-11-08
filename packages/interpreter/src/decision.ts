/**
 * The decision the live LLM returns for one window of utterances (docs/PLAN.md → Decision schema).
 * Node ids in a decision are the short aliases from the packed context (`n3`, `p1`), never UUIDs;
 * `context.ts` maps them back.
 */
import { z } from 'zod';

export const RELATIONS = ['child_of_active', 'sibling_of_active', 'child_of', 'new_theme'] as const;

export const DecisionSchema = z.object({
  action: z.enum(['continue', 'new_topic', 'revisit']),
  continue: z
    .object({ summary_update: z.string().optional().nullable() })
    .optional()
    .nullable(),
  new_topic: z
    .object({
      label: z.string().min(1),
      summary: z.string(),
      level: z.union([z.literal(1), z.literal(2)]),
      relation: z.enum(RELATIONS),
      parent_node_id: z.string().optional().nullable(),
      starts_at_utterance: z.string(),
      explicit_shift: z.boolean(),
    })
    .optional()
    .nullable(),
  revisit: z
    .object({
      node_id: z.string(),
      starts_at_utterance: z.string(),
      label: z.string().optional().nullable(),
      summary: z.string(),
    })
    .optional()
    .nullable(),
  intentions: z.array(
    z.object({
      kind: z.enum(['deferred_topic', 'promise']),
      label: z.string().min(1),
      quote_utterance: z.string(),
    }),
  ),
  resolved_thread_ids: z.array(z.string()),
  macro_anchor: z.string().optional().nullable(),
  rolling_summary: z.string(),
});

export type Decision = z.infer<typeof DecisionSchema>;

const str = { type: 'string' } as const;

/**
 * JSON schema sent to the providers. Kept to the subset both Gemini (`responseJsonSchema`) and
 * Claude (`output_config.format`) accept: no numeric/string constraints, `additionalProperties: false`
 * on every object. Optional sub-objects are nullable rather than absent so every key is `required`.
 */
export const DECISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['continue', 'new_topic', 'revisit'] },
    continue: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { summary_update: { anyOf: [str, { type: 'null' }] } },
          required: ['summary_update'],
        },
        { type: 'null' },
      ],
    },
    new_topic: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: str,
            summary: str,
            level: { type: 'integer', enum: [1, 2] },
            relation: { type: 'string', enum: [...RELATIONS] },
            parent_node_id: { anyOf: [str, { type: 'null' }] },
            starts_at_utterance: str,
            explicit_shift: { type: 'boolean' },
          },
          required: ['label', 'summary', 'level', 'relation', 'parent_node_id', 'starts_at_utterance', 'explicit_shift'],
        },
        { type: 'null' },
      ],
    },
    revisit: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            node_id: str,
            starts_at_utterance: str,
            label: { anyOf: [str, { type: 'null' }] },
            summary: str,
          },
          required: ['node_id', 'starts_at_utterance', 'label', 'summary'],
        },
        { type: 'null' },
      ],
    },
    intentions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['deferred_topic', 'promise'] },
          label: str,
          quote_utterance: str,
        },
        required: ['kind', 'label', 'quote_utterance'],
      },
    },
    resolved_thread_ids: { type: 'array', items: str },
    macro_anchor: { anyOf: [str, { type: 'null' }] },
    rolling_summary: str,
  },
  required: [
    'action',
    'continue',
    'new_topic',
    'revisit',
    'intentions',
    'resolved_thread_ids',
    'macro_anchor',
    'rolling_summary',
  ],
} as const;

/** Parse and check internal consistency (the action's payload must be present). */
export function parseDecision(raw: unknown): { ok: true; decision: Decision } | { ok: false; error: string } {
  const r = DecisionSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
  }
  const d = r.data;
  if (d.action === 'new_topic' && !d.new_topic) return { ok: false, error: 'action is new_topic but new_topic is null' };
  if (d.action === 'revisit' && !d.revisit) return { ok: false, error: 'action is revisit but revisit is null' };
  if (d.new_topic?.relation === 'child_of' && d.action === 'new_topic' && !d.new_topic.parent_node_id) {
    return { ok: false, error: 'relation child_of requires parent_node_id' };
  }
  return { ok: true, decision: d };
}
