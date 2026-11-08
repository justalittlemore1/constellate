import { MODELS, type InterpreterProvider } from '@constellate/shared';
import type { LlmClient } from './types';
export type { LlmClient, LlmJsonArgs, LlmJsonResult } from './types';
import { createAnthropicClient } from './anthropic';
import { createGeminiClient } from './gemini';

export { createAnthropicClient } from './anthropic';
export { createGeminiClient, createGeminiEmbedder, normalise } from './gemini';
export { createReplayClient, createReplayEmbedder, requestKey, type ReplayMode, type ReplayStore } from './replay';
export { LlmError, withTimeout } from './errors';

export function providerFromEnv(): InterpreterProvider {
  const p = process.env.INTERPRETER_PROVIDER;
  return p === 'anthropic' ? 'anthropic' : 'gemini';
}

/** Client for `provider`; Anthropic is also the client for MODELS.refine / MODELS.brain. */
export function createLlmClient(provider: InterpreterProvider): LlmClient {
  return provider === 'anthropic' ? createAnthropicClient() : createGeminiClient();
}

export function interpreterModel(provider: InterpreterProvider): string {
  return MODELS.interpreter[provider];
}
