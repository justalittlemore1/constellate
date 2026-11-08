import Anthropic from '@anthropic-ai/sdk';
import {
  buildMergeUserMessage,
  MERGE_RESPONSE_JSON_SCHEMA,
  MergeResponseSchema,
  normalizeDecisions,
  type MergeDecision,
  type MergeRequest,
} from '@constellate/brain';
import { MODELS } from '@constellate/shared';

export type MergeDecider = (req: MergeRequest) => Promise<MergeDecision[]>;

/**
 * One `MODELS.brain` call per conversation with JSON-schema structured output. The answer is
 * validated against the request (`normalizeDecisions`); any failure throws so the caller can
 * fall back to the conservative heuristic.
 */
export function anthropicMergeDecider(client: Anthropic, system: string, timeoutMs = 90_000): MergeDecider {
  return async (req) => {
    const res = await client.messages.create(
      {
        model: MODELS.brain,
        max_tokens: 16_000,
        system,
        messages: [{ role: 'user', content: buildMergeUserMessage(req) }],
        output_config: { format: { type: 'json_schema', schema: MERGE_RESPONSE_JSON_SCHEMA } },
      },
      { timeout: timeoutMs },
    );
    if (res.stop_reason === 'refusal') throw new Error('merge call refused');
    if (res.stop_reason === 'max_tokens') throw new Error('merge call hit max_tokens');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return normalizeDecisions(MergeResponseSchema.parse(JSON.parse(text)), req);
  };
}
