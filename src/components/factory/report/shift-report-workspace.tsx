"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Moon, Printer, Sun } from "lucide-react";
import { toast } from "sonner";

import { AmendmentHistoryDialog } from "@/components/factory/report/amendment-history-dialog";
import { EditEntryDialog } from "@/components/factory/report/edit-entry-dialog";
import { ShiftReportHeader } from "@/components/factory/report/shift-report-header";
import { ShiftReportTable } from "@/components/factory/report/shift-report-table";
import { DateField } from "@/components/ui/date-picker";
import { downloadCsv } from "@/lib/factory/shift-log-csv";
import {
  shiftReportFilename,
  toShiftReportCsv,
} from "@/lib/factory/shift-report-csv";
import {
  fetchShiftReportEntries,
  formatReportDate,
  groupByRoom,
  shiftReportKeys,
  summarise,
  todayISO,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import {
  fetchShiftTimes,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * Shift Report — one day, one shift, on one sheet.
 *
 * A different question from the data table, which is why it is a different
 * screen rather than another preset filter. The data table answers "find me
 * the entries matching this" and pages through thousands; this answers "what
 * happened on the floor during that shift", which is a fixed small slice
 * always read whole, by room. It lists what was logged and nothing else: a
 * room with no entries is not on the sheet.
 */
export function ShiftReportWorkspace({
  factoryId,
  factoryName,
  units,
  userId,
  canManage,
}: {
  factoryId: string;
  factoryName: string;
  units: { singular: string; plural: string };
  /** The viewer, so a row they filed themselves is one they may correct. */
  userId: string;
  /** Manager and up may correct anybody's entry — the rule RLS enforces. */
  canManage: boolean;
}) {
  const [date, setDate] = useState(todayISO);
  const [shift, setShift] = useState<RunningShift>("morning");
  // Today, read on every render — through the hook, or the React Compiler
  // would keep the day the sheet was opened (see `useRenderClock`).
  const today = useRenderClock(todayISO);
  /**
   * The row the correction dialog is open on.
   *
   * The sheet is where a wrong figure gets noticed — the whole point of
   * printing every room side by side — so the fix starts here rather than
   * sending someone back to the entry feed to hunt for the row again.
   */
  const [editing, setEditing] = useState<ShiftReportRow | null>(null);
  /** The row whose amendment history is open. */
  const [history, setHistory] = useState<ShiftReportRow | null>(null);

  const {
    data: entries = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: shiftReportKeys.entries(factoryId, date, shift),
    queryFn: () => fetchShiftReportEntries(factoryId, date, shift),
    // A shift in progress is still being written to. Today's sheet keeps up on
    // its own; a past one is finished and refetching it buys nothing.
    refetchInterval: date === today ? 60_000 : false,
  });

  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  const rooms = useMemo(() => groupByRoom(entries), [entries]);

  const totals = useMemo(() => summarise(entries), [entries]);

  /**
   * Who may correct which row. The same rule the `shift_log_amend` policy
   * enforces on the write — stated here only so a supervisor is not offered a
   * pencil that fails, never so the check lives in the browser.
   */
  const canEdit = useCallback(
    (entry: ShiftReportRow) => canManage || entry.logged_by === userId,
    [canManage, userId],
  );

  function exportCsv() {
    if (rooms.length === 0) {
      toast.error("Nothing to export for this shift.");
      return;
    }
    downloadCsv(
      toShiftReportCsv(rooms),
      shiftReportFilename(factoryName, date, shift),
    );
    toast.success("Shift report exported.");
  }

  return (
    <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col print:block">
      {/* The controls are the one part of the page that has no business on
          paper — you cannot press a button on a printed sheet.

          They sit alone on this row now. The page heading above them — a
          kicker, a title and a sentence of blurb — is gone: the tab strip
          already says Shift report and the sheet's own masthead says which
          factory, shift and date, so ninety vertical pixels were spent
          repeating what the same screen says twice more. The table is what
          people came for, and that height belongs to it. */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-end gap-2 print:hidden">
        {/* Never blank: a report with no date is not a document, so
              clearing falls back to today rather than to nothing. */}
        <DateField
          value={date}
          max={today}
          onChange={(next) => setDate(next || todayISO())}
          ariaLabel="Report date"
          className="h-9 w-[11.5rem] shadow-soft"
        />

        <div className="flex overflow-hidden rounded-xl border border-line shadow-soft">
          <ShiftButton
            active={shift === "morning"}
            onClick={() => setShift("morning")}
            icon={<Sun className="size-3.5" />}
            label="Morning"
          />
          <ShiftButton
            active={shift === "afternoon"}
            onClick={() => setShift("afternoon")}
            icon={<Moon className="size-3.5" />}
            label="Afternoon"
          />
        </div>

        <Ghost onClick={exportCsv} icon={<Download className="size-3.5" />}>
          Export
        </Ghost>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-xs font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98]"
        >
          <Printer className="size-3.5" />
          Print
        </button>
      </div>

      {isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
          Could not load the shift report: {(error as Error).message}
        </p>
      ) : isPending ? (
        <ReportSkeleton />
      ) : (
        /* One sheet. The masthead, the key figures and the table were three
           separate cards with gaps between them, which is three objects that
           happen to be stacked — not the single document this is meant to be,
           and not what comes out of the printer either. */
        <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1 print:block print:rounded-none print:border-0 print:shadow-none">
          <ShiftReportHeader
            factoryName={factoryName}
            date={date}
            shift={shift}
            clock={shiftTimes?.[shift]}
            unitWord={units.singular}
            unitWordPlural={units.plural}
            totals={totals}
          />

          {rooms.length === 0 ? (
            /* Names the shift as well as the day: the sheet is one shift, and
               the other may well have entries. */
            <div className="px-4 py-16 text-center">
              <p className="text-sm font-medium text-ink-3">
                Nothing logged on {formatReportDate(date)}
              </p>
              <p className="mt-1 text-xs text-ink-5">
                {shift === "morning" ? "Morning" : "Afternoon"} shift
              </p>
            </div>
          ) : (
            <ShiftReportTable
              rooms={rooms}
              unitWord={units.singular}
              onEdit={setEditing}
              onHistory={setHistory}
              canEdit={canEdit}
            />
          )}
        </div>
      )}

      {/* Keyed to the sheet on screen, so saving refreshes the day and shift
          being read rather than whichever one the cache happens to hold. */}
      <EditEntryDialog
        entry={editing}
        factoryId={factoryId}
        date={date}
        shift={shift}
        units={units}
        onClose={() => setEditing(null)}
      />
      <AmendmentHistoryDialog
        entry={history}
        factoryId={factoryId}
        unitWord={units.singular}
        onClose={() => setHistory(null)}
      />
    </div>
  );
}

function ShiftButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 px-3 text-xs font-semibold transition",
        active
          ? "bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] text-white"
          : "bg-surface text-ink-3 hover:bg-sunken",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Ghost({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
    >
      {icon}
      {children}
    </button>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1">
      <div className="h-11 shrink-0 animate-pulse border-b border-line bg-sunken" />
      <div className="min-h-[320px] flex-1 animate-pulse bg-sunken/40" />
    </div>
  );
}
