import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DiarySheet } from '../features/library/DiarySheet';
import { useGraph } from '../features/library/queries';
import { SavedMap } from '../features/map';
import { formatDate, formatDuration } from '../lib/format';
import { IconButton, ScreenHeader } from '../ui';

/**
 * `/c/:id` — the saved conversation: A4's header and Diary around A3's `<SavedMap>` (map,
 * playback, highlights and notes, `?node=` / `?t=` deep links, evidence quotes). `?diary=1`
 * opens the Diary on arrival (e.g. right after Stop, while the conversation is fresh).
 */
export function ConversationScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const graph = useGraph(id);
  const [diaryOpen, setDiaryOpen] = useState(params.get('diary') === '1');

  if (graph.isError) {
    return (
      <main className="flex h-full flex-col">
        <ScreenHeader title="Conversation" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p role="alert">We couldn’t open this conversation. It may have been deleted.</p>
          <Link to="/" className="inline-flex min-h-11 items-center text-topic underline">
            Go home
          </Link>
        </div>
      </main>
    );
  }

  const g = graph.data;
  const c = g?.conversation;
  return (
    <main className="flex h-full flex-col">
      <ScreenHeader
        title={c?.title ?? 'Conversation'}
        actions={
          <IconButton label="Open diary" aria-haspopup="dialog" disabled={!g} onClick={() => setDiaryOpen(true)}>
            <BookOpen aria-hidden size={22} />
          </IconButton>
        }
      />
      {c ? (
        <p className="-mt-2 px-14 pb-2 text-xs text-ink-2">
          {formatDate(c.startedAt)} · {formatDuration(c.durationMs)}
          {c.status === 'processing' ? ' · still processing' : ''}
        </p>
      ) : (
        <p role="status" className="px-4 text-sm text-ink-2">
          Loading conversation…
        </p>
      )}

      <section aria-label="Conversation map" className="min-h-0 flex-1">
        {g && <SavedMap graph={g} />}
      </section>

      {g && <DiarySheet open={diaryOpen} onClose={() => setDiaryOpen(false)} graph={g} />}
    </main>
  );
}
