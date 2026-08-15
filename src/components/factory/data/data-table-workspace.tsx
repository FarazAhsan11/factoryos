"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { AmendEntryDialog } from "@/components/factory/data/amend-entry-dialog";
import { ExplainOverrunDialog } from "@/components/factory/data/explain-overrun-dialog";
import { DataTableFilters } from "@/components/factory/data/data-table-filters";
import { ShiftLogTable } from "@/components/factory/data/shift-log-table";
import { TablePagination } from "@/components/factory/data/table-pagination";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  csvFilename,
  downloadCsv,
  toShiftLogCsv,
} from "@/lib/factory/shift-log-csv";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  EXPORT_LIMIT,
  defaultFilters,
  fetchLogTableExportRows,
  fetchLogTablePage,
  fetchLogTableStats,
  filtersAreDefault,
  logTableKeys,
  type LogTableFilters,
  type LogTableRow,
  type LogTableSort,
  type SortColumn,
} from "@/lib/factory/shift-log-table-queries";

/**
 * Shift log → data table. The browsable record of everything logged.
 *
 * Filtering, sorting and paging all happen in Postgres: the browser holds one
 * page of rows, never the table. That is the difference from the prototype,
 * which rendered every entry into the DOM and would fall over on a real
 * factory's year of shifts.
 *
 * Two queries back the screen and they answer different questions — the page
 * query returns the rows to draw, the stats RPC describes the whole filtered
 * set. Summing the visible rows for the totals bar would be wrong the moment
 * there is more than one page.
 */
export function DataTableWorkspace({
  factoryId,
  factoryName,
  units,
  userId,
  canManage,
}: {
  factoryId: string;
  factoryName: string;
  units: { singular: string; plural: string };
  /** The signed-in viewer, for deciding which rows they may amend. */
  userId: string;
  canManage: boolean;
}) {
  const [filters, setFilters] = useState<LogTableFilters>(defaultFilters);
  const [sort, setSort] = useState<LogTableSort>(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  // Bumped by "Clear filters" to remount the filter bar, which is what resets
  // the debounced search box to the cleared value without an effect.
  const [resetToken, setResetToken] = useState(0);
  const [amendTarget, setAmendTarget] = useState<LogTableRow | null>(null);
  const [overrunTarget, setOverrunTarget] = useState<LogTableRow | null>(null);

  // Same cache keys the Admin panels and the log form use, so arriving from
  // either has the dropdowns populated already.
  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });

  const isDefault = useMemo(() => filtersAreDefault(filters), [filters]);

  const pageQuery = useQuery({
    queryKey: logTableKeys.page(factoryId, filters, sort, page, pageSize),
    queryFn: () => fetchLogTablePage(factoryId, filters, sort, page, pageSize),
    // Hold the previous page on screen while the next one loads — the table
    // dims instead of collapsing to a spinner and back.
    placeholderData: keepPreviousData,
  });

  const statsQuery = useQuery({
    queryKey: logTableKeys.stats(factoryId, filters),
    queryFn: () => fetchLogTableStats(factoryId, filters),
    placeholderData: keepPreviousData,
    // Only asked for when the bar is on screen — see the render below. An
    // untouched table would otherwise pay for an aggregate nobody reads.
    enabled: !isDefault,
  });

  /** Any filter change invalidates the current page number, not just the rows. */
  const updateFilters = useCallback((next: Partial<LogTableFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters());
    setPage(0);
    setResetToken((n) => n + 1);
  }, []);

  const changeSort = useCallback((column: SortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : // Dates and quantities are most useful largest-first; names aren't.
          {
            column,
            direction: NUMERIC_FIRST_DESC.has(column) ? "desc" : "asc",
          }
    );
    setPage(0);
  }, []);

  const exportCsv = useMutation({
    mutationFn: async () => {
      const rows = await fetchLogTableExportRows(factoryId, filters, sort);
      downloadCsv(toShiftLogCsv(rows), csvFilename(factoryName));
      return rows.length;
    },
    onSuccess: (count) => {
      if (count === 0) {
        toast.info("Nothing to export — no entries match these filters.");
      } else if (count >= EXPORT_LIMIT) {
        toast.warning(
          `Exported the first ${EXPORT_LIMIT.toLocaleString()} entries. Narrow the date range to export the rest.`
        );
      } else {
        toast.success(`Exported ${count.toLocaleString()} entries.`);
      }
    },
    onError: (e: Error) => toast.error(`Export failed: ${e.message}`),
  });

  const rows = pageQuery.data?.rows ?? [];

  /**
   * Mirrors the `shift_log_amend` update policy — the author, or a manager.
   * The database is still the enforcement; this only keeps the UI from
   * offering a button whose write would be refused.
   */
  const canAmend = useCallback(
    (row: LogTableRow) => canManage || row.logged_by === userId,
    [canManage, userId]
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Shift log
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0F1B34]">
            Data table
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Every entry ever logged, filterable and sortable. Read-only —
            entries are audit-protected.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearFilters}
            disabled={isDefault}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6EAF1] px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="size-3.5" />
            Clear filters
          </button>
          <button
            type="button"
            onClick={() => exportCsv.mutate()}
            disabled={exportCsv.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6EAF1] px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-60"
          >
            {exportCsv.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export CSV
          </button>
        </div>
      </div>

      <DataTableFilters
        key={resetToken}
        filters={filters}
        onChange={updateFilters}
        units={unitList}
        processes={processList}
        unitWord={units.singular}
      />

      {pageQuery.isError ? (
        <p className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-center text-sm text-[#B91C1C]">
          Could not load the shift log: {(pageQuery.error as Error).message}
        </p>
      ) : (
        <>
          <ShiftLogTable
            rows={rows}
            sort={sort}
            onSort={changeSort}
            isPending={pageQuery.isFetching}
            unitWord={units.singular}
            hasFilters={!isDefault}
            canAmend={canAmend}
            onAmend={setAmendTarget}
            canExplainOverrun={canManage}
            onExplainOverrun={setOverrunTarget}
            // Totals describe a *selection*, so the footer only exists once
            // the filters make one. Unfiltered, it was summing the factory's
            // whole last 30 days directly above the table showing those same
            // rows — a headline-looking figure answering no question anyone
            // asked, and easy to misread as a total for the page on screen.
            showTotals={!isDefault}
            stats={statsQuery.data}
            statsPending={statsQuery.isFetching}
            statsError={statsQuery.error as Error | null}
          />

          <TablePagination
            page={page}
            pageSize={pageSize}
            total={pageQuery.data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        </>
      )}

      <AmendEntryDialog
        entry={
          amendTarget && {
            id: amendTarget.id,
            log_date: amendTarget.log_date,
            unit_name: amendTarget.unit_name,
            process_name: amendTarget.process_name,
            batch_no: amendTarget.batch_no,
            amend_note: amendTarget.amend_note,
          }
        }
        factoryId={factoryId}
        onClose={() => setAmendTarget(null)}
      />

      <ExplainOverrunDialog
        entry={
          overrunTarget && {
            id: overrunTarget.id,
            log_date: overrunTarget.log_date,
            unit_name: overrunTarget.unit_name,
            process_name: overrunTarget.process_name,
            batch_no: overrunTarget.batch_no,
            product_name: overrunTarget.product_name,
            accumulative: overrunTarget.accumulative,
            required_qty: overrunTarget.required_qty,
            overrun_qty: overrunTarget.overrun_qty,
            overrun_note: overrunTarget.overrun_note,
          }
        }
        factoryId={factoryId}
        onClose={() => setOverrunTarget(null)}
      />
    </>
  );
}

/** Columns where the interesting end is the top: newest, biggest, worst. */
const NUMERIC_FIRST_DESC = new Set<SortColumn>([
  "log_date",
  "start_time",
  "duration_minutes",
  "qty",
  "target_qty",
  "qty_rejected",
  "accumulative",
  "target_speed",
  "actual_speed",
]);
