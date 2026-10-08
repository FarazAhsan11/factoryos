"use client";

import { useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RotateCw } from "lucide-react";

import { DayStepper } from "@/components/factory/floor/day-stepper";
import { FloorRoomCard } from "@/components/factory/floor/floor-room-card";
import { FloorRoomDialog } from "@/components/factory/floor/floor-room-dialog";
import { actionKeys, fetchActions } from "@/lib/factory/action-queries";
import {
  batchStageKeys,
  fetchFactoryStages,
} from "@/lib/factory/batch-stage-queries";
import { formatDay, todayKey } from "@/lib/factory/dates";
import {
  buildFloorRooms,
  fetchFloorEntries,
  floorKeys,
  isDowntime,
} from "@/lib/factory/floor-queries";
import { fetchPipelineJobs } from "@/lib/factory/pipeline-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "idle";

/** How often a live board re-reads the floor. A minute is live enough to walk past. */
const LIVE_MS = 60_000;

/**
 * Floor status — a card per room, showing what it is doing today.
 *
 * The board is a calendar day: at midnight every card goes back to idle and
 * fills again as the floor logs. The day is `null` while it follows the clock,
 * so a screen left open overnight rolls over by itself instead of staying on
 * yesterday; picking a day pins it.
 */
export function FloorWorkspace({
  factoryId,
  unitWords,
}: {
  factoryId: string;
  unitWords: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const today = useRenderClock(todayKey);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const live = day === today;
  const [filter, setFilter] = useState<Filter>("all");
  const [openUnit, setOpenUnit] = useState<string | null>(null);

  const refetchInterval = live ? LIVE_MS : false;

  const units = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const entries = useQuery({
    queryKey: floorKeys.day(factoryId, day),
    queryFn: () => fetchFloorEntries(factoryId, day),
    // Stepping a day keeps the last board up until the next one arrives,
    // rather than flashing every card to a skeleton.
    placeholderData: keepPreviousData,
    refetchInterval,
  });
  const stages = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
    refetchInterval,
  });
  const jobs = useQuery({
    queryKey: floorKeys.jobs(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
    refetchInterval,
  });
  // Only the badge reads these. A role that may not read issues gets no
  // badge rather than a broken board, which is why its error is not shown.
  const actions = useQuery({
    queryKey: actionKeys.all(factoryId),
    queryFn: () => fetchActions(factoryId),
    refetchInterval,
  });

  const rooms = buildFloorRooms({
    units: units.data ?? [],
    entries: entries.data ?? [],
    stages: stages.data ?? [],
    jobs: jobs.data ?? [],
    actions: actions.data ?? [],
    live,
  });

  const running = rooms.filter((r) => r.latest && !isDowntime(r.latest)).length;
  const stopped = rooms.filter((r) => isDowntime(r.latest)).length;
  const active = running + stopped;
  const idle = rooms.length - active;

  const shown = rooms.filter((r) =>
    filter === "all" ? true : filter === "active" ? r.latest : !r.latest,
  );
  const openRoom = rooms.find((r) => r.unitId === openUnit) ?? null;

  const fetching =
    entries.isFetching || stages.isFetching || jobs.isFetching || actions.isFetching;
  const loading = units.isPending || entries.isPending;
  const error = units.error ?? entries.error;

  function refresh() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: floorKeys.day(factoryId, day) }),
      queryClient.invalidateQueries({ queryKey: batchStageKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: floorKeys.jobs(factoryId) }),
      queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
    ]);
  }

  const plural = unitWords.plural.toLowerCase();

  return (
    <div className="flex flex-col">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[0.6875rem] font-bold tracking-[0.09em] text-ink-5 uppercase">
            {live ? (
              <>
                <span className="relative flex size-2" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-teal" />
                </span>
                Live floor
              </>
            ) : (
              "Floor on a past day"
            )}
            <span className="text-ink-6">—</span>
            <span className="text-ink-3">{formatDay(day)}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Floor status
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            {loading
              ? `Reading the ${plural}…`
              : `${running} running · ${stopped} in downtime · ${idle} idle — each card is the ${unitWords.singular.toLowerCase()}'s latest log${live ? " today" : " that day"}.`}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DayStepper
          value={day}
          onChange={(next) => setPicked(next === today ? null : next)}
          today={today}
          max={today}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label={`Filter ${plural}`}
            className="flex gap-1 rounded-xl border border-line bg-sunken-2 p-1"
          >
            {(
              [
                ["all", "All", rooms.length],
                ["active", "Active", active],
                ["idle", "Idle", idle],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  filter === value
                    ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
                    : "text-ink-4 hover:bg-surface/60 hover:text-ink",
                )}
              >
                {label}
                <span className="font-mono text-[0.6875rem] text-ink-5 tabular-nums">
                  {count}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={fetching}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 transition hover:border-ink-6 hover:text-ink disabled:opacity-70"
          >
            <RotateCw className={cn("size-4", fetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Couldn&apos;t load the floor: {error.message}
        </p>
      ) : loading ? (
        <FloorGridSkeleton />
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-14 text-center text-sm text-ink-5">
          {rooms.length === 0
            ? `No ${plural} are set up yet — add them under Configuration → ${unitWords.plural}.`
            : filter === "active"
              ? `No ${plural} logged anything on ${formatDay(day)}.`
              : `Every ${unitWords.singular.toLowerCase()} logged something on ${formatDay(day)}.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((room) => (
            <FloorRoomCard
              key={room.unitId}
              room={room}
              onOpen={() => setOpenUnit(room.unitId)}
            />
          ))}
        </div>
      )}

      <FloorRoomDialog
        room={openRoom}
        day={day}
        today={today}
        stages={stages.data ?? []}
        jobs={jobs.data ?? []}
        unitWord={unitWords.singular}
        onClose={() => setOpenUnit(null)}
      />
    </div>
  );
}

function FloorGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="h-[176px] animate-pulse rounded-2xl border border-line bg-sunken-2"
        />
      ))}
    </div>
  );
}
