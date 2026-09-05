"use client";

import { Clock3, Moon, Sun, UserRound } from "lucide-react";

import { formatReportDate } from "@/lib/factory/shift-report-queries";
import type {
  RunningShift,
  ShiftClock,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * The masthead of the sheet: which factory, which shift, which clock, and
 * whose name is on it.
 *
 * It matters most on paper. A printed shift report handed to the next shift
 * with no date, no window and no supervisor is a table of numbers nobody can
 * file — which is why the supervisor gets a column in Admin → Shift times.
 *
 * Laid out like a document header rather than a toolbar: the shift is the
 * headline, the date sits under it, and the facts that qualify the sheet
 * (window, supervisor, location) run along the right as labelled values.
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
    <header
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-3",
        // A whisper of the shift's own colour across the top of the sheet —
        // enough to tell a morning report from an afternoon one at a glance
        // on a desk, not enough to survive as ink on a photocopier.
        morning
          ? "bg-[linear-gradient(105deg,var(--color-warn-tint)_0%,var(--color-surface)_45%)]"
          : "bg-[linear-gradient(105deg,var(--color-brand-tint)_0%,var(--color-surface)_45%)]",
        "print:rounded-none print:bg-none print:px-0",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl ring-1",
            morning
              ? "bg-warn-soft text-warn-deep ring-warn-line"
              : "bg-brand-soft text-brand-deep ring-brand-line",
            "print:hidden",
          )}
        >
          {morning ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </span>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-5">
            {factoryName} · {unitWord} summary
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
            {morning ? "Morning" : "Afternoon"} shift
            <span className="ml-2 font-normal text-ink-4">
              {formatReportDate(date)}
            </span>
          </h2>
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {clock?.startTime && clock?.endTime && (
          <Fact icon={Clock3} label="Shift window">
            <span className="font-mono">
              {clock.startTime} → {clock.endTime}
            </span>
          </Fact>
        )}
        {/* Only when there is one. "Supervisor: —" on a handover sheet reads
            as nobody was in charge, which is worse than silence. */}
        {supervisor && (
          <Fact icon={UserRound} label="Supervisor">
            {supervisor}
          </Fact>
        )}
      </dl>
    </header>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock3;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface text-ink-5 ring-1 ring-line print:hidden"
      >
        <Icon className="size-3.5" />
      </span>
      <div>
        <dt className="text-[10px] font-bold uppercase tracking-[0.07em] text-ink-5">
          {label}
        </dt>
        <dd className="text-[13px] font-semibold text-ink">{children}</dd>
      </div>
    </div>
  );
}
