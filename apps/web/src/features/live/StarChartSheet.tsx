/**
 * Bottom sheet in the star-chart frame (redesign wave 1): square corners, a thin rule, corner tick
 * marks like a chart plate. Same behaviour as A4's ui/Sheet — modal dialog, focus moves in and is
 * trapped, Escape / scrim / Close call onClose, focus returns to the opener, the app behind is
 * inert. A local stand-in until A4's star-chart primitive lands in `ui/`; then swap the import.
 */
import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { overlayRoot } from '../../ui/Sheet';
import { useFocusTrap } from '../../ui';

export interface StarChartSheetProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}

/** square buttons that sit inside the frame */
export const frameBtn = {
  primary:
    'flex min-h-[44px] items-center justify-center gap-2 border border-topic bg-topic px-5 font-semibold text-bg disabled:opacity-50',
  secondary:
    'flex min-h-[44px] items-center justify-center gap-2 border border-[var(--border)] px-5 font-semibold text-ink',
} as const;

function useInertApp(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const content = document.getElementById('app-content');
    if (!content || content.hasAttribute('inert')) return;
    content.setAttribute('inert', '');
    return () => content.removeAttribute('inert');
  }, [open]);
}

const TICK = 'pointer-events-none absolute size-3 border-topic/70';

export function StarChartSheet({ open, onClose, title, children, testId }: StarChartSheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // resolved after mount, so a sheet open on the first render lands in #overlay-root directly
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setContainer(overlayRoot()), []);
  useFocusTrap(panel, open && container !== null, onClose);
  useInertApp(open);
  if (!open || !container) return null;

  return createPortal(
    <div className="absolute inset-0 z-40">
      <div aria-hidden className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        data-frame="star-chart"
        className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-none border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] text-ink outline-none backdrop-blur-[16px]"
      >
        <span aria-hidden className={`${TICK} left-2 top-2 border-l border-t`} />
        <span aria-hidden className={`${TICK} right-2 top-2 border-r border-t`} />
        <span aria-hidden className={`${TICK} bottom-2 left-2 border-b border-l`} />
        <span aria-hidden className={`${TICK} bottom-2 right-2 border-b border-r`} />
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 pb-2 pt-4">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold tracking-wide">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-none text-ink hover:bg-white/10"
          >
            <X aria-hidden size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3">{children}</div>
      </div>
    </div>,
    container,
  );
}
