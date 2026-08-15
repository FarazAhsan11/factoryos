"use client";

import { AlertTriangle } from "lucide-react";

import {
  ACTION_STAGES,
  STAGE_LABELS,
  type ActionStage,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

/**
 * Four tabs, one per stage — and a toggle that cuts across all four.
 *
 * Escalated is not a fifth tab on purpose. An escalated issue is already
 * sitting in Open or Investigating; giving it a tab of its own would show the
 * same row in two places and make every count a little bit of a lie. As a
 * toggle it composes with whichever stage you are looking at, which is the
 * question people actually ask: "what in here has been ignored too long?"
 */
export function ActionStageTabs({
  stage,
  onStage,
  counts,
  attention,
  attentionCount,
  onAttention,
}: {
  stage: ActionStage;
  onStage: (stage: ActionStage) => void;
  counts: Record<ActionStage, number>;
  attention: boolean;
  attentionCount: number;
  onAttention: (on: boolean) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div
        role="tablist"
        aria-label="Issue stage"
        className="flex flex-wrap gap-1.5"
      >
        {ACTION_STAGES.map((key) => {
          const active = stage === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onStage(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                active
                  ? "border-[#0F1B34] bg-[#0F1B34] text-white"
                  : "border-[#E6EAF1] bg-white text-[#475569] hover:border-[#CBD5E1]"
              )}
            >
              {STAGE_LABELS[key]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold",
                  active ? "bg-white/20" : "bg-[#F1F5F9] text-[#64748B]"
                )}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-pressed={attention}
        onClick={() => onAttention(!attention)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
          attention
            ? "border-[#B45309] bg-[#FEF3C7] text-[#B45309]"
            : "border-[#E6EAF1] bg-white text-[#475569] hover:border-[#CBD5E1]",
          // Nothing is late: the toggle stays visible so its absence is
          // readable as "all clear" rather than as a missing control.
          attentionCount === 0 && !attention && "opacity-60"
        )}
      >
        <AlertTriangle className="size-3.5" />
        Needs attention
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-bold",
            attention ? "bg-white/60" : "bg-[#F1F5F9] text-[#64748B]"
          )}
        >
          {attentionCount}
        </span>
      </button>
    </div>
  );
}
