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
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/*
 * How every date in the app reads: "14 Aug 2026", always with the year.
 *
 * A batch record, a deviation and a customer order outlive the year they were
 * made in, and a date without its year is ambiguous the moment anyone reads
 * it in January — so the year is never dropped, not even for this year.
 *
 * Built from a fixed month table, not `toLocaleDateString(undefined, …)`:
 * an undefined locale means *the environment*, so the server rendered
 * "Aug 14" and the browser "14 Aug" (or "Sept" for "Sep"), which is both
 * inconsistent and a hydration mismatch. The table reads the same everywhere.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-14" (or a timestamp starting with it) → "14 Aug 2026". */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * A moment → "14 Aug 2026, 18:46", in the viewer's local time. The 24-hour
 * clock the shift times are written in, so "15:05" means the same thing on
 * the shift badge and on the record it stamps.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
