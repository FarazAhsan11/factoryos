/**
 * Calendar-day helpers. Plain module — no React, no Supabase, no schema
 * imports — so both the zod schemas and the query layer can use it without
 * either pulling the other in.
 */

/**
 * The local calendar day as `YYYY-MM-DD`.
 *
 * Local, never UTC. `toISOString().slice(0, 10)` is the tempting one-liner and
 * it is wrong for exactly the people this matters to: a planner east of UTC
 * picking "today" after midnight gets yesterday's date, and one west of it
 * gets tomorrow's before the evening is out. A shift is logged against the
 * wall clock and a batch is scheduled against the wall calendar, so both read
 * the date the browser is showing.
 */
export function todayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-08-14" → "14 Aug", or "14 Aug 25" when it isn't this year. */
export function formatDay(iso: string, now: Date = new Date()): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return y === now.getFullYear() ? label : `${label} ${String(y).slice(2)}`;
}
