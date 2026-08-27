"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Moon, Printer, Sun } from "lucide-react";
import { toast } from "sonner";

import { ShiftReportHeader } from "@/components/factory/report/shift-report-header";
import { ShiftReportSummary } from "@/components/factory/report/shift-report-summary";
import { ShiftReportTable } from "@/components/factory/report/shift-report-table";
import { downloadCsv } from "@/lib/factory/shift-log-csv";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
import {
  shiftReportFilename,
  toShiftReportCsv,
} from "@/lib/factory/shift-report-csv";
import {
  fetchShiftReportEntries,
  groupByRoom,
  shiftReportKeys,
  summarise,
  todayISO,
  type IdleStatus,
} from "@/lib/factory/shift-report-queries";
import {
  fetchShiftTimes,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

/** Pipeline status → what an idle room's row should say it is doing. */
const IDLE_FROM_PIPELINE: Record<string, IdleStatus> = {
  production: "PRODUCTION",
  hold: "HOLD",
  planned: "PLANNED",
};

/**
 * Shift Report — one day, one shift, the whole floor on one sheet.
 *
 * A different question from the data table, which is why it is a different
 * screen rather than another preset filter. The data table answers "find me
 * the entries matching this" and pages through thousands; this answers "what
 * happened on the floor during that shift", which is a fixed small slice
 * always read whole — and read *by room*, including the rooms that did
 * nothing, because their silence is part of the answer.
 */
export function ShiftReportWorkspace({
  factoryId,
  factoryName,
  units,
}: {
  factoryId: string;
  factoryName: string;
  units: { singular: string; plural: string };
}) {
  const [date, setDate] = useState(todayISO);
  const [shift, setShift] = useState<RunningShift>("morning");

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
    refetchInterval: date === todayISO() ? 60_000 : false,
  });

  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });

  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  const { data: jobs = [] } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });

  // What each idle room is doing, per the board. Only production, hold and
  // planned say anything — a finished job left a room free, which is READY.
  const pipelineByUnit = useMemo(() => {
    const map = new Map<string, IdleStatus>();
    for (const job of jobs) {
      const status = IDLE_FROM_PIPELINE[job.status];
      if (job.unit_id && status) map.set(job.unit_id, status);
    }
    return map;
  }, [jobs]);

  const rooms = useMemo(
    () =>
      groupByRoom(
        unitList
          .filter((u) => u.active)
          .map((u) => ({ id: u.id, name: u.name })),
        entries,
        pipelineByUnit,
      ),
    [unitList, entries, pipelineByUnit],
  );

  const totals = useMemo(() => summarise(entries), [entries]);

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
          paper — you cannot press a button on a printed sheet. */}
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-5">
            Production floor
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Shift report
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value || todayISO())}
            aria-label="Report date"
            className="h-9 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-brand"
          />

          <div className="flex overflow-hidden rounded-xl border border-line">
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
          <Ghost
            onClick={() => window.print()}
            icon={<Printer className="size-3.5" />}
          >
            Print
          </Ghost>
        </div>
      </div>

      {isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
          Could not load the shift report: {(error as Error).message}
        </p>
      ) : isPending ? (
        <ReportSkeleton />
      ) : (
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col print:block">
          <ShiftReportSummary totals={totals} unitWordPlural={units.plural} />
          <ShiftReportHeader
            factoryName={factoryName}
            date={date}
            shift={shift}
            clock={shiftTimes?.[shift]}
            unitWord={units.singular}
          />

          {rooms.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-16 text-center">
              <p className="text-sm text-ink-4">
                No {units.plural.toLowerCase()} set up yet.
              </p>
              <p className="mt-1 text-xs text-ink-5">
                Add them in Admin &amp; Settings and the report fills itself in.
              </p>
            </div>
          ) : (
            <>
              <ShiftReportTable rooms={rooms} unitWord={units.singular} />
              {totals.entries === 0 && (
                <p className="mt-3 shrink-0 text-center text-xs text-ink-5 print:hidden">
                  Nothing was logged on this shift — every{" "}
                  {units.singular.toLowerCase()} shows its board status instead.
                </p>
              )}
            </>
          )}
        </div>
      )}
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[74px] animate-pulse rounded-2xl border border-line-soft bg-surface"
          />
        ))}
      </div>
      <div className="h-[420px] animate-pulse rounded-2xl border border-line-soft bg-surface" />
    </div>
  );
}
