# Eval recordings

Every LLM answer and embedding the eval used, keyed by a SHA-256 of the request (`src/llm/replay.ts`). Committed, so repeat `pnpm eval` runs cost nothing and `pnpm eval:replay` (and the `eval replay` test in CI) need no API keys (AGENTS.md › API budget).

- `llm-<model>.jsonl`: one line per Claude answer: `{key, data, ms, inTok, outTok}`.
- `embeddings.jsonl`: one line per embedded text: `{key, q, s}`, the vector quantised to int8 (base64) with its scale, about 1 KB per text. The recording run uses the same quantised vectors, so replay is exact.
- A full `pnpm eval` (no `--only`) drops lines it no longer used, so the files match the committed prompt. Commit them together with the report.
- A prompt or context change changes the LLM keys (Claude, cheap). Embedding keys only change when the texts do (window text, node `label. summary`), so re-runs make few Gemini requests; each report states how many.
