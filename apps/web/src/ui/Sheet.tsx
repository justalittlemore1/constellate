import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { useFocusTrap } from './useFocusTrap';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** `bottom` sheet (default) or a `left` drawer */
  side?: 'bottom' | 'left';
  /** rendered above the scrolling body, below the title (e.g. a pinned action) */
  header?: ReactNode;
  children: ReactNode;
  /** test id on the dialog */
  testId?: string;
}

/** The PhoneFrame provides `#overlay-root` so sheets stay inside the phone on desktop. */
function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}

/**
 * Modal sheet: `role="dialog"` + `aria-modal`, focus moves in and is trapped, Escape or the
 * scrim closes it, focus returns to the opener. Unmounted while closed.
 */
export function Sheet({ open, onClose, title, side = 'bottom', header, children, testId }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, open, onClose);
  if (!open) return null;

  return createPortal(
    <div className="absolute inset-0 z-40">
      <div aria-hidden className="sheet-scrim absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className={cx(
          'surface absolute flex flex-col border-line text-ink outline-none',
          side === 'bottom'
            ? 'sheet-up inset-x-0 bottom-0 max-h-[88%] rounded-t-[var(--radius)] border-t pb-[env(safe-area-inset-bottom)]'
            : 'sheet-left inset-y-0 left-0 w-[86%] max-w-[360px] border-r pt-[env(safe-area-inset-top)]',
        )}
      >
        {side === 'bottom' && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />}
        <div className="flex items-center justify-between gap-2 px-4 pt-2">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden size={20} />
          </IconButton>
        </div>
        {header && <div className="px-4 pb-2">{header}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </div>,
    overlayRoot(),
  );
}
