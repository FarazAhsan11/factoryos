"use client";

import { AlertTriangle, ArrowUpRight, User } from "lucide-react";

import {
  STATUS_LABELS,
  formatDue,
  relativeTime,
  type ActionPriority,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

/**
 * The left edge of every row. Priority is the only thing worth colouring the
 * whole card by — status is a pill, and overdue is a badge, but priority is
 * what decides which row your eye lands on first.
 */
const PRIORITY_BAR: Record<ActionPriority, string> = {
  critical: "#DC2626",
  high: "#F59E0B",
  medium: "#2563EB",
  low: "#94A3B8",
};

const STATUS_PILL: Record<string, string> = {
  open: "bg-[#FEF3C7] text-[#B45309]",
  in_progress: "bg-[#DBEAFE] text-[#1D4ED8]",
  resolved: "bg-[#DCFCE7] text-[#15803D]",
};

export function ActionList({
  actions,
  onOpen,
}: {
  actions: FactoryAction[];
  onOpen: (action: FactoryAction) => void;
}) {
  return (
    <ul className="space-y-2.5">
      {actions.map((action) => (
        <li key={action.id}>
          <button
            type="button"
            onClick={() => onOpen(action)}
            className="block w-full rounded-2xl border border-[#E6EAF1] bg-white p-4 text-left transition hover:border-[#CBD5E1] focus-visible:border-[#2563EB] focus-visible:outline-none"
            style={{ borderLeft: `4px solid ${PRIORITY_BAR[action.priority]}` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#0F1B34]">
                {action.title}
              </h3>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {/* Escalated first — it is the reason this row is being read. */}
                {action.is_escalated && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#6D28D9]">
                    <ArrowUpRight className="size-3" />
                    Escalated
                  </span>
                )}
                {/* Only when it isn't already escalated: an escalated action is
                    overdue by definition, and saying both is noise. */}
                {action.is_overdue && !action.is_escalated && (
                  <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B91C1C]">
                    Overdue
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    STATUS_PILL[action.status]
                  )}
                >
                  {STATUS_LABELS[action.status]}
                </span>
              </div>
            </div>

            <p className="mt-1 text-xs text-[#94A3B8]">
              {action.unit_name ?? "Factory-wide"} · {action.category} ·{" "}
              {action.priority}
            </p>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs",
                  action.assigned_to
                    ? "font-medium text-[#0F1B34]"
                    : "italic text-[#B45309]"
                )}
              >
                <User className="size-3.5 shrink-0 text-[#94A3B8]" />
                {/* Unassigned is a problem, not a blank — nobody has picked
                    this up, which is precisely what should stand out. */}
                {action.assigned_to ?? "Unassigned"}
              </span>

              <span className="font-mono text-[11px] text-[#94A3B8]">
                {action.status === "resolved" ? (
                  <>Resolved {action.resolved_at && relativeTime(action.resolved_at)}</>
                ) : (
                  <>
                    Due: {formatDue(action.due_at)}
                    <span
                      className={cn(
                        "ml-1.5 font-semibold",
                        action.is_overdue ? "text-[#B91C1C]" : "text-[#64748B]"
                      )}
                    >
                      {relativeTime(action.due_at)}
                    </span>
                  </>
                )}
              </span>
            </div>

            {/* The one number that turns "overdue" into something actionable:
                how long before this becomes a management problem. */}
            {action.is_overdue && !action.is_escalated && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#B45309]">
                <AlertTriangle className="size-3" />
                Escalates {relativeTime(action.escalates_at)}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
