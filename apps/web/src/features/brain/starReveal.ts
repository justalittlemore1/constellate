import { useEffect, useRef, useState } from 'react';
import type { Concept } from '../../lib/api';

/** Stars appear brightest first (most mentioned), ties by name so the order is stable. */
export function revealOrder(concepts: Concept[]): string[] {
  return [...concepts].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)).map((c) => c.id);
}

/** the whole star phase takes about this long, whatever the size of the Brain */
export const REVEAL_TOTAL_MS = 2400;
/** how long one star takes to fade (and scale) in */
export const STAR_FADE_MS = 600;
/** how long the links take to draw in, once every star is out */
export const LINK_DRAW_MS = 700;
const MAX_STEPS = 12;

/** A few stars per step so the reveal lasts ~2.4 s: 8 concepts → 1 every 300 ms, 100 → 9 every 200 ms. */
export function revealPlan(count: number): { perStep: number; stepMs: number; steps: number } {
  if (count <= 0) return { perStep: 0, stepMs: 0, steps: 0 };
  const perStep = Math.max(1, Math.ceil(count / MAX_STEPS));
  const steps = Math.ceil(count / perStep);
  const stepMs = Math.round(Math.min(400, Math.max(120, REVEAL_TOTAL_MS / steps)));
  return { perStep, stepMs, steps };
}

export interface RevealState {
  /** when each revealed concept appeared (performance.now() time); null = everything visible */
  revealedAt: Map<string, number> | null;
  /** when the links start drawing in (after the last star has faded in); null = not yet */
  linksFrom: number | null;
}

const ALL_VISIBLE: RevealState = { revealedAt: null, linksFrom: null };

/**
 * After a Generate, stars appear a few at a time (each fading and scaling in), then the links draw
 * in, then everything settles to "all visible". Under reduced motion it is all there at once.
 */
export function useStarReveal(reduced: boolean, { startHidden = false }: { startHidden?: boolean } = {}) {
  // `startHidden`: nothing shows until `start` (so a reveal on entry doesn't flash the whole sky first)
  const [state, setState] = useState<RevealState>(() =>
    startHidden && !reduced ? { revealedAt: new Map(), linksFrom: null } : ALL_VISIBLE,
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => stop, []);

  function start(order: string[]) {
    stop();
    if (reduced || order.length === 0) {
      setState(ALL_VISIBLE);
      return;
    }
    const { perStep, stepMs } = revealPlan(order.length);
    let shown = 0;
    const step = () => {
      const now = performance.now();
      const next = order.slice(shown, shown + perStep);
      shown += next.length;
      setState((prev) => {
        const m = new Map(prev.revealedAt ?? []);
        for (const id of next) m.set(id, now);
        return { revealedAt: m, linksFrom: null };
      });
      if (shown >= order.length) {
        if (interval.current) clearInterval(interval.current);
        interval.current = null;
        // links draw in once the last star has faded in; then settle to "all visible"
        const linksFrom = now + STAR_FADE_MS;
        timers.current.push(
          setTimeout(() => setState((prev) => ({ ...prev, linksFrom })), STAR_FADE_MS),
          setTimeout(() => setState(ALL_VISIBLE), STAR_FADE_MS + LINK_DRAW_MS),
        );
      }
    };
    setState({ revealedAt: new Map(), linksFrom: null });
    step();
    if (shown < order.length) interval.current = setInterval(step, stepMs);
  }

  return { ...state, start };
}

/** 0–1 fade-in for a star that appeared at `at` (performance.now() time). */
export function starOpacity(at: number | undefined, now: number): number {
  if (at === undefined) return 0;
  return Math.max(0, Math.min(1, (now - at) / STAR_FADE_MS));
}

/** 0–1 draw-in for links that started at `from`. */
export function linkProgress(from: number | null, now: number): number {
  if (from === null) return 0;
  return Math.max(0, Math.min(1, (now - from) / LINK_DRAW_MS));
}
