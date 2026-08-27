"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Cog, Flag } from "lucide-react";

import { PROCESS_CATEGORIES } from "@/app/factory/[slug]/log/schemas";
import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { CompanySettingsForm } from "@/components/factory/admin/company-settings-form";
import { SetupListManager } from "@/components/factory/admin/setup-list-manager";
import { EmployeesPanel } from "@/components/factory/admin/employees-panel";
import { EquipmentPanel } from "@/components/factory/admin/equipment-panel";
import { ProductsPanel } from "@/components/factory/admin/products-panel";
import { ShiftTimesForm } from "@/components/factory/admin/shift-times-form";
import { ADMIN_TABS, TAB_TABLE } from "@/lib/factory/admin-tabs";
import type { FactoryContext } from "@/lib/factory/context";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import { equipmentKeys, fetchEquipment } from "@/lib/factory/equipment-queries";
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
      if (value === "equipment") {
        queryClient.prefetchQuery({
          queryKey: equipmentKeys.all(factory.id),
          queryFn: () => fetchEquipment(factory.id),
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
    [queryClient, factory.id],
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
            // Unlike the one above, this is a choice *between* stages: a
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
              // Not downtime: the final stage is measured by what it
              // produced, and downtime produces nothing — a job tagged that
              // way would sit at 0 for ever with nothing explaining why. The
              // constraint from 0016 refuses it outright.
              showFor: ["preparatory", "production"],
            },
          ]}
        />
      </Panel>

      {/* The machine register. A pair — the number painted on the asset and
          the name people call it by — which is why it isn't a SetupListManager
          list: the shift log types the number and reads back the name. */}
      <Panel active={tab === "equipment"} lazy>
        <EquipmentPanel factoryId={factory.id} canManage={canManage} />
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
