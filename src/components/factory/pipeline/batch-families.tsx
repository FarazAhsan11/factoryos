"use client";

import { useMemo, useState } from "react";
import { Boxes, ChevronDown, Package, Plus } from "lucide-react";

import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import {
  PIPELINE_COLUMNS,
  allocationFor,
  familiesFrom,
  type PipelineJob, packUnitSingular } from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "planned", label: "Planned" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

/** The board's own colours, so a status reads the same in both views. */
function statusStyle(status: PipelineJob["status"]) {
  const column = PIPELINE_COLUMNS.find((c) => c.status === status);
  return {
    label: column?.label ?? status,
    accent: column?.accent ?? "var(--color-ink-5)",
    tint: column?.tint ?? "var(--color-sunken)",
  };
}

/**
 * Pipeline → Batch families.
 *
 * The Kanban board answers "what is running"; this answers "does the bulk add
 * up". A manufacturing batch is shown as a parent with its packing runs
 * grouped underneath, and the bar across the top compares what those runs
 * have claimed against what the parent will actually make:
 *
 *     46000 Paracetamol Tablet          210,000 tablets
 *       46001  1,000 bottles × 30   =    30,000
 *       46002  1,000 bottles × 60   =    60,000
 *       46003  1,000 bottles × 120  =   120,000
 *                                       ───────
 *                                       210,000  ✓ Bulk sufficient
 *
 * Over-allocation is badged, never blocked — a second bulk batch already
 * scheduled is a good reason to be over, and a planner stopped at 6am works
 * around the block instead of fixing the plan.
 */
export function BatchFamilies({
  jobs,
  canManage,
  onOpen,
  onAddPacking,
}: {
  jobs: PipelineJob[];
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  /** Opens New batch on Packing with this parent pre-filled. */
  onAddPacking: (parentId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const matches = useMemo(() => {
    if (filter === "active")
      return (job: PipelineJob) =>
        job.status === "production" || job.status === "hold";
    if (filter === "planned")
      return (job: PipelineJob) => job.status === "planned";
    return () => true;
  }, [filter]);

  const { families, standalone } = useMemo(() => familiesFrom(jobs), [jobs]);

  // The filter is applied to the *parent*, not to the children: a family with
  // one packing run still in Planned is not three quarters of a family, and
  // hiding the children would break the allocation the view exists to show.
  const shownFamilies = families.filter((f) => matches(f.parent));
  const shownStandalone = standalone.filter(matches);

  if (families.length === 0 && standalone.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
          <Boxes className="size-6" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink-3">
          Nothing on the board yet.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 lg:overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-ink-4">
          Manufacturing batches with their packing runs grouped underneath, and
          how much of the bulk each run has claimed.
        </p>
        <div className="flex shrink-0 gap-1 rounded-xl border border-line bg-sunken-2 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-semibold transition",
                filter === f.value
                  ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgba(20,22,43,0.12)] ring-1 ring-line"
                  : "text-ink-4 hover:bg-surface/60 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {shownFamilies.length === 0 && shownStandalone.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-sm text-ink-5">
          Nothing matches this filter.
        </p>
      )}

      {shownFamilies.map((family) => (
        <FamilyGroup
          key={family.parent.id}
          parent={family.parent}
          runs={family.children}
          canManage={canManage}
          onOpen={onOpen}
          onAddPacking={onAddPacking}
        />
      ))}

      {shownStandalone.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold tracking-[0.07em] text-ink-5 uppercase">
            Standalone batches
          </h3>
          {shownStandalone.map((job) => (
            <StandaloneRow key={job.id} job={job} onOpen={onOpen} />
          ))}
        </section>
      )}
    </div>
  );
}

function FamilyGroup({
  parent,
  runs,
  canManage,
  onOpen,
  onAddPacking,
}: {
  parent: PipelineJob;
  /** Not named `children` — that prop belongs to React, and this is data. */
  runs: PipelineJob[];
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  onAddPacking: (parentId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const allocation = allocationFor(parent);
  const status = statusStyle(parent.status);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft bg-sunken px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 text-ink-5 transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: status.accent }}
              />
              <span className="font-mono text-[13px] font-semibold text-ink">
                {parent.batch_no}
              </span>
              <span className="truncate text-[13px] font-semibold text-ink-2">
                {parent.product_name}
              </span>
              <BatchTypeBadge type="manufacturing" />
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-5">
              {parent.unit_name ?? "No room yet"} ·{" "}
              {fmt(parent.required_qty)} {parent.bulk_unit ?? "units"} bulk
              {parent.overage_pct > 0 && ` · +${parent.overage_pct}% overage`}
              {runs.length > 0 &&
                ` · ${runs.length} packing run${runs.length === 1 ? "" : "s"}`}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ background: status.tint, color: status.accent }}
          >
            {status.label}
          </span>
          <button
            type="button"
            onClick={() => onOpen(parent)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-3 transition hover:border-ink-6 hover:text-ink"
          >
            Details
          </button>
        </div>
      </header>

      {open && (
        <div className="space-y-2.5 p-4">
          {allocation && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                <span className="font-semibold text-ink-3">
                  Bulk allocation
                </span>
                <span className="font-mono text-ink-4">
                  {fmt(allocation.allocated)} / {fmt(allocation.allowance)}{" "}
                  {parent.bulk_unit ?? "units"} ({allocation.pct}%)
                  <span className="text-ink-5">
                    {" · "}
                    {allocation.fromActual
                      ? "actually made"
                      : allocation.allowance > allocation.target
                        ? `target +${parent.overage_pct}%`
                        : "bulk target"}
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${allocation.barPct}%`,
                    background: allocation.ok
                      ? "var(--color-brand)"
                      : "var(--color-danger)",
                  }}
                />
              </div>
              <p
                className={cn(
                  "inline-block rounded-md px-2 py-1 text-[11px] font-semibold",
                  allocation.ok
                    ? "bg-teal-soft text-teal-deep"
                    : "bg-warn-tint text-warn-ink",
                )}
              >
                {allocation.ok
                  ? allocation.fromActual
                    ? `✓ Bulk sufficient — measured against the ${fmt(allocation.allowance)} actually made`
                    : allocation.allocated > allocation.target
                      ? `✓ Bulk sufficient — within the +${parent.overage_pct}% overage`
                      : "✓ Bulk sufficient"
                  : `⚠ Allocated exceeds the available bulk by ${fmt(allocation.over)}`}
              </p>
            </div>
          )}

          {runs.length === 0 ? (
            <p className="py-2 text-xs text-ink-5">
              No packing batches linked to this bulk yet.
            </p>
          ) : (
            runs.map((child) => (
              <PackingChildRow key={child.id} job={child} onOpen={onOpen} />
            ))
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => onAddPacking(parent.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-ink-6 bg-surface px-3 py-1.5 text-xs font-semibold text-ink-4 transition hover:border-brand hover:bg-brand-tint hover:text-brand"
            >
              <Plus className="size-3.5" aria-hidden />
              Add packing batch
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PackingChildRow({
  job,
  onOpen,
}: {
  job: PipelineJob;
  onOpen: (job: PipelineJob) => void;
}) {
  const status = statusStyle(job.status);
  const needed =
    job.pack_size && job.required_qty
      ? Number(job.required_qty) * Number(job.pack_size)
      : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      className="flex w-full items-center gap-3 rounded-xl border-l-[3px] border-brand bg-sunken px-3 py-2.5 text-left transition hover:bg-sunken-2"
    >
      <Package className="size-4 shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] font-semibold text-ink">
            {job.batch_no}
          </span>
          <span className="truncate text-[12px] font-semibold text-ink-2">
            {job.product_name}
          </span>
          {job.pack_size && (
            <span className="text-[10px] text-ink-5">
              {fmt(job.pack_size)} per {packUnitSingular(job.pack_unit)}
              {job.market && ` · ${job.market}`}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-5">
          {job.unit_name ?? "No room"} ·{" "}
          {job.required_qty
            ? `${fmt(job.required_qty)} ${job.pack_unit ?? "containers"}`
            : "No quantity set"}
          {needed !== null && ` · ${fmt(needed)} bulk needed`}
        </span>
      </span>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
        style={{ background: status.tint, color: status.accent }}
      >
        {status.label}
      </span>
    </button>
  );
}

function StandaloneRow({
  job,
  onOpen,
}: {
  job: PipelineJob;
  onOpen: (job: PipelineJob) => void;
}) {
  const status = statusStyle(job.status);

  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-card transition hover:border-line-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-ink">
            {job.batch_no}
          </span>
          <span className="truncate text-[13px] font-semibold text-ink-2">
            {job.product_name}
          </span>
          <BatchTypeBadge type={job.batch_type} />
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-5">
          {job.unit_name ?? "No room yet"} · {fmt(job.required_qty)} required
          {/* A packing run whose bulk came from outside the board — the
              prototype's "no parent — external bulk". Said out loud so it
              doesn't read as a family that failed to group. */}
          {job.batch_type === "packing" && " · external bulk"}
        </span>
      </span>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
        style={{ background: status.tint, color: status.accent }}
      >
        {status.label}
      </span>
    </button>
  );
}
