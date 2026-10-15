"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  batchStageKeys,
  fetchFactoryStages,
} from "@/lib/factory/batch-stage-queries";
import { todayKey } from "@/lib/factory/dates";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
import { roomSlots, type RoomSlot } from "@/lib/factory/schedule";
import { useRenderClock } from "@/lib/use-render-clock";

/**
 * What every room is already holding, for the places a plan is typed.
 *
 * The same two reads the Pipeline workspace makes — every stage in the tenant
 * and every job — under the same keys, so inside the workspace this is a cache
 * hit and costs nothing. Derived and never stored: a clash is a comparison
 * between two plans, and a saved copy of it would be a second record of one
 * fact (see the Schedule's `findRoomConflicts`, which this agrees with).
 *
 * `today` is read through the render clock, not in render — the check drops a
 * booking the moment its last day has passed.
 */
export function useRoomSlots(factoryId: string): RoomSlot[] {
  const today = useRenderClock(todayKey);
  const { data: stages = [] } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  return useMemo(() => roomSlots(stages, jobs, today), [stages, jobs, today]);
}
