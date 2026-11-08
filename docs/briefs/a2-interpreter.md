# A2 Interpreter (the core — expect 10+ iterations)

**Agent:** Claude Code · **Human:** H1 · **Branch:** `ws/a2-interpreter` · **Owns:** `packages/interpreter/`, `packages/shared/fixtures/transcripts/` and `audio/`, `scripts/` (not build-fixtures.ts), `packages/brain/prompts/`

Read first: `docs/PLAN.md` → Topic interpreter (all of it), Testing → Interpreter scenarios. Contract: `packages/shared/src/interpreter.ts`, `ops.ts`, `layout.ts`, `config.ts` (`INTERPRETER`, `DISCOURSE_MARKER`, `MODELS`).

You never need audio or a server: everything runs from transcript fixtures.

## Phase 1 (H1–H4): engine + harness

- [ ] Write the remaining 9 scenario fixtures in `packages/shared/fixtures/transcripts/` (format: `01-simple-shift.json`): 02 drill-down, 03 return/revisit, 04 deferred never discussed, 05 deferred then discussed, 06 ten-second joke, 07 synonyms, 08 Java ambiguity, 09 promise, 10 twenty-minute single-theme deep dive. Natural friend-to-friend speech, realistic timings, hand-labelled `expect`.
- [ ] `src/llm/`: `LlmClient` implementations — `gemini.ts` (`@google/genai`, JSON schema response), `anthropic.ts` (`@anthropic-ai/sdk`, `output_config.format` JSON schema), `replay.ts` (reads/writes recorded responses keyed by a hash of the request in `eval/.cache/` — deterministic CI).
- [ ] `src/trigger.ts`, `src/context.ts`, `src/granularity.ts`, `src/decision.ts` (Decision type + JSON schema + zod), `src/translate.ts` (commit gate, close/flow/revisit/tether ops, `placeNode`, pending auto-resolve ≥ 0.82, reject unknown ids, truncate labels to 4 words), `prompts/live.md` with three worked examples.
- [ ] `createLiveInterpreter` in `src/index.ts` (replace the stub; keep the signature). One call in flight; queue; 8 s timeout; one retry with the validation error; then skip.
- [ ] `eval/run.ts`: drive `createLiveInterpreter` with fixture utterances (simulated clock, fake `embed` via the real embedding API or a cached one), score against `expect`, write `eval/reports/<time>-<provider>.md` (per-scenario pass/fail, boundary P/R ±1, revisit accuracy, thread P/R, nodes/min vs target, latency p50/p95, tokens/min, the produced outline). `--replay` mode for CI.
- [ ] ~~Recommend the default provider~~ — **decided: `anthropic`** (Gemini text models are 20 requests/day on our key; see AGENTS.md → API budget). The eval runs Claude only by default; `--provider gemini` is never used.

## Phase 2 (H4–H8): iterate to the release gate

Change one thing → `pnpm eval` (Claude only) → commit only if the score doesn't drop. Gate at H8: ≥ 8/10 scenarios pass, median decision latency < 3 s. If latency fails, shorten the context or the output schema; do **not** switch to a Gemini model.

- [ ] `src/finalize.ts` + `prompts/finalize.md`: `finalizeConversation()` — renames, merges, details (3–5 sentences + evidence ids), parent fixes, thread status fixes, commitments, title ≤ 6 words, one-sentence summary, ≤ 3 recall prompts. Preserve every id; never touch highlights/annotations.
- [ ] ~~`scripts/render-tts.ts`~~ — **don't run it**: TTS is 10 requests/day on our key and it makes one call per line. The humans record the six spoken-test scripts themselves (or use ElevenLabs/podcasts) and drop WAVs into `packages/shared/fixtures/audio/`. Your job: make sure those six scripts are final and easy to read aloud.

## Phase 3 (H8–H10)

- [ ] `packages/brain/prompts/merge.md` + merge decision schema for A1's Brain build ("similar is not the same": Existentialism ≠ Personal Philosophy; Java ≠ Java).
- [ ] `scripts/seed-demo.ts`: five fixture conversations (philosophy, religion, fitness, career, solo journal) through the real interpreter + finalisation + Brain build for the demo account.

## Tests (required)

Unit tests for trigger, context packing, granularity hints, translate (every decision type, commit gate, unknown-id rejection) with a scripted fake `LlmClient`. `eval:replay` runs in CI.
