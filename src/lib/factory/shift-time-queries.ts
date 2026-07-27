import type { ShiftClockValues } from "@/app/factory/[slug]/admin/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Admin → Shift times. Reads come straight from Supabase under RLS; the save
 * goes through a Server Action, because these times feed OEE availability and
 * the shift log's pre-fill.
 */

export type RunningShift = "morning" | "afternoon";

/**
 * One shift's clock. Re-exported under a neutral name so modules that only
 * consume shift times (the shift log) don't reach into the Admin form's
 * schema module for a type.
 */
export type ShiftClock = ShiftClockValues;

/** The prototype's defaults — used until a factory saves its own. */
export const DEFAULT_SHIFT_TIMES: Record<RunningShift, ShiftClockValues> = {
  morning: {
    startTime: "06:45",
    endTime: "15:15",
    break1Start: "09:30",
    break1Minutes: 30,
    break2Start: "12:00",
    break2Minutes: 30,
  },
  afternoon: {
    startTime: "15:05",
    endTime: "23:35",
    break1Start: "18:00",
    break1Minutes: 30,
    break2Start: "21:00",
    break2Minutes: 30,
  },
};

export const shiftTimeKeys = {
  all: (factoryId: string) => ["factory_shift_times", factoryId] as const,
};

interface ShiftTimeRow {
  slot: string;
  start_time: string;
  end_time: string;
  break1_start: string | null;
  break1_minutes: number;
  break2_start: string | null;
  break2_minutes: number;
}

/** Postgres returns "06:45:00"; `<input type="time">` wants "06:45". */
function toClock(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function toValues(row: ShiftTimeRow): ShiftClockValues {
  return {
    startTime: toClock(row.start_time),
    endTime: toClock(row.end_time),
    break1Start: toClock(row.break1_start),
    break1Minutes: row.break1_minutes,
    break2Start: toClock(row.break2_start),
    break2Minutes: row.break2_minutes,
  };
}

/**
 * Always resolves to a complete pair: a factory that has never saved its
 * times still gets a sensible clock rather than an empty form.
 */
export async function fetchShiftTimes(
  factoryId: string
): Promise<Record<RunningShift, ShiftClockValues>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_shift_times")
    .select(
      "slot, start_time, end_time, break1_start, break1_minutes, break2_start, break2_minutes"
    )
    .eq("factory_id", factoryId);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ShiftTimeRow[];
  const find = (slot: RunningShift) => rows.find((r) => r.slot === slot);

  return {
    morning: find("morning")
      ? toValues(find("morning")!)
      : DEFAULT_SHIFT_TIMES.morning,
    afternoon: find("afternoon")
      ? toValues(find("afternoon")!)
      : DEFAULT_SHIFT_TIMES.afternoon,
  };
}

/* ── Clock maths ─────────────────────────────────────────────────────────
   Kept here so the form, the future shift banner and OEE availability all
   compute a shift's length the same way. */

/** "15:15" → 915. Returns null for anything unparseable. */
export function minutesOfDay(clock: string | undefined): number | null {
  if (!clock) return null;
  const [h, m] = clock.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Shift length in minutes, wrapping past midnight for a night shift. */
export function shiftLengthMinutes(shift: ShiftClockValues): number {
  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  if (start === null || end === null) return 0;
  const span = end - start;
  return span > 0 ? span : span + 24 * 60;
}

/** Shift length once scheduled breaks are taken out. */
export function productiveMinutes(shift: ShiftClockValues): number {
  const breaks =
    (shift.break1Start ? shift.break1Minutes : 0) +
    (shift.break2Start ? shift.break2Minutes : 0);
  return Math.max(0, shiftLengthMinutes(shift) - breaks);
}

/** 510 → "8h 30m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Which shift is running right now. A factory's two windows don't have to
 * tile the day (there's a gap between 15:15 and 15:05 the other way, and
 * night hours belong to neither), so an out-of-hours time falls back to
 * whichever shift starts next — that's the one about to be logged.
 */
export function resolveCurrentShift(
  times: Record<RunningShift, ShiftClockValues>,
  now: Date = new Date()
): RunningShift {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const inside = (slot: RunningShift) => {
    const start = minutesOfDay(times[slot].startTime);
    if (start === null) return false;
    const offset = (nowMins - start + 24 * 60) % (24 * 60);
    return offset < shiftLengthMinutes(times[slot]);
  };

  if (inside("morning")) return "morning";
  if (inside("afternoon")) return "afternoon";

  const morningStart = minutesOfDay(times.morning.startTime) ?? 0;
  return nowMins < morningStart ? "morning" : "afternoon";
}

/** Local calendar day as `YYYY-MM-DD` — a shift is logged against the wall date. */
export function todayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "14:05" for right now, ready for an `<input type="time">`. */
export function clockNow(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * True when a break starts inside the shift window (wrap-aware). Surfaced as
 * a warning, not a hard error — an overrunning shift is a data-entry mistake
 * worth flagging, but only the factory knows its real pattern.
 */
export function breakIsInsideShift(
  shift: ShiftClockValues,
  breakStart: string | undefined
): boolean {
  const start = minutesOfDay(shift.startTime);
  const breakAt = minutesOfDay(breakStart);
  if (start === null || breakAt === null) return true;
  const offset = (breakAt - start + 24 * 60) % (24 * 60);
  return offset < shiftLengthMinutes(shift);
}
