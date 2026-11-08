/**
 * The Flag button. A tap flags the moment, as before. Press and hold for FLAG_HOLD_MS opens a short
 * note for that flag (when notes are on). Progress is visible two ways: a bar fills along the
 * bottom edge, and the label changes to "Keep holding…" (so reduced motion still shows progress).
 * Sliding off the button before the hold completes cancels. Enter / Space on the focused button
 * flag like a tap; Shift+F (useFlagTrigger) is the keyboard way to add a note.
 */
import { Flag } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { FLAG_HOLD_MS } from './flags';
import { BAR_BUTTON, HOVER_WASH } from './styles';

export interface FlagButtonProps {
  disabled: boolean;
  /** hold opens a note; when false a hold is just a tap */
  holdEnabled: boolean;
  onTap(): void;
  /** a press started (the note's moment is when the press began, not when the hold completed) */
  onPressStart?(): void;
  /** the hold completed */
  onHold(): void;
  holdMs?: number;
}

export function FlagButton({
  disabled,
  holdEnabled,
  onTap,
  onPressStart,
  onHold,
  holdMs = FLAG_HOLD_MS,
}: FlagButtonProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** a press started on this button and has not been released or cancelled */
  const pressed = useRef(false);
  /** the hold completed: the release must not also flag */
  const held = useRef(false);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!disabled) return;
    pressed.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, [disabled]);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button > 0) return; // secondary mouse buttons never flag
    pressed.current = true;
    held.current = false;
    onPressStart?.();
    if (!holdEnabled) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      held.current = true;
      setHolding(false);
      navigator.vibrate?.(30);
      onHold();
    }, holdMs);
  };

  const up = () => {
    if (!pressed.current) return;
    pressed.current = false;
    if (held.current) {
      held.current = false;
      return;
    }
    stopTimer();
    onTap();
  };

  const cancel = () => {
    pressed.current = false;
    stopTimer();
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        // pointer presses are handled above; a click with detail 0 is Enter / Space on the focused button
        onClick={(e) => {
          if (e.detail === 0) onTap();
        }}
        onContextMenu={(e) => e.preventDefault()}
        // the name stays "Flag" while the visible label says "Keep holding…"
        aria-label="Flag"
        aria-describedby="flag-hint"
        aria-keyshortcuts={holdEnabled ? 'Shift+F' : undefined}
        data-holding={holding || undefined}
        className={`${BAR_BUTTON} ${HOVER_WASH} relative touch-manipulation select-none overflow-hidden border-flag/40 bg-flag/15 text-flag [-webkit-touch-callout:none]`}
      >
        <span data-testid="flag-label">{holding ? 'Keep holding…' : 'Flag'}</span>
        <Flag aria-hidden size={18} />
        <span
          aria-hidden
          data-testid="flag-hold-progress"
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-flag motion-reduce:hidden"
          style={{
            transform: holding ? 'scaleX(1)' : 'scaleX(0)',
            transition: holding ? `transform ${holdMs}ms linear` : 'none',
          }}
        />
      </button>
      <span id="flag-hint" className="sr-only">
        {holdEnabled
          ? 'Tap to flag this moment. Press and hold, or press Shift+F, to add a note. Also: double-press F or Space, or a media key.'
          : 'Also: double-press F or Space, or a media key.'}
      </span>
    </>
  );
}
