import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert'));
}

/**
 * While `active`, keeps Tab / Shift+Tab inside `ref`, calls `onEscape` on Escape, moves focus in on
 * open and restores it to the previously focused element on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;

    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(root)[0] ?? root;
    first.focus();

    function onKey(e: KeyboardEvent) {
      if (!root) return;
      // elements inside [data-own-escape] (e.g. an inline rename form) handle Escape themselves
      const ownEscape = e.target instanceof Element && e.target.closest('[data-own-escape]');
      if (e.key === 'Escape' && onEscape && !ownEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === firstItem || current === root)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && current === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus();
    };
    // onEscape intentionally excluded: callers pass inline closures
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}
