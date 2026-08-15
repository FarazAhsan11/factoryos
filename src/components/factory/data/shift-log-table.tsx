"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  FileSearch,
  PencilLine,
  TrendingUp,
} from "lucide-react";

import { formatMinutes } from "@/lib/factory/shift-log-queries";
import type {
  LogTableRow,
  LogTableSort,
  LogTableStats,
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
  { key: "operators_text", label: "Operators" },
  { key: "action_flag", label: "Flag" },
  { key: "comment", label: "Comments" },
];

const TH =
  "sticky top-0 z-10 whitespace-nowrap border-b-2 border-[#E6EAF1] bg-[#F8FAFC] px-2.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.5px] text-[#64748B]";
const TD = "px-2.5 py-2 align-middle";
const MONO = "font-mono text-[11.5px]";

/* ── Footer totals ───────────────────────────────────────────────────────
   Which columns a total is a truthful answer for. Deliberately short:

   · Accum. is already a running total. Summing running totals adds the same
     units in once per entry and produces a number with no meaning at all.
   · Target and actual speed are rates, not amounts. 1,200 caps/hr plus
     980 caps/hr is not 2,180 of anything; the honest summary of a rate
     column is a duration-weighted average, which is OEE's job, not a
     footer's.

   Keyed by column so the row is built by walking COLUMNS — a column added or
   moved above carries its footer cell with it instead of silently shifting
   every total one place to the left. */
const TOTALS: Partial<
  Record<SortColumn, (stats: LogTableStats) => number>
> = {
  duration_minutes: (s) => s.totalMinutes,
  qty: (s) => s.totalQty,
  target_qty: (s) => s.totalTargetQty,
  qty_rejected: (s) => s.totalRejected,
};

const FIRST_TOTAL = COLUMNS.findIndex((c) => c.key in TOTALS);
const LAST_TOTAL = COLUMNS.map((c) => c.key in TOTALS).lastIndexOf(true);

/**
 * Truncates rather than rounds, so a rate below 100 never *displays* as 100.
 * One reject in 11,000 units is 99.9909% — rounding that to "100.0%" tells a
 * supervisor the shift was clean when it wasn't. Only a genuinely defect-free
 * slice shows 100%.
 */
function formatQualityRate(rate: number): string {
  return (Math.floor(rate * 10) / 10).toFixed(1);
}

export function ShiftLogTable({
  rows,
  sort,
  onSort,
  isPending,
  unitWord,
  hasFilters,
  canAmend,
  onAmend,
  canExplainOverrun,
  onExplainOverrun,
  showTotals,
  stats,
  statsPending,
  statsError,
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
  /** Manager and up only — the trigger refuses everyone else anyway. */
  canExplainOverrun: boolean;
  onExplainOverrun: (row: LogTableRow) => void;
  /**
   * Whether the footer exists at all. A separate flag from `stats` being
   * present so the row doesn't blink out of the table on every refetch —
   * totals are shown or not shown by the filters, not by load state.
   */
  showTotals: boolean;
  /** Totals for the whole filtered set, not the page on screen. */
  stats?: LogTableStats;
  statsPending?: boolean;
  statsError?: Error | null;
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
              canExplainOverrun={canExplainOverrun}
              onExplainOverrun={() => onExplainOverrun(row)}
            />
          ))}
        </tbody>

        {showTotals && (
          <TotalsRow
            stats={stats}
            isPending={Boolean(statsPending)}
            error={statsError}
            shown={rows.length}
          />
        )}
      </table>
    </div>
  );
}

/**
 * Totals for the filtered set, under the columns they total.
 *
 * They describe every matching entry, not the 25 rows on screen — the numbers
 * come from the `shift_log_stats` RPC, because summing the visible page would
 * quietly answer a different question on any table with more than one page.
 * "Showing 25 of 812" in the first cell is what keeps that readable rather
 * than looking like an arithmetic error.
 *
 * A `<tfoot>` rather than a bar above the table: a total that sits in the
 * "Rejected" column needs no label to say what it totals, and it scrolls
 * sideways in step with the column it belongs to.
 */
function TotalsRow({
  stats,
  isPending,
  error,
  shown,
}: {
  stats?: LogTableStats;
  isPending: boolean;
  error?: Error | null;
  shown: number;
}) {
  // Two signals, not one: a rule dark enough to read as a boundary rather
  // than another row separator, and a background a shade deeper than the
  // header's. The rows above are sometimes tinted (a flagged entry is pink,
  // a reject amber), so a pale line like the body's #F1F5F9 dividers
  // disappeared against them and the totals read as one more entry.
  const TF =
    "border-t-2 border-[#94A3B8] bg-[#F1F5F9] px-2.5 py-3 text-[11px] font-semibold text-[#0F1B34]";

  if (error) {
    return (
      <tfoot>
        <tr>
          <td colSpan={COLUMNS.length + 1} className={cn(TF, "text-[#B91C1C]")}>
            Totals unavailable: {error.message}
          </td>
        </tr>
      </tfoot>
    );
  }

  const quality = stats?.qualityRate ?? null;

  return (
    <tfoot className={cn("transition-opacity", isPending && "opacity-50")}>
      <tr>
        <td
          colSpan={FIRST_TOTAL}
          className={cn(TF, "whitespace-nowrap text-[#64748B]")}
        >
          Showing <strong className="text-[#0F1B34]">{num(shown)}</strong> of{" "}
          <strong className="text-[#0F1B34]">
            {stats ? num(stats.entryCount) : DASH}
          </strong>{" "}
          entries
        </td>

        {COLUMNS.slice(FIRST_TOTAL, LAST_TOTAL + 1).map((column) => {
          // The totalled columns aren't contiguous — Room, Activity, Batch,
          // Product and Code sit between Duration and Qty produced. Their
          // cells exist to hold the row's shape and are left *empty*: an
          // em-dash there reads as a missing total for a column that can't
          // have one, and lands right-aligned under a left-aligned header.
          const totalOf = TOTALS[column.key];
          if (!totalOf) return <td key={column.key} className={TF} />;

          const total = stats ? totalOf(stats) : undefined;
          return (
            <td
              key={column.key}
              className={cn(
                TF,
                MONO,
                "whitespace-nowrap text-right",
                // The one total worth colouring: rejects are what a supervisor
                // filters down to find, and zero of them is good news.
                column.key === "qty_rejected" &&
                  total !== undefined &&
                  total > 0 &&
                  "text-[#B91C1C]"
              )}
            >
              {total === undefined
                ? DASH
                : column.key === "duration_minutes"
                  ? total > 0
                    ? formatMinutes(total)
                    : DASH
                  : num(total)}
            </td>
          );
        })}

        {/* Not a column total — a ratio derived from two of them, parked in
            the space the un-totallable columns leave. Labelled, so it can't
            be read as a total of the column it happens to sit under. */}
        <td
          colSpan={COLUMNS.length - LAST_TOTAL}
          className={cn(TF, "whitespace-nowrap")}
        >
          {quality !== null && (
            <span
              className={cn(
                quality >= 98
                  ? "text-[#16A34A]"
                  : quality >= 95
                    ? "text-[#B45309]"
                    : "text-[#DC2626]"
              )}
            >
              Quality rate: {formatQualityRate(quality)}%
            </span>
          )}
        </td>
      </tr>
    </tfoot>
  );
}

function Row({
  row,
  canAmend,
  onAmend,
  canExplainOverrun,
  onExplainOverrun,
}: {
  row: LogTableRow;
  canAmend: boolean;
  onAmend: () => void;
  canExplainOverrun: boolean;
  onExplainOverrun: () => void;
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
        !row.action_flag && rejected > 0 && "bg-[#FFFBEB]/60",
        // An unexplained overrun tints too, but only when nothing louder
        // already has: a flagged entry is still the more urgent row.
        !row.action_flag &&
          rejected === 0 &&
          row.needs_overrun_note &&
          "bg-[#FFFBEB]/60"
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

      {/* The accumulative total is where an overrun becomes visible — it is
          the number that went past the requirement — so the comparison is
          shown right here rather than in a column of its own. */}
      <td
        className={cn(
          TD,
          MONO,
          "text-right",
          row.is_overrun ? "font-semibold text-[#B45309]" : "text-[#16A34A]"
        )}
        title={
          row.is_overrun
            ? `${num(row.accumulative)} of ${num(row.required_qty)} required — over by ${num(row.overrun_qty)}`
            : "Everything logged for this batch and activity, up to this entry"
        }
      >
        {num(row.accumulative)}
        {row.is_overrun && (
          <span className="block text-[10px] font-semibold text-[#B45309]">
            +{num(row.overrun_qty)}
          </span>
        )}
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

      {/* Truncated, with the full list on hover: an entry run by five people
          would otherwise stretch the column past everything beside it. */}
      <td
        className={cn(TD, "max-w-[140px] truncate text-[11.5px] text-[#334155]")}
        title={row.operators?.join(" / ") || undefined}
      >
        {row.operators?.length ? (
          <>
            {row.operators[0]}
            {row.operators.length > 1 && (
              <span className="text-[#94A3B8]">
                {" "}
                / {row.operators.slice(1).join(" / ")}
              </span>
            )}
          </>
        ) : (
          DASH
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
        ) : !row.is_overrun ? (
          <span className="text-[#94A3B8]">{DASH}</span>
        ) : null}

        {/* Two states, not one. Unexplained is the thing to act on; explained
            still says the batch ran over, because that is a fact about the
            batch and not a problem that went away when someone described it. */}
        {row.needs_overrun_note ? (
          <span
            className="ml-1 inline-block rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-bold text-[#B45309]"
            title={`Over the required quantity by ${num(row.overrun_qty)} — needs a manager's explanation`}
          >
            Attention
          </span>
        ) : row.is_overrun ? (
          <span
            className="ml-1 inline-block rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]"
            title={row.overrun_note ?? undefined}
          >
            Overrun explained
          </span>
        ) : null}
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
        {/* The explanation that cleared the flag, shown rather than hidden in
            a tooltip. A manager-only clearance whose reason and author nobody
            can read is a control on paper only. */}
        {row.overrun_note && (
          <span
            className="mt-0.5 block truncate text-[10px] text-[#B45309]"
            title={`${row.overrun_note}${
              row.overrun_cleared_by_name
                ? ` — ${row.overrun_cleared_by_name}`
                : ""
            }`}
          >
            ↳ Overrun: {row.overrun_note}
            {row.overrun_cleared_by_name && (
              <span className="text-[#92400E]">
                {" "}
                — {row.overrun_cleared_by_name}
              </span>
            )}
          </span>
        )}
      </td>

      <td className={cn(TD, "text-right")}>
        {/* Offered above Amend when both apply: clearing the flag is the more
            urgent of the two, and it isn't an amendment — the entry is right,
            it just needs accounting for. */}
        {canExplainOverrun && row.needs_overrun_note && (
          <button
            type="button"
            onClick={onExplainOverrun}
            title="Record why this batch went past its required quantity"
            className="mb-1 inline-flex h-7 items-center gap-1 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2 text-[11px] font-semibold text-[#B45309] transition hover:border-[#B45309]"
          >
            <TrendingUp className="size-3" />
            Explain
          </button>
        )}
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
