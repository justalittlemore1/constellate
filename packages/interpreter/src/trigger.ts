/**
 * When to call the LLM (docs/PLAN.md → When it thinks). Pure functions over the buffered window.
 */
import type { Utterance } from '@constellate/shared';
import { DISCOURSE_MARKER, INTERPRETER } from '@constellate/shared';

export type TriggerReason = 'marker' | 'window' | 'pause' | 'flush';

export function speechMs(window: readonly Utterance[]): number {
  return window.reduce((sum, u) => sum + Math.max(0, u.endMs - u.startMs), 0);
}

export function hasDiscourseMarker(text: string): boolean {
  return DISCOURSE_MARKER.test(text);
}

/**
 * Decide on arrival of `latest` (already appended to `window`) whether to call now.
 * The pause rule is evaluated separately by `pauseDue` because it needs time to pass.
 */
export function triggerOnUtterance(window: readonly Utterance[], latest: Utterance): TriggerReason | null {
  if (window.length === 0) return null;
  if (hasDiscourseMarker(latest.text)) return 'marker';
  if (speechMs(window) >= INTERPRETER.windowSpeechMs) return 'window';
  return null;
}

/**
 * Finals arrive only when an utterance ends, so silence after the last final does not mean nobody is
 * talking. The pause rule is therefore checked when the NEXT utterance arrives (its start is >= pauseMs
 * after the window's end), and a timer only covers real silence of this length.
 */
export const SILENCE_FALLBACK_MS = 12_000;

/** Pause rule on arrival of `next` (not yet in `window`): the gap before it is >= pauseMs. */
export function pauseBefore(window: readonly Utterance[], next: Utterance): boolean {
  if (window.length === 0 || speechMs(window) < INTERPRETER.minSpeechForPauseMs) return false;
  return next.startMs - window[window.length - 1]!.endMs >= INTERPRETER.pauseMs;
}

/** True when the window has enough speech and nothing has arrived for SILENCE_FALLBACK_MS. */
export function pauseDue(window: readonly Utterance[], nowMs: number): boolean {
  if (window.length === 0) return false;
  if (speechMs(window) < INTERPRETER.minSpeechForPauseMs) return false;
  return nowMs - window[window.length - 1]!.endMs >= SILENCE_FALLBACK_MS;
}

/** ms from `nowMs` until the silence fallback could fire for this window, or null if it cannot yet. */
export function msUntilPause(window: readonly Utterance[], nowMs: number): number | null {
  if (window.length === 0 || speechMs(window) < INTERPRETER.minSpeechForPauseMs) return null;
  return Math.max(0, window[window.length - 1]!.endMs + SILENCE_FALLBACK_MS - nowMs);
}
