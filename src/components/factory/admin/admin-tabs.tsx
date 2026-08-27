"use client";

import type { AdminTab } from "@/lib/factory/admin-tabs";
import { cn } from "@/lib/utils";

/**
 * Sub-tabs for Admin. Plain buttons, switched in client state — the panels are
 * all mounted from data we already have, so a tab change is instant and never
 * touches the server. The URL is kept in sync by the parent.
 */
export function AdminTabs({
  tabs,
  active,
  label = "Admin sections",
  onSelect,
  onPrefetch,
}: {
  tabs: AdminTab[];
  active: string;
  /** Accessible name for the strip — the shift log reuses this component. */
  label?: string;
  onSelect: (value: string) => void;
  onPrefetch?: (value: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      /* `w-fit`: a segmented control is as wide as its segments. Stretched
         across the page it read as a toolbar with a gap in it. */
      className="scrollbar-slim mb-5 flex w-fit max-w-full shrink-0 gap-1 overflow-x-auto rounded-xl border border-[#E6EAF1] bg-[#F1F5F9] p-1"
    >
      {tabs.map((tab) =>
        tab.ready ? (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === active}
            onClick={() => onSelect(tab.value)}
            // Warm the tab's data before the click lands.
            onMouseEnter={() => onPrefetch?.(tab.value)}
            onFocus={() => onPrefetch?.(tab.value)}
            className={cn(
              "shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold transition",
              tab.value === active
                ? "bg-white text-[#1D4ED8] shadow-[0_1px_3px_rgba(15,27,52,0.12)] ring-1 ring-[#E2E8F0]"
                : "text-[#64748B] hover:bg-white/60 hover:text-[#0F1B34]",
            )}
          >
            {tab.label}
          </button>
        ) : (
          <span
            key={tab.value}
            aria-disabled
            title="Arrives in the next build step"
            className="shrink-0 cursor-not-allowed rounded-lg px-4 py-1.5 text-sm font-semibold text-[#CBD5E1]"
          >
            {tab.label}
          </span>
        ),
      )}
    </div>
  );
}
