import { Pause, Play, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lineAt, stopPlayback, togglePause, usePlaybackState } from '../lib/audio';
import { formatClock } from '../lib/format';
import { useMotionReduced } from '../lib/prefs';
import { IconButton } from '../ui';
import { overlayRoot } from '../ui/Sheet';

export const TRANSCRIPT_LABEL = 'Transcript · no audio recorded';

/**
 * Rendered once in the app shell. While a moment plays as a transcript (no recording), shows its
 * utterances one after another with the time, Pause / Resume and Stop. It sits in the overlay
 * layer (usable above an open sheet), at the top so it never covers a bottom sheet. Escape stops
 * it when no dialog is open or when focus is in the bar (otherwise Escape closes the dialog).
 * Under reduced motion the progress line doesn't animate; the caption and time still update.
 */
export function NowPlayingBar() {
  const s = usePlaybackState();
  const reduced = useMotionReduced();
  const bar = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setRoot(overlayRoot()), []);
  const active = s.mode === 'transcript' && s.clip !== null;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inBar = bar.current?.contains(document.activeElement) ?? false;
      const dialogOpen = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
      if (inBar || !dialogOpen) stopPlayback();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active || !root || !s.clip) return null;
  const at = s.atMs ?? s.clip.fromMs;
  const line = lineAt(s.clip, at);
  const progress = Math.min(1, Math.max(0, (at - s.clip.fromMs) / (s.clip.toMs - s.clip.fromMs)));

  return createPortal(
    <div
      ref={bar}
      role="region"
      aria-label="Now playing"
      data-testid="now-playing"
      className="surface star-frame absolute inset-x-0 top-0 z-50 border-b border-line px-4 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-xs font-semibold text-thread">{TRANSCRIPT_LABEL}</p>
          {/* polite: each new line is read once, without interrupting */}
          <p aria-live="polite" data-testid="now-playing-line" className="line-clamp-2 min-h-[1.4em] text-sm">
            {line ? line.text : s.clip.lines.length ? '…' : 'No transcript for this moment.'}
          </p>
          <p className="text-xs text-ink-2 tabular-nums">
            <span className="sr-only">Position </span>
            {formatClock(at)} <span aria-hidden>/</span>
            <span className="sr-only"> of </span> {formatClock(s.clip.toMs)}
          </p>
        </div>
        <IconButton label={s.paused ? 'Resume' : 'Pause'} onClick={togglePause}>
          {s.paused ? <Play aria-hidden size={18} /> : <Pause aria-hidden size={18} />}
        </IconButton>
        <IconButton label="Stop" onClick={stopPlayback}>
          <Square aria-hidden size={16} />
        </IconButton>
      </div>
      <div aria-hidden className="mt-1 h-px w-full bg-line">
        <div
          data-testid="now-playing-progress"
          className="h-px bg-thread"
          style={{ width: `${progress * 100}%`, transition: reduced ? 'none' : 'width 250ms linear' }}
        />
      </div>
    </div>,
    root,
  );
}
