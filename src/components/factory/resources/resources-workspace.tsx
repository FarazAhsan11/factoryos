"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { EmployeesPanel } from "@/components/factory/admin/employees-panel";
import { EquipmentPanel } from "@/components/factory/admin/equipment-panel";
import { resolveResourceTab } from "@/lib/factory/resource-tabs";

/**
 * Client half of Resources — the registers the floor names things from, the
 * machines and the people. Which one is open is chosen in the rail (Plant
 * setup → Resources) and carried in `?tab=`; the rail warms each register's
 * list on hover, as the tab strip it replaced used to.
 */
export function ResourcesWorkspace({
  factoryId,
  canManage,
  isAdmin,
}: {
  factoryId: string;
  canManage: boolean;
  /** Narrower than canManage: only an admin may add or remove people. */
  isAdmin: boolean;
}) {
  const tab = resolveResourceTab(useSearchParams().get("tab") ?? undefined);

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      {/* One scrolling region for whichever panel is open. The inset padding keeps a card's focus ring
          from being clipped by the scroll box's edge. */}
      <div className="scrollbar-slim -mx-1 min-h-0 flex-1 px-1 pb-1 lg:overflow-y-auto">
        {/* Panels stay mounted once visited, so going back to one is instant
          and in-progress edits survive a tab round-trip. */}
        <Panel active={tab === "equipment"}>
          <EquipmentPanel factoryId={factoryId} canManage={canManage} />
        </Panel>

        <Panel active={tab === "employees"} lazy>
          <EmployeesPanel factoryId={factoryId} isAdmin={isAdmin} />
        </Panel>
      </div>
    </div>
  );
}

/**
 * Hides an inactive panel instead of unmounting it. `lazy` panels wait until
 * their first activation so unopened tabs never fetch.
 */
function Panel({
  active,
  lazy,
  children,
}: {
  active: boolean;
  lazy?: boolean;
  children: React.ReactNode;
}) {
  const [visited, setVisited] = useState(!lazy || active);
  if (active && !visited) setVisited(true);
  if (!visited) return null;

  return (
    // Eases in whenever it comes back from `hidden` — the animation restarts
    // each time the panel is displayed again, so a switch fades rather than
    // snaps.
    <div role="tabpanel" hidden={!active} className="animate-in fade-in-0">
      {children}
    </div>
  );
}
