import {
  stageCeiling,
  stageName,
  stageProgress,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { cn } from "@/lib/utils";

/**
 * A batch's route in one line: `○ Dispensing › ⚙ Compression 62% › ○ Packing`.
 *
 * The card can carry exactly one percentage, and on a four-stage batch that
 * number is close to useless on its own — 0% while 180,000 have been
 * encapsulated reads as broken. The strip says where the work actually is,
 * which is the question anyone glancing at a board is asking.
 *
 * Deliberately not a progress bar per stage. At card width that is four bars
 * nobody can read; the percentage appears only on the stage that is running,
 * because that is the only one whose progress is news.
 */
const STYLES = {
  pending: { mark: "○", className: "bg-sunken-2 text-ink-5" },
  in_progress: {
    mark: "⚙",
    className: "bg-brand-soft text-brand-deep ring-1 ring-brand-line",
  },
  complete: { mark: "✓", className: "bg-teal-soft text-teal-deep" },
} as const;

/**
 * Overrides the status colour when a stage is past what the log will accept
 * (migration 0037).
 *
 * Status and tolerance are different questions — a stage can be signed off and
 * still hold more than its plan allows — and when they disagree the one worth
 * the colour is the one somebody has to act on.
 */
const OVER = {
  mark: "!",
  className: "bg-danger-tint text-danger-deep ring-1 ring-danger-line",
} as const;

export function StageStrip({
  stages,
  className,
}: {
  stages: BatchStage[];
  className?: string;
}) {
  if (stages.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-1", className)}>
      {stages.map((stage, i) => {
        const over = stage.is_over_tolerance;
        const style = over ? OVER : STYLES[stage.status];
        const pct = stageProgress(stage);
        const ceiling = stageCeiling(stage);
        return (
          <span key={stage.id} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-[10px] text-ink-6">
                ›
              </span>
            )}
            <span
              title={`${stageName(stage)} — ${
                stage.target_qty
                  ? `${Number(stage.accumulated_qty).toLocaleString()} of ${Number(stage.target_qty).toLocaleString()} ${stage.target_unit}`
                  : "no target set"
              }${
                over && ceiling !== null
                  ? ` · past the ${ceiling.toLocaleString()} ${stage.target_unit} this stage accepts`
                  : ""
              }${stage.is_final ? " · completes the order" : ""}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                style.className,
              )}
            >
              <span aria-hidden>{style.mark}</span>
              {stageName(stage)}
              {(over || stage.status === "in_progress") && pct !== null && (
                <span className="font-mono tabular-nums">{pct}%</span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}
