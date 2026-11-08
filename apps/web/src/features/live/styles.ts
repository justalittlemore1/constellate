/**
 * Shared styles for the live screen. The hover / press wash is A4's `hover-wash` class (ui, #60):
 * a grey wash layered over any background; the focus ring stays the separate :focus-visible outline.
 */
export const HOVER_WASH = 'hover-wash';

/**
 * Bottom-bar buttons: compact and content-width (120–160 px, centred together in the bar, not
 * stretched), 48 px tall (never below 44), A4's base text size (`text-base`, follows Text size),
 * icon after the text on one line.
 */
export const BAR_BUTTON =
  'inline-flex min-h-12 min-w-[7.5rem] max-w-40 shrink-0 items-center justify-center gap-2 rounded-none border px-5 text-base font-semibold leading-none whitespace-nowrap disabled:opacity-40';

/** square buttons inside the live screen's bottom sheets (star-chart frame) */
export const SHEET_BUTTON = {
  primary: `${HOVER_WASH} flex min-h-[44px] items-center justify-center gap-2 border border-topic bg-topic px-5 font-semibold text-bg disabled:opacity-50`,
  secondary: `${HOVER_WASH} flex min-h-[44px] items-center justify-center gap-2 border border-[var(--border)] px-5 font-semibold text-ink`,
} as const;
