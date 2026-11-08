import { MODELS, type InterpreterProvider } from '@constellate/shared';
import type { LlmClient } from './types';
export type { LlmClient, LlmJsonArgs, LlmJsonResult } from './types';
import { createAnthropicClient } from './anthropic';

export { createAnthropicClient } from './anthropic';
export { createGeminiEmbedder, normalise } from './gemini';
export {
  createReplayClient,
  createReplayEmbedder,
  newReplayStore,
  requestKey,
  type ReplayMode,
  type ReplayStore,
} from './replay';
export { LlmError, withTimeout } from './errors';
export { geminiUsage, resetGeminiUsage, setGeminiUsageLogger, type ModelUsage } from './usage';

/** Claude by default: reasoning never runs on the free-tier Gemini key (AGENTS.md › API budget, #12). */
export function providerFromEnv(): InterpreterProvider {
  return process.env.INTERPRETER_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
}

/**
 * The reasoning client. Always Claude: Gemini text models are off-budget (AGENTS.md › API budget),
 * so a `gemini` setting is ignored rather than spending the 20/day free-tier quota.
 */
export function createLlmClient(_provider?: InterpreterProvider): LlmClient {
  return createAnthropicClient();
}

/** Always MODELS.interpreter.anthropic (see createLlmClient). */
export function interpreterModel(_provider?: InterpreterProvider): string {
  return MODELS.interpreter.anthropic;
}
