import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagButton } from './FlagButton';
import { FLAG_HOLD_MS } from './flags';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(props: Partial<Parameters<typeof FlagButton>[0]> = {}) {
  const onTap = vi.fn();
  const onHold = vi.fn();
  const onPressStart = vi.fn();
  render(
    <FlagButton disabled={false} holdEnabled onTap={onTap} onHold={onHold} onPressStart={onPressStart} {...props} />,
  );
  return { onTap, onHold, onPressStart, button: screen.getByRole('button', { name: /flag|keep holding/i }) };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('FlagButton', () => {
  it('a tap flags; it never opens the note', () => {
    const { onTap, onHold, onPressStart, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    expect(onPressStart).toHaveBeenCalledOnce();
    wait(FLAG_HOLD_MS - 100);
    fireEvent.pointerUp(button);
    expect(onTap).toHaveBeenCalledOnce();
    expect(onHold).not.toHaveBeenCalled();
    wait(1000);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('holding 600 ms shows progress, then opens the note; the release does not also flag', () => {
    const { onTap, onHold, button } = setup();
    expect(FLAG_HOLD_MS).toBe(600);
    fireEvent.pointerDown(button, { button: 0 });
    expect(button).toHaveTextContent('Keep holding…'); // progress in words (works with reduced motion)
    const bar = screen.getByTestId('flag-hold-progress');
    expect(bar.style.transform).toBe('scaleX(1)');
    expect(bar.style.transition).toContain(`${FLAG_HOLD_MS}ms`);
    wait(FLAG_HOLD_MS);
    expect(onHold).toHaveBeenCalledOnce();
    expect(button).toHaveTextContent('Flag');
    expect(bar.style.transform).toBe('scaleX(0)');
    fireEvent.pointerUp(button);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('sliding off before the hold completes cancels: no flag, no note', () => {
    const { onTap, onHold, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    wait(300);
    fireEvent.pointerLeave(button);
    wait(1000);
    fireEvent.pointerUp(button);
    expect(onTap).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it('Enter / Space on the focused button flag like a tap (click with detail 0)', () => {
    const { onTap, onHold, button } = setup();
    fireEvent.click(button, { detail: 0 });
    expect(onTap).toHaveBeenCalledOnce();
    // a pointer click (detail 1) is handled by the pointer events, not twice
    fireEvent.click(button, { detail: 1 });
    expect(onTap).toHaveBeenCalledOnce();
    expect(onHold).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Shift+F');
  });

  it('with notes off (degraded) a long press is just a flag', () => {
    const { onTap, onHold, button } = setup({ holdEnabled: false });
    fireEvent.pointerDown(button, { button: 0 });
    expect(button).toHaveTextContent('Flag');
    wait(2000);
    fireEvent.pointerUp(button);
    expect(onHold).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledOnce();
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('ignores a secondary (right) mouse button', () => {
    const a = setup();
    // jsdom has no PointerEvent and drops `button` from the init dict, so set it by hand
    const ev = createEvent.pointerDown(a.button);
    Object.defineProperty(ev, 'button', { value: 2 });
    fireEvent(a.button, ev);
    wait(1000);
    fireEvent.pointerUp(a.button);
    expect(a.onTap).not.toHaveBeenCalled();
    expect(a.onHold).not.toHaveBeenCalled();
  });

  it('does nothing while disabled (not live yet)', () => {
    const a = setup({ disabled: true });
    expect(a.button).toBeDisabled();
    fireEvent.pointerDown(a.button);
    wait(1000);
    fireEvent.pointerUp(a.button);
    fireEvent.click(a.button, { detail: 0 });
    expect(a.onTap).not.toHaveBeenCalled();
    expect(a.onHold).not.toHaveBeenCalled();
  });

  it('its description explains hold and Shift+F, outside the accessible name', () => {
    const { button } = setup();
    expect(button).toHaveAccessibleName('Flag');
    expect(button).toHaveAccessibleDescription(/Press and hold, or press Shift\+F, to add a note/);
  });
});
