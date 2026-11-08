# features/live — owner A6

The live client: microphone / WAV / transcript-replay sources, the WebSocket client and the live screen.
Brief: `docs/briefs/a6-live-client.md`.

| File                       | What                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controller.ts`            | `LiveController` — state machine `idle → consenting → connecting → live → stopping → stopped \| error`; holds `GraphState` (only via `applyOps`), captions, stage; ping 15 s; reconnect with backoff (`conversationId` + `resumeAtMs`); refetch `GET /conversations/:id` on a gap or `OpError`; 5 s audio buffer while offline; stop → upload. |
| `useLiveSession.ts`        | React hook over the controller (`useSyncExternalStore`). Memoise the `source` you pass.                                                                                                                                                                                                                                                        |
| `transport.ts`             | One WebSocket; every server frame is validated with `ServerMsgSchema`.                                                                                                                                                                                                                                                                         |
| `audio.ts`                 | `getUserMedia` / decoded WAV → `pcm-processor` worklet → 3,200-byte frames; `MediaRecorder` (Opus/WebM, 1 s slices) for the upload.                                                                                                                                                                                                            |
| `worklet/pcm-processor.js` | AudioWorklet: resample to 16 kHz, Int16 with clipping, 1,600-sample frames. Self-contained (served as an asset); its maths is unit-tested.                                                                                                                                                                                                     |
| `mock-server.ts`           | `VITE_USE_MOCKS=1`: an in-browser gateway that speaks the real protocol and replays `loadDemoOps()` on their `at` gaps (speed 1 or 4) with captions from node summaries; handles flag / park / stop.                                                                                                                                           |
| `deps.ts`                  | Real wiring (server + Supabase) vs mock wiring.                                                                                                                                                                                                                                                                                                |

Mock mode never touches the microphone: whatever the source, it runs as a transcript replay of the demo op stream.

## Live screen

| File | What |
| --- | --- |
| `LiveRoute.tsx` | Route element for `/live/:id` — A4: `<Route path="/live/:id" element={<LiveRoute />} />`. `/live/new` = microphone, `/live/demo?fixture=<id>` = transcript replay, `?speed=4` = faster mock replay. |
| `LiveScreen.tsx` | Consent sheet → top bar (audio-clock timer, recording dot + word, stage), one-line caption strip (interim dimmed), the map (`renderMap` slot for A3's `<ConversationMap>`, default `LiveNodeList`), bottom bar Flag · Park a thought · Stop, toasts, Pocket mode, "Before you go", mic-denied recovery (WAV file or demo). |
| `useFlagTrigger.ts` | Button, double F/Space within 400 ms, media keys (`nexttrack`/`play`/`pause` with a silent looping `<audio>`), Pocket-mode double-tap; 1.2 s debounce; `navigator.vibrate(60)`. |
| `LiveNodeList.tsx` | Accessible ordered list of nodes that follows the newest one, with a "Jump to now" chip. |
| `sheets.tsx` | Consent, Park a thought (80 chars), Before you go, mic recovery. |
