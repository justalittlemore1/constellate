# scripts

| Script | Owner | Purpose |
| --- | --- | --- |
| `build-fixtures.ts` | A0 | `pnpm fixtures` — regenerates the religion-demo graph and op stream through the real reducer and layout |
| `render-tts.ts` | A2 | **Do not run** (AGENTS.md › API budget: TTS is not available on our key). Humans record the spoken tests: `packages/shared/fixtures/audio/SCRIPTS.md` |
| `seed-demo.ts` | A2 | Seeds the demo account with the five `demo-*` conversations through the real pipeline (A1's `apps/server/src/seed.ts`). **Humans only, once, at H10**: `EMBEDDINGS=gemini pnpm tsx --env-file=.env scripts/seed-demo.ts --user <demo-uuid> --confirm-h10`. Prints the embedding requests used. `--dry-run` uses fakes (no network, no database) |
| `stt-runner.ts` | A5 | Streams WAVs through `/live` and reports word error rate and caption latency |
