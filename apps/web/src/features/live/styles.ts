/**
 * Shared styles for the live screen. The hover / press wash is A4's `hover-wash` class (ui, #60):
 * a grey wash layered over any background; the focus ring stays the separate :focus-visible outline.
 */
export const HOVER_WASH = 'hover-wash';

/** Bottom-bar buttons: ~48 px tall (never below 44), 16 px text, icon after the text on one line. */
export const BAR_BUTTON =
  'flex min-h-12 items-center justify-center gap-2 rounded-none border px-4 text-[16px] font-semibold leading-none disabled:opacity-40';

/** square buttons inside the live screen's bottom sheets (star-chart frame) */
export const SHEET_BUTTON = {
  primary: `${HOVER_WASH} flex min-h-[44px] items-center justify-center gap-2 border border-topic bg-topic px-5 font-semibold text-bg disabled:opacity-50`,
  secondary: `${HOVER_WASH} flex min-h-[44px] items-center justify-center gap-2 border border-[var(--border)] px-5 font-semibold text-ink`,
} as const;
