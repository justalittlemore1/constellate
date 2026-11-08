/**
 * Public API of the topic interpreter. A1 (server) integrates ONLY through these two exports;
 * the signatures come from @constellate/shared and are frozen.
 *
 *   src/trigger.ts      when to call the LLM (window, pause, discourse markers)
 *   src/context.ts      context packing (anchor, outline, open threads, candidates, summary, recent)
 *   src/granularity.ts  density hints
 *   src/decision.ts     Decision type + JSON schema
 *   src/translate.ts    Decision → GraphOp[] (commit gate, placeNode, threads)
 *   src/finalize.ts     post-recording refinement (MODELS.refine)
 *   src/live.ts         the live state machine (queue, timeout, retry)
 *   src/llm/            LlmClient implementations (gemini, anthropic, replay)
 *   prompts/live.md, prompts/finalize.md
 *   eval/run.ts, eval/reports/
 */
import type { CreateLiveInterpreter, FinalizeConversation } from '@constellate/shared';
import { createFinalizer } from './finalize';
import { createInterpreter } from './live';

/** Provider from INTERPRETER_PROVIDER (gemini | anthropic), model from MODELS.interpreter. */
export const createLiveInterpreter: CreateLiveInterpreter = (deps) => createInterpreter(deps);

/** One MODELS.refine call after stop; on failure returns no ops so the live graph stands. */
export const finalizeConversation: FinalizeConversation = (input) => createFinalizer()(input);

export { createInterpreter, type DecisionRecord, type InterpreterOptions, type Scheduler } from './live';
export type { LlmClient, LlmJsonArgs, LlmJsonResult } from './llm/types';
export { createAnthropicClient, createGeminiClient, createGeminiEmbedder } from './llm';
export { createFinalizer, type FinalizerOptions } from './finalize';
