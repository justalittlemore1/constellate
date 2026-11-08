# Eval recordings

Recorded LLM responses and embeddings, one JSON file per request keyed by a SHA-256 of the request
(`src/llm/replay.ts`). They make `pnpm eval:replay` and the `eval replay` unit test deterministic
with no API keys.

- `pnpm eval` (both providers, all fixtures) re-records and prunes files the run no longer used, so
  this folder always matches the committed prompt and code. Commit it together with the report.
- Any change to the prompt, context packing or schema changes the keys: re-run `pnpm eval` before
  committing such a change, or the replay test will report cache misses.
- Lives here rather than in `eval/.cache/` (git-ignored by the root config) because CI needs it.
