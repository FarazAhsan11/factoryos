"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  FileWarning,
  PackageSearch,
  Wrench,
  Zap,
} from "lucide-react";

import { ActionDetailDialog } from "@/components/factory/actions/action-detail-dialog";
import { ActionList } from "@/components/factory/actions/action-list";
import { BatchActivityList } from "@/components/factory/batch/batch-activity-list";
import { BatchEntryDialog } from "@/components/factory/batch/batch-entry-dialog";
import { BatchSearch } from "@/components/factory/batch/batch-search";
import { DeviationDetailDialog } from "@/components/factory/deviations/deviation-detail-dialog";
import { DeviationRow } from "@/components/factory/deviations/deviations-workspace";
import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import { MaintenanceDetailDialog } from "@/components/factory/maintenance/maintenance-detail-dialog";
import { RequestRow } from "@/components/factory/maintenance/maintenance-workspace";
import {
  actionKeys,
  fetchActions,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  deviationKeys,
  fetchDeviations,
} from "@/lib/factory/deviation-queries";
import {
  fetchMaintenanceRequests,
  maintenanceKeys,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
import type { Product } from "@/lib/factory/product-queries";
import {
  fetchBatchLog,
  logKeys,
  type LogEntry,
} from "@/lib/factory/shift-log-queries";
import { cn } from "@/lib/utils";

type Tab = "activity" | "issues" | "maintenance" | "deviations";

/**
 * Batch record — one batch, everything that happened to it.
 *
 * The four modules that write about a batch each answer to their own working
 * rhythm: the shift log is filled hour by hour, issues are worked through
 * stages over days, maintenance runs its own three-section document, and QA
 * raises and closes deviations and NCRs. That is right for the people doing
 * the work and useless for the person asked, six weeks later, what happened
 * to batch 47004. This screen is that question, and nothing else — it reads
 * the same four tables and writes to none of them.
 *
 * **Activity**, not "production": the first tab holds every entry filed
 * against the batch, and a room's downtime and its mixing steps are as much
 * part of the record as its production runs. Calling the tab Production would
 * promise a filter it does not apply.
 */
export function BatchRecordWorkspace({
  factoryId,
  userId,
  role,
  units,
}: {
  factoryId: string;
  userId: string;
  /** Passed to the two detail dialogs, which decide what a viewer may drive. */
  role: FactoryRole;
  units: { singular: string; plural: string };
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [tab, setTab] = useState<Tab>("activity");

  const [openEntry, setOpenEntry] = useState<LogEntry | null>(null);
  const [openAction, setOpenAction] = useState<FactoryAction | null>(null);
  const [openRequest, setOpenRequest] = useState<MaintenanceRequest | null>(
    null,
  );
  // An id rather than a snapshot, so the dialog shows the record closed the
  // moment it is signed from here.
  const [openDeviationId, setOpenDeviationId] = useState<string | null>(null);

  const batchNo = product?.batch_no ?? "";

  /**
   * The batch's own history. Keyed by the batch, not the day, so moving
   * between batches is instant on the way back.
   */
  const { data: entries = [], isPending: entriesPending } = useQuery({
    queryKey: logKeys.batch(factoryId, batchNo),
    queryFn: () => fetchBatchLog(factoryId, batchNo),
    enabled: Boolean(batchNo),
  });

  /*
   * Issues and maintenance are read whole and filtered here rather than
   * queried per batch. Both lists are already cached by their own screens —
   * arriving from either costs nothing — and both are small: a factory that
   * has raised more issues than a browser can filter has a bigger problem
   * than this screen.
   */
  const { data: actions = [], isPending: actionsPending } = useQuery({
    queryKey: actionKeys.all(factoryId),
    queryFn: () => fetchActions(factoryId),
    enabled: Boolean(batchNo),
  });
  const { data: requests = [], isPending: requestsPending } = useQuery({
    queryKey: maintenanceKeys.all(factoryId),
    queryFn: () => fetchMaintenanceRequests(factoryId),
    enabled: Boolean(batchNo),
  });
  const { data: deviations = [], isPending: deviationsPending } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
    enabled: Boolean(batchNo),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
    enabled: Boolean(batchNo),
  });

  /**
   * Matched on the batch *number*, not the product id.
   *
   * An issue or a maintenance request keeps the number that was typed even
   * when it matched nothing in the catalogue, and `product_id` is null for
   * exactly those. Matching on the id would drop the records most worth
   * finding — the ones raised against a batch nobody had set up properly.
   */
  const key = batchNo.trim().toLowerCase();
  const batchActions = useMemo(
    () =>
      actions.filter((a) => (a.batch_no ?? "").trim().toLowerCase() === key),
    [actions, key],
  );
  const batchRequests = useMemo(
    () =>
      requests.filter((r) => (r.batch_no ?? "").trim().toLowerCase() === key),
    [requests, key],
  );
  const batchDeviations = useMemo(
    () =>
      deviations.filter(
        (d) => (d.batch_no ?? "").trim().toLowerCase() === key,
      ),
    [deviations, key],
  );
  const openDeviation =
    deviations.find((d) => d.id === openDeviationId) ?? null;
  const job = useMemo(
    () => jobs.find((j) => j.product_id === product?.id) ?? null,
    [jobs, product],
  );

  const produced = useMemo(
    () => entries.reduce((sum, e) => sum + Number(e.qty ?? 0), 0),
    [entries],
  );

  const TABS: { id: Tab; label: string; count: number; icon: typeof Zap }[] = [
    {
      id: "activity",
      label: "Activity",
      count: entries.length,
      icon: ClipboardList,
    },
    { id: "issues", label: "Issues", count: batchActions.length, icon: Zap },
    {
      id: "maintenance",
      label: "Maintenance",
      count: batchRequests.length,
      icon: Wrench,
    },
    {
      id: "deviations",
      label: "Deviations",
      count: batchDeviations.length,
      icon: FileWarning,
    },
  ];

  const pending =
    (tab === "activity" && entriesPending) ||
    (tab === "issues" && actionsPending) ||
    (tab === "maintenance" && requestsPending) ||
    (tab === "deviations" && deviationsPending);

  return (
    <div className="flex w-full flex-col gap-4 lg:min-h-0 lg:flex-1">
      <BatchSearch
        factoryId={factoryId}
        selected={product}
        onSelect={(next) => {
          setProduct(next);
          setTab("activity");
        }}
      />

      {!product ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1">
          {/* ── The batch itself ──────────────────────────────────────
              A masthead, like the shift report's: what this record is about,
              stated once, so neither the tabs nor the cards have to repeat
              the batch number on every row. */}
          <header className="shrink-0 border-b border-line bg-[linear-gradient(105deg,var(--color-brand-tint)_0%,var(--color-surface)_55%)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xl font-semibold tracking-tight text-ink">
                    {product.batch_no}
                  </span>
                  {job && <BatchTypeBadge type={job.batch_type} />}
                  {!product.active && (
                    <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-[10px] font-semibold text-ink-4 ring-1 ring-line">
                      Retired
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm break-words text-ink-3">
                  {product.name}
                  {product.code && (
                    <span className="ml-2 font-mono text-xs text-ink-5">
                      {product.code}
                    </span>
                  )}
                </p>
              </div>

              <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Fact label="Ordered" value={product.required_qty} />
                <Fact label="Logged" value={produced} tone="text-brand" />
                {product.work_order && (
                  <Fact label="Work order" text={product.work_order} />
                )}
                {job && (
                  <Fact
                    label="Board"
                    text={job.issued_at ? job.status : "Not issued"}
                  />
                )}
              </dl>
            </div>
          </header>

          {/* ── The four questions ────────────────────────────────────
              Counts on the tabs, because "were there any issues?" is answered
              by the number on the tab rather than by opening it. */}
          <div
            role="tablist"
            aria-label="Batch record"
            className="flex shrink-0 gap-1 border-b border-line-soft bg-sunken px-3 py-2"
          >
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                    active
                      ? "bg-surface text-brand shadow-[0_1px_2px_rgb(20_22_43/0.06)] ring-1 ring-line"
                      : "text-ink-4 hover:bg-surface/60 hover:text-ink-2",
                  )}
                >
                  <item.icon className="size-3.5" aria-hidden />
                  {item.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                      active
                        ? "bg-brand-soft text-brand-deep"
                        : "bg-sunken-2 text-ink-5",
                    )}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-3.5">
            {pending ? (
              <ListSkeleton />
            ) : tab === "activity" ? (
              entries.length === 0 ? (
                <Nothing
                  icon={ClipboardList}
                  text={`Nothing has been logged against ${product.batch_no} yet.`}
                />
              ) : (
                <BatchActivityList entries={entries} onOpen={setOpenEntry} />
              )
            ) : tab === "issues" ? (
              batchActions.length === 0 ? (
                <Nothing
                  icon={Zap}
                  text={`No issues have been raised against ${product.batch_no}.`}
                />
              ) : (
                <ActionList actions={batchActions} onOpen={setOpenAction} />
              )
            ) : tab === "maintenance" ? (
              batchRequests.length === 0 ? (
                <Nothing
                  icon={Wrench}
                  text={`No maintenance has been requested against ${product.batch_no}.`}
                />
              ) : (
                <ul className="space-y-2.5">
                  {batchRequests.map((request) => (
                    <RequestRow
                      key={request.id}
                      request={request}
                      unitWord={units.singular}
                      onOpen={() => setOpenRequest(request)}
                    />
                  ))}
                </ul>
              )
            ) : batchDeviations.length === 0 ? (
              <Nothing
                icon={FileWarning}
                text={`No deviations or NCRs have been raised against ${product.batch_no}.`}
              />
            ) : (
              <ul className="space-y-2.5">
                {batchDeviations.map((deviation) => (
                  <DeviationRow
                    key={deviation.id}
                    deviation={deviation}
                    onOpen={() => setOpenDeviationId(deviation.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* The same dialogs their own screens open, so an issue worked from here
          is worked exactly as it is worked from Issues & CAPAs. */}
      <BatchEntryDialog entry={openEntry} onClose={() => setOpenEntry(null)} />
      <ActionDetailDialog
        action={openAction}
        factoryId={factoryId}
        userId={userId}
        role={role}
        onClose={() => setOpenAction(null)}
      />
      <MaintenanceDetailDialog
        request={openRequest}
        factoryId={factoryId}
        role={role}
        unitWord={units.singular}
        onClose={() => setOpenRequest(null)}
      />
      <DeviationDetailDialog
        deviation={openDeviation}
        factoryId={factoryId}
        role={role}
        onClose={() => setOpenDeviationId(null)}
      />
    </div>
  );
}

function Fact({
  label,
  value,
  text,
  tone,
}: {
  label: string;
  value?: number;
  text?: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-[15px] font-semibold tabular-nums",
          tone ?? "text-ink-2",
          text && "capitalize",
        )}
      >
        {text ?? Number(value ?? 0).toLocaleString()}
      </dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-tint text-brand">
        <PackageSearch className="size-6" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink-2">
        Search a batch to open its record.
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-5">
        Everything logged on the floor, and every issue, maintenance request
        and deviation raised for one batch — gathered from the screens that
        record them, and read-only.
      </p>
    </div>
  );
}

function Nothing({ icon: Icon, text }: { icon: typeof Zap; text: string }) {
  return (
    <div className="py-16 text-center">
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-sunken text-ink-6">
        <Icon className="size-5" />
      </span>
      <p className="mt-2.5 text-xs text-ink-5">{text}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-sunken" />
      ))}
    </div>
  );
}
