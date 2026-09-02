import {
  composeSpeedUnit,
  type EditEntryParsed,
  type LogEntryParsed,
} from "@/app/factory/[slug]/log/schemas";
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
  /** The planned stage this counts towards, once resolved (0033). */
  batch_stage_id: string | null;
  /** Null for an activity that produces nothing (Idle, Break, cleaning). */
  target_qty: number | null;
  qty: number | null;
  /**
   * What `qty` is counted in — drums, kg, litres. Preparatory stages only;
   * a production entry measures in whatever `speed_unit` counts.
   */
  qty_unit: string | null;
  qty_rejected: number | null;
  speed_unit: string | null;
  target_speed: number | null;
  actual_speed: number | null;
  slow_reason: string | null;
  /** Everyone who ran it, in the order entered. Never null — `{}` if unknown. */
  operators: string[];
  comment: string | null;
  action_flag: string | null;
  created_at: string;
  amended_at: string | null;
  amend_note: string | null;
  /** Who filed it — decides whether this viewer may amend it. */
  logged_by: string | null;
  /** Joined names, so the feed never has to cross-reference three caches. */
  unit: { name: string } | null;
  process: {
    name: string;
    has_machine: boolean;
    /** downtime | preparatory | production — see migration 0030. */
    category: string;
  } | null;
  product: { name: string; code: string | null } | null;
}

const COLUMNS = `
  id, unit_id, process_id, log_date, shift, start_time, end_time,
  duration_minutes, equipment_no, batch_no, batch_stage_id,
  target_qty, qty, qty_unit, qty_rejected,
  speed_unit, target_speed, actual_speed, slow_reason,
  operators, comment, action_flag,
  created_at, amended_at, amend_note, logged_by,
  unit:factory_units ( name ),
  process:factory_processes ( name, has_machine, category ),
  product:factory_products ( name, code )
`;

export const logKeys = {
  /** Prefix covering every cached day — invalidate this after an insert. */
  factory: (factoryId: string) => ["shift_log_entries", factoryId] as const,
  /** One key per factory + working day: the feed is a day's worth of shift. */
  day: (factoryId: string, date: string) =>
    ["shift_log_entries", factoryId, date] as const,
  /** The overrun flags for one day — see `fetchOverrunFlags`. */
  overruns: (factoryId: string, date: string) =>
    ["shift_log_entries", factoryId, date, "overruns"] as const,
};

/* ── Overproduction ───────────────────────────────────────────────────── */

export interface OverrunFlag {
  id: string;
  /** Everything logged for this batch and activity, up to this entry. */
  accumulative: number | null;
  required_qty: number | null;
  /** Required plus the batch's declared overage — the threshold crossed. */
  allowed_qty: number | null;
  overage_pct: number;
  /**
   * How far past its **allowance** this batch and activity has gone — the
   * work order plus whatever overage was declared on the batch, not the work
   * order alone (migration 0032).
   */
  overrun_qty: number | null;
  /** Over the allowance and nobody has said why yet. */
  needs_overrun_note: boolean;
  overrun_note: string | null;
  /** Who explained it, once someone has. */
  overrun_cleared_by_name: string | null;
}

/**
 * The overproduction flags for one day, keyed by entry id.
 *
 * A second query rather than more columns on `fetchLogEntries`, because the
 * two read different things. The feed reads `shift_log_entries` directly —
 * it needs the nested unit/process/product shape, and the insert returns that
 * same shape so a new entry can be shown optimistically. The overrun flag
 * cannot come from there: it compares a batch's *running total* against its
 * requirement, and that total is a window function living in
 * `shift_log_entries_expanded`.
 *
 * Small, cached per day alongside the feed itself, and merged by id in the
 * browser — cheaper than reshaping the feed's read around one badge.
 */
export async function fetchOverrunFlags(
  factoryId: string,
  date: string,
): Promise<Map<string, OverrunFlag>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries_expanded")
    .select(
      // The three numbers behind the badge come with it: the explain dialog
      // opens straight from the feed, and without them it could only say
      // "over by 700" with nothing to measure that against.
      "id, accumulative, required_qty, allowed_qty, overage_pct, " +
        "overrun_qty, needs_overrun_note, overrun_note, overrun_cleared_by_name",
    )
    .eq("factory_id", factoryId)
    .eq("log_date", date);

  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as unknown as OverrunFlag[]).map((row) => [row.id, row]),
  );
}

/**
 * Records why a batch produced more than its work order required, which is
 * what clears the flag.
 *
 * An ordinary update, deliberately. `shift_log_amend_guard` recognises a
 * write that touches nothing but the overrun columns, and treats it as its own
 * act: no `amend_note` is demanded and `amended_at` is left alone, because
 * nothing about what happened on the floor was corrected. The same trigger
 * refuses it outright unless the caller can manage the factory, and stamps who
 * explained it — so the manager-only rule is not something this function is
 * trusted to have checked.
 */
export async function explainOverrun(
  entryId: string,
  note: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("shift_log_entries")
    .update({ overrun_note: note.trim() })
    .eq("id", entryId);

  if (error) throw new Error(error.message);
}

export async function fetchLogEntries(
  factoryId: string,
  date: string,
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
  batchNo: string,
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

/**
 * Builds the column set a shift-log entry stores, from what a form produced.
 *
 * The three shapes decided by the stage's category (migration 0030) are
 * applied **here** rather than trusted from the form, because a field the
 * current shape doesn't render may still hold a value typed under a previous
 * one — switch from Encapsulation to a tea break with a quantity already
 * entered and, without these gates, the break gets filed carrying it. That is
 * true of a correction as much as of a new entry, which is why the insert and
 * the update read from one function instead of two copies that can drift.
 */
export function entryColumns(
  values: LogEntryParsed | EditEntryParsed,
  productId: string | null,
) {
  const production = values.category === "production";
  const preparatory = values.category === "preparatory";
  const output = production || preparatory;
  // Speed and equipment are a production-and-machine pair; the schema and the
  // 0030 trigger both force hasMachine false elsewhere, so this is belt and
  // braces on a column that feeds OEE.
  const machine = production && values.hasMachine;
  // "Caps" + "hr" -> "Caps/hr"; RPM and Batches carry no rate.
  const speedUnit = values.speedType
    ? composeSpeedUnit(values.speedType, values.speedRate ?? "hr")
    : null;

  return {
    unit_id: values.unitId,
    process_id: values.processId,
    shift: values.shift,
    start_time: values.startTime,
    end_time: values.endTime,
    duration_minutes: durationMinutes(values.startTime, values.endTime),
    // Equipment belongs to a machine stage, same rule as speed below. Without
    // this, typing an equipment number and then switching to a manual
    // activity files a manual entry carrying kit it never touched.
    equipment_no: machine ? values.equipmentNo || null : null,
    batch_no: values.batchNo || null,
    product_id: productId,
    // Quantities belong to activities that produce something. A break or an
    // idle period stores null, not 0 — otherwise a hundred legitimate zeroes
    // drag every output and quality average computed over them.
    // A shift target is speed x duration, so only a production stage has one.
    // A preparatory stage has no target speed to derive it from.
    target_qty: production ? (values.targetQty ?? null) : null,
    qty: output ? (values.qty ?? null) : null,
    // The unit half of a preparatory measurement — "3" alone is not something
    // anyone can read back. Production measures in whatever `speed_unit`
    // counts, so it stores null rather than repeating itself.
    qty_unit: preparatory ? (values.qtyUnit ?? null) : null,
    // Rejects are the one quantity left blankable, and blank means zero here
    // rather than unknown: on a production stage, "none were rejected" is a
    // real measurement. Null would drop the entry out of the quality rate's
    // denominator and quietly flatter it. A preparatory stage isn't asked at
    // all, so null there is the truth — not "none".
    qty_rejected: production ? (values.qtyRejected ?? 0) : null,
    // Speed belongs to machine processes only — a manual entry stores null
    // rather than zeroes, so OEE can tell "not applicable" from "stopped".
    speed_unit: machine ? speedUnit : null,
    target_speed: machine ? (values.targetSpeed ?? null) : null,
    actual_speed: machine ? (values.actualSpeed ?? null) : null,
    slow_reason: machine ? values.slowReason || null : null,
    // Trimmed, de-duplicated and stripped of blanks by the schema. Empty on a
    // waiting-time activity, which the column allows — its only constraint is
    // a ceiling of 20, never a floor.
    operators: values.operators,
    comment: values.comment || null,
    // Downtime records the time and nothing else — an issue raised off one is
    // a deliberate act in Issues & CAPAs, not a side effect of the form still
    // holding a flag picked before the activity changed.
    action_flag:
      values.category === "downtime" ? null : (values.actionFlag ?? null),
  };
}

/**
 * Rewrites a filed entry, and records why.
 *
 * The other kind of amendment. `amendLogEntry` attaches a note beside numbers
 * that stay as they were; this one changes them — which is what a supervisor
 * reading the shift report actually needs when a room typed 200 where it made
 * 2,000, because a note explaining that the figure is wrong still leaves every
 * total downstream reading the wrong figure.
 *
 * Nothing here stamps who or when, and nothing here checks standing:
 * `shift_log_amend_guard` refuses the update outright without a note, stamps
 * `amended_at` / `amended_by` from the session, and forces `factory_id`,
 * `logged_by` and `created_at` back to their originals whatever this sends.
 * RLS decides who may amend at all — the author, or a manager. The rules this
 * function looks like it is missing are enforced a layer below, where a future
 * caller cannot skip them.
 *
 * `batch_stage_id` is sent explicitly rather than left alone, and that is
 * load-bearing: `shift_log_stage_guard` returns early on an update whose stage
 * is unchanged, so an entry moved to a different batch or activity would keep
 * pointing at the stage it used to belong to. The caller resolves it the same
 * way the entry form does.
 *
 * The note **appends**. `amend_note` is one column and the guard re-stamps
 * `amended_at` on every write, so appending is what keeps the earlier
 * correction readable instead of silently replacing the record of it.
 */
export async function updateLogEntry(
  entryId: string,
  values: EditEntryParsed,
  productId: string | null,
  batchStageId: string | null,
  existingNote: string | null,
): Promise<void> {
  const supabase = createClient();
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `[${stamp}] ${values.note.trim()}`;

  const { error } = await supabase
    .from("shift_log_entries")
    .update({
      ...entryColumns(values, productId),
      // Downtime is forced null by the guard; everywhere else this is either
      // the stage the caller resolved or null, which asks the guard to resolve
      // it again from the batch and activity.
      batch_stage_id: values.category === "downtime" ? null : batchStageId,
      amend_note: existingNote
        ? `${existingNote}
${entry}`
        : entry,
    })
    .eq("id", entryId);

  if (error) {
    // An RLS refusal surfaces as a 42501 rather than a 403, so the generic
    // message would read as a bug rather than a permission problem.
    throw new Error(
      error.code === "42501"
        ? "You can only correct your own entries, unless you're a manager."
        : error.message,
    );
  }
}

export async function createLogEntry(
  values: LogEntryParsed,
  loggedBy: string,
  logDate: string,
  productId: string | null,
): Promise<LogEntry> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("shift_log_entries")
    .insert({
      factory_id: values.factoryId,
      log_date: logDate,
      ...entryColumns(values, productId),
      // Null is the normal answer — `shift_log_stage_guard` fills it in when
      // the batch runs this activity once, and refuses the entry when it runs
      // it several times without saying which. Downtime is forced null there.
      batch_stage_id: values.batchStageId ?? null,
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
  existingNote: string | null,
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
        : error.message,
    );
  }
}
