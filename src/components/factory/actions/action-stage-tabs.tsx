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
  children,
}: {
  stage: ActionStage;
  onStage: (stage: ActionStage) => void;
  counts: Record<ActionStage, number>;
  attention: boolean;
  attentionCount: number;
  onAttention: (on: boolean) => void;
  /** More filters on the same row — the register's keyword box. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
      {/* One shell holding five segments rather than five free-floating
          pills: the stages are a sequence, and a shared track is what says
          so. It also stops the row from re-flowing as counts change width. */}
      <div
        role="tablist"
        aria-label="Issue stage"
        className="scrollbar-slim flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-sunken-2 p-1"
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
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                active
                  ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
                  : "text-ink-4 hover:bg-surface/60 hover:text-ink",
              )}
            >
              {STAGE_LABELS[key]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  active
                    ? "bg-brand-soft text-brand-deep"
                    : "bg-line text-ink-4",
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
          "inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition",
          attention
            ? "border-warn-deep bg-warn-soft text-warn-deep shadow-[0_0_0_3px_rgb(245_158_11/0.12)]"
            : "border-line bg-surface text-ink-3 shadow-soft hover:border-warn-deep hover:text-warn-deep",
          // Nothing is late: the toggle stays visible so its absence is
          // readable as "all clear" rather than as a missing control.
          attentionCount === 0 && !attention && "opacity-60",
        )}
      >
        <AlertTriangle className="size-3.5" />
        Needs attention
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
            attention ? "bg-warn-line text-warn-ink" : "bg-sunken-2 text-ink-4",
          )}
        >
          {attentionCount}
        </span>
      </button>

      {children}
    </div>
  );
}
