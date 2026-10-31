import { formatMinutes } from "@/lib/factory/shift-log-queries";
import {
  progressPct,
  type ShiftReportRoom,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import type { RunningShift } from "@/lib/factory/shift-time-queries";

/**
 * Shift report → CSV.
 *
 * Built from the same room grouping the table renders rather than by scraping
 * the DOM, which is what the prototype did (`querySelectorAll('td')`). Reading
 * cells back out of the table exports whatever the browser happened to
 * render — the truncated product name, the "—" placeholders, the percent sign
 * glued to a number — and silently breaks the moment a column is reordered.
 */

const HEADERS = [
  // In the sheet's order, so the file reads the way the screen does.
  "Room",
  "Activity / Stage",
  "Start → End",
  "Duration",
  "Batch",
  "Product",
  "Product Code",
  "Qty produced",
  "Unit",
  // The entry own target_qty (speed x duration), not the batch order
  // quantity — named as the sheet and the log form name it.
  "Shift target",
  "Rejected",
  "Accumulative Total",
  "Target speed",
  "Actual speed",
  "Slow reason",
  "EQ No.",
  "Operators",
  "Comments",
  // What the sheet folds into another cell. A file has no second line in a
  // cell, and each of these is still worth being able to sort by.
  "Flag",
  "Progress %",
  "Speed unit",
] as const;

/** "06:45 → 07:30", or just the start while an entry has no end. */
function window(entry: ShiftReportRow): string {
  const start = entry.start_time?.slice(0, 5) ?? "";
  const end = entry.end_time?.slice(0, 5);
  return end ? `${start} → ${end}` : start;
}

/** Same guard the shift-log export uses: a leading `=` is a formula in Excel. */
function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toShiftReportCsv(rooms: ShiftReportRoom[]): string {
  const lines: string[] = [HEADERS.join(",")];

  for (const room of rooms) {
    for (const entry of room.entries) {
      lines.push(
        [
          room.name,
          entry.process_name,
          window(entry),
          formatMinutes(entry.duration_minutes),
          entry.batch_no,
          entry.product_name,
          entry.product_code,
          entry.qty,
          entry.qty === null ? null : (entry.qty_unit ?? entry.stage_unit),
          entry.target_qty,
          entry.qty_rejected,
          entry.accumulative,
          entry.target_speed,
          entry.actual_speed,
          entry.slow_reason,
          entry.equipment_no,
          entry.operators?.filter(Boolean).join(" / "),
          entry.comment,
          entry.action_flag,
          progressPct(entry),
          entry.speed_unit,
        ]
          .map(escape)
          .join(","),
      );
    }
  }

  return lines.join("\r\n");
}

/** `shift-report-acme-2026-06-30-morning.csv` */
export function shiftReportFilename(
  factoryName: string,
  date: string,
  shift: RunningShift,
): string {
  const slug =
    factoryName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "factory";
  return `shift-report-${slug}-${date}-${shift}.csv`;
}
