"use client";

import {
  stageCeiling,
  stageIsOverTolerance,
  stageName,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { cn } from "@/lib/utils";

/**
 * The stage progress card (`StageProgress`), folded into one grid cell: what
 * the stage has taken against its plan — counting the quantity typed on this
 * line — as two short figures, a percentage and a hairline bar. Read only.
 *
 * Same arithmetic as the card, from the same helpers, so the grid and the
 * form can never disagree about what a stage may still take. The words the
 * card spells out (the stage's name, the ceiling, the overshoot) move into
 * the tooltip — a cell is no place for a paragraph, and the Qty cell beside
 * it already turns red when the entry would be refused.
 */
export function StageProgressCell({
  stage,
  pending,
}: {
  stage: BatchStage;
  pending: number;
}) {
  const target = Number(stage.target_qty ?? 0);
  const made = Number(stage.accumulated_qty ?? 0) + (pending || 0);
  const pct = target > 0 ? Math.round((made / target) * 100) : 0;

  const ceiling = stageCeiling(stage);
  const over = stageIsOverTolerance(stage, pending || 0);
  const done = !over && pct >= 100;

  const tone = over
    ? "var(--color-danger)"
    : done
      ? "var(--color-teal)"
      : "var(--color-brand)";

  const unit = stage.target_unit;
  const title = [
    `${stageName(stage)} — ${full(made)} of ${full(target)} ${unit} (${pct}%), this entry included`,
    over && ceiling !== null
      ? `Over what this stage accepts by ${full(made - ceiling)} ${unit} — at most ${full(ceiling)} ${unit} can be logged. Bring the quantity down, or have a manager change the plan on the Pipeline.`
      : done
        ? "Stage target reached — a supervisor can sign it off on the Pipeline."
        : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      title={title}
      className={cn(
        "flex h-10 flex-col justify-center gap-1 px-3",
        over && "bg-danger-soft/50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-[0.6875rem] leading-none">
        <span className="min-w-0 truncate font-mono text-ink-3">
          {short(made)}
          <span className="text-ink-5"> / {short(target)}</span>
        </span>
        <span
          className="shrink-0 font-mono font-semibold"
          style={{ color: tone }}
        >
          {pct}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(100, pct)}%`, background: tone }}
        />
      </div>
    </div>
  );
}

/** Every digit — for the tooltip, where there is room for them. */
function full(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Short enough for the cell: 400 stays 400, 299,501 becomes 299.5K and
 * 5,580,000 becomes 5.6M. The exact figures are in the tooltip.
 */
function short(n: number): string {
  return Math.abs(n) < 10_000
    ? full(n)
    : n.toLocaleString(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      });
}
