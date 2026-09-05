"use client";

import { useCallback, useState } from "react";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { ActivityFeed } from "@/components/factory/log/activity-feed";
import { LogEntryForm } from "@/components/factory/log/log-entry-form";
import { ShiftReportWorkspace } from "@/components/factory/report/shift-report-workspace";
import { logTabsFor } from "@/lib/factory/log-tabs";
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
 */
export function LogWorkspace({
  factoryId,
  factoryName,
  userId,
  units,
  initialTab,
  canManage,
  canReview,
}: {
  factoryId: string;
  /** Printed in the report's header — this is a document that leaves the app. */
  factoryName: string;
  userId: string;
  units: { singular: string; plural: string };
  initialTab: string;
  canManage: boolean;
  /** Supervisor and up. Also decides whether the report tab exists at all. */
  canReview: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  const isReport = tab === "report";

  const select = useCallback((value: string) => {
    setTab(value);
    window.history.replaceState(null, "", `?tab=${value}`);
  }, []);

  return (
    /* A column that fills what the shell gave it, so the panels below can each
       take a bounded height and scroll inside it. */
    <div
      className={cn(
        "mx-auto flex w-full flex-col lg:min-h-0 lg:flex-1",
        isReport ? "max-w-[1400px]" : "max-w-7xl",
      )}
    >
      {/* No heading above the strip. The form has to fit on one screen
          without scrolling the entry out of reach, and a title the sidebar
          already carries was spending that height twice — the two pills say
          which of the shift's two screens you are on, which is the whole of
          what a heading was telling anyone here.

          Hidden on paper: the report prints as a handover document, and a tab
          strip is a control, not part of the record. */}
      <AdminTabs
        tabs={logTabsFor(canReview)}
        active={tab}
        label="Shift log sections"
        onSelect={select}
        className="print:hidden"
      />

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
        aria-hidden={isReport}
        className={cn(
          "grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1 lg:items-stretch",
          isReport && "hidden",
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
