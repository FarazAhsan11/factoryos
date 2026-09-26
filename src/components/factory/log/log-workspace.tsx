"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ActivityFeed } from "@/components/factory/log/activity-feed";
import { LogGrid } from "@/components/factory/log/grid/log-grid";
import { LogEntryForm } from "@/components/factory/log/log-entry-form";
import { LogViewToggle } from "@/components/factory/log/log-view-toggle";
import { ShiftReportWorkspace } from "@/components/factory/report/shift-report-workspace";
import { resolveLogTab, type LogView } from "@/lib/factory/log-tabs";
import { cn } from "@/lib/utils";

/**
 * Client half of the shift log.
 *
 * Two shapes, one page. **Log entry** is a form with a live feed of what that
 * form has produced beside it — you are always looking at what you are adding
 * to. **Shift report** is the opposite: one wide sheet, every room for one
 * shift, the thing those entries were being filed *into*. It moved here from
 * its own nav item because reading the sheet and correcting an entry are the
 * same job, done minutes apart, and they were two clicks and a page load
 * away from each other.
 *
 * Which of the two is open is chosen in the rail (Shop floor → Production log
 * / Shift handover) and carried in `?tab=`. The rail switches it by rewriting
 * the URL, so this component is never remounted by the switch — the half-typed
 * entry and grid below survive a look at the handover, as they did when the
 * choice was a tab strip on this page.
 *
 * The page width belongs to the screen for that reason — a handover document
 * is not 1,280px wide. There is no heading: the rail names the screen.
 *
 * Neither the form nor the feed is handed a working day: the form stamps one
 * at submit time and the feed picks its own, so a session left open across
 * midnight can't file entries under the wrong date or hide them.
 *
 * Log entry itself comes in two views. **Form** is the one-entry form with its
 * feed; **Grid** is every room on one sheet, a line each, for catching up the
 * whole floor at once. Same schema, same write, same database rules — only the
 * layout differs, so which to use is a preference, not a permission.
 */
export function LogWorkspace({
  factoryId,
  factoryName,
  userId,
  units,
  initialView,
  canManage,
  canReview,
}: {
  factoryId: string;
  /** Printed in the report's header — this is a document that leaves the app. */
  factoryName: string;
  userId: string;
  units: { singular: string; plural: string };
  initialView: LogView;
  canManage: boolean;
  /** Supervisor and up. Also decides whether the report tab exists at all. */
  canReview: boolean;
}) {
  const tab = resolveLogTab(useSearchParams().get("tab") ?? undefined, canReview);
  const [view, setView] = useState<LogView>(initialView);
  /**
   * Mounted on first use and kept mounted after: a grid with five rooms half
   * typed must survive a look at the form or the report, and a user who never
   * opens it never pays for twenty-five row forms.
   */
  const [gridOpened, setGridOpened] = useState(initialView === "grid");
  const isReport = tab === "report";
  const isGrid = !isReport && view === "grid";

  const selectView = useCallback((next: LogView) => {
    setView(next);
    if (next === "grid") setGridOpened(true);
    window.history.replaceState(
      null,
      "",
      next === "grid" ? `?tab=entry&view=grid` : `?tab=entry`,
    );
  }, []);

  return (
    /* A column that fills what the shell gave it, so the panels below can each
       take a bounded height and scroll inside it. */
    <div
      className={cn(
        "mx-auto flex w-full flex-col lg:min-h-0 lg:flex-1",
        isReport ? "max-w-[1400px]" : isGrid ? "max-w-[1600px]" : "max-w-7xl",
      )}
    >
      {/* How Production log is filled in — a setting of that screen, so it
          is only on screen there. Hidden on paper with the rest of the
          chrome: the handover prints as a document, and a toggle is a
          control, not part of the record. */}
      {!isReport && (
        <div className="mb-4 flex shrink-0 items-center gap-3 print:hidden">
          <LogViewToggle value={view} onChange={selectView} />
        </div>
      )}

      {/* The entry pair is hidden rather than unmounted: the form is long,
          often half-filled, and a glance at the report must not throw that
          away. Hidden through the class rather than the `hidden` attribute —
          `display: grid` would out-cascade the attribute and the panel would
          stay on screen. (`cn` drops `grid` when `hidden` wins.)

          `lg:grid-rows-1` is what makes the columns equal-height: without a
          single explicit row, each panel sizes to its own content and the
          taller one sets a page scroll again.

          `animate-in fade-in-0`: a panel coming back from `display: none`
          restarts its animation, so every switch eases in over 150ms instead
          of snapping — the same on all three panels below. */}
      <div
        role="tabpanel"
        aria-hidden={isReport || isGrid}
        className={cn(
          "grid items-start gap-5 animate-in fade-in-0 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1 lg:items-stretch",
          (isReport || isGrid) && "hidden",
        )}
      >
        <div className="min-w-0 lg:min-h-0">
          <LogEntryForm
            factoryId={factoryId}
            userId={userId}
            units={units}
            canManage={canManage}
          />
        </div>

        <ActivityFeed
          factoryId={factoryId}
          units={units}
          userId={userId}
          canManage={canManage}
        />
      </div>

      {/* The grid, hidden rather than unmounted for the form's reason — rows
          typed into and not yet logged must survive a switch of view or tab. */}
      {gridOpened && (
        <div
          role="tabpanel"
          aria-hidden={!isGrid}
          className={cn(
            "flex flex-col animate-in fade-in-0 lg:min-h-0 lg:flex-1",
            !isGrid && "hidden",
          )}
        >
          <LogGrid
            factoryId={factoryId}
            userId={userId}
            units={units}
            canManage={canManage}
          />
        </div>
      )}

      {/* The report is unmounted when it isn't showing — it is read-only, and
          leaving it mounted would keep its minute-by-minute refetch running
          behind a form nobody is reading it from. */}
      {isReport && (
        <div className="animate-in fade-in-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col print:block print:animate-none">
          <ShiftReportWorkspace
            factoryId={factoryId}
            factoryName={factoryName}
            units={units}
            userId={userId}
            canManage={canManage}
          />
        </div>
      )}
    </div>
  );
}
