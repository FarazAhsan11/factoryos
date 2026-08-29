import {
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
        const style = STYLES[stage.status];
        const pct = stageProgress(stage);
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
              }${stage.is_final ? " · completes the order" : ""}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
                style.className,
              )}
            >
              <span aria-hidden>{style.mark}</span>
              {stageName(stage)}
              {stage.status === "in_progress" && pct !== null && (
                <span className="font-mono tabular-nums">{pct}%</span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}
