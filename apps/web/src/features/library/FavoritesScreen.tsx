import { Flag, Highlighter, Map as MapIcon, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { FavoriteMoment } from '../../lib/api';
import { formatClock, formatDate } from '../../lib/format';
import { routes } from '../../lib/routes';
import { ScreenHeader } from '../../ui';
import { PlayMomentButton } from './PlayMomentButton';
import { useConversations, useFavoriteMoments } from './queries';

/** Page title (route stays `/favorites`; the redesign renamed Favourites → Highlights). */
export const HIGHLIGHTS_TITLE = 'Highlights';

/** `/favorites` — favourite conversations, highlighted nodes and flagged moments, each playable. */
export function FavoritesScreen() {
  const conversations = useConversations();
  const moments = useFavoriteMoments();
  const favourites = (conversations.data ?? []).filter((c) => c.isFavorite);
  const highlights = (moments.data ?? []).filter((m) => m.kind === 'highlight');
  const flags = (moments.data ?? []).filter((m) => m.kind === 'flag');

  return (
    <main className="flex h-full flex-col">
      <ScreenHeader title={HIGHLIGHTS_TITLE} />
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {moments.isError && (
          <p role="alert" className="mb-4 text-sm text-flag">
            Couldn’t load your highlights and flags.
          </p>
        )}

        <Section
          id="fav-convs"
          title="Starred conversations"
          icon={<Star aria-hidden size={16} className="text-highlight" />}
          empty="Star a conversation in the library to keep it here."
          loading={conversations.isPending}
          count={favourites.length}
        >
          {favourites.map((c) => (
            <li key={c.id}>
              <Link to={routes.conversation(c.id)} className="hover-wash flex min-h-11 flex-col justify-center py-2">
                <span className="font-semibold">{c.title}</span>
                <span className="text-xs text-ink-2">{formatDate(c.startedAt)}</span>
              </Link>
            </li>
          ))}
        </Section>

        <Section
          id="fav-highlights"
          title="Highlighted topics"
          icon={<Highlighter aria-hidden size={16} className="text-highlight" />}
          empty="Use the highlighter on a map to save topics and branches here."
          loading={moments.isPending}
          count={highlights.length}
        >
          {highlights.map((m) => (
            <MomentRow key={`h-${m.id}`} moment={m} />
          ))}
        </Section>

        <Section
          id="fav-flags"
          title="Flagged moments"
          icon={<Flag aria-hidden size={16} className="text-flag" />}
          empty="Flag a moment during a conversation to find it again here."
          loading={moments.isPending}
          count={flags.length}
        >
          {flags.map((m) => (
            <MomentRow key={`f-${m.id}`} moment={m} />
          ))}
        </Section>
      </div>
    </main>
  );
}

function Section({
  id,
  title,
  icon,
  empty,
  loading,
  count,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  empty: string;
  loading: boolean;
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-2">
        {icon}
        {title}
      </h2>
      {loading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : count === 0 ? (
        <p className="text-sm text-ink-2">{empty}</p>
      ) : (
        <ul className="hairline-list flex flex-col border-y border-line">{children}</ul>
      )}
    </section>
  );
}

function MomentRow({ moment: m }: { moment: FavoriteMoment }) {
  const isFlag = m.kind === 'flag';
  return (
    <li className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          <span className="sr-only">{isFlag ? 'Flagged: ' : 'Highlighted: '}</span>
          {m.label}
        </p>
        <p className="truncate text-xs text-ink-2">
          {m.conversationTitle} · {formatClock(m.atMs)}
        </p>
        {m.summary && <p className="line-clamp-2 text-sm text-ink-2">{m.summary}</p>}
      </div>
      <PlayMomentButton momentKey={`${m.kind}-${m.id}`} audioPath={m.audioPath} atMs={m.atMs} label={m.label} />
      <Link
        to={routes.conversation(m.conversationId, { node: m.nodeId ?? undefined, at: m.atMs })}
        aria-label={`Open ${m.label} in the map`}
        className="hover-wash inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink"
      >
        <MapIcon aria-hidden size={18} />
      </Link>
    </li>
  );
}
