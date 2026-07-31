import type { LogEntryParsed } from "@/app/factory/[slug]/log/schemas";
import { createClient } from "@/lib/supabase/client";
import type { RunningShift } from "@/lib/factory/shift-time-queries";

/**
 * Shift log → entries. Reads and the insert go straight from the browser to
 * Supabase; RLS is the trust boundary (members insert their own rows, nobody
 * can delete). Same pattern as the setup lists — no server hop, so the feed
 * can update optimistically.
 */

export interface LogEntry {
  id: string;
  unit_id: string;
  process_id: string;
  log_date: string;
  shift: RunningShift;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  equipment_no: string | null;
  batch_no: string | null;
  target_qty: number;
  qty: number;
  qty_rejected: number;
  speed_unit: string | null;
  target_speed: number | null;
  actual_speed: number | null;
  slow_reason: string | null;
  operator_1: string | null;
  operator_2: string | null;
  comment: string | null;
  action_flag: string | null;
  created_at: string;
  amended_at: string | null;
  amend_note: string | null;
  /** Who filed it — decides whether this viewer may amend it. */
  logged_by: string | null;
  /** Joined names, so the feed never has to cross-reference three caches. */
  unit: { name: string } | null;
  process: { name: string; has_machine: boolean } | null;
  product: { name: string; code: string | null } | null;
}

const COLUMNS = `
  id, unit_id, process_id, log_date, shift, start_time, end_time,
  duration_minutes, equipment_no, batch_no,
  target_qty, qty, qty_rejected,
  speed_unit, target_speed, actual_speed, slow_reason,
  operator_1, operator_2, comment, action_flag,
  created_at, amended_at, amend_note, logged_by,
  unit:factory_units ( name ),
  process:factory_processes ( name, has_machine ),
  product:factory_products ( name, code )
`;

export const logKeys = {
  /** Prefix covering every cached day — invalidate this after an insert. */
  factory: (factoryId: string) => ["shift_log_entries", factoryId] as const,
  /** One key per factory + working day: the feed is a day's worth of shift. */
  day: (factoryId: string, date: string) =>
    ["shift_log_entries", factoryId, date] as const,
};

export async function fetchLogEntries(
  factoryId: string,
  date: string
): Promise<LogEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .eq("log_date", date)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LogEntry[];
}

/**
 * Every entry ever logged against a batch, newest first — the running total
 * the form shows as "accumulative" and, later, the batch history page.
 */
export async function fetchBatchEntries(
  factoryId: string,
  batchNo: string
): Promise<Pick<LogEntry, "id" | "process_id" | "qty" | "log_date">[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries")
    .select("id, process_id, qty, log_date")
    .eq("factory_id", factoryId)
    .ilike("batch_no", batchNo.trim())
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Minutes between two HH:MM clocks, wrapping past midnight. */
export function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins < 0 ? mins + 24 * 60 : mins;
}

/** 95 → "1h 35min"; 45 → "45min". */
export function formatMinutes(mins: number): string {
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export async function createLogEntry(
  values: LogEntryParsed,
  loggedBy: string,
  logDate: string,
  productId: string | null
): Promise<LogEntry> {
  const supabase = createClient();
  const machine = values.hasMachine;

  const { data, error } = await supabase
    .from("shift_log_entries")
    .insert({
      factory_id: values.factoryId,
      unit_id: values.unitId,
      process_id: values.processId,
      log_date: logDate,
      shift: values.shift,
      start_time: values.startTime,
      end_time: values.endTime,
      duration_minutes: durationMinutes(values.startTime, values.endTime),
      equipment_no: values.equipmentNo || null,
      batch_no: values.batchNo || null,
      product_id: productId,
      target_qty: values.targetQty ?? 0,
      qty: values.qty ?? 0,
      qty_rejected: values.qtyRejected ?? 0,
      // Speed belongs to machine processes only — a manual entry stores null
      // rather than zeroes, so OEE can tell "not applicable" from "stopped".
      speed_unit: machine ? values.speedUnit || null : null,
      target_speed: machine ? values.targetSpeed ?? null : null,
      actual_speed: machine ? values.actualSpeed ?? null : null,
      slow_reason: machine ? values.slowReason || null : null,
      operator_1: values.operator1 || null,
      operator_2: values.operator2 || null,
      comment: values.comment || null,
      action_flag: values.actionFlag ?? null,
      logged_by: loggedBy,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as LogEntry;
}

/**
 * Files an amendment against an entry.
 *
 * The write goes to `shift_log_entries` directly, never the
 * `shift_log_entries_expanded` view — a view carrying a window function is
 * not updatable.
 *
 * Nothing here stamps who or when: `shift_log_amend_guard` does that in the
 * database, and it rejects the update outright if the note is blank. RLS
 * decides who may amend at all (the author, or a manager). That means this
 * function is deliberately thin — the rules it looks like it's missing are
 * enforced a layer below, where a future caller can't skip them.
 *
 * A second amendment **appends** rather than overwrites. `amend_note` is one
 * column and the guard resets `amended_at` on every write, so appending is
 * what keeps the earlier correction readable instead of silently replacing
 * the record of it.
 */
export async function amendLogEntry(
  entryId: string,
  note: string,
  existingNote: string | null
): Promise<void> {
  const supabase = createClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `[${stamp}] ${note.trim()}`;

  const { error } = await supabase
    .from("shift_log_entries")
    .update({ amend_note: existingNote ? `${existingNote}\n${entry}` : entry })
    .eq("id", entryId);

  if (error) {
    // An RLS refusal surfaces as "no rows updated" rather than a 403, so the
    // generic message would read as a bug rather than a permission problem.
    throw new Error(
      error.code === "42501"
        ? "You can only amend your own entries, unless you're a manager."
        : error.message
    );
  }
}
