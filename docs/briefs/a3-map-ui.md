# A3 Map UI

**Agent:** Cursor (Grok 4.7) · **Human:** H2 · **Branch:** `ws/a3-map` · **Owns:** `apps/web/src/features/map/`

Live capture, the WebSocket client and flag triggers belong to **A6 Live client** (`features/live`). You expose the map as a component that takes a `GraphState` (plus `activeNodeId` and callbacks); A6 feeds it live state.

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

## Phase 2 (H5–H8): saved map and playback

- [ ] Export `<ConversationMap state onNodeSelect followLatest />` used by both `/c/:id` (yours) and `/live/:id` (A6). Agree the props with A6 in your first PR.
- [ ] `/c/:id` map screen content: fetch `GET /conversations/:id`, render the map, floating toolbar (Fit, Detail level, Highlighter, Note, Path tracer, Map ↔ Outline).
- [ ] Playback: scrubber with flags and node boundaries, the node being heard glows, tap node → seek to `startMs − 1 s` via a Supabase signed URL for `recordings/{user}/{conversation}.webm`.
- [ ] User edits go through `POST /conversations/:id/ops` as `source: 'user'` batches, applied optimistically with `applyOps`.

## Phase 3 (H8–H10)

- [ ] Highlighter mode (tap or drag across a branch → `highlights` row + `node.update highlighted` via `POST /conversations/:id/ops`), canvas notes (`annotation.upsert`), path tracer polish, reduced-motion pass.

## Tests (required)

Component tests per node/edge kind and status; outline view renders every node with accessible names; keyboard navigation through nodes.
