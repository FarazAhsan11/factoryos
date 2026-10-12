"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Hash,
  Inbox,
  ListChecks,
  Package,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";

import { StageProgressList } from "@/components/factory/pipeline/stage-progress";
import { SelectField } from "@/components/ui/select-field";
import { BATCH_TYPES } from "@/app/factory/[slug]/pipeline/schemas";
import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import { formatDay, todayKey } from "@/lib/factory/dates";
import {
  PIPELINE_COLUMNS,
  allocationFor,
  formatPackSize,
  jobStage,
  packUnitSingular,
  type PipelineJob,
  type PipelineStage,
} from "@/lib/factory/pipeline-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * The board's own colours: a blue ramp from slate (not started) through sky
 * and azure to navy (done). On hold keeps amber — it is the one status that
 * is a warning, and a blue "held" would not be read as one. Labels still come
 * from the shared column list.
 */
const BOARD_ACCENT: Record<PipelineStage, string> = {
  planning: "var(--color-ink-4)",
  planned: "var(--color-sky)",
  production: "var(--color-azure)",
  hold: "var(--color-warn-deep)",
  finished: "var(--color-navy)",
};

function statusStyle(status: PipelineStage) {
  const column = PIPELINE_COLUMNS.find((c) => c.status === status);
  return {
    label: column?.label ?? status,
    accent: BOARD_ACCENT[status] ?? "var(--color-ink-4)",
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
  canManage,
  onOpen,
  onPlan,
  onSignOff,
  onDelete,
  onAddPacking,
}: {
  jobs: PipelineJob[];
  /** Every plan in the tenant, so a row can draw its own without a fetch. */
  stages: BatchStage[];
  canManage: boolean;
  /** Opens the batch's details. Left out, the name is plain text. */
  onOpen?: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  /** Signs off a running stage from an expanded row; managers only. */
  onSignOff: (stage: BatchStage) => void;
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
        meta: String(jobs.filter((j) => jobStage(j) === column.status).length),
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
    (status === "" || jobStage(job) === status) &&
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
            className="h-9 w-44 text-[0.8125rem]"
          />
          <SelectField
            value={type}
            onChange={setType}
            options={typeOptions}
            clearable
            clearLabel="All types"
            ariaLabel="Filter by batch type"
            className="h-9 w-44 text-[0.8125rem]"
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
              today={today}
              canManage={canManage}
              open={
                expanded.has(job.id) ||
                (filtering && !matches(job) && lots.some(matches))
              }
              onToggle={() => toggle(job.id)}
              onOpen={onOpen}
              onPlan={onPlan}
              onSignOff={onSignOff}
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
  today,
  canManage,
  open,
  onToggle,
  onOpen,
  onPlan,
  onSignOff,
  onDelete,
  onAddPacking,
}: {
  job: PipelineJob;
  lots: PipelineJob[];
  stagesByJob: Map<string, BatchStage[]>;
  today: string;
  canManage: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen?: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  onSignOff: (stage: BatchStage) => void;
  onDelete: (job: PipelineJob) => void;
  onAddPacking: (parentId: string) => void;
}) {
  const status = statusStyle(jobStage(job));
  const stages = stagesByJob.get(job.id) ?? [];
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
            <BatchName
              job={job}
              onOpen={onOpen}
              className="text-[0.875rem]"
            />
            {/* The batch-type badge (Bulk Production / Finished Lot) is hidden
                for now. To bring it back, restore the `BatchTypeBadge` import
                and uncomment this:
                {job.batch_type !== "combined" && (
                  <BatchTypeBadge type={job.batch_type} />
                )} */}
            {isBulk && lots.length > 0 && (
              <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[0.625rem] font-bold text-brand-deep">
                {lots.length} lot{lots.length === 1 ? "" : "s"}
              </span>
            )}
            <RowAlerts job={job} />
          </div>
          <MetaLine job={job} today={today} />
        </div>

        {/* The status sits alone in the top-right corner; the row's actions
            hang beneath it, right-aligned. */}
        <div className="flex shrink-0 flex-col items-end gap-2 self-stretch">
          <StatusChip job={job} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RowActions
              job={job}
              canManage={canManage}
              onPlan={onPlan}
              onDelete={onDelete}
              onAddPacking={isBulk ? onAddPacking : undefined}
            />
          </div>
        </div>
      </div>

      <Collapse id={panelId} open={open}>
        <div className="space-y-3 border-t border-line-soft bg-sunken py-3 pr-3 pl-[3.25rem]">
          {/* Where the batch is in its own route: which stage is running,
              which are done, and which one finishes the order. */}
          <StagesSection
            stages={stages}
            onSignOff={canManage ? onSignOff : undefined}
          />

          {isBulk && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[0.625rem] font-bold tracking-[0.07em] text-ink-5 uppercase">
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
                    <p className="font-mono text-[0.6875rem] tabular-nums text-ink-4">
                      {fmt(allocation.allocated)} / {fmt(allocation.allowance)}{" "}
                      {job.bulk_unit ?? "units"} of bulk allocated (
                      {allocation.pct}%)
                    </p>
                  ) : (
                    <p
                      title="Lots need containers × pack size, in this bulk's unit. Check the pack size is in the same unit as the bulk."
                      className="inline-flex items-center gap-1 rounded-md bg-warn-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-warn-ink ring-1 ring-warn-line"
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
                      today={today}
                      canManage={canManage}
                      onOpen={onOpen}
                      onPlan={onPlan}
                      onSignOff={onSignOff}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Collapse>
    </article>
  );
}

/**
 * The expanded half of a row. Opens by animating its row track from 0fr to
 * 1fr — the one way to transition to an auto height. The wrapper is always
 * there, so the first open has a closed state to leave; `inert` keeps the
 * hidden buttons out of the tab order and the accessibility tree.
 */
function Collapse({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: React.ReactNode;
}) {
  // The detail is built the first time the row is opened and kept after, so
  // closing it can animate away rather than vanish — and a board of forty
  // closed rows still renders none of it.
  const [hasOpened, setHasOpened] = useState(open);
  if (open && !hasOpened) setHasOpened(true);

  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{hasOpened && children}</div>
    </div>
  );
}

/** A batch's route: how many stages are done and each one's progress. */
function StagesSection({
  stages,
  onSignOff,
}: {
  stages: BatchStage[];
  onSignOff?: (stage: BatchStage) => void;
}) {
  return (
    <div>
      <p className="text-[0.625rem] font-bold tracking-[0.07em] text-ink-5 uppercase">
        Stages
      </p>
      {stages.length > 0 ? (
        <StageProgressList
          stages={stages}
          onSignOff={onSignOff}
          className="mt-1.5"
        />
      ) : (
        <p className="mt-1 text-xs text-ink-5">No stages planned yet.</p>
      )}
    </div>
  );
}

/**
 * A batch's name. A button into its details when `onOpen` is given (so it
 * reaches the keyboard); plain text when it is not.
 */
function BatchName({
  job,
  onOpen,
  className,
}: {
  job: PipelineJob;
  onOpen?: (job: PipelineJob) => void;
  className?: string;
}) {
  if (!onOpen) {
    return (
      <span
        className={cn("max-w-full truncate font-semibold text-ink", className)}
      >
        {job.product_name}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(job)}
      title={`Open details for batch ${job.batch_no}`}
      className={cn(
        "max-w-full truncate rounded text-left font-semibold text-ink outline-none transition hover:text-brand-deep hover:underline focus-visible:ring-4 focus-visible:ring-brand/12",
        className,
      )}
    >
      {job.product_name}
    </button>
  );
}

/**
 * A finished lot under its bulk batch: the same card, one size down — a
 * chevron, the status in the corner, and its own stages when opened, signed
 * off from the same button.
 */
function LotRow({
  job,
  stages,
  today,
  canManage,
  onOpen,
  onPlan,
  onSignOff,
  onDelete,
}: {
  job: PipelineJob;
  stages: BatchStage[];
  today: string;
  canManage: boolean;
  onOpen?: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  onSignOff: (stage: BatchStage) => void;
  onDelete: (job: PipelineJob) => void;
}) {
  const status = statusStyle(jobStage(job));
  const [open, setOpen] = useState(false);
  const panelId = `batch-panel-${job.id}`;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-surface transition",
        open ? "border-line-strong shadow-card" : "hover:border-line-strong",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: status.accent }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-2.5 pl-3 sm:flex-nowrap">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
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
            <BatchName
              job={job}
              onOpen={onOpen}
              className="text-[0.8125rem]"
            />
            {job.pack_size && (
              <span className="text-[0.6875rem] text-ink-5">
                {formatPackSize(job.pack_size)} per{" "}
                {packUnitSingular(job.pack_unit)}
                {job.market && ` · ${job.market}`}
              </span>
            )}
            <RowAlerts job={job} />
          </div>
          <MetaLine job={job} today={today} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 self-stretch">
          <StatusChip job={job} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RowActions
              job={job}
              canManage={canManage}
              onPlan={onPlan}
              onDelete={onDelete}
            />
          </div>
        </div>
      </div>

      <Collapse id={panelId} open={open}>
        <div className="border-t border-line-soft bg-sunken py-3 pr-3 pl-[3.25rem]">
          <StagesSection
            stages={stages}
            onSignOff={canManage ? onSignOff : undefined}
          />
        </div>
      </Collapse>
    </article>
  );
}

/**
 * The batch's facts as small coloured chips — number, product code, quantity,
 * due date — each its own step of the blue ramp so the eye can find the one it
 * wants: azure for the number, sky for the code, indigo for the quantity, and
 * a quiet slate for the date, which turns red once it has passed.
 *
 * No room: where a batch runs is a property of each of its stages, not of the
 * batch, and is shown on the stage.
 */
function MetaLine({ job, today }: { job: PipelineJob; today: string }) {
  const quantity = quantityLabel(job);
  const finished = job.status === "finished";
  const overdue = job.due_date !== null && !finished && job.due_date < today;

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <MetaChip
        tone="bg-azure-soft text-azure-deep ring-azure-line"
        className="font-mono font-bold"
        title="Batch number"
      >
        <Hash className="size-3" aria-hidden />
        {job.batch_no}
      </MetaChip>
      {job.product_code && (
        <MetaChip
          tone="bg-sky-soft text-sky-deep ring-sky-line"
          className="font-mono"
          title="Product code"
        >
          <Tag className="size-3" aria-hidden />
          {job.product_code}
        </MetaChip>
      )}
      {quantity && (
        <MetaChip
          tone="bg-brand-soft text-brand-deep ring-brand-line"
          title="Ordered quantity"
        >
          <Package className="size-3" aria-hidden />
          {quantity}
        </MetaChip>
      )}
      {job.due_date && (
        <MetaChip
          tone={
            overdue
              ? "bg-danger-soft text-danger-deep ring-danger-line"
              : finished
                ? "bg-sunken-2 text-ink-4 ring-line"
                : "bg-sunken-2 text-ink-2 ring-line-strong"
          }
          title={overdue ? "Past its due date" : "Due date"}
        >
          <CalendarDays className="size-3" aria-hidden />
          Due {formatDay(job.due_date)}
          {overdue && " · overdue"}
        </MetaChip>
      )}
    </p>
  );
}

function MetaChip({
  tone,
  className,
  title,
  children,
}: {
  /** Background, text and ring colours — the chip's one hue. */
  tone: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ring-1 ring-inset",
        tone,
        className,
      )}
    >
      {children}
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
          className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[0.625rem] font-bold text-warn-deep ring-1 ring-warn-line"
        >
          <AlertTriangle className="size-2.5" aria-hidden />
          {job.flagged_count}
        </span>
      )}
      {job.quarantine_no ? (
        <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[0.6562rem] font-semibold text-danger-deep ring-1 ring-danger-line">
          Quarantined — {job.quarantine_no}
        </span>
      ) : (
        job.status === "hold" &&
        job.hold_reason && (
          <span className="rounded-md bg-warn-tint px-1.5 py-0.5 text-[0.6562rem] font-semibold text-warn-ink ring-1 ring-warn-line">
            Held — {job.hold_reason.toLowerCase()} issue flagged
          </span>
        )
      )}
      {note && (
        <span className="text-[0.6875rem] font-medium text-warn-ink">{note}</span>
      )}
    </>
  );
}

/**
 * The batch's status as a solid pill in the stage's own colour, white text, a
 * soft glow of the same hue and a dot — which breathes while the batch is in
 * production, the one state where something is happening right now. Solid, not
 * tinted: it is the first thing a row should say.
 */
function StatusChip({ job }: { job: PipelineJob }) {
  const stage = jobStage(job);
  const status = statusStyle(stage);
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3 text-[0.75rem] font-bold tracking-[0.03em] whitespace-nowrap text-white"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${status.accent} 82%, white) 0%, ${status.accent} 100%)`,
        boxShadow: `0 2px 8px color-mix(in srgb, ${status.accent} 38%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.22)`,
      }}
    >
      <span className="relative grid size-2.5 place-items-center" aria-hidden>
        {stage === "production" && (
          <span className="absolute inset-0 rounded-full bg-white opacity-60 motion-safe:animate-ping" />
        )}
        <span className="relative size-2 rounded-full bg-white" />
      </span>
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
