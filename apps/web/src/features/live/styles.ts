/**
 * Shared interaction styles for the live screen. WASH is the grey hover/press wash (about 7.5 %
 * white) as an overlay, so it shows over any background tint; swap it for A4's shared `ui` wash
 * when that lands. Only enabled controls get it.
 */
export const WASH =
  "relative before:pointer-events-none before:absolute before:inset-0 before:content-[''] enabled:hover:before:bg-white/[0.075] enabled:active:before:bg-white/[0.075]";

/** Bottom-bar buttons: ~48 px tall (never below 44), 16 px text, icon after the text on one line. */
export const BAR_BUTTON =
  'flex min-h-12 items-center justify-center gap-2 rounded-none border px-4 text-[16px] font-semibold leading-none disabled:opacity-40';
