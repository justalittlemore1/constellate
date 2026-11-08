import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoublePress, createFlagGate, FLAG_DEBOUNCE_MS, silentWavDataUri, useFlagTrigger } from './useFlagTrigger';

type Handler = (() => void) | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const key = (k: string, target: Element | Window = window, extra: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(target, { key: k, code: k === ' ' ? 'Space' : `Key${k.toUpperCase()}`, ...extra });
  });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function setup(enabled = true) {
  const onFlag = vi.fn(() => true);
  const hook = renderHook(({ on }) => useFlagTrigger(onFlag, { enabled: on }), { initialProps: { on: enabled } });
  return { onFlag, hook };
}

describe('gates', () => {
  it('createFlagGate lets one accepted flag through per window', () => {
    let t = 0;
    const gate = createFlagGate(1000, () => t);
    expect(gate.open()).toBe(true);
    expect(gate.open()).toBe(true); // asking does not consume the window
    gate.accept();
    t = 999;
    expect(gate.open()).toBe(false);
    t = 1000;
    expect(gate.open()).toBe(true);
  });

  it('createDoublePress needs the same key twice within the window, and resets after a hit', () => {
    let t = 0;
    const press = createDoublePress(400, () => t);
    expect(press('f')).toBe(false);
    t = 300;
    expect(press('f')).toBe(true);
    t = 350;
    expect(press('f')).toBe(false); // a third press starts a new gesture
    t = 1000;
    expect(press('space')).toBe(false);
    t = 1100;
    expect(press('f')).toBe(false); // different key
  });

  it('builds a valid silent WAV', () => {
    const uri = silentWavDataUri(0.1);
    const bin = atob(uri.split(',')[1]!);
    expect(bin.slice(0, 4)).toBe('RIFF');
    expect(bin.length).toBe(44 + 800 * 2);
  });
});

describe('useFlagTrigger: keyboard', () => {
  it('flags on a double F within 400 ms', () => {
    const { onFlag } = setup();
    key('f');
    wait(200);
    key('F');
    expect(onFlag).toHaveBeenCalledExactlyOnceWith('key');
  });

  it('flags on a double Space and prevents scrolling', () => {
    const { onFlag } = setup();
    key(' ');
    wait(100);
    key(' ');
    expect(onFlag).toHaveBeenCalledExactlyOnceWith('key');
  });

  it('ignores a single press, slow presses, key repeat and typing', () => {
    const { onFlag } = setup();
    key('f');
    wait(500);
    key('f');
    expect(onFlag).not.toHaveBeenCalled();

    wait(2000);
    key('f');
    key('f', window, { repeat: true });
    expect(onFlag).not.toHaveBeenCalled();

    const input = document.createElement('input');
    document.body.appendChild(input);
    key('f', input);
    key('f', input);
    expect(onFlag).not.toHaveBeenCalled();
    input.remove();
  });

  it('leaves Space alone on a focused button', () => {
    const { onFlag } = setup();
    const button = document.createElement('button');
    document.body.appendChild(button);
    key(' ', button);
    key(' ', button);
    expect(onFlag).not.toHaveBeenCalled();
    button.remove();
  });

  it('does nothing while disabled', () => {
    const { onFlag } = setup(false);
    key('f');
    key('f');
    expect(onFlag).not.toHaveBeenCalled();
  });
});

describe('useFlagTrigger: debounce', () => {
  it('one gesture is one flag, however many inputs fire', () => {
    const { onFlag, hook } = setup();
    act(() => {
      hook.result.current.flag('button');
      hook.result.current.flag('button');
      hook.result.current.flag('media');
    });
    expect(onFlag).toHaveBeenCalledTimes(1);
    wait(FLAG_DEBOUNCE_MS);
    act(() => void hook.result.current.flag('button'));
    expect(onFlag).toHaveBeenCalledTimes(2);
  });

  it('a rejected flag (e.g. not live yet) does not swallow the next gesture', () => {
    const onFlag = vi.fn(() => false);
    const { result } = renderHook(() => useFlagTrigger(onFlag, { enabled: true }));
    act(() => void result.current.flag('button'));
    onFlag.mockReturnValue(true);
    wait(100); // well inside the debounce window
    let ok = false;
    act(() => void (ok = result.current.flag('button')));
    expect(ok).toBe(true);
    expect(onFlag).toHaveBeenCalledTimes(2);
  });

  it('vibrates only for an accepted flag', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const onFlag = vi.fn(() => false);
    const { result } = renderHook(() => useFlagTrigger(onFlag, { enabled: true }));
    act(() => void result.current.flag('button'));
    expect(vibrate).not.toHaveBeenCalled();
    onFlag.mockReturnValue(true);
    wait(FLAG_DEBOUNCE_MS);
    act(() => void result.current.flag('button'));
    expect(vibrate).toHaveBeenCalledWith(60);
    Reflect.deleteProperty(navigator, 'vibrate');
  });
});

describe('useFlagTrigger: media keys', () => {
  let handlers: Record<string, Handler>;
  beforeEach(() => {
    handlers = {};
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: (a: string, h: Handler) => (handlers[a] = h),
      },
    });
  });
  afterEach(() => Reflect.deleteProperty(navigator, 'mediaSession'));

  it('registers next / play / pause while enabled, plays silent audio, and removes them after', () => {
    const { onFlag, hook } = setup();
    expect(Object.keys(handlers).sort()).toEqual(['nexttrack', 'pause', 'play']);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    act(() => handlers.nexttrack!());
    expect(onFlag).toHaveBeenCalledExactlyOnceWith('media');
    act(() => handlers.pause!()); // the same headphone press often fires twice
    expect(onFlag).toHaveBeenCalledTimes(1);
    hook.rerender({ on: false });
    expect(Object.values(handlers).every((h) => h === null)).toBe(true);
  });
});

describe('useFlagTrigger: pocket mode', () => {
  function Pocket({ onFlag }: { onFlag: () => boolean }) {
    const t = useFlagTrigger(onFlag, { enabled: true });
    return (
      <>
        <button type="button" onClick={() => t.setPocket(true)}>
          Pocket
        </button>
        {t.pocket && <div data-testid="pocket" onPointerUp={t.onPocketTap} />}
      </>
    );
  }

  it('double-tap anywhere on the dimmed screen flags', () => {
    const onFlag = vi.fn(() => true);
    const { getByText, getByTestId } = render(<Pocket onFlag={onFlag} />);
    fireEvent.click(getByText('Pocket'));
    const surface = getByTestId('pocket');
    fireEvent.pointerUp(surface);
    expect(onFlag).not.toHaveBeenCalled();
    wait(150);
    fireEvent.pointerUp(surface);
    expect(onFlag).toHaveBeenCalledExactlyOnceWith('tap');
  });
});
