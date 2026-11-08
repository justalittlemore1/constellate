/**
 * <SavedMap graph={g} /> — the body of `/c/:id` (A4 mounts it in its ConversationScreen shell, in
 * the "Conversation map" section). Adds to <ConversationMap>:
 *  - "Play this moment" through A4's shared player (`lib/audio`, 1 s padding); the node being heard glows
 *  - user edits (Highlight, highlighter mode, sticky notes) as optimistic `source: 'user'` ops
 *  - deep links: `?node=<id>` selects and centres that node; `?t=<ms>` selects the topic covering
 *    that time and makes its Play start there (no autoplay: browsers block it and it would surprise)
 *  - evidence quotes from the transcript
 */
import { topicAt, type GraphOp, type GraphState, type TopicNode, type Utterance } from '@constellate/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../../lib/api';
import * as sharedAudio from '../../lib/audio';
import { playMoment, stopPlayback, usePlayback } from '../../lib/audio';
import { useToast } from '../../ui';
import { ConversationMap, type MapView } from './ConversationMap';
import { useUserOps } from './userOps';

export interface DeepLink {
  nodeId: string | null;
  atMs: number | null;
}

/** Reads `?node=` and `?t=` (ms, as written by `routes.conversation`). */
export function parseDeepLink(params: URLSearchParams): DeepLink {
  const t = params.get('t');
  const atMs = t !== null && /^\d+$/.test(t) ? Number(t) : null;
  return { nodeId: params.get('node') || null, atMs };
}

/** The node to open: `?node=` if it exists, else the topic being discussed at `?t=`. */
export function deepLinkTarget(state: GraphState, link: DeepLink): TopicNode | null {
  if (link.nodeId && state.nodes[link.nodeId]) return state.nodes[link.nodeId]!;
  if (link.atMs !== null) {
    const at = topicAt(state, link.atMs);
    if (at) return at;
    // past the last topic's end, or a gap: the latest topic that started before it
    let best: TopicNode | null = null;
    for (const n of Object.values(state.nodes)) {
      if (n.kind === 'topic' && n.startMs <= link.atMs && (!best || n.startMs > best.startMs)) best = n;
    }
    return best;
  }
  return null;
}

/** Where Play starts for a node: the deep-linked time inside it, otherwise the node's start. */
export function playStartMs(node: TopicNode, link: DeepLink, target: TopicNode | null): number {
  if (link.atMs !== null && target?.id === node.id && link.atMs >= node.startMs) return link.atMs;
  return node.startMs;
}

/** What A4's header button switches between: the star map, or the nodes as a list (the outline). */
export type SavedMapView = 'map' | 'list';

export interface SavedMapProps {
  graph: GraphState;
  /** controlled view: 'list' shows the nodes as an accessible list (the outline); default 'map' */
  view?: SavedMapView;
  /** called when the view changes from inside the map (the focus-only "Text view" / "Map view" link) */
  onViewChange?: (view: SavedMapView) => void;
  /**
   * While true, the sky stays empty (no stars, no lines, nothing focusable on the canvas); when it
   * turns false the one-by-one reveal starts from the beginning. A4: `diaryOpen && !revealedOnce`.
   */
  revealHold?: boolean;
}

/**
 * Local adapter for A4's transcript playback in `lib/audio` (timed captions in the now-playing
 * bar, "Transcript · no audio recorded"). Until A4 confirms the API it feature-detects
 * `playTranscript({ key, startMs, endMs, utterances })`; resolves false when it isn't there yet.
 */
export async function playTranscriptMoment(moment: {
  key: string;
  startMs: number;
  endMs: number | null;
  utterances: Utterance[];
}): Promise<boolean> {
  const play = (sharedAudio as Record<string, unknown>).playTranscript;
  if (typeof play !== 'function') return false;
  await (play as (m: typeof moment) => Promise<void> | void)(moment);
  return true;
}

export function SavedMap({ graph, view, onViewChange, revealHold = false }: SavedMapProps) {
  const api = useApi();
  const toast = useToast();
  const [params] = useSearchParams();
  const id = graph.conversation.id;
  const link = useMemo(() => parseDeepLink(params), [params]);
  const target = useMemo(() => deepLinkTarget(graph, link), [graph, link]);
  const utterances = useQuery({ queryKey: ['utterances', id], queryFn: () => api.listUtterances(id) });
  const audioPath = graph.conversation.audioPath;
  const { current } = usePlayback();
  const submit = useUserOps(id);

  const onEdit = useCallback(
    (ops: GraphOp[]) => {
      submit(ops).catch(() => toast('Couldn’t save that change. The map shows what is saved.', 'error'));
    },
    [submit, toast],
  );

  const onPlay = useCallback(
    async (n: TopicNode) => {
      if (current === n.id) {
        stopPlayback();
        return;
      }
      try {
        const url = audioPath ? await api.audioUrl(audioPath) : null;
        if (url) {
          await playMoment(n.id, url, playStartMs(n, link, target));
          return;
        }
        // no recording (mock mode, or not uploaded yet): A4's shared player plays the transcript
        const said = (utterances.data ?? []).filter((u) => n.utteranceIds.includes(u.id));
        const played = await playTranscriptMoment({
          key: n.id,
          startMs: playStartMs(n, link, target),
          endMs: n.endMs,
          utterances: said,
        });
        if (!played) toast('No recording is available for this conversation.', 'error');
      } catch {
        toast('Couldn’t play this moment.', 'error');
      }
    },
    [current, api, audioPath, toast, link, target, utterances.data],
  );

  return (
    <ConversationMap
      state={graph}
      activeNodeId={null}
      utterances={utterances.data}
      playingNodeId={current && graph.nodes[current] ? current : null}
      // always offered: real audio when there is a recording, the transcript (A4's player) when not
      onPlaySegment={(n) => void onPlay(n)}
      onEdit={onEdit}
      focusNodeId={target?.id ?? null}
      reveal
      revealHold={revealHold}
      {...(view !== undefined ? { view: view === 'list' ? ('outline' as const) : ('map' as const) } : {})}
      {...(onViewChange ? { onViewChange: (v: MapView) => onViewChange(v === 'outline' ? 'list' : 'map') } : {})}
    />
  );
}
