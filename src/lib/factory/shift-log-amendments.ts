import { createClient } from "@/lib/supabase/client";

/**
 * An entry's amendment history — one row per correction (migration 0055).
 *
 * Read-only from here, and only from here: `shift_log_record_amendment` writes
 * these rows when `shift_log_amend_guard` stamps an amendment, working out what
 * changed by comparing the entry before and after. RLS gives the app no way to
 * add or alter one, so nothing in this file could, and nothing should try.
 */

export interface AmendmentChange {
  /** A key of `CHANGE_LABELS`. */
  field: string;
  /** Null when the field was empty — on that side of the change. */
  from: string | null;
  to: string | null;
}

export interface ShiftLogAmendment {
  id: number;
  amended_on: string;
  /** Null on a backfilled row whose note carried only a date. */
  amended_at: string | null;
  reason: string | null;
  /**
   * What changed. **`[]` and null are different answers**: `[]` is a note added
   * and nothing else touched, null is an amendment made before 0055, when what
   * it changed was not recorded.
   */
  changes: AmendmentChange[] | null;
  /** The name as it stood. Null where the old record never kept one. */
  amended_by_name: string | null;
}

export const amendmentKeys = {
  all: (factoryId: string) => ["shift_log_amendments", factoryId] as const,
  entry: (factoryId: string, entryId: string) =>
    ["shift_log_amendments", factoryId, entryId] as const,
};

/** An entry's amendments in the order they were made. */
export async function fetchAmendments(
  entryId: string,
): Promise<ShiftLogAmendment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_amendments")
    .select("id, amended_on, amended_at, reason, changes, amended_by_name")
    .eq("entry_id", entryId)
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ShiftLogAmendment[];
}

/** What to call each field the trigger compares, as the sheet names it. */
const CHANGE_LABELS: Record<string, string> = {
  log_date: "Date",
  shift: "Shift",
  start_time: "Start",
  end_time: "End",
  process: "Activity",
  batch_no: "Batch",
  stage: "Stage",
  qty: "Shift qty",
  qty_unit: "Unit",
  target_qty: "Shift target",
  qty_rejected: "Rejected",
  speed_unit: "Speed unit",
  target_speed: "Target speed",
  actual_speed: "Actual speed",
  slow_reason: "Slow reason",
  equipment_no: "EQ no.",
  operators: "Operators",
  action_flag: "Flag",
  comment: "Comments",
};

/** The fields held as figures: stored bare, shown with their separators. */
const NUMERIC_FIELDS = new Set([
  "qty",
  "target_qty",
  "qty_rejected",
  "target_speed",
  "actual_speed",
]);

/** "unit" is the factory's own word for a room, so it comes from the caller. */
export function changeLabel(field: string, unitWord: string): string {
  return field === "unit" ? unitWord : (CHANGE_LABELS[field] ?? field);
}

/** One side of a change, as it reads on the sheet. */
export function changeValue(field: string, value: string | null): string {
  if (value === null) return "—";
  const figure = NUMERIC_FIELDS.has(field) ? Number(value) : Number.NaN;
  return Number.isNaN(figure) ? value : figure.toLocaleString();
}
