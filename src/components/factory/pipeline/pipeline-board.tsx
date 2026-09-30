"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CornerDownRight,
  Inbox,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";

import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import { StageStrip } from "@/components/factory/pipeline/stage-strip";
import { SelectField } from "@/components/ui/select-field";
import { BATCH_TYPES } from "@/app/factory/[slug]/pipeline/schemas";
import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import { formatDay, todayKey } from "@/lib/factory/dates";
import {
  PIPELINE_COLUMNS,
  allocationFor,
  formatPackSize,
  jobProgress,
  packUnitSingular,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** The status's own colours — the same four the rest of the module uses. */
function statusStyle(status: PipelineJob["status"]) {
  const column = PIPELINE_COLUMNS.find((c) => c.status === status);
  return {
    label: column?.label ?? status,
    accent: column?.accent ?? "var(--color-ink-5)",
    tint: column?.tint ?? "var(--color-sunken)",
  };
}

/** "200 kg", "1,000 bottles" — the ordered quantity in the unit it is counted in. */
function quantityLabel(job: PipelineJob): string | null {
  if (!job.required_qty) return null;
  const unit =
    job.batch_type === "manufacturing"
      ? (job.bulk_unit ?? "units")
      : job.batch_type === "packing"
        ? (job.pack_unit ?? "containers")
        : (job.pack_unit ?? job.bulk_unit ?? "units");
  return `${fmt(job.required_qty)} ${unit}`;
}

/** Why nothing can be logged against the batch yet, or null once it is issued. */
function planningNote(job: PipelineJob): string | null {
  if (job.issued_at) return null;
  if (job.stage_count === 0) return "Not issued — no stages planned";
  if (job.stages_without_target > 0)
    return `Not issued — ${job.stages_without_target} stage${job.stages_without_target === 1 ? "" : "s"} without a target`;
  return "Not issued — ready to issue";
}

interface BoardRow {
  job: PipelineJob;
  /** Finished lots drawing on this batch's bulk, oldest first. */
  lots: PipelineJob[];
}

/**
 * The batch board: one row per batch, a bulk batch's finished lots folded
 * underneath it.
 *
 * It was four Kanban columns. The columns answered "what state is it in" and
 * nothing else: a bulk batch and the three lots packed from it were four cards
 * in up to four columns, related only by a line of small type. A row per batch
 * says the status with a colour and a chip and spends the width on what the
 * columns had no room for — the quantity, the due date, and the family.
 *
 * Still nothing to drag. A row's status is a fact about what has been logged
 * against the batch; rows change when the work does.
 */
export function PipelineBoard({
  jobs,
  stages,
  unitWord,
  canManage,
  onOpen,
  onPlan,
  onDelete,
  onAddPacking,
}: {
  jobs: PipelineJob[];
  /** Every plan in the tenant, so a row can draw its own without a fetch. */
  stages: BatchStage[];
  unitWord: string;
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  /** Only ever called for a Planned job — see `deletePipelineJob`. */
  onDelete: (job: PipelineJob) => void;
  /** Opens New batch on Finished Lot with this parent pre-filled. */
  onAddPacking: (parentId: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const today = useRenderClock(todayKey);

  // Grouped once for the whole board rather than filtered per row, which
  // would be a scan of every stage for every job on screen.
  const stagesByJob = useMemo(() => {
    const map = new Map<string, BatchStage[]>();
    for (const stage of stages) {
      const list = map.get(stage.job_id) ?? [];
      list.push(stage);
      map.set(stage.job_id, list);
    }
    return map;
  }, [stages]);

  // A lot is folded under its bulk only while that bulk is on the board; one
  // whose parent has left stays a row of its own rather than vanishing.
  const rows = useMemo<BoardRow[]>(() => {
    const onBoard = new Set(jobs.map((job) => job.id));
    const nested = (job: PipelineJob) =>
      Boolean(job.parent_job_id && onBoard.has(job.parent_job_id));
    const lotsOf = new Map<string, PipelineJob[]>();
    for (const job of jobs) {
      if (!nested(job)) continue;
      const list = lotsOf.get(job.parent_job_id!) ?? [];
      list.push(job);
      lotsOf.set(job.parent_job_id!, list);
    }
    return jobs
      .filter((job) => !nested(job))
      .map((job) => ({ job, lots: lotsOf.get(job.id) ?? [] }));
  }, [jobs]);

  const statusOptions = useMemo(
    () =>
      PIPELINE_COLUMNS.map((column) => ({
        value: column.status,
        label: column.label,
        meta: String(jobs.filter((j) => j.status === column.status).length),
      })),
    [jobs],
  );
  const typeOptions = useMemo(
    () =>
      BATCH_TYPES.map((t) => ({
        value: t.value,
        label: t.label,
        meta: String(jobs.filter((j) => j.batch_type === t.value).length),
      })),
    [jobs],
  );

  const filtering = status !== "" || type !== "";
  const matches = (job: PipelineJob) =>
    (status === "" || job.status === status) &&
    (type === "" || job.batch_type === type);
  // A family is kept whole: a bulk batch stays when one of its lots is what
  // matched, and is opened so the match is not hidden behind an arrow.
  const shown = rows.filter(
    (row) => matches(row.job) || row.lots.some(matches),
  );

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-4">
          {filtering
            ? `${shown.length} of ${rows.length} batches`
            : `${rows.length} batch${rows.length === 1 ? "" : "es"}`}
          {jobs.length > rows.length &&
            ` · ${jobs.length - rows.length} finished lot${jobs.length - rows.length === 1 ? "" : "s"} folded under their bulk`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            value={status}
            onChange={setStatus}
            options={statusOptions}
            clearable
            clearLabel="All statuses"
            ariaLabel="Filter by status"
            className="h-9 w-44 text-[13px]"
          />
          <SelectField
            value={type}
            onChange={setType}
            options={typeOptions}
            clearable
            clearLabel="All types"
            ariaLabel="Filter by batch type"
            className="h-9 w-44 text-[13px]"
          />
        </div>
      </div>

      {/* The list's own scrollbar from `lg` up, so the heading and the filters
          stay put while forty batches scroll under them. */}
      <div className="scrollbar-slim space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 lg:pb-1">
        {shown.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface py-14 text-center">
            <Inbox className="size-5 text-ink-6" />
            <p className="mt-1.5 text-sm text-ink-5">
              Nothing matches these filters.
            </p>
          </div>
        ) : (
          shown.map(({ job, lots }) => (
            <BatchRow
              key={job.id}
              job={job}
              lots={lots}
              stagesByJob={stagesByJob}
              unitWord={unitWord}
              today={today}
              canManage={canManage}
              open={
                expanded.has(job.id) ||
                (filtering && !matches(job) && lots.some(matches))
              }
              onToggle={() => toggle(job.id)}
              onOpen={onOpen}
              onPlan={onPlan}
              onDelete={onDelete}
              onAddPacking={onAddPacking}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BatchRow({
  job,
  lots,
  stagesByJob,
  unitWord,
  today,
  canManage,
  open,
  onToggle,
  onOpen,
  onPlan,
  onDelete,
  onAddPacking,
}: {
  job: PipelineJob;
  lots: PipelineJob[];
  stagesByJob: Map<string, BatchStage[]>;
  unitWord: string;
  today: string;
  canManage: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  onDelete: (job: PipelineJob) => void;
  onAddPacking: (parentId: string) => void;
}) {
  const status = statusStyle(job.status);
  const stages = stagesByJob.get(job.id) ?? [];
  const percent = jobProgress(job);
  const isBulk = job.batch_type === "manufacturing";
  const allocation = allocationFor(job);
  const panelId = `batch-panel-${job.id}`;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_22_43/0.05)] transition",
        open ? "border-line-strong shadow-card" : "hover:border-line-strong",
      )}
    >
      {/* A rendered spine rather than a `borderLeft` style, so the accent
          rounds with the row instead of leaving one squared-off edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: status.accent }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-3 pl-3.5 sm:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Collapse" : "Expand"} batch ${job.batch_no}`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-5 transition outline-none hover:bg-sunken-2 hover:text-ink focus-visible:ring-4 focus-visible:ring-brand/12"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>

        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* The name is the way into the batch's details — a button, so it
                reaches the keyboard. */}
            <button
              type="button"
              onClick={() => onOpen(job)}
              title={`Open details for batch ${job.batch_no}`}
              className="max-w-full truncate rounded text-left text-[14px] font-semibold text-ink outline-none transition hover:text-brand-deep hover:underline focus-visible:ring-4 focus-visible:ring-brand/12"
            >
              {job.product_name}
            </button>
            {/* Single Batch is the overwhelming majority and says nothing new,
                so it stays unbadged — a badge on every row is a badge on none. */}
            {job.batch_type !== "combined" && (
              <BatchTypeBadge type={job.batch_type} />
            )}
            {isBulk && lots.length > 0 && (
              <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand-deep">
                {lots.length} lot{lots.length === 1 ? "" : "s"}
              </span>
            )}
            <RowAlerts job={job} />
          </div>
          <MetaLine job={job} unitWord={unitWord} today={today} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {percent !== null && job.status !== "planned" && (
            <span
              className="hidden items-center gap-2 md:flex"
              title={`${fmt(job.produced_qty)} of ${fmt(job.required_qty)}`}
            >
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${percent}%`, background: status.accent }}
                />
              </span>
              <span className="w-9 font-mono text-[11px] font-semibold tabular-nums text-ink-4">
                {percent}%
              </span>
            </span>
          )}
          <StatusChip job={job} />
          <RowActions
            job={job}
            canManage={canManage}
            onPlan={onPlan}
            onDelete={onDelete}
            onAddPacking={isBulk ? onAddPacking : undefined}
          />
        </div>
      </div>

      {open && (
        <div
          id={panelId}
          className="animate-in space-y-3 border-t border-line-soft bg-sunken py-3 pr-3 pl-[3.25rem] fade-in-0"
        >
          {/* Where the batch is in its own route: which stage is running,
              which are done, and which one finishes the order. */}
          <div>
            <p className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
              Stages
            </p>
            {stages.length > 0 ? (
              <StageStrip stages={stages} className="mt-1.5" />
            ) : (
              <p className="mt-1 text-xs text-ink-5">No stages planned yet.</p>
            )}
            {percent !== null && (
              <p className="mt-1.5 font-mono text-[11px] tabular-nums text-ink-4">
                {fmt(job.produced_qty)} / {fmt(job.required_qty)} made
                <span
                  className="ml-1 font-semibold"
                  style={{ color: status.accent }}
                >
                  {percent}%
                </span>
              </p>
            )}
          </div>

          {isBulk && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
                  Finished lots
                </p>
                {/* Over-allocation is badged, never blocked — as in Batch
                    families, which is where the full sum is drawn. */}
                {/* Over, it says by how much rather than as a percentage: a
                    pack size in the wrong unit reads as 95,238%, which names
                    no fix, where "needs 1,000,000, bulk makes 1,050" points
                    straight at the mismatch. */}
                {allocation &&
                  (allocation.ok ? (
                    <p className="font-mono text-[11px] tabular-nums text-ink-4">
                      {fmt(allocation.allocated)} / {fmt(allocation.allowance)}{" "}
                      {job.bulk_unit ?? "units"} of bulk allocated (
                      {allocation.pct}%)
                    </p>
                  ) : (
                    <p
                      title="Lots need containers × pack size, in this bulk's unit. Check the pack size is in the same unit as the bulk."
                      className="inline-flex items-center gap-1 rounded-md bg-warn-tint px-2 py-0.5 text-[11px] font-semibold text-warn-ink ring-1 ring-warn-line"
                    >
                      <AlertTriangle className="size-3" aria-hidden />
                      Lots need {fmt(allocation.allocated)}{" "}
                      {job.bulk_unit ?? "units"} — this bulk makes{" "}
                      {fmt(allocation.allowance)}
                    </p>
                  ))}
              </div>
              {lots.length === 0 ? (
                <p className="mt-1 text-xs text-ink-5">
                  No finished lots drawn from this bulk yet.
                </p>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  {lots.map((lot) => (
                    <LotRow
                      key={lot.id}
                      job={lot}
                      stages={stagesByJob.get(lot.id) ?? []}
                      unitWord={unitWord}
                      today={today}
                      canManage={canManage}
                      onOpen={onOpen}
                      onPlan={onPlan}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** A finished lot under its bulk batch: the same row, one size down. */
function LotRow({
  job,
  stages,
  unitWord,
  today,
  canManage,
  onOpen,
  onPlan,
  onDelete,
}: {
  job: PipelineJob;
  stages: BatchStage[];
  unitWord: string;
  today: string;
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  onDelete: (job: PipelineJob) => void;
}) {
  const status = statusStyle(job.status);

  return (
    <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pr-2.5 pl-3.5 sm:flex-nowrap">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: status.accent }}
      />
      <CornerDownRight className="size-3.5 shrink-0 text-ink-6" aria-hidden />

      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => onOpen(job)}
            title={`Open details for batch ${job.batch_no}`}
            className="max-w-full truncate rounded text-left text-[13px] font-semibold text-ink outline-none transition hover:text-brand-deep hover:underline focus-visible:ring-4 focus-visible:ring-brand/12"
          >
            {job.product_name}
          </button>
          {job.pack_size && (
            <span className="text-[11px] text-ink-5">
              {formatPackSize(job.pack_size)} per{" "}
              {packUnitSingular(job.pack_unit)}
              {job.market && ` · ${job.market}`}
            </span>
          )}
          <RowAlerts job={job} />
        </div>
        <MetaLine job={job} unitWord={unitWord} today={today} />
        {stages.length > 0 && <StageStrip stages={stages} className="mt-1.5" />}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <StatusChip job={job} />
        <RowActions
          job={job}
          canManage={canManage}
          onPlan={onPlan}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/** `B001 · 200 kg · Room 3 · Due 9 Oct 2026` */
function MetaLine({
  job,
  unitWord,
  today,
}: {
  job: PipelineJob;
  unitWord: string;
  today: string;
}) {
  const quantity = quantityLabel(job);
  const overdue =
    job.due_date !== null && job.status !== "finished" && job.due_date < today;

  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-5">
      <span className="font-mono text-[11.5px] font-semibold text-ink-4">
        {job.batch_no}
      </span>
      {job.product_code && (
        <>
          <Dot />
          <span className="font-mono text-[11.5px]">{job.product_code}</span>
        </>
      )}
      {quantity && (
        <>
          <Dot />
          <span>{quantity}</span>
        </>
      )}
      <Dot />
      {job.unit_name ? (
        <span>{job.unit_name}</span>
      ) : (
        <span className="italic">No {unitWord.toLowerCase()} yet</span>
      )}
      {job.due_date && (
        <>
          <Dot />
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue && "font-semibold text-danger-deep",
            )}
          >
            <CalendarDays className="size-3" aria-hidden />
            Due {formatDay(job.due_date)}
            {overdue && " · overdue"}
          </span>
        </>
      )}
    </p>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-6">
      ·
    </span>
  );
}

/**
 * What needs someone's attention, said on the row: flagged entries, the
 * hold's cause rather than just its existence, and a batch nothing can be
 * logged against yet — the operator who finds that out otherwise is the one
 * refused at 6am.
 */
function RowAlerts({ job }: { job: PipelineJob }) {
  const note = planningNote(job);

  return (
    <>
      {job.flagged_count > 0 && (
        <span
          title={`${job.flagged_count} flagged shift-log entr${job.flagged_count === 1 ? "y" : "ies"}`}
          className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn-deep ring-1 ring-warn-line"
        >
          <AlertTriangle className="size-2.5" aria-hidden />
          {job.flagged_count}
        </span>
      )}
      {job.quarantine_no ? (
        <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-danger-deep ring-1 ring-danger-line">
          Quarantined — {job.quarantine_no}
        </span>
      ) : (
        job.status === "hold" &&
        job.hold_reason && (
          <span className="rounded-md bg-warn-tint px-1.5 py-0.5 text-[10.5px] font-semibold text-warn-ink ring-1 ring-warn-line">
            Held — {job.hold_reason.toLowerCase()} issue flagged
          </span>
        )
      )}
      {note && (
        <span className="text-[11px] font-medium text-warn-ink">{note}</span>
      )}
    </>
  );
}

function StatusChip({ job }: { job: PipelineJob }) {
  const status = statusStyle(job.status);
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.05em] whitespace-nowrap uppercase"
      style={{ background: status.tint, color: status.accent }}
    >
      {status.label}
    </span>
  );
}

function RowActions({
  job,
  canManage,
  onPlan,
  onDelete,
  onAddPacking,
}: {
  job: PipelineJob;
  canManage: boolean;
  onPlan: (job: PipelineJob) => void;
  onDelete: (job: PipelineJob) => void;
  /** Passed only for a bulk batch — nothing else has lots to add. */
  onAddPacking?: (parentId: string) => void;
}) {
  if (!canManage) return null;
  const needsPlanning = !job.issued_at;

  return (
    <>
      {/* Labelled, and amber until the batch is issued: planning is the thing
          standing between this row and any work being logged against it. */}
      <button
        type="button"
        onClick={() => onPlan(job)}
        aria-label={`${needsPlanning ? "Plan stages for" : "View the plan for"} batch ${job.batch_no}`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition",
          needsPlanning
            ? "bg-warn-tint text-warn-ink ring-1 ring-warn-line hover:brightness-95"
            : "border border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
        )}
      >
        <ListChecks className="size-3.5" aria-hidden />
        {needsPlanning ? "Plan stages" : "Stages"}
      </button>

      {onAddPacking && (
        <button
          type="button"
          onClick={() => onAddPacking(job.id)}
          aria-label={`Add a finished lot to batch ${job.batch_no}`}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-4 transition hover:bg-brand-tint hover:text-brand"
        >
          <Plus className="size-3.5" aria-hidden />
          Lot
        </button>
      )}

      {/* Deleting is offered only before anything has been logged. After that
          the job is the visible half of an audit-protected record. */}
      {job.status === "planned" && (
        <button
          type="button"
          onClick={() => onDelete(job)}
          title="Remove this batch from the board — nothing has been logged against it yet"
          aria-label={`Remove batch ${job.batch_no} from the board`}
          className="grid size-8 place-items-center rounded-lg text-ink-6 transition hover:bg-danger-soft hover:text-danger-deep"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </>
  );
}
