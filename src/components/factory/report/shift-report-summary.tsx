"use client";

import type { ShiftReportTotals } from "@/lib/factory/shift-report-queries";
import { cn } from "@/lib/utils";

/**
 * The five figures that answer "how did the shift go?" before anyone scrolls
 * a sixteen-column table.
 *
 * One divided band rather than five floating cards: these are the key figures
 * *of this sheet*, not five independent widgets, and hairlines say that in a
 * way a 12px gap does not. It reads the way the summary block on a printed
 * batch record reads, which is the document this is standing in for.
 *
 * Rejected and Issues flagged only take a colour when they are non-zero. A
 * permanently red "0 rejected" teaches the eye to skip the tile, which costs
 * the one moment it exists for.
 */
export function ShiftReportSummary({
  totals,
  unitWordPlural,
}: {
  totals: ShiftReportTotals;
  unitWordPlural: string;
}) {
  const cards = [
    { value: totals.entries, label: "Total entries", tone: "text-ink" },
    {
      value: totals.roomsActive,
      label: `${unitWordPlural} active`,
      tone: "text-teal-deep",
    },
    { value: totals.produced, label: "Total produced", tone: "text-brand" },
    {
      value: totals.rejected,
      label: "Total rejected",
      tone: totals.rejected > 0 ? "text-danger" : "text-ink-5",
    },
    {
      value: totals.flagged,
      label: "Issues flagged",
      tone: totals.flagged > 0 ? "text-warn-deep" : "text-ink-5",
    },
  ];

  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-2 divide-x divide-y divide-line-soft border-b border-line bg-sunken",
        "sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5",
        "print:grid-cols-5 print:divide-ink-6 print:border-ink-6 print:bg-surface",
      )}
    >
      {cards.map((card) => (
        <div key={card.label} className="px-5 py-3.5 print:px-2 print:py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-ink-5">
            {card.label}
          </p>
          <p
            className={cn(
              "mt-1 text-[26px] font-semibold leading-none tabular-nums tracking-tight print:text-lg",
              card.tone,
            )}
          >
            {card.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
