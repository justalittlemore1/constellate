/**
 * Live map following. The map follows the newest star; a pan or pinch by the user stops that, and
 * after `resumeMs` with no further touch it follows again (no "Jump to now" chip needed).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_FOLLOW_RESUME_MS } from './flags';

export interface AutoFollow {
  following: boolean;
  /** a user gesture started moving the map */
  onUserMoveStart(): void;
  /** the user gesture ended: start the countdown */
  onUserMoveEnd(): void;
  /** any touch while not following restarts the countdown */
  onTouch(): void;
  /** follow again now (the "Jump to now" chip, when its flag is on) */
  resume(): void;
}

export function useAutoFollow(enabled: boolean, resumeMs: number = AUTO_FOLLOW_RESUME_MS): AutoFollow {
  const [following, setFollowing] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setFollowing(true);
    }, resumeMs);
  }, [cancel, resumeMs]);
  useEffect(() => cancel, [cancel]);

  const onUserMoveStart = useCallback(() => {
    if (!enabled) return;
    cancel();
    setFollowing(false);
  }, [enabled, cancel]);
  const onUserMoveEnd = useCallback(() => {
    if (enabled) schedule();
  }, [enabled, schedule]);
  const onTouch = useCallback(() => {
    if (enabled && !following) schedule();
  }, [enabled, following, schedule]);
  const resume = useCallback(() => {
    cancel();
    setFollowing(true);
  }, [cancel]);

  return { following, onUserMoveStart, onUserMoveEnd, onTouch, resume };
}
