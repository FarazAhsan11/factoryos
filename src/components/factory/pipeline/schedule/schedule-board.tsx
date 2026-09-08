"use client";

import { AlertTriangle, ChevronRight, Circle, Cog } from "lucide-react";

import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import { stageName, stageProgress } from "@/lib/factory/batch-stage-queries";
import {
  formatShortDate,
  relativeDay,
  type RoomLane,
  type ScheduledStage,
} from "@/lib/factory/schedule";
import { cn } from "@/lib/utils";

/** How many stages ahead a lane shows. Three fits a row without scrolling. */
const AHEAD = 3;

const COLUMNS = [
  { key: "current", label: "Current / next up", dot: "bg-teal" },
  { key: "next", label: "Then", dot: "bg-brand" },
  { key: "following", label: "Following", dot: "bg-ink-6" },
] as const;

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Schedule → Board. What every busy room is doing, and what comes off it next.
 *
 * One row per room, three stages deep. Rooms with nothing left to run are not
 * here at all — a lane of dashes tells a planner nothing, and twenty-five of
 * them buries the four rooms that matter. That filtering happens in
 * `buildRoomLanes`, so the Queue agrees with this view about which rooms are
 * busy.
 *
 * Rooms are ordered by their soonest dated stage, which is what makes the top
 * of this board the nearest coming day.
 */
export function ScheduleBoard({
  lanes,
  onOpen,
  onShowAll,
}: {
  lanes: RoomLane[];
  onOpen: (entry: ScheduledStage) => void;
  /** Hands the room to the Queue, which is the view that lists all of it. */
  onShowAll: (unitId: string) => void;
}) {
  return (
    /* No scroller of its own: the Schedule's container scrolls both axes, and
       a nested one here would be the sticky header's positioning ancestor —
       an element that never scrolls, so the header would never stick. */
    <div className="min-w-[900px] space-y-2">
      {/* A header row rather than a table header: the lanes below are cards
            in a grid, and a real <thead> would force every cell to share a
            baseline the cards do not have. Sticky, because a planner reading
            the twelfth room down still needs to know which column is "next". */}
      <div className="sticky top-0 z-10 grid grid-cols-[140px_repeat(3,1fr)] gap-3 rounded-xl border border-line bg-sunken-2 px-3 py-2 shadow-[0_1px_0_var(--color-line)]">
        <p className="text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase">
          Room
        </p>
        {COLUMNS.map((col) => (
          <p
            key={col.key}
            className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase"
          >
            <span
              className={cn("size-1.5 rounded-full", col.dot)}
              aria-hidden
            />
            {col.label}
          </p>
        ))}
      </div>

      {lanes.map((lane) => (
        <div
          key={lane.unitId}
          className="grid grid-cols-[140px_repeat(3,1fr)] items-stretch gap-3"
        >
          <div className="flex flex-col justify-center px-3 py-2">
            <p className="text-sm font-semibold text-ink">{lane.unitName}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-5">
              {lane.stages.length} stage{lane.stages.length === 1 ? "" : "s"}
              {lane.nextDate ? ` · from ${formatShortDate(lane.nextDate)}` : ""}
            </p>
            {/* The room holds more than the board draws. Said on the room
                  itself, next to the count it contradicts, rather than as a
                  footnote under the whole board — a planner reading "5 stages"
                  above three cards needs the discrepancy explained where they
                  are looking, and needs the rest to be one click away. */}
            {lane.stages.length > AHEAD && (
              <button
                type="button"
                onClick={() => onShowAll(lane.unitId)}
                className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-bold tracking-[0.02em] text-ink-4 uppercase transition hover:border-brand-line hover:text-brand-deep"
              >
                +{lane.stages.length - AHEAD} more
                <ChevronRight className="size-3" aria-hidden />
              </button>
            )}
          </div>

          {Array.from({ length: AHEAD }).map((_, i) => {
            const entry = lane.stages[i];
            return entry ? (
              <StageCard
                key={entry.stage.id}
                entry={entry}
                lead={i === 0}
                // The last slot when the lane runs past it: the card is
                // drawn with the queue continuing behind it, so "Following"
                // never reads as "and then the room is free".
                more={i === AHEAD - 1 ? lane.stages.length - AHEAD : 0}
                onShowAll={() => onShowAll(lane.unitId)}
                onOpen={() => onOpen(entry)}
              />
            ) : (
              <div
                key={`empty-${lane.unitId}-${i}`}
                className="grid min-h-[104px] place-items-center rounded-xl border border-dashed border-line bg-sunken/40 text-sm text-ink-6"
              >
                —
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * One stage on the board.
 *
 * A button, not a div with a click handler: it is the only way into the edit
 * dialog, and a planner tabbing through a room's queue has to be able to reach
 * it the same way as everyone else.
 */
function StageCard({
  entry,
  lead,
  more = 0,
  onShowAll,
  onOpen,
}: {
  entry: ScheduledStage;
  lead: boolean;
  /** Stages queued behind this one that the board has no column for. */
  more?: number;
  onShowAll?: () => void;
  onOpen: () => void;
}) {
  const { stage, job } = entry;
  const running = stage.status === "in_progress";
  const pct = stageProgress(stage);
  const when = relativeDay(stage.planned_date);

  return (
    /* A wrapper, not a card with a link inside it: the card is a <button>, and
       a button nested in a button is invalid markup that browsers resolve by
       dropping one of them — usually the one you wanted. */
    <div className="flex min-h-[104px] flex-col gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group flex flex-1 flex-col gap-1 rounded-xl border bg-surface px-3 py-2.5 text-left transition",
          "hover:border-brand-line hover:shadow-[0_2px_10px_rgb(20_22_43/0.07)]",
          running
            ? "border-teal-line/70 shadow-[inset_3px_0_0_var(--color-teal)]"
            : lead
              ? "border-brand-line/60 shadow-[inset_3px_0_0_var(--color-brand)]"
              : "border-line",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {job && <BatchTypeBadge type={job.batch_type} />}
          {/* Behind plan is the one thing worth interrupting the card for: the
            day has passed and nobody has started it. */}
          {stage.is_behind_plan && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warn-tint px-1.5 py-0.5 text-[10px] font-bold tracking-[0.02em] text-warn-ink uppercase ring-1 ring-warn-line/70">
              <AlertTriangle className="size-3" aria-hidden />
              Behind
            </span>
          )}
        </div>

        <p className="flex items-baseline gap-1.5">
          <span className="font-mono text-[13px] font-semibold tracking-tight text-brand">
            {job?.batch_no ?? "—"}
          </span>
          {job?.product_code && (
            <span className="truncate font-mono text-[10.5px] text-ink-5">
              {job.product_code}
            </span>
          )}
        </p>

        <p className="line-clamp-1 text-[13px] font-semibold text-ink">
          {job?.product_name ?? "Unnamed batch"}
        </p>

        <p className="flex items-center gap-1.5 text-[11px] text-ink-4">
          {running ? (
            <Cog className="size-3 shrink-0 text-teal" aria-hidden />
          ) : (
            <Circle className="size-3 shrink-0 text-ink-6" aria-hidden />
          )}
          <span className="truncate font-medium">{stageName(stage)}</span>
          {stage.target_qty && (
            <span className="shrink-0 font-mono tabular-nums text-ink-5">
              {fmt(stage.target_qty)} {stage.target_unit}
            </span>
          )}
        </p>

        <p className="mt-auto flex flex-wrap items-center gap-x-2 text-[10.5px] text-ink-5">
          <span
            className={cn(
              stage.is_behind_plan && "font-semibold text-warn-ink",
            )}
          >
            {stage.planned_date
              ? formatShortDate(stage.planned_date)
              : "Not scheduled"}
            {when ? ` · ${when}` : ""}
          </span>
          {stage.est_finish_date && (
            <span
              className={cn(
                stage.is_overrunning && "font-semibold text-warn-ink",
              )}
            >
              → {formatShortDate(stage.est_finish_date)}
            </span>
          )}
          {job?.due_date && <span>Due {formatShortDate(job.due_date)}</span>}
        </p>

        {running && pct !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, pct)}%`,
                background: stage.is_over_tolerance
                  ? "var(--color-danger)"
                  : "var(--color-teal)",
              }}
            />
          </div>
        )}
      </button>

      {/* The queue does not stop here. Drawn under the last column rather than
          as another card, because these stages have no date column of their
          own to be honest in — the Queue is where they get one. */}
      {more > 0 && (
        <button
          type="button"
          onClick={onShowAll}
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-sunken/50 px-2 py-1 text-[10.5px] font-semibold text-ink-4 transition hover:border-brand-line hover:bg-brand-soft/40 hover:text-brand-deep"
        >
          +{more} more in this room
          <ChevronRight className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
