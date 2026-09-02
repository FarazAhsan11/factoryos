"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AdminTabs } from "@/components/factory/admin/admin-tabs";
import { EmployeesPanel } from "@/components/factory/admin/employees-panel";
import { EquipmentPanel } from "@/components/factory/admin/equipment-panel";
import { ProductsPanel } from "@/components/factory/admin/products-panel";
import { RESOURCE_TABS } from "@/lib/factory/resource-tabs";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import { equipmentKeys, fetchEquipment } from "@/lib/factory/equipment-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";

/**
 * Client half of Resources. The three registers that used to sit at the end of
 * the Admin strip — machines, people, catalogue — moved out from under Setup
 * because they are day-to-day production records, not configuration you set
 * once. The panels themselves are untouched: same components, same queries,
 * same permissions.
 */
export function ResourcesWorkspace({
  factoryId,
  canManage,
  isAdmin,
  initialTab,
}: {
  factoryId: string;
  canManage: boolean;
  /** Narrower than canManage: only an admin may add or remove people. */
  isAdmin: boolean;
  initialTab: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(initialTab);

  const prefetch = useCallback(
    (value: string) => {
      if (value === "employees") {
        queryClient.prefetchQuery({
          queryKey: employeeKeys.all(factoryId),
          queryFn: () => fetchEmployees(factoryId),
        });
        return;
      }
      if (value === "equipment") {
        queryClient.prefetchQuery({
          queryKey: equipmentKeys.all(factoryId),
          queryFn: () => fetchEquipment(factoryId),
        });
        return;
      }
      if (value === "products") {
        queryClient.prefetchQuery({
          queryKey: productKeys.all(factoryId),
          queryFn: () => fetchProducts(factoryId),
        });
      }
    },
    [queryClient, factoryId],
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
        tabs={RESOURCE_TABS}
        active={tab}
        label="Resource registers"
        onSelect={select}
        onPrefetch={prefetch}
      />

      {/* One scrolling region for whichever panel is open, so the tab strip
          never leaves the screen. The inset padding keeps a card's focus ring
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

        <Panel active={tab === "products"} lazy>
          <ProductsPanel factoryId={factoryId} canManage={canManage} />
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
