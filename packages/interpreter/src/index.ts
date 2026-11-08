/**
 * Public API of the topic interpreter. A1 (server) integrates ONLY through these two exports.
 * A2 replaces the stub bodies; the signatures come from @constellate/shared and are frozen.
 *
 * Planned layout (A2):
 *   src/trigger.ts      when to call the LLM (window, pause, discourse markers)
 *   src/context.ts      context packing (anchor, outline, open threads, candidates, summary, recent)
 *   src/granularity.ts  density hints
 *   src/decision.ts     Decision type + JSON schema
 *   src/translate.ts    Decision → GraphOp[] (commit gate, placeNode, threads)
 *   src/finalize.ts     post-recording refinement
 *   src/llm/{gemini,anthropic,replay}.ts   LlmClient implementations
 *   prompts/live.md, prompts/finalize.md
 *   eval/run.ts, eval/reports/
 */
import type { CreateLiveInterpreter, FinalizeConversation } from '@constellate/shared';

/** STUB (A2 replaces): accepts utterances and emits nothing, so the server can be built against it. */
export const createLiveInterpreter: CreateLiveInterpreter = (deps) => {
  const buffered: string[] = [];
  return {
    pushUtterance(u) {
      buffered.push(u.id);
      deps.log?.('interpreter.stub.utterance', { id: u.id });
    },
    park(text, atMs) {
      deps.log?.('interpreter.stub.park', { text, atMs });
    },
    async stop() {
      deps.log?.('interpreter.stub.stop', { utterances: buffered.length });
    },
  };
};

/** STUB (A2 replaces): returns no edits. */
export const finalizeConversation: FinalizeConversation = async () => ({ ops: [], recallPrompts: [] });
