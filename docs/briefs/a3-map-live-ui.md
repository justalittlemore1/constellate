# A3 Map + Live UI

**Agent:** Gemini CLI · **Human:** H2 · **Branch:** `ws/a3-map-live` · **Owns:** `apps/web/src/features/map/`, `apps/web/src/features/live/`

Read first: `docs/PLAN.md` → Interface and interaction design (tokens, visual language table, interactions, flag triggers, accessibility), Speech pipeline → Capture. Data: `loadDemoGraph()` / `loadDemoOps()` in `apps/web/src/lib/fixtures.ts`. Reducer: `applyOps` from `@constellate/shared`.

Work in mock mode (`VITE_USE_MOCKS=1`) until H5. Ask A4 (via PR note) for any new primitive in `src/ui/` or route wiring in `src/app/`.

## Phase 1 (H1–H5): the map on fixtures

- [ ] `features/map/ConversationMap.tsx` on `@xyflow/react`: nodes from `GraphState`, positions **only** from node `x/y` (never React Flow auto-layout). `fitView`, pinch/wheel zoom, pan, minimap optional, "Jump to now".
- [ ] Node components: `TopicNode` (glowing circle, radius 18–30 px by duration, 1–4 word label below, active pulse, provisional at 40 % opacity, ↺ badge on revisits, level-2 slightly smaller), `ThreadNode` (hollow dashed ring, amber; pencil glyph for parked), `NoteNode` (sticky card).
- [ ] Edge components: `FlowEdge` (solid, arrowhead, moving particles unless reduced motion), `RevisitEdge` (dashed arc out to the left margin, arrowhead into the earlier node), `TetherEdge` (dotted). **Never colour alone** — dash pattern + arrow + badge.
- [ ] Semantic zoom: Broad (level 1 only, child-count badge) / Balanced / Detailed — a control plus auto at low zoom.
- [ ] Tap → preview card; tap card → detail sheet (details, evidence, play segment, highlight, note, "How did we get here?"); long-press → quick actions; desktop hover → preview.
- [ ] Legend sheet explaining every symbol in words.
- [ ] Outline view (`role="tree"`, chronological, indented, statuses and relationships in words) — the accessible and low-stimulation alternative.
- [ ] Playwright visual snapshots of the fixture map at three zoom levels (coordinate with A5).

## Phase 2 (H5–H8): live

- [ ] `features/live/audio.ts`: `getUserMedia` (echo cancellation, noise suppression, mono) → `AudioWorklet` downsampling to 16 kHz Int16 → 3,200-byte (100 ms) binary frames; `MediaRecorder` Opus/WebM in parallel; upload to `recordings/{user}/{conversation}.webm` on stop.
- [ ] WAV replay source (decode a fixture WAV, stream through the same worklet in real time) and transcript replay (`hello` with `source: 'replay-transcript'`).
- [ ] `features/live/useLiveSession.ts`: WebSocket client per `ClientMsg`/`ServerMsg` (validate with the zod schemas), apply `ops` batches with `applyOps`, reconnect with `conversationId` + `resumeAtMs`. Mock mode replays `loadDemoOps()` on their `at` timing.
- [ ] Live screen: top bar (timer, red dot, status), one-line caption strip, bottom bar **Flag / Park a thought / Stop**, consent sheet before recording, auto-follow newest node unless the user pans.
- [ ] `useFlagTrigger`: on-screen button, double F or Space within 400 ms, `navigator.mediaSession` next/play/pause with a silent audio element, Pocket mode double-tap; haptic (`navigator.vibrate`) + toast.
- [ ] "Before you go" banner on Stop listing open threads (pending/parked) while everyone is still together.
- [ ] Playback on the saved map: scrubber with flags and node boundaries, the node being heard glows, tap node → seek to `startMs − 1 s` via a signed URL.

## Phase 3 (H8–H10)

- [ ] Highlighter mode (tap or drag across a branch → `highlights` row + `node.update highlighted` via `POST /conversations/:id/ops`), canvas notes (`annotation.upsert`), path tracer polish, reduced-motion pass.

## Tests (required)

Component tests per node/edge kind and status; outline view renders every node with accessible names; flag-trigger debounce; mock live replay ends in exactly the fixture graph; keyboard navigation through nodes.
