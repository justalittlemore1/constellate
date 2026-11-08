import type { GraphState } from '@constellate/shared';
import { BookOpen, List } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DiarySheet } from '../features/library/DiarySheet';
import { useGraph } from '../features/library/queries';
import { SavedMap } from '../features/map';
import { formatDate, formatDuration } from '../lib/format';
import { uiFlag } from '../lib/uiFlags';
import { IconButton, ScreenHeader } from '../ui';

/**
 * Local adapter for A3's controlled `SavedMap` props (A3 PR #72): `view` / `onViewChange`
 * (`'map' | 'list'`, A3's `SavedMapView`; `'list'` shows the outline, and A3's own focus-only Text
 * view link reports through `onViewChange` too) and `revealHold` (an empty sky while true; the
 * reveal starts from the beginning when it flips to false). Until #72 lands the current
 * `SavedMap` ignores them; then switch to A3's exported type and turn on
 * `uiFlags.conversationTextView`.
 */
type SavedMapView = 'map' | 'list';
type SavedMapControls = {
  graph: GraphState;
  view?: SavedMapView;
  onViewChange?: (view: SavedMapView) => void;
  revealHold?: boolean;
};
const ControlledSavedMap = SavedMap as ComponentType<SavedMapControls>;

/**
 * `/c/:id` — the saved conversation: A4's header and Diary around A3's `<SavedMap>` (map,
 * playback, highlights and notes, `?node=` / `?t=` deep links, evidence quotes). `?diary=1`
 * opens the Diary on arrival (e.g. right after Stop, while the conversation is fresh).
 */
export function ConversationScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const graph = useGraph(id);
  const arrivedWithDiary = params.get('diary') === '1';
  const [diaryOpen, setDiaryOpen] = useState(arrivedWithDiary);
  // after a recording (A6 sends you to ?diary=1) the constellation waits until the diary is closed
  // the first time; arriving without the diary reveals at once; reopening it never re-hides the map
  const [revealedOnce, setRevealedOnce] = useState(!arrivedWithDiary);
  const [view, setView] = useState<SavedMapView>('map');
  const closeDiary = () => {
    setDiaryOpen(false);
    setRevealedOnce(true);
  };

  if (graph.isError) {
    return (
      <main className="flex h-full flex-col">
        <ScreenHeader title="Conversation" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p role="alert">We couldn’t open this conversation. It may have been deleted.</p>
          <Link to="/" className="hover-wash inline-flex min-h-11 items-center px-2 text-topic underline">
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
          // Diary, and directly below it the Text view toggle (as on the Brain)
          <div className="flex flex-col items-center" data-testid="conversation-actions">
            <IconButton label="Open diary" aria-haspopup="dialog" disabled={!g} onClick={() => setDiaryOpen(true)}>
              <BookOpen aria-hidden size={22} />
            </IconButton>
            {uiFlag('conversationTextView') && (
              <IconButton
                label="Text view"
                aria-pressed={view === 'list'}
                disabled={!g}
                onClick={() => setView(view === 'list' ? 'map' : 'list')}
                className={view === 'list' ? 'text-thread' : 'text-ink-2'}
              >
                <List aria-hidden size={20} />
              </IconButton>
            )}
          </div>
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
        {g && (
          <ControlledSavedMap graph={g} view={view} onViewChange={setView} revealHold={diaryOpen && !revealedOnce} />
        )}
      </section>

      {g && <DiarySheet open={diaryOpen} onClose={closeDiary} graph={g} />}
    </main>
  );
}
