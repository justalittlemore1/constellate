import { useEffect, useRef, useState } from 'react';
import type { Concept } from '../../lib/api';

/** Stars appear brightest first (most mentioned), ties by name so the order is stable. */
export function revealOrder(concepts: Concept[]): string[] {
  return [...concepts].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)).map((c) => c.id);
}

export const REVEAL_PER_STEP = 3;
export const REVEAL_STEP_MS = 160;
/** how long one star takes to fade in */
export const STAR_FADE_MS = 600;

/**
 * After a Generate, concepts appear a few at a time, like stars coming out. `start(order)` begins
 * a reveal; the result maps each revealed id to the time it appeared (for its fade-in), or is
 * `null` when everything is visible. Under reduced motion every star appears at once.
 */
export function useStarReveal(reduced: boolean) {
  const [revealedAt, setRevealedAt] = useState<Map<string, number> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    if (settle.current) clearTimeout(settle.current);
    timer.current = null;
    settle.current = null;
  };
  useEffect(() => stop, []);

  function start(order: string[]) {
    stop();
    if (reduced || order.length === 0) {
      setRevealedAt(null);
      return;
    }
    let shown = 0;
    const step = () => {
      const now = performance.now();
      const next = order.slice(shown, shown + REVEAL_PER_STEP);
      shown += next.length;
      setRevealedAt((prev) => {
        const m = new Map(prev ?? []);
        for (const id of next) m.set(id, now);
        return m;
      });
      if (shown >= order.length) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        // once the last stars have faded in, go back to "everything visible"
        settle.current = setTimeout(() => setRevealedAt(null), STAR_FADE_MS);
      }
    };
    setRevealedAt(new Map());
    step();
    if (shown < order.length) timer.current = setInterval(step, REVEAL_STEP_MS);
  }

  return { revealedAt, start };
}

/** 0–1 fade-in for a star that appeared at `at` (performance.now() time). */
export function starOpacity(at: number | undefined, now: number): number {
  if (at === undefined) return 0;
  return Math.max(0, Math.min(1, (now - at) / STAR_FADE_MS));
}
