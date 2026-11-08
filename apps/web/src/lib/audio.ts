import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * One shared <audio> element for "play this moment" buttons outside the map (diary recall cards,
 * Favourites, Brain occurrences). Starting a new moment stops the previous one.
 * Playback starts 1 s before the moment, as on the map.
 */
export const PLAY_PADDING_MS = 1000;

type Listener = () => void;
let audio: HTMLAudioElement | null = null;
let playingKey: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      playingKey = null;
      emit();
    });
    audio.addEventListener('pause', () => {
      playingKey = null;
      emit();
    });
  }
  return audio;
}

export function startSeconds(atMs: number): number {
  return Math.max(0, atMs - PLAY_PADDING_MS) / 1000;
}

export async function playMoment(key: string, url: string, atMs: number): Promise<void> {
  const el = element();
  if (el.src !== url) el.src = url;
  const seek = () => {
    el.currentTime = startSeconds(atMs);
  };
  if (el.readyState >= 1) seek();
  else el.addEventListener('loadedmetadata', seek, { once: true });
  playingKey = key;
  emit();
  try {
    await el.play();
  } catch (err) {
    playingKey = null;
    emit();
    throw err;
  }
}

export function stopPlayback(): void {
  audio?.pause();
  playingKey = null;
  emit();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Which moment (if any) is playing; stops playback when the calling screen unmounts. */
export function usePlayback() {
  const current = useSyncExternalStore(
    subscribe,
    () => playingKey,
    () => null,
  );
  useEffect(() => () => stopPlayback(), []);
  const isPlaying = useCallback((key: string) => current === key, [current]);
  return { current, isPlaying };
}
