/** 03:21 or 1:02:05 */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "Today · 14:02" / "Nov 6 · 19:30" / "Nov 6 2025 · 19:30" */
export function fmtWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return `Today · ${time}`;
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === n.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return `${d.toLocaleDateString(undefined, opts)} · ${time}`;
}

/** 7s / 1m 12s */
export function fmtSeconds(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
