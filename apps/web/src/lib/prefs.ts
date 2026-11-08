import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-device display preferences (Settings). Kept in localStorage; never sent to the server. */
export interface Prefs {
  reduceMotion: boolean;
  lowStimulation: boolean;
  /** 1–1.5, written to `--text-size` */
  textSize: number;
}

interface PrefsStore extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  reset: () => void;
}

export const DEFAULT_PREFS: Prefs = { reduceMotion: false, lowStimulation: false, textSize: 1 };
export const TEXT_SIZE_MIN = 1;
export const TEXT_SIZE_MAX = 1.5;

export function clampTextSize(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(v * 20) / 20));
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      set: (patch) => set((s) => ({ ...s, ...patch, textSize: clampTextSize(patch.textSize ?? s.textSize) })),
      reset: () => set(DEFAULT_PREFS),
    }),
    {
      name: 'constellate.prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ reduceMotion, lowStimulation, textSize }) => ({ reduceMotion, lowStimulation, textSize }),
    },
  ),
);

/** Writes the preferences onto `<html>` so CSS (and canvas code reading CSS vars) can follow them. */
export function applyPrefs(p: Prefs, root: HTMLElement = document.documentElement): void {
  root.dataset.motion = p.reduceMotion ? 'reduce' : 'full';
  root.dataset.lowStim = String(p.lowStimulation);
  root.style.setProperty('--text-size', String(clampTextSize(p.textSize)));
}

/** Mount once near the root. */
export function usePrefsEffect(): void {
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const lowStimulation = usePrefs((s) => s.lowStimulation);
  const textSize = usePrefs((s) => s.textSize);
  useEffect(() => applyPrefs({ reduceMotion, lowStimulation, textSize }), [reduceMotion, lowStimulation, textSize]);
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(cb: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function systemReduced(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

/** True when the OS asks for reduced motion or the user turned on Reduce motion (or low-stimulation). */
export function useMotionReduced(): boolean {
  const system = useSyncExternalStore(subscribeReduced, systemReduced, () => false);
  const setting = usePrefs((s) => s.reduceMotion || s.lowStimulation);
  return system || setting;
}
