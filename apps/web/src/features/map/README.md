# features/map — owner A3

The conversation map on React Flow (`@xyflow/react`). Brief: `docs/briefs/a3-map-ui.md`.

Positions come **only** from the persisted node `x / y` (placed by `placeNode` in `@constellate/shared`); the
map never lays anything out, it only chooses where to look.

## Mounting it (stable exports from `index.ts`)

- **A4, `/c/:id`**: in `app/ConversationScreen.tsx`, replace the placeholder inside the "Conversation map"
  section with `{g && <SavedMap graph={g} />}` (the section needs `min-h-0 flex-1`). `SavedMap` reads
  `?node=` / `?t=`, plays moments through `lib/audio`, and saves edits.
- **A6, `/live/:id`**: `renderMap={(g) => g && <ConversationMap state={g} live />}`. `followLatest` still
  works as an alias.

```tsx
<SavedMap graph={graph} />    // the saved map: playback, edits, deep links, evidence quotes

<ConversationMap
  state={graph}               // GraphState (required)
  activeNodeId={id}           // optional, defaults to state.activeNodeId
  live                        // keep the newest node in view; "Jump to now" chip once the user pans
  onNodeSelect={(n) => …}     // TopicNode | null
  onPlaySegment={(n) => …}    // shows "Play this moment"
  onEdit={(ops) => …}         // enables Highlight, highlighter mode and notes (GraphOp[] for a user batch)
  focusNodeId={id}            // select + scroll to a node (deep links)
  utterances={…}              // evidence quotes in the detail sheet
  playingNodeId={id}          // the node being heard glows
  detail / onDetailChange     // optional control of Broad | Balanced | Detailed
  view / onViewChange         // optional control of Map | Outline
  hideToolbar                 // drop the built-in top toolbar
/>
```

## Files

| File                  | What                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`            | Pure view-model: radius by duration, detail-level visibility, statuses and relationships in words, path tracer, keyboard order. |
| `flow.ts`             | React Flow node/edge records (circle centre on x/y, centre handles given up front, label gap, spoken edge names).               |
| `nodes.tsx`           | `TopicNodeView`, `ThreadNodeView`, `NoteNodeView`; long-press.                                                                  |
| `edges.tsx`           | `FlowEdge`, `RevisitEdge`, `TetherEdge`, `UserEdge`, `NoteEdge`.                                                                |
| `viewport.ts`         | Width-fit, fit-all, follow, ensure-visible.                                                                                     |
| `panels.tsx`          | Preview card, detail sheet (play, Highlight, notes, path), quick actions, legend, path banner.                                  |
| `OutlineView.tsx`     | `role="tree"` chronological outline with words for every status and relation.                                                   |
| `ConversationMap.tsx` | The canvas, toolbar, zoom + highlighter buttons, keyboard navigation.                                                           |
| `SavedMap.tsx`        | `/c/:id` body: deep links, shared-audio playback, optimistic edits.                                                             |
| `edits.ts`            | Highlight and sticky-note ops (`node.update`, `annotation.upsert`).                                                             |
| `userOps.ts`          | `useUserOps(id)`: optimistic `applyOps` on `['graph', id]`, then `POST /conversations/:id/ops`; refetch on failure.             |

Every cue has a non-colour twin (shape, dash, glyph or words); motion (pulse, particles, appear) stops under
reduced motion; labels follow the Text size setting.
