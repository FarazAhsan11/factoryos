"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  PROCESS_CATEGORIES,
  type ProcessCategory,
} from "@/app/factory/[slug]/log/schemas";
import {
  batchStageKeys,
  fetchFactoryStages,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import {
  employeeKeys,
  fetchEmployees,
  type Employee,
} from "@/lib/factory/employee-queries";
import {
  equipmentKeys,
  fetchEquipment,
  type Equipment,
} from "@/lib/factory/equipment-queries";
import {
  fetchPipelineJobs,
  pipelineKeys,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import {
  fetchProducts,
  productKeys,
  type Product,
} from "@/lib/factory/product-queries";
import {
  fetchSetupItems,
  setupKeys,
  type SetupItem,
} from "@/lib/factory/setup-queries";
import { compareRoomNames } from "@/lib/factory/shift-report-queries";
import {
  fetchShiftTimes,
  shiftTimeKeys,
  type RunningShift,
  type ShiftClock,
} from "@/lib/factory/shift-time-queries";

/**
 * Everything a grid row resolves what is typed into it against.
 *
 * Read once by the grid and handed down, rather than once per row: a factory
 * with twenty-five rooms would otherwise put two hundred observers on eight
 * cache entries to learn the same thing twenty-five times. The keys are the
 * ones the entry form uses, so switching between the two views costs nothing.
 */
export interface LogRegisters {
  units: SetupItem[];
  processes: SetupItem[];
  /** The activity list under a heading per category, as the form shows it. */
  processGroups: { label: string; items: SetupItem[] }[];
  products: Product[];
  productsPending: boolean;
  equipment: Equipment[];
  employees: Employee[];
  jobs: PipelineJob[];
  jobsPending: boolean;
  stages: BatchStage[];
  stagesPending: boolean;
  shiftTimes: Record<RunningShift, ShiftClock> | undefined;
  /** The setup lists themselves have arrived — empty means empty, not loading. */
  setupReady: boolean;
}

export function useLogRegisters(factoryId: string): LogRegisters {
  const { data: unitList = [], isPending: unitsPending } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const { data: processList = [], isPending: processesPending } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });
  const { data: products = [], isPending: productsPending } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  const { data: equipment = [] } = useQuery({
    queryKey: equipmentKeys.all(factoryId),
    queryFn: () => fetchEquipment(factoryId),
  });
  const { data: employees = [] } = useQuery({
    queryKey: employeeKeys.all(factoryId),
    queryFn: () => fetchEmployees(factoryId),
  });
  const { data: jobs = [], isPending: jobsPending } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  const { data: stages = [], isPending: stagesPending } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });
  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  // Room order, not insertion order: "Room 10" after "Room 9", the way the
  // shift report reads them.
  const units = useMemo(
    () =>
      unitList
        .filter((u) => u.active)
        .sort((a, b) => compareRoomNames(a.name, b.name)),
    [unitList],
  );
  const processes = useMemo(
    () => processList.filter((p) => p.active),
    [processList],
  );
  const processGroups = useMemo(
    () =>
      PROCESS_CATEGORIES.map((c) => ({
        label: c.label,
        items: processes.filter(
          (p) => (p.category as ProcessCategory) === c.value,
        ),
      })).filter((g) => g.items.length > 0),
    [processes],
  );

  return {
    units,
    processes,
    processGroups,
    products,
    productsPending,
    equipment,
    employees,
    jobs,
    jobsPending,
    stages,
    stagesPending,
    shiftTimes,
    setupReady: !unitsPending && !processesPending,
  };
}
