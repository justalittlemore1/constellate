import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no matchMedia, canvas or ResizeObserver; components must cope without them anyway.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.removeAttribute('data-low-stim');
  document.documentElement.style.removeProperty('--text-size');
});
