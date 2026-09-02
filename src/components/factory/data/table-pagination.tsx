"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { SelectField } from "@/components/ui/select-field";
import { PAGE_SIZES } from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

/**
 * Page numbers to render: always the first and last, always a window around
 * the current page, with `null` standing in for an ellipsis. Keeps the pager
 * a fixed width whether there are 3 pages or 300.
 */
function pageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);

  const pages = new Set<number>([0, total - 1, current]);
  if (current - 1 > 0) pages.add(current - 1);
  if (current + 1 < total - 1) pages.add(current + 1);
  // Keep the row from collapsing when the current page sits at either end.
  if (current <= 2) [1, 2, 3].forEach((p) => pages.add(p));
  if (current >= total - 3)
    [total - 4, total - 3, total - 2].forEach((p) => pages.add(p));

  const sorted = [...pages]
    .filter((p) => p >= 0 && p < total)
    .sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous: number | null = null;
  for (const page of sorted) {
    if (previous !== null && page - previous > 1) out.push(null);
    out.push(page);
    previous = page;
  }
  return out;
}

const BUTTON =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-line bg-surface px-2 text-xs font-semibold tabular-nums text-ink-3 transition hover:border-brand hover:bg-brand-soft hover:text-brand disabled:pointer-events-none disabled:opacity-40";

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  /** Zero-based, like the query's `.range()`. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-ink-4">
        <label htmlFor="dt-page-size" className="sr-only">
          Rows per page
        </label>
        <SelectField
          id="dt-page-size"
          value={String(pageSize)}
          onChange={(size) => onPageSizeChange(Number(size))}
          options={PAGE_SIZES.map((size) => ({
            value: String(size),
            label: `${size} rows`,
          }))}
          className="h-8 w-28 rounded-lg px-2 text-xs font-medium"
        />
        <span aria-live="polite" className="tabular-nums">
          {total === 0
            ? "No rows"
            : `${first}–${last} of ${total.toLocaleString()}`}
        </span>
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            className={BUTTON}
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </button>

          {pageWindow(page, pageCount).map((entry, i) =>
            entry === null ? (
              <span
                key={`gap-${i}`}
                className="px-1 text-xs text-ink-5"
                aria-hidden
              >
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPageChange(entry)}
                aria-current={entry === page ? "page" : undefined}
                className={cn(
                  BUTTON,
                  entry === page &&
                    "border-brand bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] font-bold text-white shadow-brand-sm hover:bg-brand hover:text-white",
                )}
              >
                {entry + 1}
              </button>
            ),
          )}

          <button
            type="button"
            className={BUTTON}
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount - 1}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </nav>
      )}
    </div>
  );
}
