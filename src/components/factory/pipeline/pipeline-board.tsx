"use client";

import { useMemo } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import {
  PIPELINE_COLUMNS,
  jobProgress,
  type PipelineJob,
  type PipelineStatus,
} from "@/lib/factory/pipeline-queries";

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
    <div className="grid items-start gap-4 lg:grid-cols-4">
      {PIPELINE_COLUMNS.map((column) => {
        const items = byStatus.get(column.status) ?? [];
        return (
          <section
            key={column.status}
            aria-label={column.label}
            className="rounded-2xl border border-line bg-surface"
          >
            <header
              className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-line-soft px-4 py-3"
              style={{ background: column.tint }}
            >
              <h2
                className="text-[13px] font-bold uppercase tracking-[0.5px]"
                style={{ color: column.accent }}
              >
                {column.label}
              </h2>
              <span
                className="rounded-full bg-surface/70 px-2 py-0.5 text-[11px] font-bold"
                style={{ color: column.accent }}
              >
                {items.length}
              </span>
            </header>

            <div className="space-y-2.5 p-3">
              {items.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-5">
                  Nothing here.
                </p>
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
    <article
      className="group relative rounded-xl border border-line bg-surface transition focus-within:border-brand hover:border-ink-6"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Delete sits outside the card's own button — nesting one button inside
          another is invalid HTML and the inner one stops being reachable by
          keyboard. Absolutely positioned so it overlays the corner instead. */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Remove this job — nothing has been logged against it yet"
          aria-label={`Remove job for batch ${job.batch_no}`}
          className="absolute right-2 top-2 z-10 rounded p-0.5 text-ink-6 opacity-0 transition hover:text-danger-deep focus-visible:opacity-100 group-hover:opacity-100"
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
        className="block w-full cursor-pointer rounded-xl p-3 text-left outline-none"
      >
        <p className="font-mono text-[11px] font-medium text-ink-4">
          {job.product_code ? `${job.product_code} · ` : ""}
          {job.batch_no}
        </p>

        <h3 className="mt-1 pr-5 text-[13px] font-semibold leading-snug text-ink">
          {job.product_name}
        </h3>

        <p className="mt-0.5 text-[11px] text-ink-5">
          {job.unit_name ? (
            job.unit_name
          ) : (
            <span className="italic">No {unitWord.toLowerCase()} yet</span>
          )}
          {job.flagged_count > 0 && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-warn-deep">
              <AlertTriangle className="size-3" />
              {job.flagged_count}
            </span>
          )}
        </p>

        {/* The hold's cause, not just its existence — "On hold" alone sends
            someone to the shift log to find out why. */}
        {job.status === "hold" && job.hold_reason && (
          <p className="mt-2 rounded-lg bg-warn-tint px-2 py-1 text-[11px] font-medium text-warn-ink">
            Held — {job.hold_reason.toLowerCase()} issue flagged
          </p>
        )}

        {percent !== null && (
          <div className="mt-2.5 space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${percent}%`, background: accent }}
              />
            </div>
            <p className="font-mono text-[10.5px] text-ink-4">
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
