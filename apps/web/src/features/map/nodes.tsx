/**
 * Node components. Every meaning has a non-colour cue:
 *  topic   — filled glowing circle; active = static outer ring + pulse + "now"; provisional = 40 %
 *            opacity + "tentative"; revisit = ↺ badge; highlighted = gold ring + ★; flag = pin badge
 *  thread  — hollow dashed ring; clock glyph (mentioned for later), pencil (parked), check (picked up)
 *  note    — small sticky card
 * Accessible names are set on the React Flow wrapper (`ariaLabel`), so the visuals are aria-hidden.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Check, Clock, Flag, Pencil, StickyNote } from 'lucide-react';
import { createContext, useContext, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { formatClock } from '../../lib/format';
import { cx } from '../../ui';
import type { NoteFlowNode, TopicFlowNode } from './flow';

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

function Label({ box, offset, text, sub }: { box: number; offset: number; text: string; sub?: string | undefined }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute flex w-[136px] flex-col items-center text-center"
      style={{ left: box - 68, top: box + offset }}
    >
      <span className="cmap-label line-clamp-2">{text}</span>
      {sub && <span className="cmap-sub mt-0.5 tabular-nums">{sub}</span>}
    </div>
  );
}

/** Small round badge on the circle's rim; `angle` in degrees, 0 = right, -90 = top. */
function Badge({
  box,
  r,
  angle,
  className,
  children,
  testId,
}: {
  box: number;
  r: number;
  angle: number;
  className: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const cx_ = box + Math.cos(rad) * (r + 2);
  const cy_ = box + Math.sin(rad) * (r + 2);
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cx(
        'pointer-events-none absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full border bg-[var(--bg)] px-1 text-[10.5px] font-bold leading-none',
        className,
      )}
      style={{ left: cx_, top: cy_, transform: 'translate(-50%, -50%)' }}
    >
      {children}
    </span>
  );
}

export function TopicNodeView({ id, data }: NodeProps<TopicFlowNode>) {
  const { view, box, active, playing, selected, dimmed, showTime, motion } = data;
  const n = view.node;
  const r = view.radius;
  const side = box * 2;
  const provisional = n.status === 'provisional';
  const press = useLongPress(id);
  const gradId = `cmap-g-${id}`;
  const sub = active ? 'now' : playing ? 'playing' : showTime ? formatClock(n.startMs) : undefined;

  return (
    <div
      {...press}
      data-testid={`map-node-${id}`}
      data-kind="topic"
      data-status={n.status}
      data-active={active || undefined}
      data-highlighted={n.highlighted || undefined}
      className={cx('relative', dimmed && 'cmap-dim')}
      style={{ width: side, height: side, opacity: dimmed ? 0.22 : provisional ? 0.4 : undefined }}
    >
      <CentreHandles />
      <svg aria-hidden width={side} height={side} className="absolute inset-0 overflow-visible">
        <defs>
          <radialGradient id={gradId}>
            <stop offset="0%" stopColor="#F2FDFF" stopOpacity="1" />
            <stop offset="38%" stopColor="#9DEEFF" stopOpacity="1" />
            <stop offset="100%" stopColor="#3CC9EE" stopOpacity="0.95" />
          </radialGradient>
        </defs>
        {/* keyboard focus ring (shown via .react-flow__node:focus-visible) */}
        <circle className="cmap-focus" cx={box} cy={box} r={r + 9} fill="none" stroke="var(--text)" strokeWidth={2} />
        {n.highlighted && (
          <circle
            cx={box}
            cy={box}
            r={r + 5}
            fill="none"
            stroke="var(--highlight)"
            strokeWidth={2.5}
            data-testid="highlight-ring"
          />
        )}
        {(active || playing) && (
          <>
            <circle
              cx={box}
              cy={box}
              r={r + 4}
              fill="none"
              stroke={playing ? 'var(--text)' : 'var(--topic)'}
              strokeWidth={1.5}
            />
            {motion && (
              <circle
                className="cmap-pulse"
                cx={box}
                cy={box}
                r={r}
                fill="none"
                stroke="var(--topic)"
                strokeWidth={2}
                data-testid="pulse"
              />
            )}
          </>
        )}
        {selected && (
          <circle
            cx={box}
            cy={box}
            r={r + 4}
            fill="none"
            stroke="var(--text)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
        <g className="cmap-appear">
          <circle
            cx={box}
            cy={box}
            r={r}
            fill={`url(#${gradId})`}
            style={{
              filter: `drop-shadow(0 0 calc(${playing ? 18 : 10}px * var(--glow)) rgba(111,227,255,${playing ? 0.95 : 0.7}))`,
            }}
          />
        </g>
      </svg>
      {view.isRevisit && (
        <Badge box={box} r={r} angle={-135} className="border-revisit text-revisit" testId="revisit-badge">
          ↺
        </Badge>
      )}
      {view.flags > 0 && (
        <Badge box={box} r={r} angle={-45} className="border-flag text-flag" testId="flag-badge">
          <Flag size={10} strokeWidth={2.5} />
          {view.flags > 1 && <span className="ml-0.5">{view.flags}</span>}
        </Badge>
      )}
      {n.highlighted && (
        <Badge box={box} r={r} angle={135} className="border-highlight text-highlight">
          ★
        </Badge>
      )}
      {view.hiddenChildren > 0 && (
        <Badge box={box} r={r} angle={45} className="border-topic text-topic" testId="child-badge">
          +{view.hiddenChildren}
        </Badge>
      )}
      <Label box={box} offset={r + 5} text={n.label} sub={sub} />
    </div>
  );
}

export function ThreadNodeView({ id, data }: NodeProps<TopicFlowNode>) {
  const { view, box, selected, dimmed, showTime } = data;
  const n = view.node;
  const r = view.radius;
  const side = box * 2;
  const resolved = n.status === 'resolved';
  const press = useLongPress(id);
  const Glyph = resolved ? Check : n.kind === 'parked' ? Pencil : Clock;
  const sub = showTime ? formatClock(n.mentionedAtMs ?? n.startMs) : resolved ? 'picked up' : undefined;

  return (
    <div
      {...press}
      data-testid={`map-node-${id}`}
      data-kind={n.kind}
      data-status={n.status}
      className={cx('relative', dimmed && 'cmap-dim')}
      style={{ width: side, height: side, opacity: dimmed ? 0.22 : resolved ? 0.7 : undefined }}
    >
      <CentreHandles />
      <svg aria-hidden width={side} height={side} className="absolute inset-0 overflow-visible">
        <circle className="cmap-focus" cx={box} cy={box} r={r + 8} fill="none" stroke="var(--text)" strokeWidth={2} />
        {n.highlighted && (
          <circle cx={box} cy={box} r={r + 5} fill="none" stroke="var(--highlight)" strokeWidth={2.5} />
        )}
        {selected && (
          <circle
            cx={box}
            cy={box}
            r={r + 4}
            fill="none"
            stroke="var(--text)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
        <g className="cmap-appear">
          <circle
            data-testid="thread-ring"
            cx={box}
            cy={box}
            r={r}
            fill="rgba(7,10,23,0.85)"
            stroke="var(--thread)"
            strokeWidth={2}
            strokeDasharray="4 3.5"
            style={{ filter: 'drop-shadow(0 0 calc(6px * var(--glow)) rgba(255,196,107,0.45))' }}
          />
        </g>
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute flex items-center justify-center text-thread"
        style={{ left: box - 8, top: box - 8, width: 16, height: 16 }}
      >
        <Glyph size={14} strokeWidth={2.4} data-testid={`glyph-${resolved ? 'resolved' : n.kind}`} />
      </span>
      {view.flags > 0 && (
        <Badge box={box} r={r} angle={-45} className="border-flag text-flag" testId="flag-badge">
          <Flag size={10} strokeWidth={2.5} />
        </Badge>
      )}
      <Label box={box} offset={r + 5} text={n.label} sub={sub} />
    </div>
  );
}

export function NoteNodeView({ data }: NodeProps<NoteFlowNode>) {
  return (
    <div
      data-testid={`map-note-${data.annotation.id}`}
      className={cx(
        'pointer-events-none flex w-[148px] gap-1.5 rounded-lg border border-highlight/40 bg-[#2a2614]/90 px-2 py-1.5 text-[11.5px] leading-snug text-ink shadow-lg',
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
