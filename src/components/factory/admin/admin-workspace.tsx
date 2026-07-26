"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { CompanySettingsForm } from "@/components/factory/admin/company-settings-form";
import { SetupListManager } from "@/components/factory/admin/setup-list-manager";
import { ADMIN_TABS, TAB_TABLE } from "@/lib/factory/admin-tabs";
import type { FactoryContext } from "@/lib/factory/context";
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
      const table = TAB_TABLE[value];
      if (!table) return;
      queryClient.prefetchQuery({
        queryKey: setupKeys.all(table, factory.id),
        queryFn: () => fetchSetupItems(table, factory.id),
      });
    },
    [queryClient, factory.id]
  );

  const select = useCallback((value: string) => {
    setTab(value);
    // replaceState (not router.replace) — updates the address bar without
    // re-running the server component.
    window.history.replaceState(null, "", `?tab=${value}`);
  }, []);

  return (
    <>
      <AdminTabs
        tabs={ADMIN_TABS}
        active={tab}
        onSelect={select}
        onPrefetch={prefetch}
      />

      {/* Panels stay mounted once visited, so going back to one is instant
          and in-progress edits survive a tab round-trip. */}
      <Panel active={tab === "company"}>
        <CompanySettingsForm factory={factory} canManage={canManage} />
      </Panel>

      <Panel active={tab === "units"} lazy>
        <SetupListManager
          table="factory_units"
          factoryId={factory.id}
          singular={units.singular}
          plural={units.plural}
          placeholder={`e.g. ${units.singular} 29…`}
          canManage={canManage}
        />
      </Panel>

      <Panel active={tab === "processes"} lazy>
        <SetupListManager
          table="factory_processes"
          factoryId={factory.id}
          singular="Process stage"
          plural="Process stages"
          placeholder="e.g. Compression, Spray Drying…"
          canManage={canManage}
          flag={{
            label: "This stage runs on a machine",
            hint: "Machine stages get equipment, downtime and OEE tracking; manual stages don't.",
            on: "Machine",
            off: "Manual",
          }}
        />
      </Panel>
    </>
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
