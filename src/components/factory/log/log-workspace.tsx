"use client";

import { useCallback, useState } from "react";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { ActivityFeed } from "@/components/factory/log/activity-feed";
import { LogEntryForm } from "@/components/factory/log/log-entry-form";
import { LOG_TABS } from "@/lib/factory/log-tabs";

/**
 * Client half of the shift log. Two columns on wide screens: the entry form
 * and, beside it, the feed of what has already been logged — the operator's
 * proof that the entry landed.
 *
 * Neither side is handed a working day: the form stamps one at submit time
 * and the feed picks its own, so a session left open across midnight can't
 * file entries under the wrong date or hide them.
 */
export function LogWorkspace({
  factoryId,
  userId,
  units,
  initialTab,
  canManage,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
  initialTab: string;
  canManage: boolean;
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
        <div role="tabpanel" hidden={tab !== "entry"}>
          <LogEntryForm factoryId={factoryId} userId={userId} units={units} />
        </div>

        <ActivityFeed
          factoryId={factoryId}
          units={units}
          userId={userId}
          canManage={canManage}
        />
      </div>
    </>
  );
}
