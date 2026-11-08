# A1 Server

**Agent:** Claude Code (after it finishes A0) · **Human:** H1 · **Branch:** `ws/a1-server` · **Owns:** `apps/server/`, `packages/brain/`, new files in `supabase/migrations/`

Read first: `docs/PLAN.md` → Architecture, Shared contracts, Database, Speech pipeline, The Brain. Contract types: `packages/shared/src/{ws,interpreter,ops,config}.ts`.

## Phase 1 (H1–H5): live gateway

- [ ] `src/supabase.ts`: service-role client; `verifyToken(token)` via `supabase.auth.getUser(token)` → userId.
- [ ] `src/live/LiveSession.ts` per socket: on `hello` → verify token (`error auth` fatal if bad), require `consent: true`, insert the `conversations` row (or resume one owned by the user when `conversationId` + `resumeAtMs` are sent), reply `ready`. Owns the **audio clock** (`bytes ÷ AUDIO_BYTES_PER_MS`), a batch `seq` counter, the speech adapter and the interpreter instance.
- [ ] `src/speech/`: `SpeechAdapter` implementations — `GeminiLiveAdapter` (`MODELS.sttLive`, PCM 16 kHz frames, interim + final transcripts; start = clock at first interim − 300 ms, end = clock at final), `TranscriptReplayAdapter` (emits a fixture's utterances on their original timing; selected by `source: 'replay-transcript'`), `FakeAdapter` (tests). Deepgram only if time (it would also give speaker labels on the recorded file). All Gemini calls go through one shared client with a per-model request counter, embedding cache and 429 back-off (AGENTS.md → API budget); `INTERPRETER_PROVIDER` defaults to `anthropic`.
- [ ] **Session rotation** for the 10-minute live cap (`LIVE` constants): after 8.5 min rotate at the first ≥ 700 ms gap with no interim text, hard rotate at 9.75 min; open the new upstream first. `status: reconnecting-stt` only if the switch takes > 1 s.
- [ ] Backpressure: buffer ≤ 5 s PCM if upstream stalls, then drop oldest and log.
- [ ] Final segments → `utterances` rows (`u1`, `u2`, …) + `caption` messages; interim → `caption` with `final: false` only.
- [ ] Interpreter integration **only through** `createLiveInterpreter(deps)` from `@constellate/interpreter`. Implement `InterpreterDeps`: `emit(ops)` wraps into an `OpBatch` (next seq, `source: 'live'`), applies with `applyOps`, persists (insert into `op_log` + upsert materialised `nodes`/`edges`/`flags`/`commitments`/`annotations`, update `conversations.last_seq`), and sends `{ t: 'ops' }`. `embed` → Gemini `MODELS.embed` with `outputDimensionality: MODELS.embedDims`, then L2-normalise. `matchNodes` → RPC `match_nodes`.
- [ ] `flag` → `flag.add` op attached to `topicAt(state, atMs)`. `park` → `interpreter.park`. `stop` → `interpreter.stop()`, mark conversation `processing`, send `stopped`, then trigger finalisation.
- [ ] Ping/pong; close cleanly; never crash the process on one bad socket.

## Phase 2 (H5–H8): REST + finalisation

- [ ] `GET /conversations/:id` → full `GraphState` (owner check).
- [ ] `POST /conversations/:id/ops` → body `{ ops: GraphOp[] }` from the user; validate with zod, apply with `source: 'user'`, persist, return the batch.
- [ ] `POST /conversations/:id/finalize` (also called after stop once the upload exists): `MODELS.sttFile` with `diarization: true, wordTimestamp: true` on the recording (≤ 30 min, else keep live transcript) — **`MODELS.sttFile` is not available on our free Gemini key, so this step must be skippable: check `models.list` once at startup and, if absent, keep the live transcript with empty `speakers`** → rebuild utterances, map live utterance ids by time overlap, then `finalizeConversation()` from the interpreter → `source: 'finalize'` batch; store `recallPrompts` in `recall_cards`; status `ready` (or `failed` with the live graph kept).
- [ ] `DELETE /conversations/:id` → storage object + cascade.
- [ ] Deploy to Render (start command `pnpm --filter @constellate/server start`, Node 22, env from SETUP.md). Share the `wss://` URL.

## Phase 3 (H8–H10): the Brain

- [ ] `packages/brain`: build pipeline from PLAN → The Brain (candidates via `match_concepts`, one `MODELS.brain` merge call per conversation with prompts from A2, concepts + links, `linkWeight`). `POST /brain/rebuild` (incremental, `brain_built_at`), `GET /brain` → `BrainGraph` plus occurrences per concept.
- [ ] `scripts/seed-demo.ts` is A2's; expose whatever server function it needs.

## Tests (required)

Protocol round trip with `FakeAdapter` + stub interpreter (hello → ready → captions → ops → stop → stopped); bad token rejected; missing consent rejected; rotation with a 5 s cap loses no utterance; re-sent batches are idempotent; finalisation failure keeps the live graph; a user cannot read another user's conversation through any route.
