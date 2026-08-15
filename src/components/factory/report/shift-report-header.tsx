"use client";

import { Moon, Sun } from "lucide-react";

import { formatReportDate } from "@/lib/factory/shift-report-queries";
import type {
  RunningShift,
  ShiftClock,
} from "@/lib/factory/shift-time-queries";

/**
 * The band that makes the sheet a document rather than a screenshot: which
 * factory, which shift, which clock, and whose name is on it.
 *
 * It matters most on paper. A printed shift report handed to the next shift
 * with no date, no window and no supervisor is a table of numbers nobody can
 * file — which is why the supervisor gets a column in Admin → Shift times.
 */
export function ShiftReportHeader({
  factoryName,
  date,
  shift,
  clock,
  unitWord,
}: {
  factoryName: string;
  date: string;
  shift: RunningShift;
  clock: ShiftClock | undefined;
  unitWord: string;
}) {
  const morning = shift === "morning";
  const supervisor = clock?.supervisorName?.trim();

  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#E6EAF1] bg-white px-4 py-3.5 print:rounded-none print:px-0">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold text-[#0F1B34]">
          {morning ? (
            <Sun className="size-4 text-[#F59E0B]" />
          ) : (
            <Moon className="size-4 text-[#6366F1]" />
          )}
          {morning ? "Morning" : "Afternoon"} shift · {formatReportDate(date)}
        </p>
        <p className="mt-0.5 text-[12px] text-[#64748B]">
          {factoryName} · {unitWord} summary
          {/* Only when there is one. "Supervisor: —" on a handover sheet
              reads as nobody was in charge, which is worse than silence. */}
          {supervisor && ` · Supervisor: ${supervisor}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#64748B]">
        {clock?.startTime && clock?.endTime && (
          <span>
            Shift:{" "}
            <strong className="font-semibold text-[#0F1B34]">
              {clock.startTime}–{clock.endTime}
            </strong>
          </span>
        )}
        <span>
          Location:{" "}
          <strong className="font-semibold text-[#0F1B34]">
            {factoryName}
          </strong>
        </span>
      </div>
    </div>
  );
}
