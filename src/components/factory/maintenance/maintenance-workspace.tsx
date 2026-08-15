"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User, Wrench } from "lucide-react";

import { NewMaintenanceDialog } from "@/components/factory/maintenance/new-maintenance-dialog";
import {
  MAINTENANCE_PRIORITIES,
  fetchMaintenanceRequests,
  formatRaised,
  maintenanceKeys,
  priorityMeta,
  type MaintenancePriority,
} from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

type Filter = "all" | MaintenancePriority;

/**
 * Maintenance — raising a request, and the list of what has been raised.
 *
 * Deliberately only that. There is no assignment, no progress and no
 * verification yet, so the list makes no promise about what happens next: it
 * is a record that the fault was reported and by whom. The status vocabulary
 * exists in the database ready for the workflow, and nothing here moves a
 * request past `reported`.
 */
export function MaintenanceWorkspace({
  factoryId,
  userId,
  units,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const {
    data: requests = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: maintenanceKeys.all(factoryId),
    queryFn: () => fetchMaintenanceRequests(factoryId),
  });

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: maintenanceKeys.all(factoryId),
      }),
    [queryClient, factoryId]
  );

  const counts = useMemo(() => {
    const map: Record<Filter, number> = {
      all: requests.length,
      urgent: 0,
      routine: 0,
      planned: 0,
    };
    for (const r of requests) map[r.priority] += 1;
    return map;
  }, [requests]);

  const visible = useMemo(
    () =>
      filter === "all"
        ? requests
        : requests.filter((r) => r.priority === filter),
    [requests, filter]
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Equipment &amp; facility
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#0F1B34]">
            Maintenance requests
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            Report a fault and say which department is needed. Assignment and
            progress tracking arrive in a later step.
          </p>
        </div>

        <NewMaintenanceDialog
          factoryId={factoryId}
          userId={userId}
          unitWord={units.singular}
          onCreated={refresh}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["all", ...MAINTENANCE_PRIORITIES.map((p) => p.value)] as Filter[]).map(
          (key) => {
            const active = filter === key;
            const meta = key === "all" ? null : priorityMeta(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-[#0F1B34] bg-[#0F1B34] text-white"
                    : "border-[#E6EAF1] bg-white text-[#475569] hover:border-[#CBD5E1]"
                )}
              >
                {meta && (
                  <span
                    className="size-2 rounded-full"
                    style={{ background: meta.dot }}
                    aria-hidden
                  />
                )}
                {meta ? meta.label : "All"}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold",
                    active ? "bg-white/20" : "bg-[#F1F5F9] text-[#64748B]"
                  )}
                >
                  {counts[key]}
                </span>
              </button>
            );
          }
        )}
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-6 text-center text-sm text-[#B91C1C]">
          Could not load maintenance requests: {(error as Error).message}
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-16 text-center">
          <Wrench className="mx-auto mb-3 size-7 text-[#CBD5E1]" />
          <p className="text-sm text-[#64748B]">
            {requests.length === 0
              ? "No maintenance requests yet."
              : `Nothing ${priorityMeta(filter as MaintenancePriority).label.toLowerCase()}.`}
          </p>
          <p className="mt-1 text-xs text-[#94A3B8]">
            {requests.length === 0
              ? "Raise one when a machine needs attention."
              : "Try another priority."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((request) => {
            const meta = priorityMeta(request.priority);
            return (
              <li
                key={request.id}
                className="rounded-2xl border border-[#E6EAF1] bg-white p-4"
                style={{ borderLeft: `4px solid ${meta.dot}` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] font-bold text-[#94A3B8]">
                        {request.request_no}
                      </span>
                      <span className="font-mono text-sm font-semibold text-[#0F1B34]">
                        {request.equipment_no}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-[#94A3B8]">
                      {request.unit_name ?? `Not ${units.singular.toLowerCase()}-specific`}
                      {request.department_name && ` · ${request.department_name}`}
                      {request.batch_no && (
                        <>
                          {" · Batch "}
                          <span className="font-mono">{request.batch_no}</span>
                          {request.product_name && ` (${request.product_name})`}
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        meta.pill
                      )}
                    >
                      {meta.label}
                    </span>
                    {/* Only one status is reachable today, and saying so is
                        more honest than a pill implying a workflow. */}
                    <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                      Reported
                    </span>
                  </div>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-[13px] text-[#334155]">
                  {request.description}
                </p>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      request.assigned_to
                        ? "font-medium text-[#0F1B34]"
                        : "italic text-[#94A3B8]"
                    )}
                  >
                    <User className="size-3.5 shrink-0 text-[#94A3B8]" />
                    {request.assigned_to ?? "Unassigned"}
                  </span>
                  <span className="font-mono text-[11px] text-[#94A3B8]">
                    {request.reported_by && `${request.reported_by} · `}
                    {formatRaised(request.created_at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[132px] animate-pulse rounded-2xl border border-[#EEF1F6] bg-white"
        />
      ))}
    </div>
  );
}
