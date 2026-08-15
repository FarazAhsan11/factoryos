"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Cog, Flag, Package } from "lucide-react";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { CompanySettingsForm } from "@/components/factory/admin/company-settings-form";
import { SetupListManager } from "@/components/factory/admin/setup-list-manager";
import { EmployeesPanel } from "@/components/factory/admin/employees-panel";
import { ProductsPanel } from "@/components/factory/admin/products-panel";
import { ShiftTimesForm } from "@/components/factory/admin/shift-times-form";
import { ADMIN_TABS, TAB_TABLE } from "@/lib/factory/admin-tabs";
import type { FactoryContext } from "@/lib/factory/context";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
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
  isAdmin,
  units,
  initialTab,
}: {
  factory: FactoryContext["factory"];
  canManage: boolean;
  /** Narrower than canManage: only an admin may add or remove people. */
  isAdmin: boolean;
  units: { singular: string; plural: string };
  initialTab: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(initialTab);

  const prefetch = useCallback(
    (value: string) => {
      if (value === "employees") {
        queryClient.prefetchQuery({
          queryKey: employeeKeys.all(factory.id),
          queryFn: () => fetchEmployees(factory.id),
        });
        return;
      }
      if (value === "products") {
        queryClient.prefetchQuery({
          queryKey: productKeys.all(factory.id),
          queryFn: () => fetchProducts(factory.id),
        });
        return;
      }
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

      {/* Who a maintenance request is *for*. A managed list rather than a
          fixed dropdown because the trades a plant keeps in-house differ —
          one factory has Electrical and Utilities, the next outsources both. */}
      <Panel active={tab === "departments"} lazy>
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
        <SetupListManager
          table="factory_processes"
          factoryId={factory.id}
          singular="Process stage"
          plural="Process stages"
          placeholder="e.g. Compression, Spray Drying…"
          canManage={canManage}
          // Two independent facts about a stage. Sorting produces output with
          // no machine; Idle and Break do neither. Collapsing them into one
          // flag is what made the log form ask for a quantity on a tea break.
          flags={[
            {
              key: "machine",
              label: "This stage runs on a machine",
              hint: "Machine stages get equipment, speed, downtime and OEE tracking; manual stages don't.",
              on: "Machine",
              off: "Manual",
              icon: Cog,
            },
            {
              key: "output",
              label: "This stage produces output",
              hint: "Untick for stages that use shift time but make nothing — Idle, Break, Set Up, cleaning. The log form then stops asking for quantities.",
              on: "Output",
              off: "No output",
              icon: Package,
              defaultOn: true,
            },
            // Unlike the two above, this one is a choice *between* stages: a
            // batch is dispensed, encapsulated, sorted and packed, and each
            // logs roughly the full quantity. Without naming which of them
            // means "the batch is done", completion is unknowable — summing
            // them finishes a job at a quarter of the work, and taking the
            // largest finishes it when the first stage does.
            {
              key: "final",
              label: "This is the final stage",
              hint: "The stage whose output IS the finished batch — usually the last pack or label step. Pipeline jobs complete when it reaches the required quantity. Only one stage can hold this; ticking it here clears it from the other.",
              on: "Final",
              off: "Not final",
              icon: Flag,
            },
          ]}
        />
      </Panel>

      <Panel active={tab === "employees"} lazy>
        <EmployeesPanel factoryId={factory.id} isAdmin={isAdmin} />
      </Panel>

      <Panel active={tab === "products"} lazy>
        <ProductsPanel factoryId={factory.id} canManage={canManage} />
      </Panel>

      <Panel active={tab === "shift-times"} lazy>
        <ShiftTimesForm factoryId={factory.id} canManage={canManage} />
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
