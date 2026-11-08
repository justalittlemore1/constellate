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
