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
  process_name: string | null;
  equipment_no: string | null;
  duration_minutes: number;
  product_name: string | null;
  product_code: string | null;
  batch_no: string | null;
  target_qty: number | null;
  qty: number | null;
  /** What `qty` counts in on a preparatory entry (drums, kg…). */
  qty_unit: string | null;
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
}

const COLUMNS = `
  id, unit_id, unit_name, process_name, equipment_no, duration_minutes,
  product_name, product_code, batch_no,
  target_qty, qty, qty_unit, qty_rejected, accumulative,
  operators, comment, slow_reason,
  speed_unit, target_speed, actual_speed, action_flag, created_at
`;

export const shiftReportKeys = {
  entries: (factoryId: string, date: string, shift: RunningShift) =>
    ["shift_report", factoryId, date, shift] as const,
};

export async function fetchShiftReportEntries(
  factoryId: string,
  date: string,
  shift: RunningShift
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
  return (data ?? []) as unknown as ShiftReportRow[];
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

/** What a room with no entries this shift was doing, per the pipeline board. */
export type IdleStatus = "READY" | "PRODUCTION" | "HOLD" | "PLANNED";

export interface ShiftReportRoom {
  unitId: string;
  name: string;
  entries: ShiftReportRow[];
  /** Only set when `entries` is empty — an idle room still says something. */
  idleStatus: IdleStatus | null;
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
 * Every room in the factory, in room order, each with its entries.
 *
 * Rooms with nothing logged are **kept**, not dropped. A shift report that
 * lists only the busy rooms cannot answer "was anything running in 7?", and
 * the blank row is the answer — which is exactly why the prototype prints
 * them. Their status comes from the pipeline board rather than being assumed
 * idle: a room holding a batch is not the same as a room standing ready.
 */
export function groupByRoom(
  units: { id: string; name: string }[],
  entries: ShiftReportRow[],
  pipelineByUnit: Map<string, IdleStatus>
): ShiftReportRoom[] {
  const byUnit = new Map<string, ShiftReportRow[]>();
  for (const entry of entries) {
    const list = byUnit.get(entry.unit_id);
    if (list) list.push(entry);
    else byUnit.set(entry.unit_id, [entry]);
  }

  // Units the factory has, plus any room that logged an entry but has since
  // been deactivated — its work still happened and still belongs on the sheet.
  const known = new Map(units.map((u) => [u.id, u.name]));
  for (const entry of entries) {
    if (!known.has(entry.unit_id)) {
      known.set(entry.unit_id, entry.unit_name ?? "—");
    }
  }

  return [...known.entries()]
    .map(([unitId, name]) => {
      const rows = byUnit.get(unitId) ?? [];
      return {
        unitId,
        name,
        entries: rows,
        idleStatus: rows.length
          ? null
          : (pipelineByUnit.get(unitId) ?? "READY"),
        producedQty: rows.reduce((sum, r) => sum + (r.qty ?? 0), 0),
      };
    })
    .sort((a, b) => compareRoomNames(a.name, b.name));
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

/** "30 Jun 2026" — the date as it should read on a printed sheet. */
export function formatReportDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** 95 → "1.6h". Minutes under an hour keep their own unit. */
export function formatRunTime(minutes: number): string {
  if (!minutes) return "—";
  return minutes < 60 ? `${minutes}m` : `${(minutes / 60).toFixed(1)}h`;
}

/** Thousands separators, and an em-dash for "doesn't apply". */
export function formatQty(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString();
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
