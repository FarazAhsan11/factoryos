"use client";

import { useMemo } from "react";
import { AlertTriangle, Inbox, Trash2 } from "lucide-react";

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
  unitWord,
  canManage,
  onOpen,
  onDelete,
}: {
  jobs: PipelineJob[];
  unitWord: string;
  canManage: boolean;
  onOpen: (job: PipelineJob) => void;
  /** Only ever called for a Planned job — see `deletePipelineJob`. */
  onDelete: (job: PipelineJob) => void;
}) {
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
  accent,
  unitWord,
  onOpen,
  onDelete,
}: {
  job: PipelineJob;
  accent: string;
  unitWord: string;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const percent = jobProgress(job);

  return (
    <article className="group relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_22_43/0.05)] transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/12">
      {/* A rendered spine rather than a `borderLeft` style, so the accent
          rounds with the card instead of leaving one squared-off edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />

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
        className="block w-full cursor-pointer py-3 pr-3 pl-4 text-left outline-none"
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

        {/* The hold's cause, not just its existence — "On hold" alone sends
            someone to the shift log to find out why. */}
        {job.status === "hold" && job.hold_reason && (
          <p className="mt-2 rounded-lg bg-warn-tint px-2 py-1 text-[11px] font-medium text-warn-ink ring-1 ring-warn-line">
            Held — {job.hold_reason.toLowerCase()} issue flagged
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
