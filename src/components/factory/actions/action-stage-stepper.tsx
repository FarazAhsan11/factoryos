"use client";

import { Check, Minus } from "lucide-react";

import {
  ACTION_STAGES,
  STAGE_LABELS,
  isStageSkipped,
  stageIndex,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

/**
 * Where the issue has got to, in one line.
 *
 * The vertical timeline answers "what did each stage produce" and needs the
 * room to do it. This answers "where am I", which is a glance, not a read —
 * and it is the question someone opening the dialog asks first. Splitting the
 * two is most of why the panel stopped feeling like one undifferentiated
 * column: position sits at the top of the working tab, the evidence lives in
 * the record.
 *
 * Labels are absolutely positioned under their node so a long stage name
 * can't stretch its segment and throw the rail out of true; the end labels
 * anchor to their edges rather than centring, so nothing overhangs the box.
 */
export function ActionStageStepper({
  action,
  className,
}: {
  action: FactoryAction;
  className?: string;
}) {
  const current = stageIndex(action.status);

  return (
    <ol
      className={cn(
        "flex items-center rounded-2xl border border-line bg-sunken px-4 pt-4 pb-9",
        className,
      )}
      aria-label="Issue progress"
    >
      {ACTION_STAGES.map((stage, i) => {
        const skipped = isStageSkipped(action, stage);
        const done = i < current && !skipped;
        const active = i === current;
        const last = i === ACTION_STAGES.length - 1;
        // The rail runs green only *into* a stage that actually happened, so
        // a skipped stretch reads as the detour it was.
        const railDone = done && !isStageSkipped(action, ACTION_STAGES[i + 1]);

        return (
          <li
            key={stage}
            className={cn("relative flex items-center", !last && "flex-1")}
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border-2 transition",
                done
                  ? "border-teal bg-teal text-white shadow-[0_4px_10px_-4px_rgb(13_148_136/0.8)]"
                  : active
                    ? "border-brand bg-surface text-brand ring-4 ring-brand/15"
                    : "border-line bg-surface text-ink-6",
              )}
            >
              {done ? (
                <Check className="size-3.5" />
              ) : skipped ? (
                <Minus className="size-3" />
              ) : active ? (
                <span className="size-2 rounded-full bg-current" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>

            {!last && (
              <span
                className={cn(
                  "mx-1.5 h-1 flex-1 rounded-full",
                  railDone ? "bg-teal" : "bg-line-strong/60",
                )}
              />
            )}

            <span
              className={cn(
                "absolute top-9 whitespace-nowrap text-[10.5px] font-semibold",
                i === 0
                  ? "left-0"
                  : last
                    ? "right-0"
                    : "left-3.5 -translate-x-1/2",
                skipped
                  ? "text-ink-6 line-through"
                  : active
                    ? "text-brand"
                    : done
                      ? "text-teal-deep"
                      : "text-ink-5",
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
