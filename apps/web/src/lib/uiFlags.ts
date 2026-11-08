/**
 * UI flags for the redesign (wave 1). "Hide" means behind a flag, never delete: every item the
 * humans asked to hide stays in the code, off by default, and its tests run with it switched on.
 * Flip a default to bring something back.
 */
export const UI_FLAG_DEFAULTS = {
  /** Home: "Where will your conversation take you?" */
  homeTagline: false,
  /** Home: "Tap to start. Everyone is asked to agree first." under the mic orb */
  homeOrbHint: false,
  /** Home: the top-right Settings icon (Settings stays reachable from the sidebar) */
  homeSettingsButton: false,
  /** Home: the slow pulse around the mic orb (no pulsing glows in the new style) */
  homeOrbPulse: false,
  /** Home: the wave-0 mic orb (replaced by the F4 filament star in wave 2) */
  homeMicOrb: false,

  /** Sidebar: the gradient "Generate Brain" button pinned at the top (replaced by a plain "Brain" link) */
  sidebarGenerateBrain: false,
  /** Sidebar: search by title */
  sidebarSearch: false,
  /** Sidebar: the "Settings" row in the sections list (a minimal link stays at the bottom) */
  sidebarSettingsRow: false,
  /** Sidebar: folders, "All conversations" and the add-folder button */
  sidebarFolders: false,
  /** Sidebar: the "Recent conversations" header */
  sidebarRecentHeading: false,
  /** Sidebar rows: the Solo / Group tag */
  sidebarRowTags: false,
  /** Sidebar rows: the ⋯ options menu (move to folder) */
  sidebarRowMenu: false,

  /** Brain: concept search */
  brainSearch: false,
  /** Brain: the Galaxy / List toggle (replaced by a single "Text view" icon) */
  brainViewToggle: false,
  /** Brain: the regenerate icon in the header (replaced by the on-page Generate button) */
  brainHeaderRegenerate: false,

  /** Brain: wave 2's comet trail / line / stardust links (replaced by classic constellation lines) */
  brainCometLinks: false,

  /** Highlights: the separate map icon on each item (the item's text is now the map link) */
  highlightsMapIcon: false,

  /**
   * Conversation header: the "Text view" toggle under the Diary icon. Built, but off until A3's
   * controlled `SavedMap` `view` / `onViewChange` props land; until then it couldn't switch the
   * map to the outline, and a button that does nothing is worse than none. Flip to true then.
   */
  conversationTextView: false,

  /** Diary: recall cards */
  diaryRecallCards: false,
} as const;

export type UiFlag = keyof typeof UI_FLAG_DEFAULTS;

const flags: Record<UiFlag, boolean> = { ...UI_FLAG_DEFAULTS };

/** Read at render time. */
export function uiFlag(name: UiFlag): boolean {
  return flags[name];
}

/** Tests (and future settings) only: switch flags for this session. */
export function setUiFlags(patch: Partial<Record<UiFlag, boolean>>): void {
  Object.assign(flags, patch);
}

export function resetUiFlags(): void {
  Object.assign(flags, UI_FLAG_DEFAULTS);
}

/** Every flag on: the pre-redesign UI, for tests that cover the hidden features. */
export const ALL_UI_FLAGS_ON: Record<UiFlag, boolean> = Object.fromEntries(
  Object.keys(UI_FLAG_DEFAULTS).map((k) => [k, true]),
) as Record<UiFlag, boolean>;
