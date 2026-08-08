"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ActionDetailDialog } from "@/components/factory/actions/action-detail-dialog";
import { ActionList } from "@/components/factory/actions/action-list";
import { NewActionDialog } from "@/components/factory/actions/new-action-dialog";
import {
  ACTION_FILTERS,
  FILTER_LABELS,
  actionKeys,
  fetchActions,
  matchesFilter,
  type ActionFilter,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

/**
 * Actions & escalations — the accountability loop.
 *
 * Overdue and escalated are computed in the database on every read, so this
 * screen never has to run a timer or patch a status to keep them honest. The
 * only writes are the ones a person makes: create, assign, note, resolve.
 */
export function ActionsWorkspace({
  factoryId,
  userId,
  units,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [selected, setSelected] = useState<FactoryAction | null>(null);

  const {
    data: actions = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: actionKeys.all(factoryId),
    queryFn: () => fetchActions(factoryId),
    // The clock keeps moving even when nothing is written: an action can go
    // overdue, then escalate, while this page sits open. A minute is often
    // enough to catch that without anyone reloading.
    refetchInterval: 60_000,
  });

  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
    [queryClient, factoryId]
  );

  const counts = useMemo(() => {
    const map = {} as Record<ActionFilter, number>;
    for (const key of ACTION_FILTERS) {
      map[key] = actions.filter((a) => matchesFilter(a, key)).length;
    }
    return map;
  }, [actions]);

  const visible = useMemo(
    () => actions.filter((a) => matchesFilter(a, filter)),
    [actions, filter]
  );

  // The dialog holds a snapshot, so it has to be re-read from the refetched
  // list — otherwise resolving an action leaves its own dialog showing "Open".
  const selectedLive = useMemo(
    () => actions.find((a) => a.id === selected?.id) ?? selected,
    [actions, selected]
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Accountability loop
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0F1B34]">
            Actions &amp; escalations
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Issues flagged in the shift log land here automatically. An action
            left past its due time escalates on its own.
          </p>
        </div>

        <NewActionDialog
          factoryId={factoryId}
          userId={userId}
          units={unitList}
          unitWord={units.singular}
          onCreated={refresh}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {ACTION_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              filter === key
                ? "border-[#0F1B34] bg-[#0F1B34] text-white"
                : "border-[#E6EAF1] bg-white text-[#475569] hover:border-[#CBD5E1]"
            )}
          >
            {FILTER_LABELS[key]}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-bold",
                filter === key
                  ? "bg-white/20"
                  : key === "escalated" && counts[key] > 0
                    ? "bg-[#EDE9FE] text-[#6D28D9]"
                    : "bg-[#F1F5F9] text-[#64748B]"
              )}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-center text-sm text-[#B91C1C]">
          Could not load actions: {(error as Error).message}
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-16 text-center">
          <p className="text-sm text-[#64748B]">
            {actions.length === 0
              ? "No actions yet."
              : `Nothing ${FILTER_LABELS[filter].toLowerCase()}.`}
          </p>
          <p className="mt-1 text-xs text-[#94A3B8]">
            {actions.length === 0
              ? "Flag an issue in the shift log and it appears here."
              : "Try another filter."}
          </p>
        </div>
      ) : (
        <ActionList actions={visible} onOpen={setSelected} />
      )}

      <ActionDetailDialog
        action={selectedLive}
        factoryId={factoryId}
        userId={userId}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[104px] animate-pulse rounded-2xl border border-[#EEF1F6] bg-white"
        />
      ))}
    </div>
  );
}
