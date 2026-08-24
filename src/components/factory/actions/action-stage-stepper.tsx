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
      className={cn("flex items-center pb-6", className)}
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
                "grid size-6 shrink-0 place-items-center rounded-full border-2 transition",
                done
                  ? "border-[#16A34A] bg-[#16A34A] text-white"
                  : active
                    ? "border-[#2563EB] bg-white text-[#2563EB] ring-4 ring-[#2563EB]/12"
                    : "border-[#E2E8F0] bg-white text-[#CBD5E1]"
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
                  "mx-1.5 h-0.5 flex-1 rounded-full",
                  railDone ? "bg-[#16A34A]" : "bg-[#E2E8F0]"
                )}
              />
            )}

            <span
              className={cn(
                "absolute top-8 whitespace-nowrap text-[10.5px] font-semibold",
                i === 0
                  ? "left-0"
                  : last
                    ? "right-0"
                    : "left-3 -translate-x-1/2",
                skipped
                  ? "text-[#CBD5E1] line-through"
                  : active
                    ? "text-[#2563EB]"
                    : done
                      ? "text-[#15803D]"
                      : "text-[#94A3B8]"
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
