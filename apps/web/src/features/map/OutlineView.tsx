/**
 * Outline view: the same graph as a chronological, indented tree (`role="tree"`, flat with
 * `aria-level`). Statuses and relationships are written out in words. Roving tabindex:
 * ↑/↓ move, Home/End jump, Enter or Space opens the node. Also the low-stimulation view.
 */
import { nodesInOrder, type GraphState, type TopicNode } from '@constellate/shared';
import { Check, Clock, Pencil } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../ui';
import { isThread, relationWords, statusWords, timeRange } from './model';

function Glyph({ n }: { n: TopicNode }) {
  if (n.kind === 'topic')
    return (
      <span
        aria-hidden
        className={cx(
          'mt-1.5 inline-block size-2.5 shrink-0 rounded-full bg-topic',
          n.status === 'provisional' && 'opacity-40',
        )}
      />
    );
  const G = n.status === 'resolved' ? Check : n.kind === 'parked' ? Pencil : Clock;
  return (
    <span
      aria-hidden
      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed border-thread text-thread"
    >
      <G size={10} strokeWidth={2.6} />
    </span>
  );
}

export function OutlineView({
  state,
  activeNodeId,
  selectedNodeId,
  onOpen,
}: {
  state: GraphState;
  activeNodeId: string | null;
  selectedNodeId?: string | null;
  onOpen(n: TopicNode): void;
}) {
  const nodes = nodesInOrder(state);
  const [focusId, setFocusId] = useState<string | null>(selectedNodeId ?? null);
  const current = focusId && state.nodes[focusId] ? focusId : (nodes[0]?.id ?? null);
  const items = useRef(new Map<string, HTMLLIElement>());

  const move = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    items.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, n: TopicNode, i: number) => {
    switch (e.key) {
      case 'ArrowDown':
        move(nodes[i + 1]?.id);
        break;
      case 'ArrowUp':
        move(nodes[i - 1]?.id);
        break;
      case 'Home':
        move(nodes[0]?.id);
        break;
      case 'End':
        move(nodes[nodes.length - 1]?.id);
        break;
      case 'Enter':
      case ' ':
        onOpen(n);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (nodes.length === 0) {
    return <p className="px-6 py-10 text-center text-sm text-ink-2">Topics appear here as the conversation goes.</p>;
  }

  return (
    <ul
      role="tree"
      aria-label="Conversation outline, in order"
      data-testid="outline"
      className="flex flex-col gap-1 px-3 py-3"
    >
      {nodes.map((n, i) => {
        const indent = isThread(n) ? 2 : Math.max(0, n.level - 1);
        const relations = relationWords(state, n);
        const notes = state.annotations.filter((a) => a.nodeId === n.id);
        const active = n.id === activeNodeId;
        return (
          <li
            key={n.id}
            ref={(el) => {
              if (el) items.current.set(n.id, el);
              else items.current.delete(n.id);
            }}
            role="treeitem"
            aria-level={indent + 1}
            aria-setsize={nodes.length}
            aria-posinset={i + 1}
            aria-selected={n.id === selectedNodeId}
            aria-current={active ? 'step' : undefined}
            tabIndex={n.id === current ? 0 : -1}
            onFocus={() => setFocusId(n.id)}
            onClick={() => onOpen(n)}
            onKeyDown={(e) => onKeyDown(e, n, i)}
            data-testid={`outline-item-${n.id}`}
            className={cx(
              'flex min-h-11 cursor-pointer gap-2.5 rounded-xl border px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-topic',
              active ? 'border-topic/60 bg-topic/10' : 'border-transparent hover:bg-white/5',
              n.highlighted && 'border-highlight/50',
            )}
            style={{ marginLeft: indent * 18 }}
          >
            <Glyph n={n} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{n.label}</span>
                {active && (
                  <span className="rounded-full bg-topic/20 px-2 text-[11.5px] font-semibold text-topic">now</span>
                )}
                <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-ink-2">{timeRange(n)}</span>
              </div>
              <p className="text-[13px] leading-snug text-ink-2">
                {[statusWords(n, activeNodeId), ...relations].join(' · ')}
              </p>
              {notes.map((a) => (
                <p key={a.id} className="mt-1 text-[13px] text-ink">
                  Note: {a.text}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
