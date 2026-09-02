"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Clock3, Cog, LayoutGrid, Wrench } from "lucide-react";

import { PROCESS_CATEGORIES } from "@/app/factory/[slug]/log/schemas";
import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { CompanySettingsForm } from "@/components/factory/admin/company-settings-form";
import { SetupListManager } from "@/components/factory/admin/setup-list-manager";
import { ShiftTimesForm } from "@/components/factory/admin/shift-times-form";
import { PanelHeader } from "@/components/factory/admin/settings-ui";
import { ADMIN_TABS, TAB_TABLE } from "@/lib/factory/admin-tabs";
import type { FactoryContext } from "@/lib/factory/context";
import {
  fetchShiftTimes,
  shiftTimeKeys,
} from "@/lib/factory/shift-time-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";

/**
 * Client half of Admin. Owns the active sub-tab so switching is instant: the
 * server already handed us the factory, and React Query holds the setup lists,
 * so no navigation is needed. The URL is rewritten in place (history API) to
 * keep tabs deep-linkable without a round-trip.
 */
export function AdminWorkspace({
  factory,
  canManage,
  units,
  initialTab,
}: {
  factory: FactoryContext["factory"];
  canManage: boolean;
  units: { singular: string; plural: string };
  initialTab: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(initialTab);

  const prefetch = useCallback(
    (value: string) => {
      if (value === "shift-times") {
        queryClient.prefetchQuery({
          queryKey: shiftTimeKeys.all(factory.id),
          queryFn: () => fetchShiftTimes(factory.id),
        });
        return;
      }
      const table = TAB_TABLE[value];
      if (!table) return;
      queryClient.prefetchQuery({
        queryKey: setupKeys.all(table, factory.id),
        queryFn: () => fetchSetupItems(table, factory.id),
      });
    },
    [queryClient, factory.id],
  );

  const select = useCallback((value: string) => {
    setTab(value);
    // replaceState (not router.replace) — updates the address bar without
    // re-running the server component.
    window.history.replaceState(null, "", `?tab=${value}`);
  }, []);

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <AdminTabs
        tabs={ADMIN_TABS}
        active={tab}
        onSelect={select}
        onPrefetch={prefetch}
      />

      {/* One scrolling region for whichever panel is open, so the tab strip
          never leaves the screen. The inset padding keeps a card's focus ring
          from being clipped by the scroll box's edge. */}
      <div className="scrollbar-slim -mx-1 min-h-0 flex-1 px-1 pb-1 lg:overflow-y-auto">
        {/* Panels stay mounted once visited, so going back to one is instant
          and in-progress edits survive a tab round-trip. */}
        <Panel active={tab === "company"}>
          <PanelHeader
            icon={Building2}
            title="Company"
            description="The site's name, the words it uses for its rooms, and the targets every report measures against."
          />
          <CompanySettingsForm factory={factory} canManage={canManage} />
        </Panel>

        <Panel active={tab === "units"} lazy>
          <PanelHeader
            icon={LayoutGrid}
            title={units.plural}
            description={`Where work happens. Every shift-log entry names one, and the shift report gives each its own row — including the ones that ran nothing.`}
          />
          <SetupListManager
            table="factory_units"
            factoryId={factory.id}
            singular={units.singular}
            plural={units.plural}
            placeholder={`e.g. ${units.singular} 29…`}
            canManage={canManage}
          />
        </Panel>

        {/* Who a maintenance request is *for*. A managed list rather than a
          fixed dropdown because the trades a plant keeps in-house differ —
          one factory has Electrical and Utilities, the next outsources both. */}
        <Panel active={tab === "departments"} lazy>
          <PanelHeader
            icon={Wrench}
            title="Departments"
            description="The trades a maintenance request can be raised by and assigned to — whichever ones this plant keeps in-house."
          />
          <SetupListManager
            table="factory_departments"
            factoryId={factory.id}
            singular="Department"
            plural="Departments"
            placeholder="e.g. Electrical, Mechanical, Utilities…"
            canManage={canManage}
          />
        </Panel>

        <Panel active={tab === "processes"} lazy>
          <PanelHeader
            icon={Cog}
            title="Process stages"
            description="What a room can be doing. A stage's type decides which shape the shift-log form takes. Which stage completes a batch is set per batch, when its stages are planned on the Pipeline."
          />
          <SetupListManager
            table="factory_processes"
            factoryId={factory.id}
            singular="Process stage"
            plural="Process stages"
            placeholder="e.g. Compression, Spray Drying…"
            canManage={canManage}
            categoryLabel="Type of stage"
            // The one thing that decides what the shift-log form asks for. It
            // replaces the old "produces output" / "runs on a machine" pair,
            // which had four combinations for three real kinds of stage and
            // said nothing about how the output is measured — so a mixing room
            // reporting 3 drums got the same three quantity boxes as an
            // encapsulation line reporting 231,453 capsules.
            categories={PROCESS_CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label,
              example: c.example,
              hint: c.hint,
            }))}
            defaultCategory="production"
            flags={[
              {
                key: "machine",
                label: "This stage runs on a machine",
                hint: "Machine stages get equipment, speed and OEE tracking; a manual production stage (hand packing against a target) doesn't.",
                on: "Machine",
                off: "Manual",
                icon: Cog,
                // Production only. A preparatory stage has no target speed to
                // run below, and downtime has no machine to attribute time to —
                // the database forces the flag off for both (migration 0030),
                // so offering the tick there would be a control that snaps back.
                showFor: ["production"],
              },
            ]}
          />
        </Panel>

        <Panel active={tab === "shift-times"} lazy>
          <PanelHeader
            icon={Clock3}
            title="Shift times"
            description="When each shift starts and ends, and who supervises it. The workspace clock, the log form and the printed handover all read these."
          />
          <ShiftTimesForm factoryId={factory.id} canManage={canManage} />
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
    <div role="tabpanel" hidden={!active}>
      {children}
    </div>
  );
}
