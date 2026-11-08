/**
 * Node components. Every meaning has a non-colour cue:
 *  topic   — Y4 faceted four-point star (art.tsx); active = small white core dot + "now"; provisional
 *            = 40 % opacity + "tentative"; selected / focused = thin hairline ring; highlighted =
 *            thin gold ring + ★; revisit = ↺ badge (flag); flag = pin badge. No pulse: the light
 *            facets only shift colour very slowly (static under reduced motion).
 *  thread  — deferred / unexplored: E2 "broken shell" ember (small dashed ring + dim core), a
 *            different shape from any star; picked up later: a "rekindled" Y4 star in orange, plus
 *            the words "picked up"; parked (flag): the ember with a pencil
 *  note    — small sticky card
 * Accessible names are set on the React Flow wrapper (`ariaLabel`), so the visuals are aria-hidden.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Flag, Pencil, StickyNote } from 'lucide-react';
import { createContext, useContext, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '../../ui';
import type { NoteFlowNode, TopicFlowNode } from './flow';
import { EmberArt, StateRings, Y3Star, Y4Star, type StarPalette } from './art';
import { COLUMN, type PlacedNode } from './layout';
import { nodeSubLabel } from './model';

export interface MapNodeActions {
  onLongPress(nodeId: string): void;
}
export const MapNodeActionsContext = createContext<MapNodeActions>({ onLongPress: () => {} });

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/** Long-press detection; swallows the click that follows a long-press. */
function useLongPress(nodeId: string) {
  const { onLongPress } = useContext(MapNodeActionsContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown(e: ReactPointerEvent) {
      if (e.button > 0) return; // primary button or touch only
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress(nodeId);
      }, LONG_PRESS_MS);
    },
    onPointerMove(e: ReactPointerEvent) {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClickCapture(e: React.MouseEvent) {
      if (fired.current) {
        fired.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    onContextMenu(e: React.MouseEvent) {
      // the long-press opens our quick actions instead of the browser menu
      e.preventDefault();
    },
  };
}

function CentreHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} style={{ left: '50%', top: '50%' }} />
      <Handle type="source" position={Position.Top} isConnectable={false} style={{ left: '50%', top: '50%' }} />
    </>
  );
}

function Label({
  box,
  r,
  text,
  sub,
  place,
}: {
  box: number;
  r: number;
  text: string;
  sub?: string | undefined;
  place?: PlacedNode | undefined;
}) {
  const body = (
    <>
      <span className="cmap-label line-clamp-2">{text}</span>
      {/* the space keeps the DOM text "Label sub" (= the start of the accessible name) */}
      {sub && ' '}
      {sub && <span className="cmap-sub mt-0.5 tabular-nums">{sub}</span>}
    </>
  );
  if (place) {
    // column layout: beside the star, vertically centred (right of topics, left of gutter threads)
    const right = place.labelSide === 'right';
    return (
      <div
        aria-hidden
        data-testid="node-label"
        data-side={place.labelSide}
        className={cx(
          'cmap-label-beside absolute flex flex-col',
          right ? 'items-start text-left' : 'items-end text-right',
        )}
        style={{
          width: place.labelWidth,
          top: box,
          left: right ? box + r + COLUMN.labelGap : box - r - COLUMN.labelGap - place.labelWidth,
          transform: 'translateY(-50%)',
        }}
      >
        {body}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      data-testid="node-label"
      className="absolute flex w-[136px] flex-col items-center text-center"
      style={{ left: box - 68, top: box + r + 5 }}
    >
      {body}
    </div>
  );
}

/** Saved-map reveal: the star waits its turn (class keeps it hidden until its delay; CSS in map.css). */
function revealStyle(delay: number | undefined): React.CSSProperties | undefined {
  return delay !== undefined ? { animationDelay: `${delay}ms` } : undefined;
}

/** Small round badge on the circle's rim; `angle` in degrees, 0 = right, -90 = top. */
function Badge({
  box,
  r,
  angle,
  className,
  glyph,
  children,
  testId,
}: {
  box: number;
  r: number;
  angle: number;
  className: string;
  /** drawn with CSS `content`, so it is not DOM text (the node's accessible name carries the meaning) */
  glyph?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const cx_ = box + Math.cos(rad) * (r + 2);
  const cy_ = box + Math.sin(rad) * (r + 2);
  return (
    <span
      aria-hidden
      data-testid={testId}
      data-glyph={glyph}
      className={cx(
        'cmap-badge pointer-events-none absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full border bg-[var(--bg)] px-1 text-[10.5px] font-bold leading-none',
        className,
      )}
      style={{ left: cx_, top: cy_, transform: 'translate(-50%, -50%)' }}
    >
      {children}
    </span>
  );
}

/**
 * The star itself, kept apart from the node's behaviour (badges, label, long-press) so the art can
 * change on its own. Everything here is decoration (aria-hidden).
 */
export function TopicArt({
  box,
  r,
  active,
  playing,
  selected,
  highlighted,
  motion,
  palette = 'young',
  art = 'y3',
}: {
  box: number;
  r: number;
  active: boolean;
  playing: boolean;
  selected: boolean;
  highlighted: boolean;
  motion: boolean;
  palette?: StarPalette;
  /** 'y3' eight-point compass (default) or 'y4' faceted (flag `facetedStars`) */
  art?: 'y3' | 'y4';
}) {
  const side = box * 2;
  const Star = art === 'y4' ? Y4Star : Y3Star;
  return (
    <svg aria-hidden width={side} height={side} className="absolute inset-0 overflow-visible">
      <StateRings cx={box} cy={box} r={r} selected={selected} highlighted={highlighted} />
      <Star cx={box} cy={box} r={r} palette={palette} motion={motion} />
      {/* being discussed now (or being heard): a small white core, never a pulse */}
      {(active || playing) && <circle cx={box} cy={box} r={2.5} fill="#FFFFFF" data-testid="active-core" />}
    </svg>
  );
}

export function TopicNodeView({ id, data }: NodeProps<TopicFlowNode>) {
  const { view, box, active, playing, selected, dimmed, showTime, motion } = data;
  const n = view.node;
  const r = view.radius;
  const side = box * 2;
  const provisional = n.status === 'provisional';
  const press = useLongPress(id);
  const sub = nodeSubLabel(n, { active, playing, showTime });

  return (
    <div
      {...press}
      data-testid={`map-node-${id}`}
      data-kind="topic"
      data-status={n.status}
      data-active={active || undefined}
      data-highlighted={n.highlighted || undefined}
      data-occurrences={view.occurrences.length > 1 ? view.occurrences.length : undefined}
      data-reveal={data.revealDelay}
      className={cx('cmap-appear relative', data.revealDelay !== undefined && 'cmap-reveal', dimmed && 'cmap-dim')}
      style={{
        width: side,
        height: side,
        opacity: dimmed ? 0.22 : provisional ? 0.4 : undefined,
        ...revealStyle(data.revealDelay),
      }}
    >
      <CentreHandles />
      <TopicArt
        box={box}
        r={r}
        active={active}
        playing={playing}
        selected={selected}
        highlighted={n.highlighted}
        motion={motion}
        art={data.art}
      />
      {view.isRevisit && (
        <Badge box={box} r={r} angle={-135} className="border-revisit text-revisit" testId="revisit-badge" glyph="↺" />
      )}
      {view.flags > 0 && (
        <Badge
          box={box}
          r={r}
          angle={-45}
          className="border-flag text-flag"
          testId="flag-badge"
          glyph={view.flags > 1 ? String(view.flags) : undefined}
        >
          <Flag size={10} strokeWidth={2.5} />
        </Badge>
      )}
      {n.highlighted && <Badge box={box} r={r} angle={135} className="border-highlight text-highlight" glyph="★" />}
      {view.hiddenChildren > 0 && (
        <Badge
          box={box}
          r={r}
          angle={45}
          className="border-topic text-topic"
          testId="child-badge"
          glyph={`+${view.hiddenChildren}`}
        />
      )}
      {(data.noteCount ?? 0) > 0 && (
        <Badge box={box} r={r} angle={160} className="border-highlight/70 text-highlight" testId="note-badge">
          <StickyNote size={10} strokeWidth={2.4} />
        </Badge>
      )}
      <Label box={box} r={r} text={n.label} sub={sub} place={data.place} />
    </div>
  );
}

export function ThreadNodeView({ id, data }: NodeProps<TopicFlowNode>) {
  const { view, box, selected, dimmed, showTime, motion } = data;
  const n = view.node;
  const r = view.radius;
  const side = box * 2;
  const resolved = n.status === 'resolved';
  const press = useLongPress(id);
  const sub = nodeSubLabel(n, { active: false, playing: false, showTime });

  return (
    <div
      {...press}
      data-testid={`map-node-${id}`}
      data-kind={n.kind}
      data-status={n.status}
      data-art={resolved ? 'rekindled' : 'ember'}
      data-reveal={data.revealDelay}
      className={cx('cmap-appear relative', data.revealDelay !== undefined && 'cmap-reveal', dimmed && 'cmap-dim')}
      style={{ width: side, height: side, opacity: dimmed ? 0.22 : undefined, ...revealStyle(data.revealDelay) }}
    >
      <CentreHandles />
      {resolved ? (
        <TopicArt
          box={box}
          r={r}
          active={false}
          playing={false}
          selected={selected}
          highlighted={n.highlighted}
          motion={motion}
          palette="rekindled"
          art={data.art}
        />
      ) : (
        <svg aria-hidden width={side} height={side} className="absolute inset-0 overflow-visible">
          <StateRings cx={box} cy={box} r={r} selected={selected} highlighted={n.highlighted} />
          <EmberArt cx={box} cy={box} motion={motion} />
        </svg>
      )}
      {n.kind === 'parked' && !resolved && (
        <span
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center text-thread"
          style={{ left: box + r - 2, top: box - r - 10, width: 12, height: 12 }}
        >
          <Pencil size={10} strokeWidth={2.4} data-testid="glyph-parked" />
        </span>
      )}
      {view.flags > 0 && (
        <Badge box={box} r={r} angle={-45} className="border-flag text-flag" testId="flag-badge">
          <Flag size={10} strokeWidth={2.5} />
        </Badge>
      )}
      <Label box={box} r={r} text={n.label} sub={sub} place={data.place} />
    </div>
  );
}

export function NoteNodeView({ data }: NodeProps<NoteFlowNode>) {
  return (
    <div
      data-testid={`map-note-${data.annotation.id}`}
      className={cx(
        'pointer-events-none flex w-[148px] gap-1.5 border border-highlight/40 bg-[#2a2614]/90 px-2 py-1.5 text-[11.5px] leading-snug text-ink shadow-lg',
        data.dimmed && 'cmap-dim',
      )}
      style={{ fontSize: 'calc(11.5px * var(--text-size))' }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Left} isConnectable={false} />
      <StickyNote aria-hidden size={12} className="mt-0.5 shrink-0 text-highlight" />
      <span>
        <span className="sr-only">Note: </span>
        {data.annotation.text}
      </span>
    </div>
  );
}

export const nodeTypes = { topic: TopicNodeView, thread: ThreadNodeView, note: NoteNodeView };
