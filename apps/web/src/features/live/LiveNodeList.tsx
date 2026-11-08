/**
 * Plain, accessible list of the live map's nodes in conversation order. Stands in for A3's
 * <ConversationMap> until it lands (and stays useful as the low-stimulation view). Follows the
 * newest node; once the user scrolls away a "Jump to now" chip brings them back.
 */
import { nodesInOrder, type GraphState, type TopicNode } from '@constellate/shared';
import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatClock } from './openThreads';

const FOLLOW_SLACK_PX = 48;

function describe(n: TopicNode, graph: GraphState): string {
  const parts: string[] = [];
  if (n.kind === 'pending') parts.push(n.status === 'resolved' ? 'mentioned for later, picked up' : 'mentioned for later');
  if (n.kind === 'parked') parts.push(n.status === 'resolved' ? 'parked by you, picked up' : 'parked by you');
  if (n.status === 'provisional') parts.push('tentative');
  const revisit = Object.values(graph.edges).find((e) => e.kind === 'revisit' && e.sourceId === n.id);
  const earlier = revisit ? graph.nodes[revisit.targetId] : undefined;
  if (earlier) parts.push(`returns to ${earlier.label} from ${formatClock(earlier.startMs)}`);
  const flags = graph.flags.filter((f) => f.nodeId === n.id).length;
  if (flags) parts.push(flags === 1 ? '⚑ flagged' : `⚑ flagged ${flags}×`);
  return parts.join(' · ');
}

const GLYPH: Record<TopicNode['kind'], string> = { topic: '●', pending: '◌', parked: '✎' };

export function LiveNodeList({ graph }: { graph: GraphState | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const nodes = graph ? nodesInOrder(graph) : [];
  const count = nodes.length;

  useEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [count, following]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX;
    setFollowing(atEnd);
  };

  if (!graph || count === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-ink-2">
        Topics appear here as the conversation goes.
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-4" data-testid="live-node-scroller">
        <ol aria-label="Topics so far" className="flex flex-col gap-2">
          {nodes.map((n) => {
            const active = graph.activeNodeId === n.id;
            const note = describe(n, graph);
            return (
              <li
                key={n.id}
                aria-current={active ? 'step' : undefined}
                style={{ marginLeft: `${n.kind === 'topic' ? n.level * 16 : 32}px` }}
                className={`rounded-xl border px-3 py-2 ${
                  active ? 'border-topic/70 bg-topic/10' : 'border-white/10 bg-white/[0.03]'
                } ${n.status === 'provisional' ? 'opacity-60' : ''}`}
              >
                <div className="flex items-baseline gap-2">
                  <span aria-hidden className={n.kind === 'topic' ? 'text-topic' : 'text-thread'}>
                    {GLYPH[n.kind]}
                  </span>
                  <span className="font-semibold">{n.label}</span>
                  {active && (
                    <span className="rounded-full bg-topic/20 px-2 text-[11.5px] font-semibold text-topic">now</span>
                  )}
                  <span className="ml-auto text-[11.5px] tabular-nums text-ink-2">{formatClock(n.startMs)}</span>
                </div>
                {note && <p className="mt-0.5 text-[13px] text-ink-2">{note}</p>}
              </li>
            );
          })}
        </ol>
      </div>
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-3 left-1/2 flex min-h-[44px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-topic/50 bg-bg/90 px-4 text-sm font-semibold text-topic shadow-lg"
        >
          <ArrowDown aria-hidden size={16} />
          Jump to now
        </button>
      )}
    </div>
  );
}
