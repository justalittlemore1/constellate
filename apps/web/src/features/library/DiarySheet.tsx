import type { Commitment, GraphState, TopicNode } from '@constellate/shared';
import { Eye, Map as MapIcon, Pencil, Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { isOpenThread, type RecallCard } from '../../lib/api';
import { formatClock, formatDateTime, formatDuration } from '../../lib/format';
import { routes } from '../../lib/routes';
import { Button, Chip, IconButton, Sheet, TextArea, TextField } from '../../ui';
import { PlayMomentButton } from './PlayMomentButton';
import { composePromise, parsePromise } from './promises';
import {
  useParticipantMutations,
  useParticipants,
  useRecallCards,
  useRecordRecall,
  useUpdateCommitment,
  useUpdateConversation,
} from './queries';

export const REFLECTION_PROMPT = 'What do you want to remember from this?';

/**
 * The Diary on `/c/:id`: title, date, duration, participants, place, the reflection prompt,
 * open threads, promises in if-then form, and recall cards (answer first, then reveal).
 */
export function DiarySheet({ open, onClose, graph }: { open: boolean; onClose: () => void; graph: GraphState }) {
  return (
    <Sheet open={open} onClose={onClose} title="Diary" testId="diary-sheet">
      <DiaryContent graph={graph} />
    </Sheet>
  );
}

function DiaryContent({ graph }: { graph: GraphState }) {
  const c = graph.conversation;
  const update = useUpdateConversation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: c.id, patch });

  const threads = Object.values(graph.nodes)
    .filter(isOpenThread)
    .sort((a, b) => a.seq - b.seq);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="About this conversation" className="flex flex-col gap-3">
        <BlurField label="Title" value={c.title} maxLength={80} onSave={(v) => v.trim() && save({ title: v.trim() })} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-2">Date</dt>
          <dd>{formatDateTime(c.startedAt)}</dd>
          <dt className="text-ink-2">Duration</dt>
          <dd>{formatDuration(c.durationMs)}</dd>
          <dt className="text-ink-2">Type</dt>
          <dd>
            <Chip tone={c.isSolo ? 'revisit' : 'topic'}>{c.isSolo ? 'Solo' : 'Group'}</Chip>
          </dd>
        </dl>
        <Participants conversationId={c.id} />
        <BlurField
          label="Place"
          placeholder="Where were you?"
          value={c.location ?? ''}
          maxLength={80}
          onSave={(v) => save({ location: v.trim() || null })}
        />
        <BlurField
          multiline
          label={REFLECTION_PROMPT}
          placeholder="A sentence or two, while it's fresh."
          value={c.reflection ?? ''}
          maxLength={1000}
          onSave={(v) => save({ reflection: v.trim() || null })}
        />
      </section>

      <section aria-labelledby="threads-h">
        <SectionTitle id="threads-h">Open threads</SectionTitle>
        {threads.length === 0 ? (
          <p className="text-sm text-ink-2">No loose ends — every deferred topic was picked up.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {threads.map((n) => (
              <ThreadRow key={n.id} node={n} conversationId={c.id} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="promises-h">
        <SectionTitle id="promises-h">Promises</SectionTitle>
        {graph.commitments.length === 0 ? (
          <p className="text-sm text-ink-2">No promises were made.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {graph.commitments.map((p) => (
              <PromiseRow key={p.id} promise={p} />
            ))}
          </ul>
        )}
      </section>

      <RecallSection graph={graph} />
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
      {children}
    </h3>
  );
}

/** Text input that saves when it loses focus (or on Enter for single-line fields), only if changed. */
function BlurField({
  label,
  value,
  onSave,
  multiline,
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    // the saved value changed underneath us (e.g. refetch): adopt it
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return multiline ? (
    <TextArea
      label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <TextField
      label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function Participants({ conversationId }: { conversationId: string }) {
  const list = useParticipants([conversationId]);
  const { add, remove } = useParticipantMutations(conversationId);
  const [name, setName] = useState('');
  const headingId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    add.mutate(v.slice(0, 60));
    setName('');
  }

  return (
    <div role="group" aria-labelledby={headingId}>
      <p id={headingId} className="mb-1 text-sm font-semibold text-ink-2">
        Participants
      </p>
      {(list.data ?? []).length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {list.data!.map((p) => (
            <li key={p.id} className="flex items-center rounded-full border border-line pl-3">
              <span className="text-sm">{p.displayName}</span>
              <IconButton label={`Remove ${p.displayName}`} onClick={() => remove.mutate(p.id)}>
                <X aria-hidden size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex items-end gap-1">
        <TextField
          label="Add a participant"
          hideLabel
          placeholder="Add a name"
          className="flex-1"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <IconButton type="submit" label="Add participant" disabled={!name.trim()}>
          <Plus aria-hidden size={20} />
        </IconButton>
      </form>
    </div>
  );
}

function ThreadRow({ node, conversationId }: { node: TopicNode; conversationId: string }) {
  const parked = node.kind === 'parked';
  const at = node.mentionedAtMs ?? node.startMs;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-dashed border-thread/50 py-1 pl-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 font-semibold">
          {parked && <Pencil aria-hidden size={14} className="text-thread" />}
          {node.label}
        </p>
        <p className="text-xs text-ink-2">
          {parked ? 'Parked thought' : 'Deferred, never picked up'} · raised at {formatClock(at)}
        </p>
      </div>
      <Link
        to={routes.conversation(conversationId, { node: node.id })}
        aria-label={`Show ${node.label} on the map`}
        className="inline-flex size-11 items-center justify-center rounded-full text-ink hover:bg-white/10"
      >
        <MapIcon aria-hidden size={18} />
      </Link>
    </li>
  );
}

function PromiseRow({ promise }: { promise: Commitment }) {
  const update = useUpdateCommitment(promise.conversationId);
  const parsed = parsePromise(promise.text);
  const [cue, setCue] = useState(parsed.cue ?? '');
  const doneId = useId();
  const cueId = useId();

  const saveCue = () => {
    if (cue.trim() === (parsed.cue ?? '')) return;
    update.mutate({ id: promise.id, patch: { text: composePromise(cue, parsed.action) } });
  };

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-3">
        <input
          id={doneId}
          type="checkbox"
          checked={promise.done}
          onChange={(e) => update.mutate({ id: promise.id, patch: { done: e.target.checked } })}
          className="mt-0.5 size-6 shrink-0 accent-[var(--topic)]"
          aria-describedby={`${doneId}-text`}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={doneId} className="sr-only">
            Done
          </label>
          <p id={`${doneId}-text`} className={promise.done ? 'text-ink-2 line-through' : ''}>
            <span className="text-ink-2">When </span>
            <label htmlFor={cueId} className="sr-only">
              When should you do this?
            </label>
            <input
              id={cueId}
              value={cue}
              placeholder="___"
              maxLength={80}
              onChange={(e) => setCue(e.target.value)}
              onBlur={saveCue}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className="min-h-11 w-40 border-b border-dashed border-thread/70 bg-transparent px-1 text-thread placeholder:text-thread/70"
            />
            <span className="text-ink-2">, I will </span>
            {parsed.action}
          </p>
          <p className="mt-1 text-xs text-ink-2">Said at {formatClock(promise.atMs)}</p>
        </div>
      </div>
    </li>
  );
}

function RecallSection({ graph }: { graph: GraphState }) {
  const cards = useRecallCards(graph.conversation.id);
  return (
    <section aria-labelledby="recall-h">
      <SectionTitle id="recall-h">Recall cards</SectionTitle>
      {cards.isPending ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : (cards.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-2">Recall cards appear once the conversation has been processed.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.data!.map((card) => (
            <RecallCardItem key={card.id} card={card} graph={graph} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecallCardItem({ card, graph }: { card: RecallCard; graph: GraphState }) {
  const record = useRecordRecall(card.conversationId);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const node = card.nodeId ? graph.nodes[card.nodeId] : undefined;

  return (
    <li className="rounded-xl border border-revisit/40 p-3">
      <p className="mb-2 font-semibold">{card.prompt}</p>
      {!revealed ? (
        <>
          <TextArea
            label="Your answer"
            placeholder="Answer from memory first"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button className="mt-2" icon={<Eye aria-hidden size={18} />} onClick={() => setRevealed(true)}>
            Reveal
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {answer.trim() && (
            <p className="text-sm">
              <span className="text-ink-2">You said: </span>
              {answer.trim()}
            </p>
          )}
          {node ? (
            <div className="flex items-center gap-2 rounded-lg bg-white/5 p-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{node.label}</p>
                <p className="text-sm text-ink-2">{node.summary}</p>
              </div>
              <PlayMomentButton
                momentKey={`recall-${card.id}`}
                audioPath={graph.conversation.audioPath}
                atMs={node.startMs}
                label={node.label}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-2">The moment for this card is no longer on the map.</p>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="How did you do?">
            <Button
              aria-pressed={card.lastResult === 'remembered'}
              onClick={() => record.mutate({ id: card.id, result: 'remembered' })}
            >
              I remembered
            </Button>
            <Button
              aria-pressed={card.lastResult === 'forgot'}
              onClick={() => record.mutate({ id: card.id, result: 'forgot' })}
            >
              I forgot
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
