/**
 * Map feature flags (humans' redesign, wave 1). "Hide" means hide, never delete: flip one value to
 * bring a feature back. `<ConversationMap flags={…}>` can override them per instance (tests, demos).
 */
export interface MapFlags {
  /** Broad / Balanced / Detailed bar with its fit control; off = always Balanced, no auto-Broad */
  zoomBar: boolean;
  /** visible Map ↔ Outline toggle (the outline stays reachable through the focus-only "Text view" link) */
  outlineToggle: boolean;
  /** the "?" legend button */
  legendHelp: boolean;
  /** on-screen + / − zoom buttons */
  zoomButtons: boolean;
  /** live "Jump to now" chip (off: auto-follow resumes after a few seconds without touch) */
  jumpToNow: boolean;
  /** purple revisit arcs + ↺ badge (off: all occurrences of a thread merge into one star, returns loop back) */
  revisitArcs: boolean;
  /** dots drifting along flow edges */
  particles: boolean;
  /** parked-thought nodes (off: the humans are replacing Park with flag notes) */
  parkedThoughts: boolean;
  /** wave-1 comet trails instead of the classic constellation lines */
  cometTrails: boolean;
  /** wave-2 Y4 faceted stars instead of the Y3 eight-point compass */
  facetedStars: boolean;
  /** draw stars at their persisted x / y (the pre-round-4 layout) instead of a phone layout */
  storedLayout: boolean;
  /** round-4 straight column layout instead of the round-5 weaving layout */
  columnLayout: boolean;
}

export const MAP_FLAGS: MapFlags = {
  zoomBar: false,
  outlineToggle: false,
  legendHelp: false,
  zoomButtons: false,
  jumpToNow: false,
  revisitArcs: false,
  particles: false,
  parkedThoughts: false,
  cometTrails: false,
  facetedStars: false,
  storedLayout: false,
  columnLayout: false,
};

export function resolveFlags(over?: Partial<MapFlags>): MapFlags {
  return { ...MAP_FLAGS, ...over };
}

/** Live map: resume following the newest node after this long without a touch or pan. */
export const AUTO_FOLLOW_RESUME_MS = 5000;
