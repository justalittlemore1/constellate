# scripts

| Script | Owner | Purpose |
| --- | --- | --- |
| `build-fixtures.ts` | A0 | `pnpm fixtures` — regenerates the religion-demo graph and op stream through the real reducer and layout |
| `render-tts.ts` | A2 | Renders transcript scripts to synthetic multi-speaker WAV for speech tests |
| `seed-demo.ts` | A2 | Runs five fixture conversations through the real pipeline for the demo account |
| `stt-runner.ts` | A5 | Streams WAVs through `/live` and reports word error rate and caption latency |
