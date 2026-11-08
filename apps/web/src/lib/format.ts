/** Display formatting (en locale, user's time zone). */

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, opts).format(d);
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

/** 620000 → "10 min", 45000 → "45 s", 4000000 → "1 h 7 min" */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Position in a recording: 250000 → "04:10", 3725000 → "1:02:05" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Spoken form for screen readers: 250000 → "4 minutes 10 seconds" */
export function spokenClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}
