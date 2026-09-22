"use client";

import { useMemo } from "react";
import { AlertTriangle, Inbox, ListChecks, Trash2 } from "lucide-react";

import {
  BatchTypeBadge,
  ParentBatchLink,
} from "@/components/factory/pipeline/batch-type-badge";
import { StageStrip } from "@/components/factory/pipeline/stage-strip";
import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import {
  PIPELINE_COLUMNS,
  jobProgress,
  type PipelineJob,
  type PipelineStatus,
} from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * The Kanban board: four columns, one card per batch.
 *
 * There is no drag-and-drop, and that is the design rather than a shortcut.
 * A card's column is a fact about what has been logged against the batch — a
 * hand-dragged card would be an opinion sitting next to it, and the two would
 * disagree the moment anyone filed an entry. Cards move when the work moves.
 *
 * Each column is its own scroll container from `lg` up, sized to the screen.
 * A board where one busy column sets the page's height leaves the other three
 * as short stubs with an acre of white under them, and pushes the column
 * headings — the only thing saying which pile you are reading — off the top.
 */
export function PipelineBoard({
  jobs,
  stages,
  unitWord,
  canManage,
  onOpen,
  onPlan,
  onDelete,
}: {
  jobs: PipelineJob[];
  /** Every plan in the tenant, so a card can draw its own without a fetch. */
  stages: BatchStage[];
  unitWord: string;
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  onPlan: (job: PipelineJob) => void;
  /** Only ever called for a Planned job — see `deletePipelineJob`. */
  onDelete: (job: PipelineJob) => void;
}) {
  // Grouped once for the whole board rather than filtered per card, which
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
  const byStatus = useMemo(() => {
    const map = new Map<PipelineStatus, PipelineJob[]>();
    for (const column of PIPELINE_COLUMNS) map.set(column.status, []);
    for (const job of jobs) map.get(job.status)?.push(job);
    return map;
  }, [jobs]);

  return (
    /* `lg:grid-rows-1` is what makes the four columns equal-height: without a
       single explicit row each sizes to its own contents and the tallest one
       sets a page scroll again. */
    <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-4 lg:grid-rows-1">
      {PIPELINE_COLUMNS.map((column) => {
        const items = byStatus.get(column.status) ?? [];
        return (
          <section
            key={column.status}
            aria-label={column.label}
            /* Sunken, so the cards read as pieces sitting *in* a tray rather
               than as white boxes on a white box — the separation the old
               surface-on-surface board never had. */
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-sunken shadow-[inset_0_1px_2px_rgb(20_22_43/0.04)] lg:min-h-0"
          >
            <header
              className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5"
              style={{ background: column.tint }}
            >
              <h2 className="flex items-center gap-2 text-[12px] font-bold tracking-[0.07em] uppercase">
                <span
                  aria-hidden
                  className="h-3.5 w-1 rounded-full"
                  style={{ background: column.accent }}
                />
                <span style={{ color: column.accent }}>{column.label}</span>
              </h2>
              <span
                className="rounded-full bg-surface/80 px-2 py-0.5 text-[11px] font-bold tabular-nums"
                style={{ color: column.accent }}
              >
                {items.length}
              </span>
            </header>

            {/* The column's own scrollbar. Below `lg` the columns stack and the
                page scrolls, but a capped height keeps one long pile from
                burying the three under it. */}
            <div className="scrollbar-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5 max-lg:max-h-[26rem]">
              {items.length === 0 ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-line-strong py-10 text-center">
                  <Inbox className="size-5 text-ink-6" />
                  <p className="mt-1.5 text-[11px] text-ink-5">Nothing here.</p>
                </div>
              ) : (
                items.map((job) => (
                  <JobCard
                    stages={stagesByJob.get(job.id) ?? []}
                    canManage={canManage}
                    onPlan={() => onPlan(job)}
                    key={job.id}
                    job={job}
                    accent={column.accent}
                    unitWord={unitWord}
                    onOpen={() => onOpen(job)}
                    // Deleting is offered only before anything has been logged.
                    // After that the job is the visible half of an
                    // audit-protected record.
                    onDelete={
                      canManage && job.status === "planned"
                        ? () => onDelete(job)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function JobCard({
  job,
  stages,
  accent,
  unitWord,
  canManage,
  onOpen,
  onPlan,
  onDelete,
}: {
  job: PipelineJob;
  stages: BatchStage[];
  accent: string;
  unitWord: string;
  canManage: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onDelete?: () => void;
}) {
  const percent = jobProgress(job);
  const needsPlanning = !job.issued_at;

  return (
    <article className="group relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_22_43/0.05)] transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/12">
      {/* A rendered spine rather than a `borderLeft` style, so the accent
          rounds with the card instead of leaving one squared-off edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />

      {/* Same reason as Delete below: a button inside a button is invalid HTML
          and the inner one stops being reachable by keyboard.

          On an unissued batch this is a labelled button, not an icon. It was
          an icon first, and that was wrong: planning is the thing standing
          between this card and any work being logged against it, and hiding
          it behind 24 unlabelled pixels meant people opened the card, found
          the details dialog, and concluded the feature did not exist. */}
      {canManage && needsPlanning && (
        <button
          type="button"
          onClick={onPlan}
          className="absolute right-1.5 bottom-1.5 z-10 inline-flex items-center gap-1 rounded-lg bg-warn-tint px-2 py-1 text-[10px] font-bold text-warn-ink ring-1 ring-warn-line transition hover:brightness-95"
        >
          <ListChecks className="size-3" />
          Plan stages
        </button>
      )}
      {canManage && !needsPlanning && (
        <button
          type="button"
          onClick={onPlan}
          title="View this batch's plan"
          aria-label={`View the plan for batch ${job.batch_no}`}
          className={cn(
            "absolute right-1.5 z-10 grid size-6 place-items-center rounded-lg text-ink-6 opacity-0 transition hover:bg-sunken-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100",
            onDelete ? "top-8" : "top-1.5",
          )}
        >
          <ListChecks className="size-3.5" />
        </button>
      )}

      {/* Delete sits outside the card's own button — nesting one button inside
          another is invalid HTML and the inner one stops being reachable by
          keyboard. Absolutely positioned so it overlays the corner instead. */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Remove this job — nothing has been logged against it yet"
          aria-label={`Remove job for batch ${job.batch_no}`}
          className="absolute top-1.5 right-1.5 z-10 grid size-6 place-items-center rounded-lg text-ink-6 opacity-0 transition hover:bg-danger-soft hover:text-danger-deep focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}

      {/* The whole card is one target, and a button rather than a div with an
          onClick so it reaches the keyboard — this is the only way into the
          batch's history. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for batch ${job.batch_no}, ${job.product_name}`}
        className={cn(
          "block w-full cursor-pointer py-3 pr-3 pl-4 text-left outline-none",
          // Room for the labelled Plan stages button pinned bottom-right.
          canManage && needsPlanning && "pb-9",
        )}
      >
        <p className="pr-5">
          <span className="rounded-md bg-sunken-2 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-ink-4 ring-1 ring-line">
            {job.batch_no}
          </span>
          {job.product_code && (
            <span className="ml-1.5 font-mono text-[10.5px] text-ink-5">
              {job.product_code}
            </span>
          )}
        </p>

        <h3 className="mt-1.5 text-[13px] leading-snug font-semibold break-words text-ink transition group-hover:text-brand-deep">
          {job.product_name}
        </h3>

        {/* What kind of batch, and whose bulk. A packing run and the bulk it
            came out of are two cards in different columns with similar
            numbers on them; without this the board cannot say which is which,
            or that they are related at all. Combined is the overwhelming
            majority and says nothing new, so it stays unbadged — a badge on
            every card is a badge on none. */}
        {job.batch_type !== "combined" && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <BatchTypeBadge
              type={job.batch_type}
              detail={
                job.pack_size
                  ? `${fmt(job.pack_size)}${job.market ? ` · ${job.market}` : ""}`
                  : undefined
              }
            />
          </p>
        )}
        <ParentBatchLink batchNo={job.parent_batch_no} className="mt-1" />

        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-5">
          {job.unit_name ? (
            <span className="font-medium text-ink-4">{job.unit_name}</span>
          ) : (
            <span className="italic">No {unitWord.toLowerCase()} yet</span>
          )}
          {job.flagged_count > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn-deep ring-1 ring-warn-line">
              <AlertTriangle className="size-2.5" />
              {job.flagged_count}
            </span>
          )}
        </p>

        {/* Where the batch is in its own route. Four pills say more than one
            percentage can: which stage is running, which are done, and which
            one will finish the order. */}
        {stages.length > 0 && <StageStrip stages={stages} className="mt-2" />}

        {/* The hold's cause, not just its existence — "On hold" alone sends
            someone to the shift log to find out why. */}
        {job.quarantine_no ? (
          <p className="mt-2 rounded-lg bg-danger-soft px-2 py-1 text-[11px] font-medium text-danger-deep ring-1 ring-danger-line">
            Quarantined — {job.quarantine_no}
          </p>
        ) : (
          job.status === "hold" &&
          job.hold_reason && (
            <p className="mt-2 rounded-lg bg-warn-tint px-2 py-1 text-[11px] font-medium text-warn-ink ring-1 ring-warn-line">
              Held — {job.hold_reason.toLowerCase()} issue flagged
            </p>
          )
        )}

        {/* Nothing can be logged against this batch yet, and the operator who
            finds that out is the one refused at 6am. Said on the card, where
            the person who can fix it is looking. */}
        {needsPlanning && (
          <p className="mt-2 text-[11px] font-medium text-warn-ink">
            {job.stage_count === 0
              ? "Not issued — no stages planned"
              : job.stages_without_target > 0
                ? `Not issued — ${job.stages_without_target} stage${job.stages_without_target === 1 ? "" : "s"} without a target`
                : "Not issued — ready to issue"}
          </p>
        )}

        {percent !== null && (
          <div className="mt-2.5 space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500",
                )}
                style={{ width: `${percent}%`, background: accent }}
              />
            </div>
            <p className="font-mono text-[10.5px] tabular-nums text-ink-4">
              {fmt(job.produced_qty)} / {fmt(job.required_qty)}
              <span className="ml-1 font-semibold" style={{ color: accent }}>
                {percent}%
              </span>
            </p>
          </div>
        )}
      </button>
    </article>
  );
}
