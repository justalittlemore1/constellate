/**
 * <ConversationMap> — the live constellation of a conversation (React Flow). Used by `/c/:id`
 * (A3, through <SavedMap>) and `/live/:id` (A6: `renderMap={(g) => g && <ConversationMap state={g} live />}`).
 *
 * Positions come only from node x/y (never React Flow layout). Pinch / wheel zoom, drag to pan,
 * double-tap empty space to fit. Fewer clicks: desktop hover or keyboard focus on a star shows the
 * bottom preview strip; a click, a tap or Enter opens the detail sheet at once; long-press → quick
 * actions. Arrow keys walk the stars in conversation order. Every occurrence of a thread is one
 * star (returns loop back to it). A focus-only "Text view" link opens the outline for keyboard and
 * screen-reader users. Toolbar, zoom buttons, legend, "Jump to now" and revisit arcs sit behind
 * `MAP_FLAGS` (flags.ts).
 */
import '@xyflow/react/dist/base.css';
import './map.css';
import { nodesInOrder, type GraphOp, type GraphState, type TopicNode, type Utterance } from '@constellate/shared';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
  type OnMoveEnd,
  type OnMoveStart,
} from '@xyflow/react';
import { ArrowDown, HelpCircle, Highlighter, List, Map as MapIcon, Maximize2, Minus, Plus } from 'lucide-react';
import { resolveFlags, type MapFlags } from './flags';
import { useAutoFollow } from './useAutoFollow';
import { columnLayout } from './layout';
import { weaveLayout } from './weave';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useMotionReduced, usePrefs } from '../../lib/prefs';
import { Button, cx, IconButton } from '../../ui';
import { highlightOps, noteOps } from './edits';
import { toFlowEdges, toFlowNodes, type MapFlowNode } from './flow';
import { edgeTypes } from './edges';
import {
  DETAIL_LABEL,
  DETAIL_LEVELS,
  effectiveDetail,
  latestNode,
  nodeAccessibleName,
  nodeSubLabel,
  pathInOrder,
  stepNode,
  tracePath,
  visibleGraph,
  type DetailLevel,
  type TracedPath,
} from './model';
import { MapNodeActionsContext, nodeTypes } from './nodes';
import { OutlineView } from './OutlineView';
import {
  LegendSheet,
  NodeDetailSheet,
  PathBanner,
  PreviewCard,
  QuickActionsSheet,
  type NodeEditActions,
} from './panels';
import {
  ensureVisible,
  fitAll,
  fitWidth,
  followY,
  graphBounds,
  LIVE_FOLLOW_FRAC,
  MAX_ZOOM,
  MIN_ZOOM,
  panAboveSheet,
  readableViewport,
  withLaneFrame,
} from './viewport';

export type MapView = 'map' | 'outline';

export interface ConversationMapProps {
  state: GraphState;
  /** defaults to `state.activeNodeId` */
  activeNodeId?: string | null;
  /** live map: keep the newest node in view; after the user pans away, resume following after ~5 s */
  live?: boolean;
  /** @deprecated same as `live` (kept for A6's first integration) */
  followLatest?: boolean;
  /** called when the user selects a node (preview) or clears the selection */
  onNodeSelect?: (node: TopicNode | null) => void;
  /** shows "Play this moment" where given (saved conversations with a recording) */
  onPlaySegment?: (node: TopicNode) => void;
  /**
   * User edits (Highlight, highlighter mode, sticky notes) as contract ops. Absent → read-only
   * (the live screen). The saved map passes `useUserOps(id)`, which applies them optimistically.
   */
  onEdit?: (ops: GraphOp[]) => void;
  /** select and centre this node (deep link `?node=` / `?t=`); re-applied when it changes */
  focusNodeId?: string | null;
  /** evidence quotes in the detail sheet */
  utterances?: Utterance[];
  /** playback: the node being heard glows */
  playingNodeId?: string | null;
  /** controlled detail level (otherwise internal, starting at Balanced) */
  detail?: DetailLevel;
  onDetailChange?: (d: DetailLevel) => void;
  /** controlled Map ↔ Outline (otherwise internal, starting at Map) */
  view?: MapView;
  onViewChange?: (v: MapView) => void;
  /** hide the built-in top toolbar (detail level, fit, outline, legend) */
  hideToolbar?: boolean;
  /** saved map: on mount, stars appear one by one in conversation order, then the lines draw in */
  reveal?: boolean;
  /** keep the sky empty (no stars, lines or focus stops) until false; then the reveal starts from the beginning */
  revealHold?: boolean;
  /** per-instance overrides of MAP_FLAGS (flags.ts) */
  flags?: Partial<MapFlags>;
  className?: string;
}

const TOOLBAR_INSET = 60;
const EMPTY_NODES: MapFlowNode[] = [];
const EMPTY_EDGES: ReturnType<typeof toFlowEdges> = [];
/** saved-map reveal: gap between stars appearing, in conversation order */
export const REVEAL_STEP_MS = 150;
/** column layout: never below this zoom, so labels stay ≈ 16–17 px and stars ≥ 28 px */
const COLUMN_MIN_ZOOM = 0.96;
/** a mouse must rest on a star this long before its preview strip appears (keyboard focus is instant) */
export const HOVER_DWELL_MS = 700;
export const KEYBOARD_HINT =
  'Arrow keys move between topics in conversation order; each one shows a preview below. Enter opens the details.';
/** how long the preview strip stays after the pointer leaves a star (time to reach the strip) */
const HOVER_LINGER_MS = 350;
const DOUBLE_TAP_MS = 320;

export function ConversationMap(props: ConversationMapProps) {
  return (
    <ReactFlowProvider>
      <MapInner {...props} />
    </ReactFlowProvider>
  );
}

function useControllable<T>(
  value: T | undefined,
  onChange: ((v: T) => void) | undefined,
  initial: T,
): [T, (v: T) => void] {
  const [inner, setInner] = useState(initial);
  const set = useCallback(
    (v: T) => {
      setInner(v);
      onChange?.(v);
    },
    [onChange],
  );
  return [value ?? inner, set];
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function MapInner({
  state,
  activeNodeId: activeProp,
  live = false,
  followLatest: followLatestProp = false,
  onNodeSelect,
  onPlaySegment,
  onEdit,
  focusNodeId = null,
  utterances,
  playingNodeId = null,
  detail: detailProp,
  onDetailChange,
  view: viewProp,
  onViewChange,
  hideToolbar = false,
  reveal = false,
  revealHold = false,
  flags: flagsProp,
  className,
}: ConversationMapProps) {
  const F = resolveFlags(flagsProp);
  const followLatest = live || followLatestProp;
  const follow = useAutoFollow(followLatest);
  const following = follow.following;
  const activeNodeId = activeProp === undefined ? state.activeNodeId : activeProp;
  const reduced = useMotionReduced();
  // label footprints follow the Text size setting (the CSS scales labels by --text-size)
  const textSize = usePrefs((s) => s.textSize);
  const motion = !reduced;
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const container = useRef<HTMLDivElement>(null);
  // React Flow drops its own node description when disableKeyboardA11y is on, so we carry ours
  const keyboardHintId = `cmap-keys-${useId().replace(/:/g, '')}`;
  const size = useSize(container);

  const [detail, setDetail] = useControllable<DetailLevel>(detailProp, onDetailChange, 'balanced');
  const [view, setView] = useControllable<MapView>(viewProp, onViewChange, 'map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [tracedId, setTracedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [painting, setPainting] = useState(false);
  const [ready, setReady] = useState(false);
  const placed = useRef(false);
  const lastTap = useRef(0);

  // without the detail bar the map stays at the chosen (default) level: no auto-Broad either
  const shown = F.zoomBar ? effectiveDetail(detail, zoom) : detail;
  const autoBroad = shown !== detail;
  const mergeReturns = !F.revisitArcs;
  const hideParked = !F.parkedThoughts;
  const vg = useMemo(
    () => visibleGraph(state, shown, { mergeReturns, hideParked }),
    [state, shown, mergeReturns, hideParked],
  );
  const starById = useMemo(() => new Map(vg.nodes.map((v) => [v.node.id, v])), [vg]);
  // display-only column layout for phones (round 4); the persisted x / y stay behind `storedLayout`
  // round 5: the weaving layout; the round-4 column behind `columnLayout`, stored x / y behind `storedLayout`
  const layout = useMemo(
    () => (F.storedLayout ? undefined : F.columnLayout ? columnLayout(vg) : weaveLayout(vg, { textSize })),
    [vg, F.storedLayout, F.columnLayout, textSize],
  );
  /** where a star is drawn (column layout), falling back to its persisted position */
  const posOf = useCallback(
    (id: string): { x: number; y: number } | null => layout?.nodes.get(id) ?? state.nodes[id] ?? null,
    [layout, state.nodes],
  );
  // the full graph decides the frame, so switching detail level never jumps the view
  // live maps frame every lane up to the thread gutter from the start, so later nodes land in view
  const fullBounds = useMemo(() => {
    if (layout) return layout.bounds;
    const b = graphBounds(visibleGraph(state, 'balanced', { mergeReturns, hideParked }));
    return b && followLatest ? withLaneFrame(b) : b;
  }, [layout, state, followLatest, mergeReturns, hideParked]);
  /** the first frame: column layout = fit its fixed width (labels ≈ 17 px on a 375–430 px phone) */
  const startViewport = useCallback(
    (b: NonNullable<typeof fullBounds>, w: number, top: number) =>
      layout ? fitWidth(b, w, top, 1.25, COLUMN_MIN_ZOOM) : readableViewport(b, w, top),
    [layout],
  );
  const traced: TracedPath | null = useMemo(() => {
    if (!tracedId || !state.nodes[tracedId]) return null;
    const t = tracePath(state, tracedId);
    // light the stars that stand for the traced occurrences
    return { nodeIds: new Set([...t.nodeIds].map(vg.starOf)), edgeIds: t.edgeIds };
  }, [state, tracedId, vg]);

  const flowFlags = useMemo(
    () => ({
      activeNodeId,
      playingNodeId,
      selectedNodeId: selectedId,
      showTime: shown === 'detailed',
      motion,
      traced,
      describedBy: keyboardHintId,
      particles: F.particles,
      comet: F.cometTrails,
      starArt: F.facetedStars ? ('y4' as const) : ('y3' as const),
      ...(layout ? { layout } : {}),
      ...(reveal && motion ? { revealStepMs: REVEAL_STEP_MS } : {}),
    }),
    [
      activeNodeId,
      playingNodeId,
      selectedId,
      shown,
      motion,
      traced,
      keyboardHintId,
      F.particles,
      F.cometTrails,
      F.facetedStars,
      layout,
      reveal,
    ],
  );
  const nodes = useMemo(
    () =>
      toFlowNodes(vg, flowFlags, (v) =>
        nodeAccessibleName(
          state,
          v.node,
          activeNodeId,
          nodeSubLabel(v.node, {
            active: v.occurrences.some((o) => o.id === activeNodeId),
            playing: v.occurrences.some((o) => o.id === playingNodeId),
            showTime: shown === 'detailed',
          }),
          v.occurrences,
        ),
      ),
    [vg, flowFlags, state, activeNodeId, playingNodeId, shown],
  );
  // same flags as the nodes, so edges leave below the time line in Detailed
  const edges = useMemo(() => toFlowEdges(vg, state, flowFlags), [vg, state, flowFlags]);
  const order = useMemo(() => vg.nodes.map((v) => v.node.id), [vg]);
  const latestRaw = latestNode(state);
  // a return to an earlier thread is drawn at that thread's star
  const latestStar = latestRaw ? (state.nodes[vg.starOf(latestRaw.id)] ?? latestRaw) : null;
  const latest = useMemo(
    () => (latestStar ? { id: latestStar.id, ...(posOf(latestStar.id) ?? latestStar) } : null),
    [latestStar, posOf],
  );
  const toolbarShown = !hideToolbar && (F.zoomBar || F.outlineToggle || F.legendHelp);
  const topInset = toolbarShown ? TOOLBAR_INSET : 0;

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      onNodeSelect?.(id ? (state.nodes[id] ?? null) : null);
    },
    [onNodeSelect, state.nodes],
  );

  const duration = motion ? 350 : 0;

  const jumpToNow = useCallback(() => {
    const vp = rf.getViewport();
    if (!latest || !size.h) return;
    void rf.setViewport(followY(vp, latest.y, size.h, LIVE_FOLLOW_FRAC), { duration });
    follow.resume();
  }, [rf, latest, size.h, duration, follow]);

  const fitEverything = useCallback(() => {
    if (!fullBounds || !size.w) return;
    void rf.setViewport(fitAll(fullBounds, size.w, size.h, topInset, 24), { duration });
  }, [rf, fullBounds, size.w, size.h, topInset, duration]);

  // first frame: width-fit from the top (saved map) or on the newest node (live)
  useEffect(() => {
    if (!ready || placed.current || !fullBounds || !size.w || !size.h || view !== 'map') return;
    placed.current = true;
    // readable from the start (labels ≥ 15 px, smallest star ≥ 28 px); live: newest star ~38 % down
    const vp = startViewport(fullBounds, size.w, topInset);
    void rf.setViewport(followLatest && latest ? followY(vp, latest.y, size.h, LIVE_FOLLOW_FRAC) : vp);
  }, [ready, fullBounds, size.w, size.h, topInset, rf, followLatest, latest, view, startViewport]);

  // live: follow the newest node while the user has not panned away
  const latestId = latest?.id;
  useEffect(() => {
    if (!followLatest || !following || !placed.current || !latestId) return;
    const n = posOf(latestId);
    if (!n || !size.h) return;
    void rf.setViewport(followY(rf.getViewport(), n.y, size.h, LIVE_FOLLOW_FRAC), { duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new node arrives
  }, [latestId, followLatest, following]);

  const onMoveStart: OnMoveStart = useCallback(
    (event) => {
      // a real pointer / wheel gesture (programmatic moves have no event)
      if (event) follow.onUserMoveStart();
    },
    [follow],
  );
  const onMoveEnd: OnMoveEnd = useCallback(
    (event) => {
      if (event) follow.onUserMoveEnd();
    },
    [follow],
  );
  // a touch that doesn't pan still counts as "looking": restart the countdown
  const onPointerDownCapture = follow.onTouch;

  const toggleHighlight = useCallback(
    (n: TopicNode) => {
      const v = starById.get(vg.starOf(n.id));
      const on = !(v ? v.node.highlighted : n.highlighted);
      const occ = v ? v.occurrences : [n];
      const ops = occ.filter((o) => o.highlighted !== on).flatMap((o) => highlightOps(o, on));
      if (ops.length) onEdit?.(ops);
    },
    [onEdit, starById, vg],
  );
  const edit: NodeEditActions | undefined = useMemo(
    () =>
      onEdit
        ? {
            onToggleHighlight: toggleHighlight,
            onSaveNote: (n, text, existing) => onEdit(noteOps(state, n, text, existing)),
          }
        : undefined,
    [onEdit, toggleHighlight, state],
  );
  const paintingOn = painting && Boolean(onEdit);

  const onNodeClick: NodeMouseHandler<MapFlowNode> = useCallback(
    (_e, node) => {
      if (node.type === 'note') return;
      const n = state.nodes[node.id];
      if (paintingOn && n) {
        toggleHighlight(n);
        return;
      }
      // fewer clicks: a click or a tap opens the details straight away
      setHoverId(null);
      onNodeSelect?.(n ?? null);
      setSheetId(node.id);
    },
    [paintingOn, toggleHighlight, state.nodes, onNodeSelect],
  );

  // deep link / external focus: select the node now (preview shows at once) …
  useEffect(() => {
    if (focusNodeId && state.nodes[focusNodeId]) select(vg.starOf(focusNodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the requested node changes
  }, [focusNodeId]);
  // … and scroll it into view once the canvas is ready, keeping the width-fit frame
  useEffect(() => {
    if (!ready || !focusNodeId || !fullBounds || !size.w || !size.h || view !== 'map') return;
    const n = posOf(vg.starOf(focusNodeId));
    if (!n) return;
    placed.current = true;
    void rf.setViewport(followY(startViewport(fullBounds, size.w, topInset), n.y, size.h, 0.4));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the requested node changes
  }, [ready, focusNodeId, size.w > 0 && size.h > 0, view]);

  // the detail sheet covers the bottom ~58 %: bring its star into the uncovered map above it
  useEffect(() => {
    if (!sheetId || view !== 'map' || !container.current) return;
    const n = posOf(sheetId);
    if (!n) return;
    const mapRect = container.current.getBoundingClientRect();
    if (!mapRect.height) return;
    const frameEl = document.querySelector<HTMLElement>('[data-testid="phone-frame"]') ?? document.documentElement;
    const frameRect = frameEl.getBoundingClientRect();
    // measure in the frame's own coordinates: opening the sheet moves focus, which can scroll the
    // frame for a moment, and screen rects would then be off by that scroll
    const mapTop = mapRect.top - frameRect.top + frameEl.scrollTop;
    const map = { top: mapTop, height: mapRect.height, width: mapRect.width };
    const frame = { top: 0, height: frameRect.height || window.innerHeight };
    void rf.setViewport(panAboveSheet(rf.getViewport(), n, map, frame), { duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when a sheet opens
  }, [sheetId]);

  const onPaneClick = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      fitEverything();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    select(null);
    setTracedId(null);
  }, [fitEverything, select]);

  const clearHoverTimer = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const clearDwell = () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  };
  const onNodeMouseEnter: NodeMouseHandler<MapFlowNode> = useCallback((e, node) => {
    if (node.type === 'note') return;
    // desktop hover only; touch taps go straight to the sheet through onNodeClick
    if ((e.nativeEvent as PointerEvent).pointerType === 'touch') return;
    clearHoverTimer();
    clearDwell();
    // only after the pointer rests on the star (a pass over it shows nothing)
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null;
      setHoverId(node.id);
    }, HOVER_DWELL_MS);
  }, []);
  // linger a moment so the pointer can travel to the strip (which keeps itself open while hovered)
  const leaveHover = useCallback(() => {
    clearDwell();
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setHoverId(null), HOVER_LINGER_MS);
  }, []);
  const onNodeMouseLeave = leaveHover;
  useEffect(
    () => () => {
      clearHoverTimer();
      clearDwell();
    },
    [],
  );

  // keyboard focus on a star shows its preview strip, like hover
  const onFocusCapture = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (id && !id.startsWith('note:')) setFocusId(id);
  }, []);
  const onBlurCapture = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as HTMLElement | null;
    if (!next?.closest('.react-flow__node')) setFocusId(null);
  }, []);

  const focusNode = useCallback(
    (id: string | null) => {
      if (!id) return;
      const n = posOf(id);
      const el = container.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
      if (n && size.w) {
        const vp = rf.getViewport();
        const next = ensureVisible(vp, n, size.w, size.h, 70, topInset);
        if (next.x !== vp.x || next.y !== vp.y) void rf.setViewport(next, { duration });
      }
    },
    [posOf, rf, size.w, size.h, topInset, duration],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const nodeEl = target.closest<HTMLElement>('.react-flow__node');
      const id = nodeEl?.dataset.id ?? null;
      if (!id || !state.nodes[id]) return;
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          focusNode(stepNode(order, id, 1));
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          focusNode(stepNode(order, id, -1));
          break;
        case 'Home':
          focusNode(order[0] ?? null);
          break;
        case 'End':
          focusNode(order[order.length - 1] ?? null);
          break;
        case 'Enter':
        case ' ':
          if (paintingOn) toggleHighlight(state.nodes[id]!);
          else setSheetId(id);
          break;
        case 'Escape':
          // hides the preview strip too (it comes back when focus moves to another star)
          select(null);
          setTracedId(null);
          setHoverId(null);
          setFocusId(null);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [state.nodes, order, focusNode, select, paintingOn, toggleHighlight],
  );

  const actions = useMemo(() => ({ onLongPress: (id: string) => setQuickId(id) }), []);

  const previewId = paintingOn ? null : (hoverId ?? focusId ?? selectedId);
  /** the star's own node (merged highlight), falling back to the raw node */
  const starNode = (id: string | null) => (id ? (starById.get(id)?.node ?? state.nodes[id] ?? null) : null);
  const previewNode = sheetId ? null : starNode(previewId);
  const play = onPlaySegment;
  const trace = (n: TopicNode) => {
    setTracedId(n.id);
    setSheetId(null);
    setQuickId(null);
    select(n.id);
  };
  const tracedLabels = traced ? pathInOrder(state, traced).map((n) => n.label) : [];
  const empty = nodesInOrder(state).length === 0;

  return (
    <div
      className={cx('cmap relative h-full w-full overflow-hidden bg-bg', className)}
      data-testid="conversation-map"
      // weave labels stay ≈ 13.5 px on screen when the map is zoomed in past 1 (stars keep scaling)
      style={{ '--cmap-label-scale': String(1 / Math.max(1, zoom)) } as React.CSSProperties}
    >
      {/* keyboard / screen-reader way to the outline: invisible until it has keyboard focus */}
      <button
        type="button"
        onClick={() => {
          setView(view === 'map' ? 'outline' : 'map');
          placed.current = false;
        }}
        data-testid="text-view-link"
        className="hover-wash sr-only z-30 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:inline-flex focus:min-h-11 focus:items-center focus:bg-bg focus:px-4 focus:text-sm focus:font-semibold focus:text-ink focus:outline-2 focus:outline-topic"
      >
        {view === 'map' ? 'Text view' : 'Map view'}
      </button>

      {toolbarShown && (
        <MapToolbar
          flags={F}
          detail={detail}
          onDetail={setDetail}
          autoBroad={autoBroad && view === 'map'}
          view={view}
          onView={(v) => {
            setView(v);
            placed.current = false;
          }}
          onFit={fitEverything}
          onLegend={() => setLegendOpen(true)}
        />
      )}

      {view === 'outline' ? (
        <div className="h-full overflow-y-auto" style={{ paddingTop: topInset }}>
          <OutlineView
            state={state}
            activeNodeId={activeNodeId}
            selectedNodeId={selectedId}
            hideParked={hideParked}
            onOpen={(n) => setSheetId(vg.starOf(n.id))}
          />
        </div>
      ) : (
        <MapNodeActionsContext.Provider value={actions}>
          <div
            ref={container}
            className="absolute inset-0"
            onKeyDown={onKeyDown}
            onFocusCapture={onFocusCapture}
            onBlurCapture={onBlurCapture}
            onPointerDownCapture={onPointerDownCapture}
          >
            <ReactFlow<MapFlowNode>
              // held: an empty sky; releasing mounts every star, so their staggered fade-ins start then
              nodes={revealHold ? EMPTY_NODES : nodes}
              edges={revealHold ? EMPTY_EDGES : edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={() => setReady(true)}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onPaneClick={onPaneClick}
              onMoveStart={onMoveStart}
              onMoveEnd={onMoveEnd}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              edgesFocusable={false}
              disableKeyboardA11y
              zoomOnDoubleClick={false}
              panOnScroll={false}
              zoomOnPinch
              zoomOnScroll
              panOnDrag
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              colorMode="dark"
              attributionPosition="bottom-left"
              proOptions={{ hideAttribution: true }}
              aria-label="Conversation map"
            />
            <p id={keyboardHintId} className="sr-only">
              {KEYBOARD_HINT}
            </p>
          </div>
        </MapNodeActionsContext.Provider>
      )}

      {view === 'map' && paintingOn && (
        <div className="pointer-events-none absolute inset-x-3 z-10" style={{ top: topInset + 8 }}>
          <div
            role="status"
            data-testid="highlighter-banner"
            className="cmap-chart star-frame surface pointer-events-auto flex items-center gap-2 border border-line py-1 pl-3 pr-1"
          >
            <Highlighter aria-hidden size={16} className="shrink-0 text-highlight" />
            <p className="min-w-0 flex-1 text-[13px] leading-snug">
              <span className="font-semibold">Highlighter on.</span> Tap topics to paint them gold; tap again to clear.
            </p>
            <Button variant="ghost" className="hover-wash" onClick={() => setPainting(false)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {view === 'map' && !paintingOn && traced && tracedLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-x-3 z-10" style={{ top: topInset + 8 }}>
          <PathBanner labels={tracedLabels} onClear={() => setTracedId(null)} />
        </div>
      )}

      {empty && !revealHold && view === 'map' && (
        <p className="pointer-events-none absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-sm text-ink-2">
          Topics appear here as the conversation goes.
        </p>
      )}

      {/* bottom overlay: zoom buttons, Jump to now, preview card */}
      {view === 'map' && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2">
          <div className="flex items-end justify-between gap-2">
            <span />
            {F.jumpToNow && followLatest && !following ? (
              <button
                type="button"
                onClick={jumpToNow}
                className="hover-wash pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full border border-topic/50 bg-bg/90 px-4 text-sm font-semibold text-topic shadow-lg"
              >
                <ArrowDown aria-hidden size={16} />
                Jump to now
              </button>
            ) : (
              <span />
            )}
            {(onEdit || F.zoomButtons) && (
              <div className="surface pointer-events-auto flex flex-col rounded-full border border-line">
                {onEdit && (
                  <IconButton
                    label="Paint topics gold (highlighter)"
                    aria-pressed={paintingOn}
                    className={cx(paintingOn ? 'bg-highlight text-bg hover:bg-highlight/90' : 'hover-wash')}
                    onClick={() => {
                      setPainting((p) => !p);
                      select(null);
                    }}
                  >
                    <Highlighter aria-hidden size={18} />
                  </IconButton>
                )}
                {F.zoomButtons && (
                  <>
                    <IconButton className="hover-wash" label="Zoom in" onClick={() => void rf.zoomIn({ duration })}>
                      <Plus aria-hidden size={18} />
                    </IconButton>
                    <IconButton className="hover-wash" label="Zoom out" onClick={() => void rf.zoomOut({ duration })}>
                      <Minus aria-hidden size={18} />
                    </IconButton>
                  </>
                )}
              </div>
            )}
          </div>
          {previewNode && (
            <div
              className="pointer-events-auto"
              onMouseEnter={clearHoverTimer}
              onMouseLeave={() => hoverId && leaveHover()}
            >
              <PreviewCard
                state={state}
                node={previewNode}
                occurrences={starById.get(previewNode.id)?.occurrences}
                activeNodeId={activeNodeId}
                onOpen={() => setSheetId(previewNode.id)}
                onPlay={play ? () => play(previewNode) : undefined}
              />
            </div>
          )}
        </div>
      )}

      <NodeDetailSheet
        state={state}
        node={starNode(sheetId)}
        occurrences={sheetId ? starById.get(sheetId)?.occurrences : undefined}
        activeNodeId={activeNodeId}
        utterances={utterances}
        onClose={() => setSheetId(null)}
        onPlay={play}
        playingNodeId={playingNodeId}
        edit={edit}
        onTrace={(n) => {
          trace(n);
          if (view !== 'map') setView('map');
        }}
      />
      <QuickActionsSheet
        node={starNode(quickId)}
        onClose={() => setQuickId(null)}
        onOpen={(n) => {
          setQuickId(null);
          setSheetId(n.id);
        }}
        onPlay={play}
        onTrace={trace}
        edit={edit}
      />
      <LegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

function MapToolbar({
  flags,
  detail,
  onDetail,
  autoBroad,
  view,
  onView,
  onFit,
  onLegend,
}: {
  flags: MapFlags;
  detail: DetailLevel;
  onDetail(d: DetailLevel): void;
  autoBroad: boolean;
  view: MapView;
  onView(v: MapView): void;
  onFit(): void;
  onLegend(): void;
}) {
  return (
    <div className="absolute inset-x-2 top-2 z-10 flex flex-col items-stretch gap-1">
      <div className="surface flex items-center gap-0.5 rounded-full border border-line p-0.5 shadow-lg">
        {view === 'map' && flags.zoomBar ? (
          <div role="group" aria-label="Detail level" className="flex min-w-0 flex-1">
            {DETAIL_LEVELS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={detail === d}
                onClick={() => onDetail(d)}
                className={cx(
                  'hover-wash min-h-11 min-w-0 flex-1 rounded-full px-2 text-[13px] font-semibold transition-colors',
                  detail === d ? 'bg-topic text-bg' : 'text-ink-2 hover:bg-white/10 hover:text-ink',
                )}
              >
                {DETAIL_LABEL[d]}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex-1 px-3 text-[13px] font-semibold text-ink-2">
            {view === 'map' ? 'Map' : 'Outline · in order'}
          </p>
        )}
        {view === 'map' && flags.zoomBar && (
          <IconButton className="hover-wash" label="Fit the whole map" onClick={onFit}>
            <Maximize2 aria-hidden size={18} />
          </IconButton>
        )}
        {flags.outlineToggle && (
          <IconButton
            className="hover-wash"
            label={view === 'map' ? 'Show as outline' : 'Show as map'}
            onClick={() => onView(view === 'map' ? 'outline' : 'map')}
          >
            {view === 'map' ? <List aria-hidden size={18} /> : <MapIcon aria-hidden size={18} />}
          </IconButton>
        )}
        {flags.legendHelp && (
          <IconButton className="hover-wash" label="What the symbols mean" onClick={onLegend}>
            <HelpCircle aria-hidden size={18} />
          </IconButton>
        )}
      </div>
      <p
        role="status"
        className={cx(
          'self-center rounded-full bg-bg/80 px-3 py-0.5 text-[11.5px] text-ink-2',
          !autoBroad && 'sr-only',
        )}
      >
        {autoBroad ? 'Zoomed out: showing main topics only' : ''}
      </p>
    </div>
  );
}
