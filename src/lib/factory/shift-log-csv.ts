import type { LogTableRow } from "@/lib/factory/shift-log-table-queries";

/**
 * CSV export for the shift-log data table. The file mirrors the columns on
 * screen, in the same order, so an exported sheet is recognisable as the view
 * it came from — and it exports the *filtered set*, not the visible page.
 *
 * Values are written raw (unformatted numbers, ISO dates, `HH:MM` times):
 * a spreadsheet should receive data it can sum and sort, not the thousands
 * separators and em-dashes the table renders for a human.
 */

const HEADERS = [
  "Date",
  "Shift",
  "Start",
  "End",
  "Duration (min)",
  "Room / Unit",
  "Activity / Stage",
  // Which of the three shapes the row was filed in. Without it a null qty is
  // ambiguous in the export: a downtime row records none by design, whereas a
  // blank on a production row is an omission worth chasing.
  "Stage type",
  "Batch",
  "Product",
  "Product code",
  "Qty produced",
  // The unit half of a preparatory measurement. Blank on production rows,
  // which count in whatever "Speed unit" says.
  "Qty unit",
  "Shift target",
  "Rejected",
  "Accumulative",
  "Speed unit",
  "Target speed",
  "Actual speed",
  "Performance %",
  "Slow reason",
  "Equipment no.",
  // One column, not one per operator: the count varies row to row, so a
  // fixed set of columns would either truncate the long entries or pad every
  // short one with blanks.
  "Operators",
  "Flag",
  "Comments",
  "Amended",
  "Amendment note",
  // Overproduction. Exported because the whole point of a manager-only
  // clearance is that it can be audited later, and an audit that stops at the
  // screen is not one.
  "Required qty",
  "Over by",
  "Overrun status",
  "Overrun reason",
  "Overrun explained by",
  "Overrun explained at",
];

function cells(row: LogTableRow): (string | number | null)[] {
  const perf =
    row.target_speed && row.actual_speed && Number(row.target_speed) > 0
      ? Math.round((Number(row.actual_speed) / Number(row.target_speed)) * 100)
      : null;

  return [
    row.log_date,
    row.shift === "morning" ? "Morning" : "Afternoon",
    row.start_time?.slice(0, 5) ?? "",
    row.end_time?.slice(0, 5) ?? "",
    row.duration_minutes,
    row.unit_name ?? "",
    row.process_name ?? "",
    row.process_category ?? "",
    row.batch_no ?? "",
    row.product_name ?? "",
    row.product_code ?? "",
    row.qty,
    row.qty_unit ?? "",
    row.target_qty,
    row.qty_rejected,
    row.accumulative ?? "",
    row.speed_unit ?? "",
    row.target_speed ?? "",
    row.actual_speed ?? "",
    perf ?? "",
    row.slow_reason ?? "",
    row.equipment_no ?? "",
    row.operators?.join(" / ") ?? "",
    row.action_flag ?? "",
    row.comment ?? "",
    row.amended_at ? "Yes" : "",
    row.amend_note ?? "",
    row.required_qty ?? "",
    row.overrun_qty ?? "",
    row.needs_overrun_note
      ? "Needs explanation"
      : row.is_overrun
        ? "Explained"
        : "",
    row.overrun_note ?? "",
    row.overrun_cleared_by_name ?? "",
    row.overrun_cleared_at ?? "",
  ];
}

/**
 * RFC-4180 quoting: wrap in quotes when the value contains a delimiter,
 * a quote or a newline, and double any embedded quote.
 *
 * The leading-character guard is not cosmetic — a batch number or comment
 * beginning `=`, `+`, `-` or `@` is executed as a formula when the file is
 * opened in Excel or Sheets. Prefixing a tab neutralises it while leaving the
 * text readable.
 */
function escape(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toShiftLogCsv(rows: LogTableRow[]): string {
  const lines = [
    HEADERS.join(","),
    ...rows.map((row) => cells(row).map(escape).join(",")),
  ];
  // CRLF + a BOM (added at download time) is what makes Excel open a UTF-8
  // file with the right encoding and one row per line.
  return lines.join("\r\n");
}

/** `shift-log-acme-2026-07-31.csv` */
export function csvFilename(factoryName: string): string {
  const slug =
    factoryName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "factory";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
  return `shift-log-${slug}-${stamp}.csv`;
}

/** Triggers a browser download of `csv` without a server round-trip. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
