/**
 * Feature switches for the live screen (redesign wave 1). Features are hidden here, never deleted,
 * so they can come back with a one-line change.
 */
export interface LiveFeatures {
  /** "Park a thought": bottom-bar button and sheet. Hidden in the redesign. */
  parkThought: boolean;
  /**
   * The "Before you go" sheet after Stop (open threads + Open the map). Hidden: the session goes
   * straight to the saved map with the diary open (`/c/:id?diary=1`), which lists the open threads.
   */
  beforeYouGo: boolean;
  /**
   * Press-and-hold Flag (or Shift+F) opens a short note for that flag, sent on the `flag` message
   * (contract #49 / server #50). false = degraded: holding or Shift+F simply flags, no note field.
   */
  flagNotes: boolean;
}

export const LIVE_FEATURES: LiveFeatures = {
  parkThought: false,
  beforeYouGo: false,
  flagNotes: true,
};

/** a held press longer than this opens the note field */
export const FLAG_HOLD_MS = 600;
export const FLAG_NOTE_MAX_CHARS = 140;
