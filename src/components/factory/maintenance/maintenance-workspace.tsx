"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  Package,
  User,
  Wrench,
} from "lucide-react";

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
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.09em] text-ink-5 uppercase">
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
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        {/* One shell holding the chips rather than five free-floating pills:
            the sections are a sequence, and a shared track says so. It also
            stops the row re-flowing as the counts change width. */}
        <div
          role="tablist"
          aria-label="Request section"
          className="scrollbar-slim flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-sunken-2 p-1"
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
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
                    : "text-ink-4 hover:bg-surface/60 hover:text-ink",
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                    active
                      ? "bg-brand-soft text-brand-deep"
                      : "bg-line text-ink-4",
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
            "inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition",
            urgent
              ? "border-danger-deep bg-danger-soft text-danger-deep shadow-[0_0_0_3px_rgb(220_38_38/0.12)]"
              : "border-line bg-surface text-ink-3 shadow-soft hover:border-danger-deep hover:text-danger-deep",
            // Nothing is urgent: the toggle stays put so its absence reads as
            // "all quiet" rather than as a control that went missing.
            urgentCount === 0 && !urgent && "opacity-60",
          )}
        >
          <AlertTriangle className="size-3.5" />
          Urgent only
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
              urgent
                ? "bg-danger-line text-danger-deep"
                : "bg-sunken-2 text-ink-4",
            )}
          >
            {urgentCount}
          </span>
        </button>
      </div>

      {/* The tray is the only thing that scrolls. A page-length scroll took
          the section chips and their counts off screen, which is exactly the
          context you need while reading down the tray. The negative margin and
          matching padding let a card's hover shadow breathe without being
          clipped by the scroll box. */}
      <div className="scrollbar-slim -mx-1 min-h-0 flex-1 px-1 pb-1 lg:overflow-y-auto">
        {isPending ? (
          <ListSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load maintenance requests: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
              <Wrench className="size-6" />
            </span>
            <p className="mt-3 text-sm font-medium text-ink-3">
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
      </div>

      <MaintenanceDetailDialog
        request={open}
        factoryId={factoryId}
        role={role}
        unitWord={units.singular}
        onClose={() => setOpenId(null)}
      />
    </div>
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
        className="group relative block w-full overflow-hidden rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-5 text-left shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong hover:shadow-lift focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/12 focus-visible:outline-none"
      >
        {/* A rendered spine rather than a `borderLeft` style, so priority
            rounds with the card instead of leaving one squared-off edge. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: meta.dot }}
        />

        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              {/* The request number is the document's name — the thing said
                  out loud on the floor — so it reads as an identifier rather
                  than as the smallest grey text on the row. */}
              <span className="rounded-md bg-sunken-2 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-ink-4 ring-1 ring-line">
                {request.request_no}
              </span>
              <span className="font-mono text-sm font-semibold text-ink transition group-hover:text-brand-deep">
                {request.equipment_no}
              </span>
              {request.equipment_name && (
                <span className="truncate text-xs text-ink-3">
                  {request.equipment_name}
                </span>
              )}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-5">
              <span className="font-medium text-ink-4">
                {request.unit_name ?? `Not ${unitWord.toLowerCase()}-specific`}
              </span>
              {request.department_name && (
                <>
                  <Dot />
                  <span>{request.department_name}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
                meta.pill,
              )}
            >
              {meta.label}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
                STATUS_PILL[request.status],
              )}
            >
              {STATUS_LABELS[request.status]}
            </span>
            <ChevronRight className="size-4 text-ink-6 transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </div>
        </div>

        <p className="mt-2 line-clamp-2 text-[13px] break-words whitespace-pre-wrap text-ink-2">
          {request.description}
        </p>

        {/* The batch, on its own line rather than trailing four grey words:
            it is what ties a breakdown to a run that may have to be quarantined. */}
        {request.batch_no && (
          <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-lg bg-sunken px-2 py-1 text-xs ring-1 ring-line-soft">
            <Package className="size-3.5 shrink-0 text-ink-5" />
            <span className="font-mono font-semibold text-ink">
              {request.batch_no}
            </span>
            {request.product_name && (
              <span className="text-ink-4">{request.product_name}</span>
            )}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line-soft pt-2.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              request.assigned_to
                ? "font-medium text-ink-2"
                : "font-medium text-warn-deep italic",
            )}
          >
            <User className="size-3.5 shrink-0 text-ink-5" />
            {/* Unassigned is the state a broken machine waits in, so it reads
                as something outstanding rather than as a blank. */}
            {request.assigned_to ?? "Unassigned"}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-ink-5">
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
      <span className="mr-1.5 rounded-md bg-warn-soft px-1.5 py-0.5 font-semibold text-warn-deep ring-1 ring-warn-line">
        Down {formatMinutes(minutesSince(request.work_started_at))}
      </span>
    );
  }
  return null;
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-line bg-surface p-4"
        >
          <span className="block h-3.5 w-2/5 animate-pulse rounded bg-sunken-2" />
          <span className="mt-2.5 block h-2.5 w-1/3 animate-pulse rounded bg-sunken-2" />
          <span className="mt-3 block h-2.5 w-4/5 animate-pulse rounded bg-sunken-2" />
          <span className="mt-4 block h-2.5 w-1/4 animate-pulse rounded bg-sunken-2" />
        </div>
      ))}
    </div>
  );
}

/** The separator in a meta line, dimmer than the words it separates. */
function Dot() {
  return (
    <span aria-hidden className="text-ink-6">
      ·
    </span>
  );
}
