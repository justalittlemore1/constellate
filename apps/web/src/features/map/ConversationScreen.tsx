/**
 * `/c/:id` — the saved map (A4 wires the route: `<Route path="/c/:id" element={<ConversationScreen />} />`).
 * Loads the graph (`api.getGraph` → `GET /conversations/:id`) and the transcript, renders the map
 * and plays a node's moment from the recording (signed URL) starting 1 s before it.
 * `?node=<id>` opens on that node; the playback scrubber comes in phase 2.
 */
import { topicAt, type TopicNode } from '@constellate/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../../lib/api';
import { formatDate, formatDuration } from '../../lib/format';
import { Button, ScreenHeader } from '../../ui';
import { ConversationMap } from './ConversationMap';

const PLAY_PADDING_MS = 1000;

export function ConversationScreen() {
  const { id = '' } = useParams();
  const api = useApi();
  const graph = useQuery({ queryKey: ['graph', id], queryFn: () => api.getGraph(id), enabled: Boolean(id) });
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

  const audio = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const state = graph.data;
  const canPlay = Boolean(audioUrl.data);

  useEffect(() => {
    const el = audio.current;
    if (!el || !state) return;
    const onTime = () => setPlayingId(el.paused ? null : (topicAt(state, el.currentTime * 1000)?.id ?? null));
    const onStop = () => setPlayingId(null);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('pause', onStop);
    el.addEventListener('ended', onStop);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('pause', onStop);
      el.removeEventListener('ended', onStop);
    };
  }, [state, canPlay]);

  const play = useCallback((n: TopicNode) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, (n.startMs - PLAY_PADDING_MS) / 1000);
    void el.play().catch(() => setPlayingId(null));
  }, []);

  if (graph.isPending) {
    return (
      <main className="flex h-full flex-col">
        <ScreenHeader title="Loading…" />
        <p role="status" className="flex-1 px-6 pt-10 text-center text-ink-2">
          Loading the map…
        </p>
      </main>
    );
  }
  if (graph.isError || !state) {
    return (
      <main className="flex h-full flex-col">
        <ScreenHeader title="Conversation" />
        <div role="alert" className="flex flex-1 flex-col items-center gap-3 px-6 pt-10 text-center">
          <p>We couldn't load this conversation.</p>
          <Button onClick={() => void graph.refetch()}>Try again</Button>
        </div>
      </main>
    );
  }

  const c = state.conversation;
  return (
    <main className="flex h-full flex-col">
      <ScreenHeader title={c.title} />
      <p className="-mt-2 px-14 pb-2 text-[11.5px] text-ink-2">
        {formatDate(c.startedAt)} · {formatDuration(c.durationMs)}
        {c.status === 'processing' ? ' · still processing' : ''}
      </p>
      <div className="min-h-0 flex-1">
        <ConversationMap
          state={state}
          activeNodeId={null}
          utterances={utterances.data}
          playingNodeId={playingId}
          onPlaySegment={canPlay ? play : undefined}
        />
      </div>
      {canPlay && <audio ref={audio} src={audioUrl.data ?? undefined} preload="metadata" className="hidden" />}
    </main>
  );
}
