import {
  AlertTriangle,
  CalendarDays,
  Check,
  Cog,
  Flag,
  MapPin,
} from "lucide-react";

import { formatDay } from "@/lib/factory/dates";
import {
  stageCeiling,
  stageName,
  stageProgress,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * A batch's route with each stage's progress — the expanded half of a board
 * row, where `StageStrip` is the one-line version for a card.
 *
 * The strip answers "where is the work", and it has to do it in a line, so it
 * can't say how far each stage has got. Once a row is open there is room to,
 * which is what a planner or a supervisor opening it is asking: this stage is
 * done, this one is at 62% of its target and a day behind, these are waiting.
 *
 * Read-only and derived — everything comes from the stage rows, whose
 * accumulated quantity is the shift log's. Nothing on screen is a second
 * record of anything.
 */
export function StageProgressList({
  stages,
  className,
}: {
  stages: BatchStage[];
  className?: string;
}) {
  if (stages.length === 0) return null;

  const done = stages.filter((s) => s.status === "complete").length;
  const running = stages.find((s) => s.status === "in_progress");

  return (
    <div className={className}>
      <p className="flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-ink-4">
        <span className="font-semibold text-ink-3">
          {done} of {stages.length} stage{stages.length === 1 ? "" : "s"} complete
        </span>
        {running && (
          <span>
            · now on{" "}
            <span className="font-semibold text-brand-deep">
              {stageName(running)}
            </span>
          </span>
        )}
      </p>

      <ol className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
        {stages.map((stage, index) => (
          <StageProgressRow
            key={stage.id}
            stage={stage}
            index={index}
            isLast={index === stages.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

const NODE = {
  pending: "border-line-strong bg-sunken-2 text-ink-4",
  in_progress: "border-brand-line bg-brand-soft text-brand-deep ring-4 ring-brand/10",
  complete: "border-teal-line bg-teal-soft text-teal-deep",
  over: "border-danger-line bg-danger-soft text-danger-deep",
} as const;

const STATUS_WORD = {
  pending: "Waiting",
  in_progress: "In progress",
  complete: "Complete",
} as const;

function StageProgressRow({
  stage,
  index,
  isLast,
}: {
  stage: BatchStage;
  index: number;
  isLast: boolean;
}) {
  const over = stage.is_over_tolerance;
  const pct = stageProgress(stage);
  const ceiling = stageCeiling(stage);
  const tone = over ? "over" : stage.status;
  const hasTarget = Boolean(stage.target_qty);
  const behind = stage.is_behind_plan || stage.is_overrunning;

  const barColor = over
    ? "var(--color-danger)"
    : stage.status === "complete" || (pct !== null && pct >= 100)
      ? "var(--color-teal)"
      : stage.status === "in_progress"
        ? "var(--color-brand)"
        : "var(--color-ink-6)";

  const when =
    stage.planned_date && stage.est_finish_date
      ? `${formatDay(stage.planned_date)} → ${formatDay(stage.est_finish_date)}`
      : stage.planned_date
        ? `from ${formatDay(stage.planned_date)}`
        : stage.est_finish_date
          ? `to ${formatDay(stage.est_finish_date)}`
          : null;

  return (
    <li
      className={cn(
        "grid items-center gap-x-5 gap-y-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]",
        stage.status === "in_progress" && "bg-brand-tint/60",
      )}
    >
      {/* Who and where: the stage, its place in the route, where and when it
          is meant to run. */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full border font-mono text-[0.75rem] font-bold",
            NODE[tone],
          )}
          aria-hidden
        >
          {over ? (
            <AlertTriangle className="size-4" />
          ) : stage.status === "complete" ? (
            <Check className="size-4" strokeWidth={3} />
          ) : stage.status === "in_progress" ? (
            <Cog className="size-4" />
          ) : (
            index + 1
          )}
        </span>

        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[0.875rem] font-semibold text-ink">
              {stageName(stage)}
            </span>
            {isLast && (
              <span
                title="Completes the order"
                className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-teal-deep ring-1 ring-teal-line"
              >
                <Flag className="size-2.5" aria-hidden />
                Completes the order
              </span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.6875rem] text-ink-5">
            <span
              className={cn(
                "font-semibold",
                over
                  ? "text-danger-deep"
                  : stage.status === "complete"
                    ? "text-teal-deep"
                    : stage.status === "in_progress"
                      ? "text-brand-deep"
                      : "text-ink-4",
              )}
            >
              {over ? "Over tolerance" : STATUS_WORD[stage.status]}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {stage.unit_name ?? "No room"}
            </span>
            {when && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  behind && stage.status !== "complete" && "font-semibold text-warn-ink",
                )}
              >
                <CalendarDays className="size-3" aria-hidden />
                {when}
                {behind && stage.status !== "complete" && " · behind"}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* How far: the bar, and the two numbers it is made of. */}
      <div className="min-w-0">
        {hasTarget ? (
          <>
            <div className="flex items-center gap-2.5">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, pct ?? 0)}
                aria-label={`${stageName(stage)} progress`}
                className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, pct ?? 0)}%`,
                    background: barColor,
                  }}
                />
              </div>
              <span
                className="w-11 shrink-0 text-right font-mono text-[0.75rem] font-bold tabular-nums"
                style={{ color: over ? "var(--color-danger)" : "var(--color-ink-2)" }}
              >
                {pct ?? 0}%
              </span>
            </div>
            <p className="mt-1 font-mono text-[0.6875rem] tabular-nums text-ink-4">
              {fmt(stage.accumulated_qty)}{" "}
              <span className="text-ink-6">/</span> {fmt(stage.target_qty)}{" "}
              {stage.target_unit}
              {over && ceiling !== null && (
                <span className="ml-2 font-sans font-semibold text-danger-deep">
                  past the {fmt(ceiling)} accepted
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-[0.75rem] text-ink-5 italic">
            No target set
            {Number(stage.accumulated_qty) > 0 &&
              ` · ${fmt(stage.accumulated_qty)} ${stage.target_unit} logged`}
          </p>
        )}

        {stage.status === "complete" && (
          <p className="mt-0.5 text-[0.6875rem] text-teal-deep">
            Signed off
            {stage.completed_by_name ? ` by ${stage.completed_by_name}` : ""}
            {stage.yield_pct !== null ? ` · yield ${stage.yield_pct}%` : ""}
            {stage.yield_acceptable === false ? " · not accepted" : ""}
          </p>
        )}
      </div>
    </li>
  );
}
