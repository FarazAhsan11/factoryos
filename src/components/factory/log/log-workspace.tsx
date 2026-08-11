"use client";

import { useCallback, useState } from "react";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { ActivityFeed } from "@/components/factory/log/activity-feed";
import { KaizenFeed } from "@/components/factory/log/kaizen-feed";
import { KaizenForm } from "@/components/factory/log/kaizen-form";
import { LogEntryForm } from "@/components/factory/log/log-entry-form";
import { LOG_TABS } from "@/lib/factory/log-tabs";

/**
 * Client half of the shift log. Two columns on wide screens: a form, and
 * beside it a live feed of what that form has produced.
 *
 * The right-hand column belongs to the tab, not to the page: on Log entry it
 * is the shift's entries, on Kaizen it is the improvement queue. Same place,
 * same shape, so the pairing stays legible — you are always looking at what
 * you are adding to.
 *
 * Neither side is handed a working day: the form stamps one at submit time
 * and the feed picks its own, so a session left open across midnight can't
 * file entries under the wrong date or hide them.
 */
export function LogWorkspace({
  factoryId,
  userId,
  userName,
  units,
  initialTab,
  canManage,
  canReview,
}: {
  factoryId: string;
  userId: string;
  /** The signed-in person, shown by the Kaizen form in place of a name box. */
  userName: string;
  units: { singular: string; plural: string };
  initialTab: string;
  canManage: boolean;
  /** Supervisor and up — may move an idea through the review states. */
  canReview: boolean;
}) {
  const [tab, setTab] = useState(initialTab);

  const select = useCallback((value: string) => {
    setTab(value);
    window.history.replaceState(null, "", `?tab=${value}`);
  }, []);

  return (
    <>
      <AdminTabs
        tabs={LOG_TABS}
        active={tab}
        label="Shift log sections"
        onSelect={select}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* The entry form is hidden rather than unmounted: it is long, often
            half-filled, and a glance at the Kaizen tab must not throw that
            away. The Kaizen form is short enough that remounting it costs
            nothing, so it is only rendered when its tab is open. */}
        <div role="tabpanel" hidden={tab !== "entry"}>
          <LogEntryForm factoryId={factoryId} userId={userId} units={units} />
        </div>

        {tab === "kaizen" && (
          <div role="tabpanel">
            <KaizenForm
              factoryId={factoryId}
              userId={userId}
              userName={userName}
            />
          </div>
        )}

        {tab === "kaizen" ? (
          <KaizenFeed
            factoryId={factoryId}
            userId={userId}
            canReview={canReview}
          />
        ) : (
          <ActivityFeed
            factoryId={factoryId}
            units={units}
            userId={userId}
            canManage={canManage}
          />
        )}
      </div>
    </>
  );
}
