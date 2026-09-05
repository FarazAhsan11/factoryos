"use client";

import {
  stageCeiling,
  stageIsOverTolerance,
  stageName,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { cn } from "@/lib/utils";

/**
 * How far through its planned target this stage is, counting what is being
 * typed right now.
 *
 * Its own file because two screens ask the question: the shift log's entry
 * form, and the row typed straight into the shift report. A second copy would
 * be a second opinion about what a stage is allowed to take, which is the one
 * thing these two must never disagree on.
 *
 * The open entry is included on purpose: an operator about to file 5,000 needs
 * to see it land, and a bar that only moves after the submit is a bar that
 * answers the question too late to act on.
 *
 * That is also what makes the red state worth drawing. Since migration 0037 a
 * stage has a ceiling — its target plus the batch's tolerance — and the shift
 * log *refuses* an entry that would cross it. Reading the refusal off a failed
 * submit, after the whole form is typed, is the worst moment to learn it; the
 * bar turns red as the quantity is entered, with the ceiling and the overshoot
 * named, so the number can be corrected before anyone presses save.
 */
export function StageProgress({
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
  /** Would this entry, as typed, be refused? */
  const over = stageIsOverTolerance(stage, pending || 0);
  /** By how much — the number that has to come off before this can be filed. */
  const excess = over && ceiling !== null ? made - ceiling : 0;

  const tone = over
    ? "var(--color-danger)"
    : pct >= 100
      ? "var(--color-teal)"
      : "var(--color-brand)";

  return (
    <div
      className={cn(
        "space-y-1 rounded-xl border px-3.5 py-2.5",
        over ? "border-danger-line bg-danger-tint" : "border-line bg-sunken",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-medium text-ink-3">{stageName(stage)}</span>
        <span className="font-mono text-ink-4">
          {made.toLocaleString(undefined, { maximumFractionDigits: 2 })} /{" "}
          {target.toLocaleString()} {stage.target_unit}
          <span className="ml-1 font-semibold" style={{ color: tone }}>
            {pct}%
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(100, pct)}%`, background: tone }}
        />
      </div>

      {/* Red first: an entry that will be refused is more urgent news than a
          target that has been reached, and on an over-tolerance entry both are
          true at once. */}
      {over && ceiling !== null ? (
        <p className="text-[11px] font-medium text-danger-deep">
          Over what this stage accepts by{" "}
          <strong className="font-mono font-semibold">
            {excess.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            {stage.target_unit}
          </strong>
          . It is planned for {target.toLocaleString()} {stage.target_unit}
          {stage.effective_tolerance_pct > 0
            ? ` +${stage.effective_tolerance_pct}%, so ${ceiling.toLocaleString()} ${stage.target_unit} is the most that can be logged`
            : " with no tolerance, so that is the most that can be logged"}
          . This entry won&rsquo;t be saved until the quantity comes down, or a
          manager changes the plan on the Pipeline.
        </p>
      ) : (
        pct >= 100 && (
          <p className="text-[11px] font-medium" style={{ color: tone }}>
            Stage target reached — a supervisor can sign it off on the Pipeline.
          </p>
        )
      )}
    </div>
  );
}
