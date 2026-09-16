import type { QueryClient } from "@tanstack/react-query";

import { actionKeys, fetchActions } from "@/lib/factory/action-queries";
import {
  batchStageKeys,
  fetchFactoryStages,
} from "@/lib/factory/batch-stage-queries";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import {
  equipmentKeys,
  fetchEquipment,
} from "@/lib/factory/equipment-queries";
import { fetchKaizenIdeas, kaizenKeys } from "@/lib/factory/kaizen-queries";
import {
  fetchMaintenanceRequests,
  maintenanceKeys,
} from "@/lib/factory/maintenance-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import {
  fetchSetupItems,
  setupKeys,
  type SetupTable,
} from "@/lib/factory/setup-queries";
import {
  fetchLogEntries,
  fetchOverrunFlags,
  logKeys,
} from "@/lib/factory/shift-log-queries";
import {
  fetchShiftTimes,
  shiftTimeKeys,
  todayKey,
} from "@/lib/factory/shift-time-queries";

/**
 * Sidebar → warm a module's lists before its page is opened.
 *
 * A page arrives in two halves: the server render, then the lists its client
 * components ask React Query for once they mount. Started on hover, the second
 * half runs *alongside* the first instead of after it, so the lists are
 * usually in the cache by the time the page draws and it opens on data rather
 * than on a spinner.
 *
 * Every entry is the exact key and fetcher the page itself uses, so a warmed
 * entry is indistinguishable from one the page fetched. `prefetchQuery` skips
 * anything still fresh and shares a request already in flight, so hovering up
 * and down the rail costs nothing twice.
 *
 * Deliberately absent: the pipeline board. Its page runs the scheduled-batch
 * promotion as part of reading the board, and a board warmed without it would
 * let the page skip that step on arrival.
 */
type Warm = (client: QueryClient, factoryId: string) => void;

function setupList(client: QueryClient, factoryId: string, table: SetupTable) {
  void client.prefetchQuery({
    queryKey: setupKeys.all(table, factoryId),
    queryFn: () => fetchSetupItems(table, factoryId),
  });
}

function products(client: QueryClient, factoryId: string) {
  void client.prefetchQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
}

function stages(client: QueryClient, factoryId: string) {
  void client.prefetchQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });
}

const WARMERS: Record<string, Warm> = {
  "/log": (client, factoryId) => {
    setupList(client, factoryId, "factory_units");
    setupList(client, factoryId, "factory_processes");
    products(client, factoryId);
    stages(client, factoryId);
    void client.prefetchQuery({
      queryKey: equipmentKeys.all(factoryId),
      queryFn: () => fetchEquipment(factoryId),
    });
    void client.prefetchQuery({
      queryKey: employeeKeys.all(factoryId),
      queryFn: () => fetchEmployees(factoryId),
    });
    void client.prefetchQuery({
      queryKey: shiftTimeKeys.all(factoryId),
      queryFn: () => fetchShiftTimes(factoryId),
    });
    // The activity feed beside the form — today's entries and their flags.
    const date = todayKey();
    void client.prefetchQuery({
      queryKey: logKeys.day(factoryId, date),
      queryFn: () => fetchLogEntries(factoryId, date),
    });
    void client.prefetchQuery({
      queryKey: logKeys.overruns(factoryId, date),
      queryFn: () => fetchOverrunFlags(factoryId, date),
    });
  },
  "/pipeline": (client, factoryId) => {
    products(client, factoryId);
    stages(client, factoryId);
  },
  "/products": (client, factoryId) => {
    products(client, factoryId);
  },
  "/data": (client, factoryId) => {
    setupList(client, factoryId, "factory_units");
    setupList(client, factoryId, "factory_processes");
  },
  "/resources": (client, factoryId) => {
    void client.prefetchQuery({
      queryKey: equipmentKeys.all(factoryId),
      queryFn: () => fetchEquipment(factoryId),
    });
  },
  "/actions": (client, factoryId) => {
    setupList(client, factoryId, "factory_units");
    void client.prefetchQuery({
      queryKey: actionKeys.all(factoryId),
      queryFn: () => fetchActions(factoryId),
    });
  },
  "/maintenance": (client, factoryId) => {
    void client.prefetchQuery({
      queryKey: maintenanceKeys.all(factoryId),
      queryFn: () => fetchMaintenanceRequests(factoryId),
    });
  },
  "/kaizen": (client, factoryId) => {
    void client.prefetchQuery({
      queryKey: kaizenKeys.all(factoryId),
      queryFn: () => fetchKaizenIdeas(factoryId),
    });
  },
};

/** Warms the lists behind a nav item's href (the part after /factory/<slug>). */
export function prefetchModule(
  client: QueryClient,
  factoryId: string,
  href: string,
) {
  WARMERS[href]?.(client, factoryId);
}
