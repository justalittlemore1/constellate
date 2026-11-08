/**
 * Feature switches for the live screen (redesign wave 1). Features are hidden here, never deleted,
 * so they can come back with a one-line change.
 */
export interface LiveFeatures {
  /** "Park a thought": bottom-bar button and sheet. Hidden in the redesign. */
  parkThought: boolean;
  /**
   * Press-and-hold Flag (or Shift+F) opens a short note for that flag.
   *   'user-op' — the note is saved now as a `flag.add` user op (POST /conversations/:id/ops), which
   *               today's contract and server already accept; if that call fails the moment is still
   *               flagged over the socket, without the note.
   *   'off'     — degraded: holding or Shift+F simply flags, no note field.
   */
  flagNotes: 'user-op' | 'off';
}

export const LIVE_FEATURES: LiveFeatures = {
  parkThought: false,
  flagNotes: 'user-op',
};

/** a held press longer than this opens the note field */
export const FLAG_HOLD_MS = 600;
export const FLAG_NOTE_MAX_CHARS = 140;
