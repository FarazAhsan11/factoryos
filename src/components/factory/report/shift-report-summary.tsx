"use client";

import type { ShiftReportTotals } from "@/lib/factory/shift-report-queries";
import { cn } from "@/lib/utils";

/**
 * The five figures that answer "how did the shift go?" before anyone reads a
 * sixteen-column table.
 *
 * Small pills in the masthead's one line rather than tiles of their own: they
 * were five stacked boxes with 26px numerals, then a strip of their own, and
 * four of the five read "0" on most shifts, so the height went to saying
 * nothing at some size. The table gets it instead.
 *
 * Rejected and Issues flagged only take a colour when they are non-zero. A
 * permanently red "0 rejected" teaches the eye to skip the figure, which costs
 * the one moment it exists for.
 */
export function ShiftReportSummary({
  totals,
  unitWordPlural,
  className,
}: {
  totals: ShiftReportTotals;
  unitWordPlural: string;
  className?: string;
}) {
  const figures = [
    { value: totals.entries, label: "Entries", tone: "text-ink" },
    {
      value: totals.roomsActive,
      label: `${unitWordPlural} active`,
      tone: "text-teal-deep",
    },
    { value: totals.produced, label: "Produced", tone: "text-brand" },
    {
      value: totals.rejected,
      label: "Rejected",
      tone: totals.rejected > 0 ? "text-danger" : "text-ink-3",
    },
    {
      value: totals.flagged,
      label: "Flagged",
      tone: totals.flagged > 0 ? "text-warn-deep" : "text-ink-3",
    },
  ];

  return (
    <dl className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="flex h-7 items-baseline gap-1.5 rounded-lg bg-surface px-2.5 pt-1.5 ring-1 ring-line-soft print:ring-0"
        >
          <dt className="text-[0.5938rem] font-bold tracking-[0.07em] whitespace-nowrap text-ink-5 uppercase">
            {figure.label}
          </dt>
          <dd
            className={cn(
              "font-mono text-[0.8125rem] leading-none font-semibold tabular-nums tracking-tight",
              figure.tone,
            )}
          >
            {figure.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}
