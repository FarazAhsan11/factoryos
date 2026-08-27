"use client";

import { AlertTriangle, ArrowUpRight, Package, User } from "lucide-react";

import {
  STAGE_LABELS,
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
  critical: "var(--color-danger)",
  high: "var(--color-warn)",
  medium: "var(--color-brand)",
  low: "var(--color-ink-5)",
};

const STAGE_PILL: Record<string, string> = {
  open: "bg-warn-soft text-warn-deep",
  investigating: "bg-brand-soft text-brand-deep",
  action_taken: "bg-brand-soft text-brand-deep",
  verification: "bg-teal-soft text-teal-deep",
  closed: "bg-teal-soft text-teal-deep",
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
            className="block w-full rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-ink-6 focus-visible:border-brand focus-visible:outline-none"
            style={{ borderLeft: `4px solid ${PRIORITY_BAR[action.priority]}` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{action.title}</h3>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {/* Escalated first — it is the reason this row is being read. */}
                {action.is_escalated && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-deep">
                    <ArrowUpRight className="size-3" />
                    Escalated
                  </span>
                )}
                {/* Only when it isn't already escalated: an escalated action is
                    overdue by definition, and saying both is noise. */}
                {action.is_overdue && !action.is_escalated && (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger-deep">
                    Overdue
                  </span>
                )}
                {/* The second clock. A fix waiting on a signature isn't
                    urgent, but it isn't done either — and this is the state
                    an issue quietly dies in. */}
                {action.is_verify_overdue && (
                  <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn-deep">
                    Sign-off late
                  </span>
                )}
                {/* Closed and closed-without-a-CAPA are both "Closed", and
                    for anyone scanning the tab for what was actually
                    investigated, the difference is the only thing worth
                    knowing about the row. */}
                {action.resolved_direct && (
                  <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                    No CAPA
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    STAGE_PILL[action.status],
                  )}
                >
                  {STAGE_LABELS[action.status]}
                </span>
              </div>
            </div>

            <p className="mt-1 text-xs text-ink-5">
              {action.unit_name ?? "Factory-wide"} · {action.category} ·{" "}
              {action.priority}
            </p>

            {/* The batch, on its own line rather than appended to the one
                above: it is the detail that ties an issue to a run, and
                buried at the end of four grey words nobody reads it. */}
            {action.batch_no && (
              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                <Package className="size-3.5 shrink-0 translate-y-0.5 text-ink-5" />
                <span className="font-mono font-medium text-ink">
                  {action.batch_no}
                </span>
                {action.product_name && (
                  <span className="text-ink-4">{action.product_name}</span>
                )}
                {action.product_code && (
                  <span className="font-mono text-[11px] text-ink-5">
                    {action.product_code}
                  </span>
                )}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs",
                  action.assigned_to
                    ? "font-medium text-ink"
                    : "italic text-warn-deep",
                )}
              >
                <User className="size-3.5 shrink-0 text-ink-5" />
                {/* Unassigned is a problem, not a blank — nobody has picked
                    this up, which is precisely what should stand out. */}
                {action.assigned_to ?? "Unassigned"}
              </span>

              {/* Whichever clock is actually running. Showing the fix
                  deadline on an issue whose fix is already in would be
                  answering a question nobody is asking. */}
              <span className="font-mono text-[11px] text-ink-5">
                {action.status === "closed" ? (
                  <>
                    Closed {action.closed_at && relativeTime(action.closed_at)}
                  </>
                ) : action.verify_due_at ? (
                  <>
                    Sign-off: {formatDue(action.verify_due_at)}
                    <span
                      className={cn(
                        "ml-1.5 font-semibold",
                        action.is_verify_overdue
                          ? "text-warn-deep"
                          : "text-ink-4",
                      )}
                    >
                      {relativeTime(action.verify_due_at)}
                    </span>
                  </>
                ) : (
                  <>
                    Due: {formatDue(action.due_at)}
                    <span
                      className={cn(
                        "ml-1.5 font-semibold",
                        action.is_overdue ? "text-danger-deep" : "text-ink-4",
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
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-warn-deep">
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
