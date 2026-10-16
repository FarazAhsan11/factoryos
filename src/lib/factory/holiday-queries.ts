import { addDays } from "@/lib/factory/dates";
import { createClient } from "@/lib/supabase/client";

/**
 * Admin → Shift times → Holidays — the days a factory is closed. Read by the
 * Room schedule, which tints those columns. Browser-direct under RLS (the
 * whole tenant reads, admins and managers write): ordinary tenant data, and
 * nothing here needs the service-role key. Migration 0050.
 */

export interface Holiday {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  label: string | null;
}

export const holidayKeys = {
  all: (factoryId: string) => ["factory_holidays", factoryId] as const,
};

export async function fetchHolidays(factoryId: string): Promise<Holiday[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_holidays")
    .select("id, holiday_date, label")
    .eq("factory_id", factoryId)
    .order("holiday_date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    date: String(row.holiday_date).slice(0, 10),
    label: (row.label as string | null) ?? null,
  }));
}

/** Every day from `from` to `until`, both ends inclusive. */
export function dayRun(from: string, until?: string): string[] {
  const last = until && until >= from ? until : from;
  const days: string[] = [];
  for (let d = from; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Adds a day or a run of days. A day already marked is left as it is —
 * `ignoreDuplicates`, so re-adding a break that overlaps one on file does not
 * fail halfway and does not overwrite the name already given.
 */
export async function addHolidays(
  factoryId: string,
  days: string[],
  label: string | null,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("factory_holidays").upsert(
    days.map((day) => ({
      factory_id: factoryId,
      holiday_date: day,
      label,
    })),
    { onConflict: "factory_id,holiday_date", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

export async function deleteHoliday(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_holidays")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── Weekly days off ─────────────────────────────────────────────────────
   The weekdays always closed — every Sunday, say. Migration 0051. A weekday
   is 0 = Monday … 6 = Sunday, the order the Room schedule is drawn in. */

export const WEEKDAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const weeklyOffKeys = {
  all: (factoryId: string) => ["factory_weekly_off", factoryId] as const,
};

export async function fetchWeeklyOff(factoryId: string): Promise<number[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_weekly_off")
    .select("weekday")
    .eq("factory_id", factoryId)
    .order("weekday", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => Number(row.weekday));
}

/** Marks a weekday as off, or works it again — one row per day that is off. */
export async function setWeekdayOff(
  factoryId: string,
  weekday: number,
  off: boolean,
): Promise<void> {
  const supabase = createClient();
  const { error } = off
    ? await supabase
        .from("factory_weekly_off")
        .upsert(
          { factory_id: factoryId, weekday },
          { onConflict: "factory_id,weekday", ignoreDuplicates: true },
        )
    : await supabase
        .from("factory_weekly_off")
        .delete()
        .eq("factory_id", factoryId)
        .eq("weekday", weekday);
  if (error) throw new Error(error.message);
}
