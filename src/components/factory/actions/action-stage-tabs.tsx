"use client";

import { AlertTriangle } from "lucide-react";

import {
  ACTION_STAGES,
  STAGE_LABELS,
  type ActionStage,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

/**
 * Five tabs, one per stage — and a toggle that cuts across all of them.
 *
 * Escalated is not a tab of its own on purpose. An escalated issue is already
 * sitting in one of the unfinished stages; giving it a tab of its own would
 * show the same row twice and make every count a little bit of a lie. As a
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
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-surface text-ink-3 hover:border-ink-6",
              )}
            >
              {STAGE_LABELS[key]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold",
                  active ? "bg-surface/20" : "bg-sunken-2 text-ink-4",
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
            ? "border-warn-deep bg-warn-soft text-warn-deep"
            : "border-line bg-surface text-ink-3 hover:border-ink-6",
          // Nothing is late: the toggle stays visible so its absence is
          // readable as "all clear" rather than as a missing control.
          attentionCount === 0 && !attention && "opacity-60",
        )}
      >
        <AlertTriangle className="size-3.5" />
        Needs attention
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-bold",
            attention ? "bg-surface/60" : "bg-sunken-2 text-ink-4",
          )}
        >
          {attentionCount}
        </span>
      </button>
    </div>
  );
}
