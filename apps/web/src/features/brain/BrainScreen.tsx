import { List, Orbit, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Starfield } from '../../app/Starfield';
import type { BrainPayload, Concept } from '../../lib/api';
import { useMotionReduced, usePrefs } from '../../lib/prefs';
import { Button, cx, IconButton, ScreenHeader, TextField, useToast } from '../../ui';
import { BrainCanvas } from './BrainCanvas';
import { ConceptSheet } from './ConceptSheet';
import { useBrain, useConceptSearch, useRebuildBrain } from './queries';

type View = 'galaxy' | 'list';

/**
 * `/brain` — every finished conversation folded into one concept graph. The galaxy is the visual
 * view; the list view is the keyboard / screen-reader path (and the default in low-stimulation).
 * Arriving with `state.rebuild` (the library's Generate Brain button) starts a rebuild.
 */
export function BrainScreen() {
  const brain = useBrain();
  const rebuild = useRebuildBrain();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useMotionReduced();
  const lowStim = usePrefs((s) => s.lowStimulation);
  const [view, setView] = useState<View>(lowStim ? 'list' : 'galaxy');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const generate = () =>
    rebuild.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          r.conversations === 0
            ? 'Your Brain is up to date.'
            : `Added ${r.conversations} ${r.conversations === 1 ? 'conversation' : 'conversations'} · ${r.newConcepts} new ${r.newConcepts === 1 ? 'concept' : 'concepts'}.`,
          'success',
        ),
    });

  const autoStarted = useRef(false);
  useEffect(() => {
    if ((location.state as { rebuild?: boolean } | null)?.rebuild && !autoStarted.current) {
      autoStarted.current = true;
      generate();
      navigate(location.pathname, { replace: true, state: null });
    }
    // run once on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payload = brain.data;
  const selected = payload?.concepts.find((c) => c.id === selectedId) ?? null;

  return (
    <main className="relative flex h-full flex-col overflow-hidden">
      {!lowStim && <Starfield count={90} />}
      <div className="relative z-10 flex h-full flex-col">
        <ScreenHeader
          title="Brain"
          actions={
            <IconButton label="Generate Brain" onClick={generate} disabled={rebuild.isPending}>
              <Sparkles aria-hidden size={20} />
            </IconButton>
          }
        />

        {rebuild.isPending && (
          <div role="status" className="mx-4 mb-2 rounded-xl border border-revisit/40 p-3 text-sm">
            <p className="mb-2 font-semibold">Generating your Brain…</p>
            <p className="mb-2 text-ink-2">Folding each finished conversation’s topics into shared concepts.</p>
            <progress aria-label="Generating your Brain" className="h-2 w-full accent-[var(--revisit)]" />
          </div>
        )}
        {rebuild.isError && (
          <p role="alert" className="mx-4 mb-2 text-sm text-flag">
            Couldn’t generate the Brain: {rebuild.error.message}
          </p>
        )}

        {brain.isPending ? (
          <p role="status" className="px-4 text-ink-2">
            Loading your Brain…
          </p>
        ) : brain.isError ? (
          <p role="alert" className="px-4 text-sm text-flag">
            Couldn’t load your Brain.
          </p>
        ) : payload!.concepts.length === 0 ? (
          <EmptyBrain onGenerate={generate} busy={rebuild.isPending} />
        ) : (
          <>
            <div className="flex flex-col gap-2 px-4 pb-2">
              <ConceptSearch onSelect={setSelectedId} />
              <div role="group" aria-label="View" className="flex gap-1 self-start rounded-full border border-line p-1">
                <ViewButton
                  pressed={view === 'galaxy'}
                  onClick={() => setView('galaxy')}
                  icon={<Orbit aria-hidden size={16} />}
                >
                  Galaxy
                </ViewButton>
                <ViewButton
                  pressed={view === 'list'}
                  onClick={() => setView('list')}
                  icon={<List aria-hidden size={16} />}
                >
                  List
                </ViewButton>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              {view === 'galaxy' ? (
                <>
                  <BrainCanvas payload={payload!} selectedId={selectedId} onSelect={setSelectedId} reduced={reduced} />
                  <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-ink-2">
                    {payload!.concepts.length} concepts · tap one to explore · List view for keyboard
                  </p>
                </>
              ) : (
                <ConceptList payload={payload!} onSelect={setSelectedId} />
              )}
            </div>
          </>
        )}
      </div>

      {payload && (
        <ConceptSheet
          payload={payload}
          concept={selected}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
        />
      )}
    </main>
  );
}

function ViewButton({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold',
        pressed ? 'bg-topic/20 text-topic' : 'text-ink-2 hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyBrain({ onGenerate, busy }: { onGenerate: () => void; busy: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <h2 className="text-xl font-semibold">Your Brain is empty</h2>
      <p className="text-ink-2">
        Generate it to fold your finished conversations into one map of the ideas you keep coming back to.
      </p>
      <Button variant="brain" icon={<Sparkles aria-hidden size={18} />} onClick={onGenerate} disabled={busy}>
        Generate Brain
      </Button>
    </div>
  );
}

/** Keyboard and screen-reader path: concepts by mention count, each opening the concept sheet. */
function ConceptList({ payload, onSelect }: { payload: BrainPayload; onSelect: (id: string) => void }) {
  const sorted = useMemo(
    () => [...payload.concepts].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)),
    [payload.concepts],
  );
  return (
    <section aria-label="All concepts" className="h-full overflow-y-auto px-4 pb-8">
      <ul className="flex flex-col gap-2">
        {sorted.map((c) => (
          <li key={c.id}>
            <ConceptButton concept={c} onSelect={onSelect} links={countLinks(payload, c.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function countLinks(payload: BrainPayload, id: string): number {
  const s = new Set<string>();
  for (const l of payload.links) {
    if (l.sourceId === id) s.add(l.targetId);
    if (l.targetId === id) s.add(l.sourceId);
  }
  return s.size;
}

function ConceptButton({
  concept: c,
  onSelect,
  links,
}: {
  concept: Concept;
  onSelect: (id: string) => void;
  links: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      className="surface flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left hover:border-topic/60"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{c.name}</span>
        {c.description && <span className="line-clamp-1 text-sm text-ink-2">{c.description}</span>}
      </span>
      <span className="shrink-0 text-right text-xs text-ink-2">
        {c.mentionCount} {c.mentionCount === 1 ? 'mention' : 'mentions'}
        <br />
        {links} {links === 1 ? 'connection' : 'connections'}
      </span>
    </button>
  );
}

function ConceptSearch({ onSelect }: { onSelect: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const results = useConceptSearch(query);

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery(draft.trim());
  }

  return (
    <div>
      <form role="search" onSubmit={submit} className="flex items-end gap-1">
        <TextField
          label="Search concepts"
          hideLabel
          type="search"
          placeholder="Search by meaning, e.g. “meaning of life”"
          className="flex-1"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value) setQuery('');
          }}
        />
        <IconButton type="submit" label="Search" disabled={!draft.trim()}>
          <Search aria-hidden size={20} />
        </IconButton>
      </form>
      {query && (
        <div aria-live="polite" className="mt-2">
          {results.isPending ? (
            <p className="text-sm text-ink-2">Searching…</p>
          ) : results.isError ? (
            <p className="text-sm text-flag">Search is unavailable right now.</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-2">No concepts match “{query}”.</p>
          ) : (
            <ul aria-label={`Results for ${query}`} className="flex flex-wrap gap-2">
              {results.data!.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className="min-h-11 rounded-full border border-topic/50 px-3 text-sm font-semibold text-topic"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
