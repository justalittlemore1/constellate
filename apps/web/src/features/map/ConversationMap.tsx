/**
 * <ConversationMap> — the live constellation of a conversation (React Flow). Used by `/c/:id`
 * (A3) and `/live/:id` (A6: `renderMap={(g) => g && <ConversationMap state={g} followLatest />}`).
 *
 * Positions come only from node x/y (never React Flow layout). Pinch / wheel zoom, drag to pan,
 * double-tap empty space to fit, zoom buttons for keyboard and switch users. Tap a node → preview
 * card → detail sheet; long-press → quick actions; desktop hover → preview. Arrow keys walk the
 * nodes in conversation order. Semantic zoom: Broad / Balanced / Detailed, and Broad by itself
 * when zoomed far out. Map ↔ Outline switches to the accessible list view.
 */
import '@xyflow/react/dist/base.css';
import './map.css';
import { nodesInOrder, type GraphState, type TopicNode, type Utterance } from '@constellate/shared';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
  type OnMoveStart,
} from '@xyflow/react';
import { ArrowDown, HelpCircle, List, Map as MapIcon, Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMotionReduced } from '../../lib/prefs';
import { cx, IconButton } from '../../ui';
import { toFlowEdges, toFlowNodes, type MapFlowNode } from './flow';
import { edgeTypes } from './edges';
import {
  DETAIL_LABEL,
  DETAIL_LEVELS,
  effectiveDetail,
  latestNode,
  nodeAccessibleName,
  pathInOrder,
  stepNode,
  tracePath,
  visibleGraph,
  type DetailLevel,
  type TracedPath,
} from './model';
import { MapNodeActionsContext, nodeTypes } from './nodes';
import { OutlineView } from './OutlineView';
import { LegendSheet, NodeDetailSheet, PathBanner, PreviewCard, QuickActionsSheet } from './panels';
import { ensureVisible, fitAll, fitWidth, followY, graphBounds, MAX_ZOOM, MIN_ZOOM, withLaneFrame } from './viewport';

export type MapView = 'map' | 'outline';

export interface ConversationMapProps {
  state: GraphState;
  /** defaults to `state.activeNodeId` */
  activeNodeId?: string | null;
  /** live: keep the newest node in view until the user pans away; then show "Jump to now" */
  followLatest?: boolean;
  /** called when the user selects a node (preview) or clears the selection */
  onNodeSelect?: (node: TopicNode | null) => void;
  /** shows "Play this moment" where given (saved conversations with a recording) */
  onPlaySegment?: (node: TopicNode) => void;
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
  className?: string;
}

const TOOLBAR_INSET = 60;
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
  followLatest = false,
  onNodeSelect,
  onPlaySegment,
  utterances,
  playingNodeId = null,
  detail: detailProp,
  onDetailChange,
  view: viewProp,
  onViewChange,
  hideToolbar = false,
  className,
}: ConversationMapProps) {
  const activeNodeId = activeProp === undefined ? state.activeNodeId : activeProp;
  const reduced = useMotionReduced();
  const motion = !reduced;
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const container = useRef<HTMLDivElement>(null);
  const size = useSize(container);

  const [detail, setDetail] = useControllable<DetailLevel>(detailProp, onDetailChange, 'balanced');
  const [view, setView] = useControllable<MapView>(viewProp, onViewChange, 'map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [tracedId, setTracedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [following, setFollowing] = useState(true);
  const [ready, setReady] = useState(false);
  const placed = useRef(false);
  const lastTap = useRef(0);

  const shown = effectiveDetail(detail, zoom);
  const autoBroad = shown !== detail;
  const vg = useMemo(() => visibleGraph(state, shown), [state, shown]);
  // the full graph decides the frame, so switching detail level never jumps the view
  // live maps frame every lane up to the thread gutter from the start, so later nodes land in view
  const fullBounds = useMemo(() => {
    const b = graphBounds(visibleGraph(state, 'balanced'));
    return b && followLatest ? withLaneFrame(b) : b;
  }, [state, followLatest]);
  const traced: TracedPath | null = useMemo(
    () => (tracedId && state.nodes[tracedId] ? tracePath(state, tracedId) : null),
    [state, tracedId],
  );

  const nodes = useMemo(
    () =>
      toFlowNodes(
        vg,
        { activeNodeId, playingNodeId, selectedNodeId: selectedId, showTime: shown === 'detailed', motion, traced },
        (v) => nodeAccessibleName(state, v.node, activeNodeId),
      ),
    [vg, activeNodeId, playingNodeId, selectedId, shown, motion, traced, state],
  );
  const edges = useMemo(
    () =>
      toFlowEdges(vg, state, {
        activeNodeId,
        playingNodeId,
        selectedNodeId: selectedId,
        showTime: false,
        motion,
        traced,
      }),
    [vg, state, activeNodeId, playingNodeId, selectedId, motion, traced],
  );
  const order = useMemo(() => vg.nodes.map((v) => v.node.id), [vg]);
  const latest = latestNode(state);
  const topInset = hideToolbar ? 0 : TOOLBAR_INSET;

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
    void rf.setViewport(followY(vp, latest.y, size.h), { duration });
    setFollowing(true);
  }, [rf, latest, size.h, duration]);

  const fitEverything = useCallback(() => {
    if (!fullBounds || !size.w) return;
    void rf.setViewport(fitAll(fullBounds, size.w, size.h, topInset, 24), { duration });
  }, [rf, fullBounds, size.w, size.h, topInset, duration]);

  // first frame: width-fit from the top (saved map) or on the newest node (live)
  useEffect(() => {
    if (!ready || placed.current || !fullBounds || !size.w || !size.h || view !== 'map') return;
    placed.current = true;
    const vp = fitWidth(fullBounds, size.w, topInset);
    void rf.setViewport(followLatest && latest ? followY(vp, latest.y, size.h) : vp);
  }, [ready, fullBounds, size.w, size.h, topInset, rf, followLatest, latest, view]);

  // live: follow the newest node while the user has not panned away
  const latestId = latest?.id;
  useEffect(() => {
    if (!followLatest || !following || !placed.current || !latestId) return;
    const n = state.nodes[latestId];
    if (!n || !size.h) return;
    void rf.setViewport(followY(rf.getViewport(), n.y, size.h), { duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new node arrives
  }, [latestId, followLatest, following]);

  const onMoveStart: OnMoveStart = useCallback(
    (event) => {
      // a real pointer / wheel gesture (programmatic moves have no event)
      if (event && followLatest) setFollowing(false);
    },
    [followLatest],
  );

  const onNodeClick: NodeMouseHandler<MapFlowNode> = useCallback(
    (_e, node) => {
      if (node.type === 'note') return;
      select(selectedId === node.id ? selectedId : node.id);
    },
    [select, selectedId],
  );

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

  const onNodeMouseEnter: NodeMouseHandler<MapFlowNode> = useCallback((e, node) => {
    if (node.type === 'note') return;
    // desktop hover only; touch taps go through onNodeClick
    if ((e.nativeEvent as PointerEvent).pointerType === 'touch') return;
    setHoverId(node.id);
  }, []);
  const onNodeMouseLeave = useCallback(() => setHoverId(null), []);

  const focusNode = useCallback(
    (id: string | null) => {
      if (!id) return;
      const n = state.nodes[id];
      const el = container.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
      if (n && size.w) {
        const vp = rf.getViewport();
        const next = ensureVisible(vp, n, size.w, size.h, 70, topInset);
        if (next.x !== vp.x || next.y !== vp.y) void rf.setViewport(next, { duration });
      }
    },
    [state.nodes, rf, size.w, size.h, topInset, duration],
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
          if (selectedId === id) setSheetId(id);
          else select(id);
          break;
        case 'Escape':
          select(null);
          setTracedId(null);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [state.nodes, order, focusNode, selectedId, select],
  );

  const actions = useMemo(() => ({ onLongPress: (id: string) => setQuickId(id) }), []);

  const previewId = selectedId ?? hoverId;
  const previewNode = previewId ? (state.nodes[previewId] ?? null) : null;
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
    <div className={cx('cmap relative h-full w-full overflow-hidden bg-bg', className)} data-testid="conversation-map">
      {!hideToolbar && (
        <MapToolbar
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
            onOpen={(n) => setSheetId(n.id)}
          />
        </div>
      ) : (
        <MapNodeActionsContext.Provider value={actions}>
          <div ref={container} className="absolute inset-0" onKeyDown={onKeyDown}>
            <ReactFlow<MapFlowNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={() => setReady(true)}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onPaneClick={onPaneClick}
              onMoveStart={onMoveStart}
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
              ariaLabelConfig={{
                'node.a11yDescription.keyboardDisabled':
                  'Arrow keys move between topics in conversation order. Enter opens a preview; Enter again opens the details.',
              }}
              proOptions={{ hideAttribution: false }}
              aria-label="Conversation map"
            />
          </div>
        </MapNodeActionsContext.Provider>
      )}

      {view === 'map' && traced && tracedLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-x-3 z-10" style={{ top: topInset + 8 }}>
          <PathBanner labels={tracedLabels} onClear={() => setTracedId(null)} />
        </div>
      )}

      {empty && view === 'map' && (
        <p className="pointer-events-none absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-sm text-ink-2">
          Topics appear here as the conversation goes.
        </p>
      )}

      {/* bottom overlay: zoom buttons, Jump to now, preview card */}
      {view === 'map' && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2">
          <div className="flex items-end justify-between gap-2">
            <span />
            {followLatest && !following ? (
              <button
                type="button"
                onClick={jumpToNow}
                className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full border border-topic/50 bg-bg/90 px-4 text-sm font-semibold text-topic shadow-lg"
              >
                <ArrowDown aria-hidden size={16} />
                Jump to now
              </button>
            ) : (
              <span />
            )}
            <div className="surface pointer-events-auto flex flex-col rounded-full border border-line">
              <IconButton label="Zoom in" onClick={() => void rf.zoomIn({ duration })}>
                <Plus aria-hidden size={18} />
              </IconButton>
              <IconButton label="Zoom out" onClick={() => void rf.zoomOut({ duration })}>
                <Minus aria-hidden size={18} />
              </IconButton>
            </div>
          </div>
          {previewNode && (
            <PreviewCard
              state={state}
              node={previewNode}
              activeNodeId={activeNodeId}
              onOpen={() => setSheetId(previewNode.id)}
              onClose={() => {
                select(null);
                setHoverId(null);
              }}
              onPlay={play ? () => play(previewNode) : undefined}
            />
          )}
        </div>
      )}

      <NodeDetailSheet
        state={state}
        node={sheetId ? (state.nodes[sheetId] ?? null) : null}
        activeNodeId={activeNodeId}
        utterances={utterances}
        onClose={() => setSheetId(null)}
        onPlay={play}
        onTrace={(n) => {
          trace(n);
          if (view !== 'map') setView('map');
        }}
      />
      <QuickActionsSheet
        node={quickId ? (state.nodes[quickId] ?? null) : null}
        onClose={() => setQuickId(null)}
        onOpen={(n) => {
          setQuickId(null);
          setSheetId(n.id);
        }}
        onPlay={play}
        onTrace={trace}
      />
      <LegendSheet open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}

function MapToolbar({
  detail,
  onDetail,
  autoBroad,
  view,
  onView,
  onFit,
  onLegend,
}: {
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
        {view === 'map' ? (
          <div role="group" aria-label="Detail level" className="flex min-w-0 flex-1">
            {DETAIL_LEVELS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={detail === d}
                onClick={() => onDetail(d)}
                className={cx(
                  'min-h-11 min-w-0 flex-1 rounded-full px-2 text-[13px] font-semibold transition-colors',
                  detail === d ? 'bg-topic text-bg' : 'text-ink-2 hover:bg-white/10 hover:text-ink',
                )}
              >
                {DETAIL_LABEL[d]}
              </button>
            ))}
          </div>
        ) : (
          <p className="flex-1 px-3 text-[13px] font-semibold text-ink-2">Outline · in order</p>
        )}
        {view === 'map' && (
          <IconButton label="Fit the whole map" onClick={onFit}>
            <Maximize2 aria-hidden size={18} />
          </IconButton>
        )}
        <IconButton
          label={view === 'map' ? 'Show as outline' : 'Show as map'}
          onClick={() => onView(view === 'map' ? 'outline' : 'map')}
        >
          {view === 'map' ? <List aria-hidden size={18} /> : <MapIcon aria-hidden size={18} />}
        </IconButton>
        <IconButton label="What the symbols mean" onClick={onLegend}>
          <HelpCircle aria-hidden size={18} />
        </IconButton>
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
