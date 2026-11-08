/**
 * Test helpers for the map (test-only). React Flow needs ResizeObserver, DOMMatrixReadOnly and
 * element sizes, none of which jsdom provides; these stubs let the canvas render its nodes.
 */
import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { HOVER_DWELL_MS } from './ConversationMap';

class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

let installed = false;

/** Call once per test file (in `beforeAll`). Gives every element a 390 × 700 box. */
export function installFlowDomStubs(): void {
  if (installed) return;
  installed = true;
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixReadOnlyStub);
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get: () => 700 },
    offsetWidth: { configurable: true, get: () => 390 },
    clientHeight: { configurable: true, get: () => 700 },
    clientWidth: { configurable: true, get: () => 390 },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  if (typeof window.PointerEvent === 'undefined') {
    // jsdom has none, so fireEvent.pointer* would drop clientX / button
    class PointerEventStub extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    vi.stubGlobal('PointerEvent', PointerEventStub);
  }
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/["\\]/g, '\\$&') });
  }
}

/** Mouse-over a star and rest on it long enough for the preview strip (the 700 ms dwell). */
export function hoverStar(el: Element): void {
  vi.useFakeTimers();
  try {
    fireEvent.mouseEnter(el);
    act(() => {
      vi.advanceTimersByTime(HOVER_DWELL_MS + 10);
    });
  } finally {
    vi.useRealTimers();
  }
}
