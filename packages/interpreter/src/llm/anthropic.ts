/**
 * LlmClient on the Anthropic Messages API with JSON-schema structured output (`output_config.format`).
 * The live interpreter model runs with thinking off and low effort for latency; anything else
 * (finalisation, Brain merge) keeps adaptive thinking.
 */
import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@constellate/shared';
import type { LlmClient, LlmJsonArgs } from './types';
import { LlmError } from './errors';

export interface AnthropicClientOptions {
  apiKey?: string;
  client?: Anthropic;
}

/** Request settings per model; part of the eval recording key so a settings change is never served stale answers. */
export function tuning(
  model: string,
): Pick<Anthropic.MessageCreateParamsNonStreaming, 'max_tokens' | 'thinking' | 'output_config'> {
  if (model === MODELS.interpreter.anthropic) {
    // adaptive thinking at low effort: thinking off made level and revisit judgements unreliable,
    // and latency stays well inside the 3 s gate (see eval reports)
    return { max_tokens: 4_000, thinking: { type: 'adaptive' }, output_config: { effort: 'low' } };
  }
  return { max_tokens: 16_000, output_config: { effort: 'medium' } };
}

export function createAnthropicClient(opts: AnthropicClientOptions = {}): LlmClient {
  const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  return {
    async json<T>({ system, user, schema, model, timeoutMs }: LlmJsonArgs) {
      const t0 = performance.now();
      const base = tuning(model);
      const res = await client.messages.create(
        {
          model,
          ...base,
          output_config: {
            ...base.output_config,
            format: { type: 'json_schema', schema: schema as Record<string, unknown> },
          },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        },
        { timeout: timeoutMs, maxRetries: 0 },
      );
      const ms = performance.now() - t0;
      if (res.stop_reason === 'refusal')
        throw new LlmError('refusal', `model refused (${res.stop_details?.category ?? 'unknown'})`);
      if (res.stop_reason === 'max_tokens') throw new LlmError('truncated', 'response hit max_tokens');
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new LlmError('invalid_json', `response was not JSON: ${text.slice(0, 200)}`);
      }
      const u = res.usage;
      return {
        data,
        ms,
        inTok: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outTok: u.output_tokens,
      };
    },
  };
}
