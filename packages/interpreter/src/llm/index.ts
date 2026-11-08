import { MODELS, type InterpreterProvider } from '@constellate/shared';
import type { LlmClient } from './types';
export type { LlmClient, LlmJsonArgs, LlmJsonResult } from './types';
import { createAnthropicClient } from './anthropic';

export { createAnthropicClient } from './anthropic';
export { createGeminiEmbedder, EMBED_BATCH_MAX, normalise } from './gemini';
export { CapExceededError, createDailyCap, EVAL_EMBED_CAP_PER_DAY, pacificDay, type DailyCap } from './cap';
export {
  createReplayClient,
  createReplayEmbedder,
  dequantise,
  embeddingsFile,
  flushDeferred,
  llmFile,
  newReplayStore,
  pruneUnused,
  quantise,
  requestKey,
  type ReplayMode,
  type ReplayStore,
} from './replay';
export { LlmError, withTimeout } from './errors';
export { geminiUsage, resetGeminiUsage, setGeminiUsageLogger, type ModelUsage } from './usage';

/** Claude by default: reasoning never runs on the free-tier Gemini key (AGENTS.md › API budget). */
export function providerFromEnv(): InterpreterProvider {
  const p = process.env.INTERPRETER_PROVIDER;
  return p === 'gemini' ? 'gemini' : 'anthropic';
}

/**
 * The reasoning client. Always Claude: Gemini text models are off-budget (AGENTS.md › API budget),
 * so a `gemini` provider setting is ignored rather than spending the free-tier key.
 */
export function createLlmClient(_provider?: InterpreterProvider): LlmClient {
  return createAnthropicClient();
}

/** Always MODELS.interpreter.anthropic (see createLlmClient). */
export function interpreterModel(_provider?: InterpreterProvider): string {
  return MODELS.interpreter.anthropic;
}
