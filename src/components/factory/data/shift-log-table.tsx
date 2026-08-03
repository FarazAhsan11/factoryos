"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  FileSearch,
  PencilLine,
} from "lucide-react";

import { formatMinutes } from "@/lib/factory/shift-log-queries";
import type {
  LogTableRow,
  LogTableSort,
  SortColumn,
} from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

/* ── Formatting ──────────────────────────────────────────────────────────
   The table's job is to make a shift readable at a glance, so every number
   is formatted for a human and every empty value renders as an em-dash
   rather than a blank cell. The CSV export does the opposite — see
   `shift-log-csv.ts`. */

const DASH = "—";

function num(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return DASH;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "2026-07-31" → "31 Jul", or "31 Jul 25" when it isn't the current year. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return y === new Date().getFullYear() ? day : `${day} ${String(y).slice(2)}`;
}

function clock(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

const FLAG_STYLE: Record<string, string> = {
  Quality: "bg-[#FEE2E2] text-[#DC2626]",
  Maintenance: "bg-[#FEF3C7] text-[#B45309]",
  Safety: "bg-[#FEE2E2] text-[#DC2626]",
  Process: "bg-[#EDE9FE] text-[#7C3AED]",
};

/* ── Column definitions ──────────────────────────────────────────────────
   Declared as data so the header row and the sort state stay in step, and
   so adding a column is one entry rather than three edits. */

interface Column {
  key: SortColumn;
  label: string;
  numeric?: boolean;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "log_date", label: "Date" },
  { key: "shift", label: "Shift" },
  { key: "start_time", label: "Start → End" },
  { key: "duration_minutes", label: "Duration", numeric: true },
  { key: "unit_name", label: "Room" },
  { key: "process_name", label: "Activity / Stage" },
  { key: "batch_no", label: "Batch" },
  { key: "product_name", label: "Product" },
  { key: "product_code", label: "Code" },
  { key: "qty", label: "Qty produced", numeric: true },
  { key: "target_qty", label: "Shift target", numeric: true },
  { key: "qty_rejected", label: "Rejected", numeric: true },
  { key: "accumulative", label: "Accum.", numeric: true },
  { key: "target_speed", label: "Target speed", numeric: true },
  { key: "actual_speed", label: "Actual speed" },
  { key: "slow_reason", label: "Slow reason" },
  { key: "equipment_no", label: "EQ No." },
  { key: "operator_1", label: "Operator" },
  { key: "action_flag", label: "Flag" },
  { key: "comment", label: "Comments" },
];

const TH =
  "sticky top-0 z-10 whitespace-nowrap border-b-2 border-[#E6EAF1] bg-[#F8FAFC] px-2.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.5px] text-[#64748B]";
const TD = "px-2.5 py-2 align-middle";
const MONO = "font-mono text-[11.5px]";

export function ShiftLogTable({
  rows,
  sort,
  onSort,
  isPending,
  unitWord,
  hasFilters,
  canAmend,
  onAmend,
}: {
  rows: LogTableRow[];
  sort: LogTableSort;
  onSort: (column: SortColumn) => void;
  isPending: boolean;
  unitWord: string;
  /** Changes the empty state from "nothing logged" to "nothing matches". */
  hasFilters: boolean;
  /** Mirrors the update policy: the author, or a manager. */
  canAmend: (row: LogTableRow) => boolean;
  onAmend: (row: LogTableRow) => void;
}) {
  if (!isPending && rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-16 text-center">
        <FileSearch className="mx-auto mb-3 size-7 text-[#CBD5E1]" />
        <p className="text-sm text-[#64748B]">
          {hasFilters
            ? "No entries match the current filters."
            : "Nothing has been logged yet."}
        </p>
        <p className="mt-1 text-xs text-[#94A3B8]">
          {hasFilters
            ? "Try clearing the filters or widening the date range."
            : "Entries logged in the Shift log tab appear here."}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-[#E6EAF1] bg-white transition-opacity",
        isPending && "opacity-60"
      )}
    >
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">
          Shift log entries, sorted by{" "}
          {COLUMNS.find((c) => c.key === sort.column)?.label}{" "}
          {sort.direction === "asc" ? "ascending" : "descending"}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.column === column.key;
              const Icon = !active
                ? ChevronsUpDown
                : sort.direction === "asc"
                  ? ArrowUp
                  : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={cn(TH, column.numeric && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 uppercase transition hover:text-[#2563EB]",
                      column.numeric && "flex-row-reverse",
                      active && "text-[#2563EB]"
                    )}
                  >
                    {column.key === "unit_name" ? unitWord : column.label}
                    <Icon
                      className={cn(
                        "size-3 shrink-0",
                        active ? "opacity-100" : "opacity-30"
                      )}
                    />
                  </button>
                </th>
              );
            })}
            <th scope="col" className={cn(TH, "text-right")}>
              Amend
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              canAmend={canAmend(row)}
              onAmend={() => onAmend(row)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  row,
  canAmend,
  onAmend,
}: {
  row: LogTableRow;
  canAmend: boolean;
  onAmend: () => void;
}) {
  const target = Number(row.target_speed ?? 0);
  const actual = Number(row.actual_speed ?? 0);
  const performance =
    target > 0 && actual > 0 ? Math.round((actual / target) * 100) : null;

  const rejected = Number(row.qty_rejected ?? 0);
  const produced = Number(row.qty ?? 0);

  return (
    <tr
      className={cn(
        "border-b border-[#F1F5F9] last:border-b-0 hover:bg-[#F8FAFC]",
        // A flagged entry is the one a supervisor is scanning for; a reject
        // is the next most interesting. Tint rather than shout — a whole
        // column of red would make neither stand out.
        row.action_flag && "bg-[#FEF2F2]/60",
        !row.action_flag && rejected > 0 && "bg-[#FFFBEB]/60"
      )}
    >
      <td className={cn(TD, MONO, "whitespace-nowrap text-[#475569]")}>
        <time dateTime={row.log_date}>{formatDate(row.log_date)}</time>
      </td>

      <td className={cn(TD, "whitespace-nowrap text-[11px]")}>
        {row.shift === "morning" ? "☀ AM" : "🌙 PM"}
      </td>

      <td className={cn(TD, MONO, "whitespace-nowrap text-[#475569]")}>
        {row.start_time ? clock(row.start_time) : DASH}
        {row.end_time && (
          <span className="text-[#94A3B8]"> → {clock(row.end_time)}</span>
        )}
      </td>

      {/* Rendered as "7h 37min", not 457: an activity that ran most of a
          shift shouldn't need mental arithmetic to read. The exact minute
          count stays on hover, and the CSV exports the raw number so a
          spreadsheet can still sum it. Sorting is unaffected — it happens in
          Postgres on `duration_minutes`. */}
      <td
        className={cn(TD, MONO, "whitespace-nowrap text-right text-[#475569]")}
        title={
          row.duration_minutes > 0 ? `${row.duration_minutes} min` : undefined
        }
      >
        {row.duration_minutes > 0 ? formatMinutes(row.duration_minutes) : DASH}
      </td>

      <td className={cn(TD, "whitespace-nowrap font-semibold text-[#0F1B34]")}>
        {row.unit_name ?? DASH}
      </td>

      <td className={cn(TD, "whitespace-nowrap text-[#334155]")}>
        {row.process_name ?? DASH}
      </td>

      <td className={cn(TD, MONO, "whitespace-nowrap text-[#475569]")}>
        {row.batch_no || DASH}
      </td>

      <td
        className={cn(TD, "max-w-[160px] truncate text-[#334155]")}
        title={row.product_name ?? undefined}
      >
        {row.product_name ?? DASH}
      </td>

      <td className={cn(TD, MONO, "whitespace-nowrap text-[#475569]")}>
        {row.product_code || DASH}
      </td>

      <td
        className={cn(
          TD,
          MONO,
          "text-right font-semibold",
          produced > 0 ? "text-[#2563EB]" : "text-[#94A3B8]"
        )}
      >
        {num(produced)}
      </td>

      <td className={cn(TD, MONO, "text-right text-[#94A3B8]")}>
        {num(row.target_qty)}
      </td>

      <td
        className={cn(
          TD,
          MONO,
          "text-right",
          rejected > 0 ? "font-semibold text-[#DC2626]" : "text-[#94A3B8]"
        )}
      >
        {num(rejected)}
      </td>

      <td
        className={cn(TD, MONO, "text-right text-[#16A34A]")}
        title="Everything logged for this batch and activity, up to this entry"
      >
        {num(row.accumulative)}
      </td>

      <td className={cn(TD, MONO, "whitespace-nowrap text-right text-[#94A3B8]")}>
        {target > 0 ? `${num(target)} ${row.speed_unit ?? ""}`.trim() : DASH}
      </td>

      <td className={cn(TD, "whitespace-nowrap text-[11px]")}>
        {actual > 0 ? (
          <>
            <span className={cn(MONO, "text-[#334155]")}>{num(actual)}</span>
            {performance !== null && (
              <span
                className={cn(
                  "ml-1 font-semibold",
                  performance >= 90
                    ? "text-[#16A34A]"
                    : performance >= 70
                      ? "text-[#B45309]"
                      : "text-[#DC2626]"
                )}
              >
                {performance}%
              </span>
            )}
          </>
        ) : (
          <span className="text-[#94A3B8]">{DASH}</span>
        )}
      </td>

      <td
        className={cn(TD, "max-w-[140px] truncate text-[11px] text-[#64748B]")}
        title={row.slow_reason ?? undefined}
      >
        {row.slow_reason ?? DASH}
      </td>

      <td className={cn(TD, MONO, "whitespace-nowrap text-[#475569]")}>
        {row.equipment_no || DASH}
      </td>

      <td className={cn(TD, "max-w-[140px] truncate text-[11.5px] text-[#334155]")}>
        {row.operator_1 ?? DASH}
        {row.operator_2 && (
          <span className="text-[#94A3B8]"> / {row.operator_2}</span>
        )}
      </td>

      <td className={cn(TD, "whitespace-nowrap")}>
        {row.action_flag ? (
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
              FLAG_STYLE[row.action_flag] ?? "bg-[#F1F5F9] text-[#475569]"
            )}
          >
            {row.action_flag}
          </span>
        ) : (
          <span className="text-[#94A3B8]">{DASH}</span>
        )}
      </td>

      <td
        className={cn(TD, "max-w-[180px] text-[#64748B]")}
        title={row.comment ?? undefined}
      >
        <span className="block truncate">{row.comment ?? DASH}</span>
        {row.amended_at && (
          <span
            className="mt-0.5 block text-[10px] font-semibold text-[#7C3AED]"
            title={row.amend_note ?? undefined}
          >
            ↳ Amended
          </span>
        )}
      </td>

      <td className={cn(TD, "text-right")}>
        {canAmend ? (
          <button
            type="button"
            onClick={onAmend}
            title="Attach a correction note — the original entry is preserved"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#E6EAF1] px-2 text-[11px] font-medium text-[#64748B] transition hover:border-[#B45309] hover:text-[#B45309]"
          >
            <PencilLine className="size-3" />
            Amend
          </button>
        ) : (
          <span
            className="text-[10px] text-[#CBD5E1]"
            title="Only the operator who filed this entry, or a manager, can amend it"
          >
            —
          </span>
        )}
      </td>
    </tr>
  );
}
