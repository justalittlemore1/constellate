# A6 Live client

**Agent:** Codex (second Plus seat) · **Human:** H2 · **Branch:** `ws/a6-live` · **Owns:** `apps/web/src/features/live/`

Read first: `docs/PLAN.md` → Speech pipeline → Capture, Interface → Screens (`/live/:id`), Flag triggers. Contract: `packages/shared/src/ws.ts` (`ClientMsg`, `ServerMsg`, `AUDIO_*`), `schemas.ts` (`ClientMsgSchema`, `ServerMsgSchema`), `ops.ts` (`applyOps`). The map itself is A3's `<ConversationMap>`; until it lands, render a plain list of nodes so you are never blocked.

## Phase 1 (H1–H5): client on mocks, then live

- [ ] `useLiveSession()` hook: state machine `idle → consenting → connecting → live → stopping → stopped | error`; holds `GraphState`, captions, stage. Mock mode (`env.useMocks`): replays `loadDemoOps()` on the differences between their `at` times (with a 4× speed option) and fake captions.
- [ ] WebSocket client: `hello` (token from Supabase session, `consent: true`), validate every server frame with `ServerMsgSchema`, apply `ops` batches with `applyOps` (ignore duplicates; on `OpError` refetch `GET /conversations/:id`), ping every 15 s, reconnect with backoff sending `conversationId` + `resumeAtMs`.
- [ ] `audio.ts`: `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })` → `AudioWorkletProcessor` (in `features/live/worklet/pcm-processor.js`, loaded via `new URL(..., import.meta.url)`) that downsamples to 16 kHz, converts to Int16 and posts 1,600-sample frames → send as binary frames of exactly `AUDIO_FRAME_BYTES`. `MediaRecorder` (Opus/WebM, 1 s timeslice) on the same stream; on stop upload the blob to `recordings/{userId}/{conversationId}.webm` (`recordingPath` from shared).
- [ ] Sources: microphone; **WAV replay** (decode a WAV with `AudioContext`, play it through the same worklet in real time — this is how the pipeline is demoed without speaking); **transcript replay** (`hello` with `source: 'replay-transcript'`, `fixture: '<id>'`).
- [ ] Unit-test the downsampler and Int16 conversion with a synthetic sine wave (frame size, sample count, clipping).

## Phase 2 (H5–H8): the live screen

- [ ] `LiveScreen` for `/live/:id` (A4 wires the route): consent sheet first; top bar (timer from the audio clock, red recording dot, stage text); one-line caption strip (interim text dimmed); the map (A3) auto-following the newest node, with a "Jump to now" chip when the user pans away; bottom bar **Flag · Park a thought · Stop**.
- [ ] `useFlagTrigger(onFlag)`: on-screen button; keyboard double-press of `F` or `Space` within 400 ms; `navigator.mediaSession.setActionHandler` for `nexttrack`/`play`/`pause` while a silent looping `<audio>` keeps the media session active (works with laptop media keys and Bluetooth headphones); Pocket mode (screen dimmed, double-tap anywhere). Haptic via `navigator.vibrate(60)` where available, plus a toast. Debounce so one gesture = one flag.
- [ ] Park a thought: tap → input (max 80 chars, two-word hint) → `park` message.
- [ ] Stop: send `stop`, show the **"Before you go"** banner listing open threads (pending + parked nodes) so the group can close loops while still together, then upload and navigate to `/c/:id`.
- [ ] Mic permission denied → recovery screen offering WAV replay.

## Tests (required)

Mock replay ends in exactly `loadDemoGraph()` state; reconnect resumes without duplicate nodes (feed a batch twice); flag debounce; worklet maths; consent required before any audio is sent.
