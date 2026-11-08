/**
 * One flag handler, four inputs (docs/PLAN.md → Flag triggers):
 *   - the on-screen button                                  → source 'button'
 *   - a double-press of F or Space within 400 ms              → source 'key'
 *   - media keys / headphone buttons (nexttrack, play, pause) → source 'media'
 *     while a silent looping <audio> keeps the media session active
 *   - Pocket mode: double-tap anywhere on the dimmed screen   → source 'tap'
 * One gesture is one flag: anything within `debounceMs` of the last flag is ignored.
 * A successful flag vibrates for 60 ms where the device supports it.
 */
import type { FlagSource } from '@constellate/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const DOUBLE_PRESS_MS = 400;
export const FLAG_DEBOUNCE_MS = 1200;
export const MEDIA_ACTIONS = ['nexttrack', 'play', 'pause'] as const;

/** Lets one flag through per `windowMs`. */
export function createFlagGate(windowMs = FLAG_DEBOUNCE_MS, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY;
  return (): boolean => {
    const t = now();
    if (t - last < windowMs) return false;
    last = t;
    return true;
  };
}

/** True on the second press of the same key within `windowMs`. */
export function createDoublePress(windowMs = DOUBLE_PRESS_MS, now: () => number = Date.now) {
  let lastKey: string | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  return (key: string): boolean => {
    const t = now();
    if (key === lastKey && t - lastAt <= windowMs) {
      lastKey = null;
      return true;
    }
    lastKey = key;
    lastAt = t;
    return false;
  };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function isActivatable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.closest('button, a[href], [role="button"], summary') !== null);
}

/** A short silent WAV, as a data URI, to keep the media session alive. */
export function silentWavDataUri(seconds = 1, rate = 8000): string {
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export interface FlagTriggerOptions {
  /** listen for keys, media keys and pocket taps (true while live) */
  enabled: boolean;
  debounceMs?: number;
}

export interface FlagTrigger {
  /** fire a flag from any source; false if debounced or rejected */
  flag(source: FlagSource): boolean;
  pocket: boolean;
  setPocket(on: boolean): void;
  /** pointer-up handler for the Pocket mode surface (double-tap = flag) */
  onPocketTap(): void;
}

/**
 * `onFlag` performs the flag and returns whether it was accepted (e.g. `controller.flag`).
 */
export function useFlagTrigger(onFlag: (source: FlagSource) => boolean, opts: FlagTriggerOptions): FlagTrigger {
  const { enabled, debounceMs = FLAG_DEBOUNCE_MS } = opts;
  const [pocket, setPocket] = useState(false);
  const onFlagRef = useRef(onFlag);
  useEffect(() => {
    onFlagRef.current = onFlag;
  }, [onFlag]);

  const gate = useMemo(() => createFlagGate(debounceMs), [debounceMs]);
  const keyPress = useMemo(() => createDoublePress(), []);
  const tapPress = useMemo(() => createDoublePress(), []);

  const flag = useCallback(
    (source: FlagSource): boolean => {
      if (!gate()) return false;
      const ok = onFlagRef.current(source);
      if (ok) navigator.vibrate?.(60);
      return ok;
    },
    [gate],
  );

  // keyboard: double F or double Space
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key === ' ' || e.code === 'Space' ? 'space' : e.key.toLowerCase() === 'f' ? 'f' : null;
      if (!key) return;
      if (key === 'space') {
        if (isActivatable(e.target)) return; // Space presses the focused button; leave it alone
        e.preventDefault(); // no page scroll
      }
      if (keyPress(key)) flag('key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, flag, keyPress]);

  // media keys and Bluetooth headphone buttons
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const audio = new Audio(silentWavDataUri());
    audio.loop = true;
    audio.setAttribute('aria-hidden', 'true');
    void audio.play().catch(() => undefined); // needs a prior user gesture (the consent tap)
    try {
      session.metadata = new MediaMetadata({ title: 'Constellate is recording', artist: 'Press ⏭ to flag a moment' });
    } catch {
      /* MediaMetadata unsupported */
    }
    session.playbackState = 'playing';
    for (const action of MEDIA_ACTIONS) {
      try {
        session.setActionHandler(action, () => {
          flag('media');
          if (audio.paused) void audio.play().catch(() => undefined);
          session.playbackState = 'playing';
        });
      } catch {
        /* action unsupported on this browser */
      }
    }
    return () => {
      for (const action of MEDIA_ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
      session.playbackState = 'none';
      audio.pause();
      audio.removeAttribute('src');
    };
  }, [enabled, flag]);

  useEffect(() => {
    if (!enabled) setPocket(false);
  }, [enabled]);

  const onPocketTap = useCallback(() => {
    if (tapPress('tap')) flag('tap');
  }, [flag, tapPress]);

  return { flag, pocket, setPocket, onPocketTap };
}
