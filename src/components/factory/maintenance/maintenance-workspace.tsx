"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, User, Wrench } from "lucide-react";

import { MaintenanceDetailDialog } from "@/components/factory/maintenance/maintenance-detail-dialog";
import { NewMaintenanceDialog } from "@/components/factory/maintenance/new-maintenance-dialog";
import type { FactoryRole } from "@/lib/factory/context";
import {
  MAINTENANCE_FILTERS,
  STATUS_LABELS,
  STATUS_PILL,
  fetchMaintenanceRequests,
  formatMinutes,
  formatRaised,
  maintenanceKeys,
  minutesSince,
  priorityMeta,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

type FilterKey = "all" | string;

/**
 * Maintenance — the whole Breakdown Maintenance Request, not just its first
 * page.
 *
 * The list is the tray the paper forms used to sit in, so it is filtered the
 * way that tray is searched: by which section is waiting on someone, and by
 * how loudly. Opening a row opens the document itself, three tabs deep.
 *
 * Nothing here decides what a request is allowed to do next — that lives in
 * `maintenance_stage_transition`, and the forms in the dialog only ask for
 * what it will demand anyway.
 */
export function MaintenanceWorkspace({
  factoryId,
  userId,
  role,
  units,
}: {
  factoryId: string;
  userId: string;
  role: FactoryRole;
  units: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [urgent, setUrgent] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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
    [queryClient, factoryId],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requests.length };
    for (const f of MAINTENANCE_FILTERS) {
      map[f.key] = requests.filter((r) => f.match(r.status)).length;
    }
    return map;
  }, [requests]);

  const urgentCount = useMemo(
    () => requests.filter((r) => r.priority === "urgent").length,
    [requests],
  );

  const visible = useMemo(() => {
    const chip = MAINTENANCE_FILTERS.find((f) => f.key === filter);
    return requests.filter(
      (r) =>
        (!chip || chip.match(r.status)) && (!urgent || r.priority === "urgent"),
    );
  }, [requests, filter, urgent]);

  // Read out of the freshly fetched list rather than held in state, so the
  // open dialog re-renders with the new record the moment a section is signed
  // — a snapshot taken on click would show the stage you just left.
  const open = requests.find((r) => r.id === openId) ?? null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-5">
            Equipment &amp; facility
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Maintenance requests
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            Report a fault, assign it, record the work, and have QA review it —
            the three sections of the request, in order.
          </p>
        </div>

        <NewMaintenanceDialog
          factoryId={factoryId}
          userId={userId}
          unitWord={units.singular}
          onCreated={refresh}
        />
      </div>

      {/* Who is holding it — the question the tray gets asked. Four chips
          rather than the three sections, because Section 3 holds both the
          request QA has not looked at and every request QA ever finished, and
          one chip for both is a chip nobody can use. The toggle beside them
          cuts across all four rather than joining them: "urgent" is not a
          place a request can be. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Request section"
          className="flex flex-wrap gap-1.5"
        >
          {[
            { key: "all", label: "All", hint: "Every request ever raised" },
            ...MAINTENANCE_FILTERS,
          ].map(({ key, label, hint }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                title={hint}
                onClick={() => setFilter(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-surface text-ink-3 hover:border-ink-6",
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold",
                    active ? "bg-surface/20" : "bg-sunken-2 text-ink-4",
                  )}
                >
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-pressed={urgent}
          onClick={() => setUrgent(!urgent)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
            urgent
              ? "border-danger-deep bg-danger-soft text-danger-deep"
              : "border-line bg-surface text-ink-3 hover:border-ink-6",
            // Nothing is urgent: the toggle stays put so its absence reads as
            // "all quiet" rather than as a control that went missing.
            urgentCount === 0 && !urgent && "opacity-60",
          )}
        >
          <AlertTriangle className="size-3.5" />
          Urgent only
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold",
              urgent ? "bg-surface/60" : "bg-sunken-2 text-ink-4",
            )}
          >
            {urgentCount}
          </span>
        </button>
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm text-danger-deep">
          Could not load maintenance requests: {(error as Error).message}
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-16 text-center">
          <Wrench className="mx-auto mb-3 size-7 text-ink-6" />
          <p className="text-sm text-ink-4">
            {requests.length === 0
              ? "No maintenance requests yet."
              : "Nothing matches that filter."}
          </p>
          <p className="mt-1 text-xs text-ink-5">
            {requests.length === 0
              ? "Raise one when a machine needs attention."
              : urgent
                ? "Nothing urgent in that section."
                : "Try another section."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              unitWord={units.singular}
              onOpen={() => setOpenId(request.id)}
            />
          ))}
        </ul>
      )}

      <MaintenanceDetailDialog
        request={open}
        factoryId={factoryId}
        role={role}
        unitWord={units.singular}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}

function RequestRow({
  request,
  unitWord,
  onOpen,
}: {
  request: MaintenanceRequest;
  unitWord: string;
  onOpen: () => void;
}) {
  const meta = priorityMeta(request.priority);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-ink-6 hover:shadow-lift"
        style={{ borderLeft: `4px solid ${meta.dot}` }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[11px] font-bold text-ink-5">
                {request.request_no}
              </span>
              <span className="font-mono text-sm font-semibold text-ink">
                {request.equipment_no}
              </span>
              {request.equipment_name && (
                <span className="truncate text-xs text-ink-3">
                  {request.equipment_name}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-ink-5">
              {request.unit_name ?? `Not ${unitWord.toLowerCase()}-specific`}
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
                meta.pill,
              )}
            >
              {meta.label}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                STATUS_PILL[request.status],
              )}
            >
              {STATUS_LABELS[request.status]}
            </span>
            <ChevronRight className="size-4 text-ink-6" />
          </div>
        </div>

        <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[13px] text-ink-2">
          {request.description}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              request.assigned_to
                ? "font-medium text-ink"
                : "italic text-ink-5",
            )}
          >
            <User className="size-3.5 shrink-0 text-ink-5" />
            {request.assigned_to ?? "Unassigned"}
          </span>
          <span className="font-mono text-[11px] text-ink-5">
            <Downtime request={request} />
            {request.reported_by && `${request.reported_by} · `}
            {formatRaised(request.created_at)}
          </span>
        </div>
      </button>
    </li>
  );
}

/**
 * The downtime figure, and only when it means something.
 *
 * While the tools are down it counts up and is the most urgent thing on the
 * row; once the work is signed it is a fact; before work starts there is
 * nothing to say, and a "0m" there would read as a machine that never broke.
 */
function Downtime({ request }: { request: MaintenanceRequest }) {
  if (request.downtime_minutes !== null) {
    return (
      <span className="text-ink-3">
        Down {formatMinutes(request.downtime_minutes)} ·{" "}
      </span>
    );
  }
  if (request.work_started_at) {
    return (
      <span className="font-semibold text-warn-deep">
        Down {formatMinutes(minutesSince(request.work_started_at))} ·{" "}
      </span>
    );
  }
  return null;
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[132px] animate-pulse rounded-2xl border border-line-soft bg-surface"
        />
      ))}
    </div>
  );
}
