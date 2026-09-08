"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import { DateField } from "@/components/ui/date-picker";
import {
  stageName,
  updateBatchStage,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import {
  formatShortDate,
  type RoomLane,
  type ScheduledStage,
} from "@/lib/factory/schedule";
import { cn } from "@/lib/utils";

const HEAD =
  "px-3 py-2 text-[10px] font-bold tracking-[0.06em] text-ink-5 uppercase";
const CELL = "px-3 py-2.5 align-middle";
const MONO = "font-mono tracking-tight tabular-nums";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Schedule → Queue. Every room, every stage on it, with dates.
 *
 * The Board answers "what is Room 4 doing" in one glance and stops at three
 * stages. This is the other half: the full list, and the two fields that only
 * a person can fill in — the **estimated finish** and the **planning
 * comment** (migration 0040).
 *
 * Those two are edited in place rather than behind the card dialog, and that
 * is the whole point of the view. A planner works down a room setting finish
 * dates; making each one cost a dialog open, a save and a close turns twenty
 * seconds of work into five minutes. Everything else about a stage still opens
 * the dialog, because everything else is a decision rather than a number
 * somebody is reading off a run sheet.
 */
export function ScheduleQueue({
  lanes,
  canManage,
  focusRoom = null,
  onOpen,
  onSaved,
}: {
  lanes: RoomLane[];
  canManage: boolean;
  /** Set when the Board handed this room over — scrolled to and ringed. */
  focusRoom?: string | null;
  onOpen: (entry: ScheduledStage) => void;
  onSaved: () => void | Promise<void>;
}) {
  /**
   * Bring the handed-over room into view.
   *
   * A callback ref rather than an effect: the node arrives exactly once, when
   * the Queue mounts on it, which is the moment to scroll — and there is no
   * dependency array that can be wrong about it.
   */
  const focus = useCallback((node: HTMLElement | null) => {
    node?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  return (
    <div className="space-y-4">
      {lanes.map((lane) => (
        <section
          key={lane.unitId}
          ref={lane.unitId === focusRoom ? focus : undefined}
          className={cn(
            "overflow-hidden rounded-2xl border bg-surface scroll-mt-4",
            lane.unitId === focusRoom
              ? "border-brand-line ring-2 ring-brand/25"
              : "border-line",
          )}
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-4 py-2.5">
            <h3 className="text-sm font-semibold text-ink">{lane.unitName}</h3>
            <p className="text-[11px] text-ink-5">
              {lane.pending} planned · {lane.stages.length} total
              {lane.nextDate ? ` · from ${formatShortDate(lane.nextDate)}` : ""}
            </p>
          </header>

          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left">
                  <th className={cn(HEAD, "w-10")}>#</th>
                  <th className={HEAD}>Batch</th>
                  <th className={HEAD}>Code</th>
                  <th className={HEAD}>Product / stage</th>
                  <th className={cn(HEAD, "text-right")}>Target</th>
                  <th className={HEAD}>Planned</th>
                  <th className={HEAD}>Est. finish</th>
                  <th className={HEAD}>Due</th>
                  <th className={HEAD}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {lane.stages.map((entry, i) => (
                  <QueueRow
                    key={entry.stage.id}
                    entry={entry}
                    index={i + 1}
                    canManage={canManage}
                    onOpen={() => onOpen(entry)}
                    onSaved={onSaved}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function QueueRow({
  entry,
  index,
  canManage,
  onOpen,
  onSaved,
}: {
  entry: ScheduledStage;
  index: number;
  canManage: boolean;
  onOpen: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { stage, job } = entry;
  const running = stage.status === "in_progress";

  /**
   * The comment as it is being typed.
   *
   * Local because a controlled input writing to the server on every keystroke
   * is a request per character; it is committed on blur. Re-seeded from the
   * row whenever the row changes, so an edit made in the card dialog shows
   * here without a remount.
   */
  const [note, setNote] = useState(stage.planning_note ?? "");
  // Adjusted during render rather than in an effect: React's own answer to
  // "reset state when a prop changes", and the one that does not cost a second
  // paint showing the stale note. Typing does not trigger it — the server
  // value only moves after a save.
  const [saved, setSaved] = useState(stage.planning_note);
  if (saved !== stage.planning_note) {
    setSaved(stage.planning_note);
    setNote(stage.planning_note ?? "");
  }

  const patch = useMutation({
    mutationFn: (values: Partial<BatchStage>) =>
      updateBatchStage(stage.id, values),
    onSuccess: () => onSaved(),
    onError: (e: Error) => {
      // Put the row back to what the server holds — an input still showing a
      // rejected value is a planner who thinks the note is saved.
      setNote(stage.planning_note ?? "");
      toast.error(e.message);
    },
  });

  return (
    <tr
      className={cn(
        "border-b border-line-soft last:border-0",
        running && "bg-teal-soft/25",
      )}
    >
      <td className={cn(CELL, MONO, "text-[11px] text-ink-5")}>{index}</td>

      <td className={CELL}>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            MONO,
            "text-[13px] font-semibold text-brand underline-offset-2 hover:underline",
          )}
        >
          {job?.batch_no ?? "—"}
        </button>
        {stage.work_order && (
          <p className={cn(MONO, "text-[10px] text-ink-5")}>{stage.work_order}</p>
        )}
      </td>

      <td className={cn(CELL, MONO, "text-[11px] text-ink-4")}>
        {job?.product_code ?? "—"}
      </td>

      <td className={cn(CELL, "min-w-[240px]")}>
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-[280px] text-left"
        >
          <span className="line-clamp-1 text-[13px] font-medium text-ink hover:text-brand-deep">
            {job?.product_name ?? "Unnamed batch"}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-4">{stageName(stage)}</span>
            {job && <BatchTypeBadge type={job.batch_type} />}
          </span>
        </button>
      </td>

      <td className={cn(CELL, MONO, "text-right text-[12px] text-ink-3")}>
        {fmt(stage.target_qty)}
        <span className="ml-1 text-[10px] text-ink-5">{stage.target_unit}</span>
      </td>

      <td className={cn(CELL, "text-[12px] whitespace-nowrap")}>
        <span
          className={cn(
            stage.is_behind_plan ? "font-semibold text-warn-ink" : "text-ink-3",
          )}
        >
          {formatShortDate(stage.planned_date)}
        </span>
      </td>

      {/* The field this view exists for. Empty until somebody fills it in —
          there is nothing to derive it from, since the same target is two days
          on one machine and five on another. */}
      <td className={cn(CELL, "w-[168px]")}>
        {canManage ? (
          <DateField
            ariaLabel={`Estimated finish for ${stageName(stage)}`}
            value={stage.est_finish_date ?? ""}
            onChange={(next) =>
              patch.mutate({ est_finish_date: next || null })
            }
            min={stage.planned_date ?? undefined}
            placeholder="Add estimate"
            disabled={patch.isPending}
            className={cn(
              "h-8 text-[12px]",
              stage.is_overrunning && "border-warn-line text-warn-ink",
            )}
          />
        ) : (
          <span className="text-[12px] text-ink-3">
            {formatShortDate(stage.est_finish_date)}
          </span>
        )}
      </td>

      <td className={cn(CELL, "text-[12px] whitespace-nowrap text-ink-4")}>
        {formatShortDate(job?.due_date ?? null)}
      </td>

      <td className={cn(CELL, "min-w-[220px]")}>
        <div className="flex items-center gap-1.5">
          <input
            value={note}
            disabled={!canManage}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              const next = note.trim();
              if (next === (stage.planning_note ?? "")) return;
              patch.mutate({ planning_note: next || null });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNote(stage.planning_note ?? "");
                e.currentTarget.blur();
              }
            }}
            maxLength={500}
            placeholder={canManage ? "Add planning comment…" : "—"}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-[12px] text-ink-3 outline-none transition placeholder:text-placeholder hover:border-line focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/12 disabled:cursor-default"
          />
          {patch.isPending && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-5" />
          )}
        </div>
      </td>
    </tr>
  );
}
