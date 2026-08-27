"use client";

import type { ShiftReportTotals } from "@/lib/factory/shift-report-queries";
import { cn } from "@/lib/utils";

/**
 * The five figures that answer "how did the shift go?" before anyone scrolls
 * a sixteen-column table.
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
    {
      value: totals.entries,
      label: "Total entries",
      tone: "var(--color-brand-deep)",
    },
    {
      value: totals.roomsActive,
      label: `${unitWordPlural} active`,
      tone: "var(--color-teal)",
    },
    {
      value: totals.produced,
      label: "Total produced",
      tone: "var(--color-brand-deep)",
    },
    {
      value: totals.rejected,
      label: "Total rejected",
      tone:
        totals.rejected > 0 ? "var(--color-danger-deep)" : "var(--color-ink-5)",
    },
    {
      value: totals.flagged,
      label: "Issues flagged",
      tone:
        totals.flagged > 0 ? "var(--color-warn-deep)" : "var(--color-ink-5)",
    },
  ];

  return (
    <div className="mb-4 grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 print:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn(
            "rounded-2xl border border-line bg-surface px-4 py-3.5",
            "print:rounded-none print:border-ink-6 print:px-2 print:py-2",
          )}
        >
          <p
            className="text-2xl font-semibold tabular-nums tracking-tight print:text-lg"
            style={{ color: card.tone }}
          >
            {card.value.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-4">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
