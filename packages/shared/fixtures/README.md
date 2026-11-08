# Fixtures

Part of the contract. Every agent builds and tests against these before the real pipeline exists.

| Path | What | Owner |
| --- | --- | --- |
| `graphs/religion-demo.json` | A complete `GraphState` (13 nodes, 15 edges) exercising every node kind, every final status, every edge kind, two revisits, a resolved and an unexplored pending thread, a parked thought, two flags, a commitment, a note and a highlighted branch. Use it to build the map UI. | A0 (generated) |
| `ops/religion-demo.jsonl` | The same conversation as 23 timed `OpBatch`es, one per line, in `at` order: live batches (including a provisional node that gets removed), user edits, then a finalisation batch. Replaying it from a fresh conversation yields exactly the graph above. Drives `VITE_USE_MOCKS=1` live mode. | A0 (generated) |
| `transcripts/*.json` | `TranscriptFixture` files: utterances with timings plus hand-labelled `expect` for the interpreter eval. Utterance ids are `u1, u2, …` in file order. `01-simple-shift.json` is the format example. | A2 |
| `audio/*.wav` | Synthetic multi-speaker audio rendered from scripts by `scripts/render-tts.ts` (git-ignored; regenerate locally). | A2 |

Regenerate the graph and op stream with `pnpm fixtures` after changing `scripts/build-fixtures.ts`. Never hand-edit them: `schemas.test.ts` checks that the op stream replays exactly into the graph.
