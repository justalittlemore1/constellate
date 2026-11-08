/**
 * Map overlays: preview card (tap a node), detail sheet (tap the card), quick actions
 * (long-press) and the legend sheet. Built on A4's `Sheet` primitive.
 */
import type { GraphState, TopicNode, Utterance } from '@constellate/shared';
import { ChevronRight, Play, Route, X } from 'lucide-react';
import { formatClock } from '../../lib/format';
import { Button, Chip, IconButton, Sheet } from '../../ui';
import { relationWords, statusWords, timeRange, isThread, revisitTarget } from './model';

export function PreviewCard({
  state,
  node,
  activeNodeId,
  onOpen,
  onClose,
  onPlay,
}: {
  state: GraphState;
  node: TopicNode;
  activeNodeId: string | null;
  onOpen(): void;
  onClose(): void;
  onPlay?: (() => void) | undefined;
}) {
  const relations = relationWords(state, node);
  return (
    <section
      aria-label={`Preview: ${node.label}`}
      data-testid="preview-card"
      className="cmap-preview surface pointer-events-auto flex items-start gap-1 rounded-[var(--radius)] border border-line p-1.5 shadow-xl"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/5"
        aria-label={`Open details for ${node.label}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{node.label}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-2">{timeRange(node)}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{node.summary}</span>
          <span className="mt-1 block text-[11.5px] text-ink-2">
            {[statusWords(node, activeNodeId), ...relations].join(' · ')}
          </span>
        </span>
        <ChevronRight aria-hidden size={18} className="mt-0.5 shrink-0 text-ink-2" />
      </button>
      <div className="flex flex-col">
        <IconButton label="Close preview" onClick={onClose}>
          <X aria-hidden size={18} />
        </IconButton>
        {onPlay && (
          <IconButton label={`Play ${node.label}`} onClick={onPlay}>
            <Play aria-hidden size={18} />
          </IconButton>
        )}
      </div>
    </section>
  );
}

/** Minimal markdown → paragraphs (finalisation `details`); strips emphasis markers, keeps text. */
function paragraphs(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/[*_`#>]+/g, '')
        .replace(/^\s*[-•]\s+/gm, '• ')
        .trim(),
    )
    .filter(Boolean);
}

export function NodeDetailSheet({
  state,
  node,
  activeNodeId,
  utterances,
  onClose,
  onPlay,
  onTrace,
}: {
  state: GraphState;
  node: TopicNode | null;
  activeNodeId: string | null;
  utterances?: Utterance[] | undefined;
  onClose(): void;
  onPlay?: ((n: TopicNode) => void) | undefined;
  onTrace(n: TopicNode): void;
}) {
  const open = Boolean(node);
  const evidence = node && utterances ? utterances.filter((u) => node.utteranceIds.includes(u.id)) : [];
  const flags = node ? state.flags.filter((f) => f.nodeId === node.id) : [];
  const notes = node ? state.annotations.filter((a) => a.nodeId === node.id) : [];
  const back = node ? revisitTarget(state, node.id) : null;
  return (
    <Sheet open={open} onClose={onClose} title={node?.label ?? ''} testId="node-detail-sheet">
      {node && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={isThread(node) ? 'thread' : 'topic'}>{statusWords(node, activeNodeId)}</Chip>
            {back && <Chip tone="revisit">↺ return</Chip>}
            {node.highlighted && <Chip tone="highlight">★ highlighted</Chip>}
            {flags.length > 0 && <Chip tone="flag">⚑ flagged{flags.length > 1 ? ` ×${flags.length}` : ''}</Chip>}
            <span className="text-[13px] tabular-nums text-ink-2">{timeRange(node)}</span>
          </div>

          <p className="text-[0.9375rem] leading-relaxed">{node.summary}</p>

          {node.details && (
            <section aria-labelledby="cmap-details-h">
              <h3 id="cmap-details-h" className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">
                Details
              </h3>
              {paragraphs(node.details).map((p, i) => (
                <p key={i} className="mb-2 whitespace-pre-line text-[0.9375rem] leading-relaxed">
                  {p}
                </p>
              ))}
            </section>
          )}

          <section aria-labelledby="cmap-rel-h">
            <h3 id="cmap-rel-h" className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">
              Where it sits
            </h3>
            <ul className="list-disc pl-5 text-[0.9375rem] leading-relaxed">
              {relationWords(state, node).map((r) => (
                <li key={r}>{r}</li>
              ))}
              {relationWords(state, node).length === 0 && <li>Level {node.level} topic</li>}
            </ul>
          </section>

          {evidence.length > 0 && (
            <section aria-labelledby="cmap-ev-h">
              <h3 id="cmap-ev-h" className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">
                What was said
              </h3>
              <ul className="flex flex-col gap-2">
                {evidence.map((u) => (
                  <li key={u.id} className="border-l-2 border-topic/50 pl-3 text-[0.9375rem] leading-relaxed">
                    <q>{u.text}</q>
                    <span className="ml-2 text-[11.5px] tabular-nums text-ink-2">
                      {u.speaker !== null ? `Speaker ${u.speaker + 1} · ` : ''}
                      {formatClock(u.startMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notes.length > 0 && (
            <section aria-labelledby="cmap-notes-h">
              <h3 id="cmap-notes-h" className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">
                Your notes
              </h3>
              <ul className="flex flex-col gap-1">
                {notes.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-highlight/40 bg-[#2a2614]/80 px-3 py-2 text-[0.9375rem]"
                  >
                    {a.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            {onPlay && (
              <Button variant="primary" icon={<Play aria-hidden size={18} />} onClick={() => onPlay(node)}>
                Play this moment
              </Button>
            )}
            <Button icon={<Route aria-hidden size={18} />} onClick={() => onTrace(node)}>
              How did we get here?
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function QuickActionsSheet({
  node,
  onClose,
  onOpen,
  onPlay,
  onTrace,
}: {
  node: TopicNode | null;
  onClose(): void;
  onOpen(n: TopicNode): void;
  onPlay?: ((n: TopicNode) => void) | undefined;
  onTrace(n: TopicNode): void;
}) {
  return (
    <Sheet
      open={Boolean(node)}
      onClose={onClose}
      title={node ? `${node.label}: quick actions` : ''}
      testId="quick-actions-sheet"
    >
      {node && (
        <div className="flex flex-col gap-2 pt-1">
          <Button block onClick={() => onOpen(node)} icon={<ChevronRight aria-hidden size={18} />}>
            Open details
          </Button>
          {onPlay && (
            <Button block onClick={() => onPlay(node)} icon={<Play aria-hidden size={18} />}>
              Play this moment
            </Button>
          )}
          <Button block onClick={() => onTrace(node)} icon={<Route aria-hidden size={18} />}>
            How did we get here?
          </Button>
        </div>
      )}
    </Sheet>
  );
}

// ───────────────────────── legend ─────────────────────────

function Sample({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden width={64} height={40} viewBox="0 0 64 40" className="shrink-0 overflow-visible">
      {children}
    </svg>
  );
}

const LEGEND: { title: string; text: string; sample: React.ReactNode }[] = [
  {
    title: 'Topic',
    text: 'A filled, glowing circle. Bigger means it was discussed for longer. The label underneath names it in 1–4 words.',
    sample: <circle cx={32} cy={20} r={13} fill="#6FE3FF" opacity={0.85} />,
  },
  {
    title: 'Being discussed now',
    text: 'A circle with an extra outer ring that pulses slowly (still, if motion is reduced), and the word “now” under the label.',
    sample: (
      <>
        <circle cx={32} cy={20} r={17} fill="none" stroke="#6FE3FF" strokeWidth={1.5} />
        <circle cx={32} cy={20} r={12} fill="#6FE3FF" opacity={0.85} />
      </>
    ),
  },
  {
    title: 'Tentative topic',
    text: 'Faded to 40 %: the app is not sure yet. It firms up or disappears in a few seconds.',
    sample: <circle cx={32} cy={20} r={13} fill="#6FE3FF" opacity={0.35} />,
  },
  {
    title: 'Sub-topic',
    text: 'Indented one step to the right and slightly smaller. In Broad detail it folds into the main topic just before it, which shows a “+N” badge.',
    sample: (
      <>
        <circle cx={18} cy={14} r={9} fill="#6FE3FF" opacity={0.85} />
        <circle cx={44} cy={28} r={7} fill="#6FE3FF" opacity={0.85} />
      </>
    ),
  },
  {
    title: 'The conversation moved on',
    text: 'A solid line with an arrowhead pointing to what came next. Small dots drift along it (not when motion is reduced).',
    sample: (
      <>
        <path d="M 8 20 L 50 20" stroke="#6FE3FF" strokeWidth={1.5} />
        <path d="M 50 15 L 58 20 L 50 25 Z" fill="#6FE3FF" />
      </>
    ),
  },
  {
    title: 'Came back to an earlier topic',
    text: 'A dashed arc that swings out to the left and points back at the earlier topic. The new circle carries a ↺ badge.',
    sample: (
      <>
        <path d="M 46 34 C 8 34, 8 6, 46 6" fill="none" stroke="#C79BFF" strokeWidth={1.75} strokeDasharray="6 4" />
        <path d="M 46 1.5 L 54 6 L 46 10.5 Z" fill="#C79BFF" />
      </>
    ),
  },
  {
    title: 'Mentioned for later',
    text: 'A hollow dashed ring with a clock, in the right-hand column, joined by a dotted line to where it was raised. Listed under Open threads until someone picks it up.',
    sample: (
      <>
        <path d="M 4 20 L 36 20" stroke="#FFC46B" strokeWidth={2} strokeDasharray="0.5 5" strokeLinecap="round" />
        <circle cx={48} cy={20} r={11} fill="none" stroke="#FFC46B" strokeWidth={2} strokeDasharray="4 3.5" />
        <path d="M 48 14 L 48 20 L 52 23" stroke="#FFC46B" strokeWidth={2} fill="none" />
      </>
    ),
  },
  {
    title: 'Parked thought',
    text: 'The same hollow dashed ring with a pencil: something you typed mid-conversation to come back to.',
    sample: (
      <>
        <circle cx={32} cy={20} r={11} fill="none" stroke="#FFC46B" strokeWidth={2} strokeDasharray="4 3.5" />
        <path d="M 28 25 L 29 21 L 35 15 L 38 18 L 32 24 Z" stroke="#FFC46B" strokeWidth={1.6} fill="none" />
      </>
    ),
  },
  {
    title: 'Picked up later',
    text: 'A faded ring with a check mark: a thread that was deferred and then discussed after all.',
    sample: (
      <>
        <circle
          cx={32}
          cy={20}
          r={11}
          fill="none"
          stroke="#FFC46B"
          strokeWidth={2}
          strokeDasharray="4 3.5"
          opacity={0.7}
        />
        <path d="M 27 20 L 31 24 L 38 16" stroke="#FFC46B" strokeWidth={2} fill="none" opacity={0.7} />
      </>
    ),
  },
  {
    title: 'Highlighted',
    text: 'A gold ring and a ★ badge; lines between highlighted topics are thicker. Shows up in Favourites.',
    sample: (
      <>
        <circle cx={32} cy={20} r={17} fill="none" stroke="#FFD84D" strokeWidth={2.5} />
        <circle cx={32} cy={20} r={12} fill="#6FE3FF" opacity={0.85} />
      </>
    ),
  },
  {
    title: 'Flagged moment',
    text: 'A small flag pin on the topic that was being discussed when someone pressed Flag. A number shows several flags.',
    sample: (
      <>
        <circle cx={30} cy={22} r={12} fill="#6FE3FF" opacity={0.85} />
        <circle cx={42} cy={10} r={8} fill="#070A17" stroke="#FF7A90" strokeWidth={1.5} />
        <path d="M 39 14 L 39 6 L 45 8 L 39 10" stroke="#FF7A90" strokeWidth={1.4} fill="none" />
      </>
    ),
  },
  {
    title: 'Your note',
    text: 'A small sticky card joined to its topic by a thin line.',
    sample: (
      <>
        <rect x={10} y={8} width={44} height={24} rx={4} fill="#2a2614" stroke="#FFD84D" strokeOpacity={0.5} />
        <path d="M 16 16 L 46 16 M 16 23 L 38 23" stroke="#E8ECF8" strokeWidth={1.5} />
      </>
    ),
  },
];

export function LegendSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="What the map shows" testId="legend-sheet">
      <p className="mb-3 text-[13px] text-ink-2">
        Time flows down the screen. Every symbol has a shape or a word as well as a colour.
      </p>
      <ul className="flex flex-col gap-3">
        {LEGEND.map((l) => (
          <li key={l.title} className="flex items-start gap-3">
            <Sample>{l.sample}</Sample>
            <div className="min-w-0">
              <p className="font-semibold">{l.title}</p>
              <p className="text-[13px] leading-snug text-ink-2">{l.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Words for the path tracer banner: "Sunday Service → Historical Jesus → …" */
export function PathBanner({ labels, onClear }: { labels: string[]; onClear(): void }) {
  return (
    <div
      role="status"
      data-testid="path-banner"
      className="surface pointer-events-auto flex items-center gap-2 rounded-[var(--radius)] border border-line py-1 pl-3 pr-1 shadow-lg"
    >
      <Route aria-hidden size={16} className="shrink-0 text-topic" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="font-semibold">How we got here: </span>
        {labels.join(' → ')}
      </p>
      <IconButton label="Clear path" onClick={onClear}>
        <X aria-hidden size={18} />
      </IconButton>
    </div>
  );
}
