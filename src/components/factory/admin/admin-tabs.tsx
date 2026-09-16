"use client";

import { useOptimistic, useTransition } from "react";

import type { AdminTab } from "@/lib/factory/admin-tabs";
import { cn } from "@/lib/utils";

/**
 * Sub-tabs for Admin. Plain buttons, switched in client state — the panels are
 * all mounted from data we already have, so a tab change is instant and never
 * touches the server. The URL is kept in sync by the parent.
 *
 * The switch runs as a transition. The pill moves the instant it is pressed
 * (an optimistic value, reconciled with `active` when the transition lands),
 * while the panel behind it renders without blocking the page — a board of
 * forty cards or a sheet of twenty-five rooms no longer holds the click
 * hostage until it has finished drawing.
 */
export function AdminTabs({
  tabs,
  active,
  label = "Admin sections",
  onSelect,
  onPrefetch,
  className,
}: {
  tabs: AdminTab[];
  active: string;
  /** Accessible name for the strip — the shift log reuses this component. */
  label?: string;
  onSelect: (value: string) => void;
  onPrefetch?: (value: string) => void;
  className?: string;
}) {
  const [, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(active);

  function select(value: string) {
    if (value === shown) return;
    startTransition(() => {
      setShown(value);
      onSelect(value);
    });
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      /* `w-fit`: a segmented control is as wide as its segments. Stretched
         across the page it read as a toolbar with a gap in it. */
      className={cn(
        "scrollbar-slim mb-5 flex w-fit max-w-full shrink-0 gap-1 overflow-x-auto rounded-xl border border-line bg-sunken-2 p-1",
        className,
      )}
    >
      {tabs.map((tab) =>
        tab.ready ? (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === shown}
            onClick={() => select(tab.value)}
            // Warm the tab's data before the click lands.
            onMouseEnter={() => onPrefetch?.(tab.value)}
            onFocus={() => onPrefetch?.(tab.value)}
            className={cn(
              "shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold transition-[color,background-color,box-shadow] duration-150",
              tab.value === shown
                ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgba(20,22,43,0.12)] ring-1 ring-line"
                : "text-ink-4 hover:bg-surface/60 hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ) : (
          <span
            key={tab.value}
            aria-disabled
            title="Arrives in the next build step"
            className="shrink-0 cursor-not-allowed rounded-lg px-4 py-1.5 text-sm font-semibold text-ink-6"
          >
            {tab.label}
          </span>
        ),
      )}
    </div>
  );
}
