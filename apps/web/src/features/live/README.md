# features/live — owner A6

The live client: microphone / WAV / transcript-replay sources, the WebSocket client and the live screen.
Brief: `docs/briefs/a6-live-client.md`.

| File | What |
| --- | --- |
| `controller.ts` | `LiveController` — state machine `idle → consenting → connecting → live → stopping → stopped \| error`; holds `GraphState` (only via `applyOps`), captions, stage; ping 15 s; reconnect with backoff (`conversationId` + `resumeAtMs`); refetch `GET /conversations/:id` on a gap or `OpError`; 5 s audio buffer while offline; stop → upload. |
| `useLiveSession.ts` | React hook over the controller (`useSyncExternalStore`). Memoise the `source` you pass. |
| `transport.ts` | One WebSocket; every server frame is validated with `ServerMsgSchema`. |
| `audio.ts` | `getUserMedia` / decoded WAV → `pcm-processor` worklet → 3,200-byte frames; `MediaRecorder` (Opus/WebM, 1 s slices) for the upload. |
| `worklet/pcm-processor.js` | AudioWorklet: resample to 16 kHz, Int16 with clipping, 1,600-sample frames. Self-contained (served as an asset); its maths is unit-tested. |
| `mock-server.ts` | `VITE_USE_MOCKS=1`: an in-browser gateway that speaks the real protocol and replays `loadDemoOps()` on their `at` gaps (speed 1 or 4) with captions from node summaries; handles flag / park / stop. |
| `deps.ts` | Real wiring (server + Supabase) vs mock wiring. |

Mock mode never touches the microphone: whatever the source, it runs as a transcript replay of the demo op stream.

## Live screen

| File | What |
| --- | --- |
| `LiveRoute.tsx` | Route element for `/live/:id` (wired by A4). `/live/new` = microphone (always real time); `/live/new?replay=<fixture>` or `/live/demo` = transcript replay. Demo speed: 4× in mock mode (`?speed=` overrides); against the real server it is the server's `REPLAY_SPEED`, mirrored by `VITE_DEMO_REPLAY_SPEED` for the timer and label. After Stop → `/c/:id?diary=1`. |
| `LiveScreen.tsx` | Consent sheet → top bar (audio-clock timer, recording dot + word, stage), one-line caption strip (interim dimmed), the map (`LiveMap`), bottom bar Flag · Park a thought · Stop, toasts, Pocket mode, "Before you go", mic-denied recovery (WAV file or demo). |
| `useFlagTrigger.ts` | Button, double F/Space within 400 ms, media keys (`nexttrack`/`play`/`pause` with a silent looping `<audio>`), Pocket-mode double-tap; 1.2 s debounce; `navigator.vibrate(60)`. |
| `LiveMap.tsx` | A3's `<ConversationMap followLatest>` (its own "Jump to now" chip); falls back to `LiveNodeList` in low-stimulation mode, before the first topic, and if the canvas throws. |
| `LiveNodeList.tsx` | Accessible ordered list of nodes that follows the newest one, with a "Jump to now" chip (the fallback above). |
| `captions.ts` | One-line caption tail: whole words, leading "…" when cut (plus a CSS fade on the left edge). |
| `sheets.tsx` | Consent, Park a thought (80 chars), Before you go, mic recovery. |
