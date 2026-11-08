# features/map — owner A3

The conversation map on React Flow (`@xyflow/react`). Brief: `docs/briefs/a3-map-ui.md`.

Positions come **only** from the persisted node `x / y` (placed by `placeNode` in `@constellate/shared`); the
map never lays anything out, it only chooses where to look.

## Public surface (`index.ts`)

```tsx
<ConversationMap
  state={graph}               // GraphState (required)
  activeNodeId={id}           // optional, defaults to state.activeNodeId
  followLatest                // live: keep the newest node in view; "Jump to now" chip once the user pans
  onNodeSelect={(n) => …}     // TopicNode | null
  onPlaySegment={(n) => …}    // shows "Play this moment" (saved conversations with a recording)
  utterances={…}              // evidence quotes in the detail sheet
  playingNodeId={id}          // playback: the node being heard glows
  detail / onDetailChange     // optional control of Broad | Balanced | Detailed
  view / onViewChange         // optional control of Map | Outline
  hideToolbar                 // drop the built-in top toolbar
/>
```

- **A6 (`/live/:id`)**: `renderMap={(g) => g && <ConversationMap state={g} followLatest />}`.
- **A4 (`/c/:id`)**: `<Route path="/c/:id" element={<ConversationScreen />} />`.

## Files

| File                     | What                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`               | Pure view-model: radius by duration, detail-level visibility (Broad folds level-2 topics into the main topic just before them), statuses and relationships in words, path tracer, keyboard order. |
| `flow.ts`                | React Flow node/edge records (circle centre on x/y, centre handles given up front, label gap for edges).                                                                                          |
| `nodes.tsx`              | `TopicNodeView`, `ThreadNodeView`, `NoteNodeView`; long-press.                                                                                                                                    |
| `edges.tsx`              | `FlowEdge` (solid + arrow + particles), `RevisitEdge` (dashed arc to the left margin + arrow), `TetherEdge` (dotted), `UserEdge` (long dash), `NoteEdge`.                                         |
| `viewport.ts`            | Width-fit, fit-all, follow, ensure-visible.                                                                                                                                                       |
| `panels.tsx`             | Preview card, detail sheet, quick actions, legend, path banner.                                                                                                                                   |
| `OutlineView.tsx`        | `role="tree"` chronological outline with words for every status and relation.                                                                                                                     |
| `ConversationMap.tsx`    | The canvas, toolbar (detail level, fit, outline, legend), zoom buttons, keyboard navigation.                                                                                                      |
| `ConversationScreen.tsx` | `/c/:id`: loads the graph + transcript, plays a node's moment from the signed recording URL.                                                                                                      |

Every cue has a non-colour twin (shape, dash, glyph or words); motion (pulse, particles, appear) stops under
reduced motion; labels follow the Text size setting.
