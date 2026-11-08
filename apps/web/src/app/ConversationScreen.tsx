import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DiarySheet } from '../features/library/DiarySheet';
import { useGraph } from '../features/library/queries';
import { Button, IconButton, ScreenHeader } from '../ui';

/**
 * `/c/:id` — the saved conversation. A3 owns the map and playback in the body; A4 owns this shell
 * and the Diary sheet. `?diary=1` opens the Diary on arrival (e.g. right after Stop, while the
 * conversation is fresh).
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

  // the layout renders at once (map area included) and fills in when the graph arrives
  const g = graph.data;
  return (
    <main className="flex h-full flex-col">
      <ScreenHeader
        title={g?.conversation.title ?? 'Conversation'}
        actions={
          <IconButton label="Open diary" aria-haspopup="dialog" disabled={!g} onClick={() => setDiaryOpen(true)}>
            <BookOpen aria-hidden size={22} />
          </IconButton>
        }
      />
      {!g && (
        <p role="status" className="px-4 text-sm text-ink-2">
          Loading conversation…
        </p>
      )}

      {/* Map area: replaced by A3's saved-map screen (map, scrubber, toolbar) */}
      <section
        aria-label="Conversation map"
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <p className="text-ink-2 text-sm">Placeholder — built by A3 + A4 (the map lands with A3).</p>
        <Button
          variant="secondary"
          disabled={!g}
          icon={<BookOpen aria-hidden size={18} />}
          onClick={() => setDiaryOpen(true)}
        >
          Open the diary
        </Button>
      </section>

      {g && <DiarySheet open={diaryOpen} onClose={() => setDiaryOpen(false)} graph={g} />}
    </main>
  );
}
