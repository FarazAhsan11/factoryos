import type { RunningShift } from "@/lib/factory/shift-time-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Shift Report — one day, one shift, every room.
 *
 * Reads the same `shift_log_entries_expanded` view the data table does, but
 * with a different question in mind. The data table answers "find me the
 * entries matching this", so it filters, sorts and pages in Postgres. This
 * answers "what happened on the floor during that shift" — a fixed, small
 * slice (one date, one shift; tens of rows, not thousands) that is always read
 * whole. So it fetches the slice and does the grouping, the room ordering and
 * the totals in the browser, where the same rows also have to be laid out.
 *
 * The two live side by side on purpose. Aggregating this in SQL would mean a
 * view or an RPC that produced exactly one screen's shape and nothing else.
 */

export interface ShiftReportRow {
  id: string;
  unit_id: string;
  unit_name: string | null;
  process_id: string;
  process_name: string | null;
  /** downtime | preparatory | production — which shape the entry was filed in. */
  process_category: string | null;
  /** Whether the activity runs on a machine, so speed and equipment apply. */
  has_machine: boolean | null;
  equipment_no: string | null;
  log_date: string;
  shift: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  batch_no: string | null;
  /** Which planned stage it counts towards, where the batch has a plan (0033). */
  batch_stage_id: string | null;
  target_qty: number | null;
  qty: number | null;
  /** What `qty` counts in on a preparatory entry (drums, kg…). */
  qty_unit: string | null;
  /** What the entry's stage counts in — production's unit; see the fetch. */
  stage_unit: string | null;
  qty_rejected: number | null;
  accumulative: number | null;
  operators: string[];
  comment: string | null;
  slow_reason: string | null;
  speed_unit: string | null;
  target_speed: number | null;
  actual_speed: number | null;
  action_flag: string | null;
  created_at: string;
  /** Who filed it — decides, with the viewer's role, whether they may correct it. */
  logged_by: string | null;
  amended_at: string | null;
  amend_note: string | null;
}

/**
 * Wider than the sheet renders, and deliberately so. Since the report's rows
 * are editable, each one has to carry everything the correction dialog opens
 * on — the activity and its category, the times, the stage, who filed it —
 * because the alternative is a second round-trip per row the moment somebody
 * clicks Edit, against a slice that was already fetched whole.
 */
const COLUMNS = `
  id, unit_id, unit_name, process_id, process_name, process_category,
  has_machine, equipment_no, log_date, shift, start_time, end_time,
  duration_minutes, product_id, product_name, product_code, batch_no,
  batch_stage_id, target_qty, qty, qty_unit, qty_rejected, accumulative,
  operators, comment, slow_reason,
  speed_unit, target_speed, actual_speed, action_flag, created_at,
  logged_by, amended_at, amend_note
`;

export const shiftReportKeys = {
  entries: (factoryId: string, date: string, shift: RunningShift) =>
    ["shift_report", factoryId, date, shift] as const,
};

export async function fetchShiftReportEntries(
  factoryId: string,
  date: string,
  shift: RunningShift,
): Promise<ShiftReportRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .eq("log_date", date)
    .eq("shift", shift)
    // Filed order within a room is the order things happened, which is how a
    // shift report reads. Room grouping happens below, on names the browser
    // already has.
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Omit<ShiftReportRow, "stage_unit">[];

  // A production entry stores no unit of its own — it counts in whatever its
  // stage does — and the view doesn't carry one. Read for this slice alone: a
  // sheet of a few dozen rows doesn't need every stage the factory ever planned.
  const stageIds = [...new Set(rows.flatMap((r) => r.batch_stage_id ?? []))];
  const units = new Map<string, string>();
  if (stageIds.length > 0) {
    const { data: stages, error: stageError } = await supabase
      .from("batch_stages")
      .select("id, target_unit")
      .in("id", stageIds);
    if (stageError) throw new Error(stageError.message);
    for (const stage of stages ?? []) units.set(stage.id, stage.target_unit);
  }

  return rows.map((row) => ({
    ...row,
    stage_unit: units.get(row.batch_stage_id ?? "") ?? null,
  }));
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

export interface ShiftReportRoom {
  unitId: string;
  name: string;
  entries: ShiftReportRow[];
  /** Everything this room made this shift. */
  producedQty: number;
}

/**
 * "Room 10" sorts before "Room 2" alphabetically, which is wrong on a sheet
 * people read by room number. Compares the embedded number first and falls
 * back to the text for rooms named without one.
 */
export function compareRoomNames(a: string, b: string): number {
  const na = Number(a.replace(/\D/g, ""));
  const nb = Number(b.replace(/\D/g, ""));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * The rooms that logged something this shift, in room order, each with its
 * entries. A room with no entries has no place on the sheet, so the entries
 * alone decide who is listed — a room since deactivated included, because its
 * work still happened.
 */
export function groupByRoom(entries: ShiftReportRow[]): ShiftReportRoom[] {
  const rooms = new Map<string, ShiftReportRoom>();
  for (const entry of entries) {
    const room = rooms.get(entry.unit_id);
    if (room) {
      room.entries.push(entry);
      room.producedQty += entry.qty ?? 0;
    } else {
      rooms.set(entry.unit_id, {
        unitId: entry.unit_id,
        name: entry.unit_name ?? "—",
        entries: [entry],
        producedQty: entry.qty ?? 0,
      });
    }
  }
  return [...rooms.values()].sort((a, b) => compareRoomNames(a.name, b.name));
}

export interface ShiftReportTotals {
  entries: number;
  roomsActive: number;
  produced: number;
  rejected: number;
  flagged: number;
}

export function summarise(entries: ShiftReportRow[]): ShiftReportTotals {
  return {
    entries: entries.length,
    roomsActive: new Set(entries.map((e) => e.unit_id)).size,
    // `qty` is null on an activity that produces nothing — a clean-down, a
    // break — and null is not zero. Summing coalesces, but the distinction is
    // why nothing here divides by the entry count.
    produced: entries.reduce((sum, e) => sum + (e.qty ?? 0), 0),
    rejected: entries.reduce((sum, e) => sum + (e.qty_rejected ?? 0), 0),
    flagged: entries.filter((e) => e.action_flag).length,
  };
}

/* ── Display ──────────────────────────────────────────────────────────── */

/** Today as `YYYY-MM-DD` in the viewer's own timezone, not UTC. */
export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * "30 Jun 2026" — the date as it should read on a printed sheet.
 *
 * Assembled by hand rather than through toLocaleDateString. The locale
 * argument was undefined, which means *the environment*: Node renders the
 * server pass in its own locale and the browser re-renders in the users, so
 * a sheet dated "Sep 5, 2026" on the server became "5 Sept 2026" on the
 * client and React reported a hydration mismatch on that very text node. A
 * fixed month table is the same three letters everywhere, which is also what
 * a document that gets printed and filed wants.
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

export function formatReportDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? MONTHS[0];
  return `${d ?? 1} ${month} ${y}`;
}

/** Thousands separators, and an em-dash for "doesn't apply". */
export function formatQty(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

/**
 * Progress against the batch requirement, as a percentage.
 *
 * Reads `accumulative` — the running total for the batch across the whole
 * log — not this entry's `qty`, because the question a supervisor asks of a
 * batch is how far through it is, not how much moved in the last two hours.
 */
export function progressPct(row: ShiftReportRow): number | null {
  if (!row.target_qty || !row.accumulative) return null;
  return Math.min(100, Math.round((row.accumulative / row.target_qty) * 100));
}
