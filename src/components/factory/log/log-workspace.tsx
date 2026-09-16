"use client";

import { useCallback, useState } from "react";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { ActivityFeed } from "@/components/factory/log/activity-feed";
import { LogGrid } from "@/components/factory/log/grid/log-grid";
import { LogEntryForm } from "@/components/factory/log/log-entry-form";
import { LogViewToggle } from "@/components/factory/log/log-view-toggle";
import { ShiftReportWorkspace } from "@/components/factory/report/shift-report-workspace";
import { logTabsFor, type LogView } from "@/lib/factory/log-tabs";
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
 * The page width belongs to the tab for that reason — a handover document is
 * not 1,280px wide. There is no heading above the strip: the sidebar already
 * names the section, and the two pills say which of its screens you are on.
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
  initialTab,
  initialView,
  canManage,
  canReview,
}: {
  factoryId: string;
  /** Printed in the report's header — this is a document that leaves the app. */
  factoryName: string;
  userId: string;
  units: { singular: string; plural: string };
  initialTab: string;
  initialView: LogView;
  canManage: boolean;
  /** Supervisor and up. Also decides whether the report tab exists at all. */
  canReview: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  const [view, setView] = useState<LogView>(initialView);
  /**
   * Mounted on first use and kept mounted after: a grid with five rooms half
   * typed must survive a look at the form or the report, and a user who never
   * opens it never pays for twenty-five row forms.
   */
  const [gridOpened, setGridOpened] = useState(initialView === "grid");
  const isReport = tab === "report";
  const isGrid = !isReport && view === "grid";

  const select = useCallback(
    (value: string) => {
      setTab(value);
      window.history.replaceState(
        null,
        "",
        value === "entry" && view === "grid"
          ? `?tab=entry&view=grid`
          : `?tab=${value}`,
      );
    },
    [view],
  );

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
      {/* No heading above the strip. The form has to fit on one screen
          without scrolling the entry out of reach, and a title the sidebar
          already carries was spending that height twice — the two pills say
          which of the shift's two screens you are on, which is the whole of
          what a heading was telling anyone here.

          Hidden on paper: the report prints as a handover document, and a tab
          strip is a control, not part of the record. */}
      <div className="mb-5 flex shrink-0 flex-wrap items-center justify-between gap-3 print:hidden">
        <AdminTabs
          tabs={logTabsFor(canReview)}
          active={tab}
          label="Shift log sections"
          onSelect={select}
          className="mb-0"
        />
        {/* A setting of the Log entry tab, so it is only on screen there. */}
        {!isReport && <LogViewToggle value={view} onChange={selectView} />}
      </div>

      {/* The entry pair is hidden rather than unmounted: the form is long,
          often half-filled, and a glance at the report must not throw that
          away. Hidden through the class rather than the `hidden` attribute —
          `display: grid` would out-cascade the attribute and the panel would
          stay on screen. (`cn` drops `grid` when `hidden` wins.)

          `lg:grid-rows-1` is what makes the columns equal-height: without a
          single explicit row, each panel sizes to its own content and the
          taller one sets a page scroll again. */}
      <div
        role="tabpanel"
        aria-hidden={isReport || isGrid}
        className={cn(
          "grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1 lg:items-stretch",
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
            "flex flex-col lg:min-h-0 lg:flex-1",
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
        <ShiftReportWorkspace
          factoryId={factoryId}
          factoryName={factoryName}
          units={units}
          userId={userId}
          canManage={canManage}
        />
      )}
    </div>
  );
}
