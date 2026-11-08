/**
 * Promise catcher phrasing (PLAN → research review: implementation intentions). A commitment is
 * shown as "When ___, I will ___"; once the user fills the cue, the commitment text is stored in
 * that form so it reads the same everywhere.
 */
const IF_THEN = /^when\s+(.+?),\s*i will\s+(.+)$/is;

export interface IfThen {
  cue: string | null;
  action: string;
}

export function parsePromise(text: string): IfThen {
  const m = IF_THEN.exec(text.trim());
  if (m) return { cue: m[1]!.trim(), action: m[2]!.trim() };
  return { cue: null, action: stripLead(text.trim()) };
}

/** "I'll send…" / "I will send…" → "send…"; lower-cases an initial capital unless it's "I" or an acronym. */
function stripLead(action: string): string {
  const s = action.replace(/^(i'll|i will)\s+/i, '');
  if (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s)) return s[0]!.toLowerCase() + s.slice(1);
  return s;
}

export function composePromise(cue: string, action: string): string {
  const c = cue.trim().replace(/[.,;:]+$/, '');
  const a = stripLead(action.trim());
  return c ? `When ${c}, I will ${a}` : a.charAt(0).toUpperCase() + a.slice(1);
}
