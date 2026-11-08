import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/**
 * A bottom sheet is attached to the bottom edge and never taller than this share of the phone
 * (the PhoneFrame on desktop, the viewport on phones); longer content scrolls inside it.
 */
export const BOTTOM_SHEET_MAX_HEIGHT = '58%';

/** The PhoneFrame provides `#overlay-root` so sheets stay inside the phone on desktop. */
export function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}

/** While open, the screens behind the sheet are `inert` (no focus, hidden from assistive tech). */
function useInertBackground(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const content = document.getElementById('app-content');
    if (!content || content.hasAttribute('inert')) return; // a parent sheet already did it
    content.setAttribute('inert', '');
    return () => content.removeAttribute('inert');
  }, [open]);
}

/**
 * Modal sheet: `role="dialog"` + `aria-modal`, focus moves in and is trapped, Escape or the
 * scrim closes it, focus returns to the opener. Unmounted while closed.
 */
export function Sheet({ open, onClose, title, side = 'bottom', header, children, testId }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Resolve the portal target after mount: a sheet that is open on the very first render would
  // otherwise land in document.body (the PhoneFrame's #overlay-root isn't in the DOM yet), move on
  // the next render and lose its initial focus. The layout effect re-renders before paint.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setContainer(overlayRoot()), []);
  useFocusTrap(panel, open && container !== null, onClose);
  useInertBackground(open);
  if (!open || !container) return null;

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
          // star-chart frame: square corners, --thread top hairline, corner ticks (see ui/StarFrame)
          'surface star-frame absolute flex flex-col text-ink outline-none',
          side === 'bottom'
            ? 'sheet-up inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]'
            : 'sheet-left inset-y-0 left-0 w-[86%] max-w-[360px] border-r border-r-line pt-[env(safe-area-inset-top)]',
        )}
        style={side === 'bottom' ? { maxHeight: BOTTOM_SHEET_MAX_HEIGHT } : undefined}
        data-side={side}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 pt-3 pb-2">
          <h2 id={titleId} className="min-w-0 truncate text-xl font-semibold tracking-wide">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden size={20} />
          </IconButton>
        </div>
        {header && <div className="px-5 py-3">{header}</div>}
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-8">
          {children}
        </div>
      </div>
    </div>,
    container,
  );
}

/**
 * The bottom sheet (A6: consent, Before you go, flag note): attached to the bottom, capped at
 * `BOTTOM_SHEET_MAX_HEIGHT` with its content scrolling inside, star-chart frame, scrim tap or
 * Escape to close, focus trapped and returned to the opener.
 */
export function BottomSheet(props: Omit<SheetProps, 'side'>) {
  return <Sheet {...props} side="bottom" />;
}
