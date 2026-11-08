import type { TopicNode } from '@constellate/shared';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DiarySheet } from '../features/library/DiarySheet';
import { useGraph } from '../features/library/queries';
import { ConversationMap } from '../features/map';
import { useApi } from '../lib/api';
import { playMoment, usePlayback } from '../lib/audio';
import { formatDate, formatDuration } from '../lib/format';
import { IconButton, ScreenHeader, useToast } from '../ui';

const MAP_KEY = 'map-';

/**
 * `/c/:id` — the saved conversation: A3's map (nodes, edges, detail levels, outline, legend,
 * detail sheet) under A4's header and Diary. `?diary=1` opens the Diary on arrival (e.g. right
 * after Stop, while the conversation is fresh).
 */
export function ConversationScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const graph = useGraph(id);
  const [diaryOpen, setDiaryOpen] = useState(params.get('diary') === '1');

  const utterances = useQuery({
    queryKey: ['utterances', id],
    queryFn: () => api.listUtterances(id),
    enabled: Boolean(id),
  });
  const audioPath = graph.data?.conversation.audioPath ?? null;
  const audioUrl = useQuery({
    queryKey: ['audio-url', audioPath],
    queryFn: () => api.audioUrl(audioPath),
    enabled: Boolean(audioPath),
    staleTime: 30 * 60_000,
  });

  // one shared player (lib/audio): the node whose moment is playing glows on the map
  const { current } = usePlayback();
  const playingNodeId = current?.startsWith(MAP_KEY) ? current.slice(MAP_KEY.length) : null;
  const url = audioUrl.data ?? null;
  const play = useCallback(
    (n: TopicNode) => {
      if (!url) return;
      playMoment(`${MAP_KEY}${n.id}`, url, n.startMs).catch(() => toast('Couldn’t play the recording.', 'error'));
    },
    [url, toast],
  );

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

      <div className="min-h-0 flex-1">
        {g && (
          <ConversationMap
            state={g}
            activeNodeId={null}
            utterances={utterances.data}
            playingNodeId={playingNodeId}
            onPlaySegment={url ? play : undefined}
          />
        )}
      </div>

      {g && <DiarySheet open={diaryOpen} onClose={() => setDiaryOpen(false)} graph={g} />}
    </main>
  );
}
