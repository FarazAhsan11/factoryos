import {
  formatRunTime,
  progressPct,
  type ShiftReportRoom,
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
  "Room",
  "Status / stage",
  "Flag",
  "EQ no.",
  "Run time",
  "Product",
  "Code",
  "Batch",
  "Shift qty",
  "Accumulative",
  // The entry own target_qty (speed x duration), not the batch order
  // quantity — named as the sheet and the log form name it.
  "Shift target",
  "Progress %",
  "Rejected",
  "Operators",
  "Comments",
  "Speed",
  "Speed unit",
  "Target speed",
] as const;

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
    // Idle rooms are exported too. Their absence from the file would be read
    // as "no such room", not as "that room was idle" — the same reason they
    // stay on the printed sheet.
    if (room.entries.length === 0) {
      lines.push(
        [room.name, room.idleStatus ?? "READY", ...Array(16).fill("")]
          .map(escape)
          .join(","),
      );
      continue;
    }

    for (const entry of room.entries) {
      const pct = progressPct(entry);
      lines.push(
        [
          room.name,
          entry.process_name,
          entry.action_flag,
          entry.equipment_no,
          formatRunTime(entry.duration_minutes),
          entry.product_name,
          entry.product_code,
          entry.batch_no,
          entry.qty,
          entry.accumulative,
          entry.target_qty,
          pct,
          entry.qty_rejected,
          entry.operators?.filter(Boolean).join(" / "),
          entry.comment || entry.slow_reason,
          entry.actual_speed,
          entry.speed_unit,
          entry.target_speed,
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
