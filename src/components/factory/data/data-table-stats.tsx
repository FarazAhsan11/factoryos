"use client";

import { formatMinutes } from "@/lib/factory/shift-log-queries";
import type { LogTableStats } from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

function num(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Truncates rather than rounds, so a rate below 100 never *displays* as 100.
 * One reject in 11,000 units is 99.9909% — rounding that to "100.0%" tells a
 * supervisor the shift was clean when it wasn't. Only a genuinely defect-free
 * slice shows 100%.
 */
function formatQualityRate(rate: number): string {
  return (Math.floor(rate * 10) / 10).toFixed(1);
}

/**
 * Totals for the filtered set — deliberately not for the page on screen.
 * They come from the `shift_log_stats` RPC, because summing 25 visible rows
 * would quietly answer a different question than the one the bar asks.
 */
export function DataTableStats({
  stats,
  isPending,
  error,
  shown,
}: {
  stats?: LogTableStats;
  isPending: boolean;
  error?: Error | null;
  /** Rows rendered right now, for the "showing X of Y" count. */
  shown: number;
}) {
  if (error) {
    return (
      <p className="mb-2.5 rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
        Totals unavailable: {error.message}
      </p>
    );
  }

  const quality = stats?.qualityRate ?? null;

  return (
    <div
      className={cn(
        "mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-[#64748B] transition-opacity",
        isPending && "opacity-50"
      )}
    >
      <span>
        Showing <strong className="font-bold text-[#0F1B34]">{num(shown)}</strong>{" "}
        of{" "}
        <strong className="font-bold text-[#0F1B34]">
          {stats ? num(stats.entryCount) : "—"}
        </strong>{" "}
        entries
      </span>

      <span>
        Total qty:{" "}
        <strong className="font-bold text-[#0F1B34]">
          {stats && stats.totalQty > 0 ? `${num(stats.totalQty)} units` : "—"}
        </strong>
      </span>

      <span>
        Total rejected:{" "}
        <strong
          className={cn(
            "font-bold",
            stats && stats.totalRejected > 0 ? "text-[#B91C1C]" : "text-[#0F1B34]"
          )}
        >
          {stats && stats.totalRejected > 0 ? num(stats.totalRejected) : "—"}
        </strong>
      </span>

      <span>
        Total duration:{" "}
        <strong className="font-bold text-[#0F1B34]">
          {stats && stats.totalMinutes > 0
            ? formatMinutes(stats.totalMinutes)
            : "—"}
        </strong>
      </span>

      {quality !== null && (
        <span
          className={cn(
            "font-semibold",
            quality >= 98
              ? "text-[#16A34A]"
              : quality >= 95
                ? "text-[#B45309]"
                : "text-[#DC2626]"
          )}
        >
          Quality rate: {formatQualityRate(quality)}%
        </span>
      )}
    </div>
  );
}
