"use client";

import type { ShiftReportTotals } from "@/lib/factory/shift-report-queries";
import { cn } from "@/lib/utils";

/**
 * The five figures that answer "how did the shift go?" before anyone reads a
 * sixteen-column table.
 *
 * One thin strip rather than five tiles. They were five stacked boxes with
 * 26px numerals in them, seventy pixels tall on a screen whose whole point is
 * the table underneath — and four of the five read "0" on most shifts, so the
 * space went to saying nothing at some size. Inline label-and-value pairs on
 * one line say the same thing in a fifth of the height, and the table gets the
 * rest.
 *
 * Rejected and Issues flagged only take a colour when they are non-zero. A
 * permanently red "0 rejected" teaches the eye to skip the figure, which costs
 * the one moment it exists for.
 */
export function ShiftReportSummary({
  totals,
  unitWordPlural,
}: {
  totals: ShiftReportTotals;
  unitWordPlural: string;
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
    <dl
      className={cn(
        "flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1.5 border-b border-line bg-sunken px-5 py-2",
        "print:bg-surface print:px-0 print:py-1.5",
      )}
    >
      {figures.map((figure) => (
        <div key={figure.label} className="flex items-baseline gap-1.5">
          <dt className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
            {figure.label}
          </dt>
          <dd
            className={cn(
              "font-mono text-[15px] leading-none font-semibold tabular-nums tracking-tight",
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
