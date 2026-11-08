# features/map — owner A3

Constellation canvas on React Flow (`@xyflow/react`): `TopicNode`, `ThreadNode`, `NoteNode`, `FlowEdge`, `RevisitEdge`, `TetherEdge`; positions only from the persisted `x/y` (computed by `placeNode` in `@constellate/shared`); semantic zoom (Broad / Balanced / Detailed); preview card and detail sheet; playback synced to the scrubber; highlighter; notes; "How did we get here?" path tracer; outline view (`role="tree"`); legend. Build against `loadDemoGraph()` from `src/lib/fixtures.ts` first. See `docs/briefs/a3-map-ui.md`.
