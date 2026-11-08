import type { Utterance } from '@constellate/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useApi } from './api';

/**
 * The one shared player for "play this moment" everywhere (map node sheet via A3, Diary recall
 * cards, Highlights, Brain occurrences). Starting a new moment stops the previous one.
 *
 *  - **audio**: when there is a recording URL, one shared <audio> element plays from 1 s before
 *    the moment (unchanged from before).
 *  - **transcript**: when there isn't (the demo and seeded conversations have no audio), the moment
 *    plays honestly as timed captions: the clock runs for the clip's real duration
 *    (startMs − 1 s … endMs + 1 s) and the span's utterances appear one after another in the
 *    now-playing bar (`NowPlayingBar`), labelled "Transcript · no audio recorded".
 *
 * `usePlayback()` reports the same state either way (`current` = the playing key), so the
 * "playing" glow works for both.
 */
export const PLAY_PADDING_MS = 1000;
/** clip length when a moment has no end (a flag, an open thread) */
export const DEFAULT_CLIP_MS = 20_000;
const TICK_MS = 250;

export type PlaybackMode = 'audio' | 'transcript';

export interface TranscriptClip {
  /** the span being played, padded by 1 s each side */
  fromMs: number;
  toMs: number;
  /** utterances overlapping the span, in time order */
  lines: Utterance[];
}

export interface PlaybackState {
  /** the playing moment's key (A3 uses the node id), or null */
  current: string | null;
  mode: PlaybackMode | null;
  /** position on the conversation clock, ms */
  atMs: number | null;
  paused: boolean;
  /** transcript mode only */
  clip: TranscriptClip | null;
}

const IDLE: PlaybackState = { current: null, mode: null, atMs: null, paused: false, clip: null };

type Listener = () => void;
let state: PlaybackState = IDLE;
const listeners = new Set<Listener>();
let audio: HTMLAudioElement | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** transcript clock: performance.now() when the current run started, and the position then */
let runStartedAt = 0;
let runStartMs = 0;

function set(next: PlaybackState) {
  state = next;
  for (const l of listeners) l();
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      if (state.mode === 'audio') set(IDLE);
    });
    audio.addEventListener('pause', () => {
      if (state.mode === 'audio') set(IDLE);
    });
    audio.addEventListener('timeupdate', () => {
      if (state.mode === 'audio' && audio) set({ ...state, atMs: audio.currentTime * 1000 });
    });
  }
  return audio;
}

export function startSeconds(atMs: number): number {
  return Math.max(0, atMs - PLAY_PADDING_MS) / 1000;
}

/** Play a recording from 1 s before `atMs`. */
export async function playMoment(key: string, url: string, atMs: number): Promise<void> {
  stopTicker();
  const el = element();
  if (el.src !== url) el.src = url;
  const seek = () => {
    el.currentTime = startSeconds(atMs);
  };
  if (el.readyState >= 1) seek();
  else el.addEventListener('loadedmetadata', seek, { once: true });
  set({ current: key, mode: 'audio', atMs: Math.max(0, atMs - PLAY_PADDING_MS), paused: false, clip: null });
  try {
    await el.play();
  } catch (err) {
    set(IDLE);
    throw err;
  }
}

/** The span a transcript clip covers and the utterances in it. */
export function transcriptClip(startMs: number, endMs: number | null, utterances: Utterance[]): TranscriptClip {
  const fromMs = Math.max(0, startMs - PLAY_PADDING_MS);
  const toMs = (endMs ?? startMs + DEFAULT_CLIP_MS) + PLAY_PADDING_MS;
  const lines = utterances.filter((u) => u.endMs > fromMs && u.startMs < toMs).sort((a, b) => a.startMs - b.startMs);
  return { fromMs, toMs, lines };
}

/** The utterance being "heard" at `atMs` (the last one that has started), or null before the first. */
export function lineAt(clip: TranscriptClip, atMs: number): Utterance | null {
  let line: Utterance | null = null;
  for (const u of clip.lines) if (u.startMs <= atMs) line = u;
  // during the 1 s lead-in nothing has started yet: show the first line, not "no transcript"
  return line ?? clip.lines[0] ?? null;
}

function tick() {
  if (state.mode !== 'transcript' || state.paused || !state.clip) return;
  const atMs = runStartMs + (performance.now() - runStartedAt);
  if (atMs >= state.clip.toMs) {
    stopTicker();
    set(IDLE);
    return;
  }
  set({ ...state, atMs });
}

/**
 * Play a moment as timed captions (no recording). The signature A3 calls:
 * `playTranscript({ key, startMs, endMs, utterances })`.
 */
export function playTranscript({
  key,
  startMs,
  endMs,
  utterances,
}: {
  key: string;
  startMs: number;
  endMs: number | null;
  utterances: Utterance[];
}): void {
  if (state.mode === 'audio') audio?.pause();
  stopTicker();
  const clip = transcriptClip(startMs, endMs, utterances);
  runStartedAt = performance.now();
  runStartMs = clip.fromMs;
  set({ current: key, mode: 'transcript', atMs: clip.fromMs, paused: false, clip });
  ticker = setInterval(tick, TICK_MS);
}

/** Pause or resume a transcript clip (audio pauses end playback, as before). */
export function togglePause(): void {
  if (state.mode !== 'transcript' || !state.clip) return;
  if (state.paused) {
    runStartedAt = performance.now();
    runStartMs = state.atMs ?? state.clip.fromMs;
    set({ ...state, paused: false });
    ticker = setInterval(tick, TICK_MS);
  } else {
    tick();
    stopTicker();
    set({ ...state, paused: true });
  }
}

export function stopPlayback(): void {
  stopTicker();
  if (state.mode === 'audio') audio?.pause();
  set(IDLE);
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The playback state without side effects (the now-playing bar). */
export function usePlaybackState(): PlaybackState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => IDLE,
  );
}

/** Which moment (if any) is playing, in either mode; stops playback when the calling screen unmounts. */
export function usePlayback() {
  const { current, mode, atMs } = usePlaybackState();
  useEffect(() => () => stopPlayback(), []);
  const isPlaying = useCallback((key: string) => current === key, [current]);
  return { current, mode, atMs, isPlaying };
}

export interface MomentToPlay {
  key: string;
  conversationId: string;
  startMs: number;
  endMs: number | null;
  audioPath: string | null;
  /** pass them when you have them; otherwise they're fetched */
  utterances?: Utterance[];
}

/**
 * Convenience for callers with the API at hand (Highlights, Brain, Diary): plays the recording when
 * there is one, otherwise the transcript (using `utterances` or `api.listUtterances`).
 */
export function usePlayMoment() {
  const api = useApi();
  return useCallback(
    async (m: MomentToPlay) => {
      const url = m.audioPath ? await api.audioUrl(m.audioPath).catch(() => null) : null;
      if (url) {
        await playMoment(m.key, url, m.startMs);
        return;
      }
      const utterances = m.utterances ?? (await api.listUtterances(m.conversationId).catch(() => []));
      playTranscript({ key: m.key, startMs: m.startMs, endMs: m.endMs, utterances });
    },
    [api],
  );
}
