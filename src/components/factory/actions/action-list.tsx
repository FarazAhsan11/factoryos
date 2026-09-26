"use client";

import { AlertTriangle, ArrowUpRight, Package, User } from "lucide-react";

import {
  STAGE_LABELS,
  formatDue,
  relativeTime,
  type ActionPriority,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { secondNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * The left edge of every row. Priority is the only thing worth colouring the
 * whole card by — status is a pill, and overdue is a badge, but priority is
 * what decides which row your eye lands on first.
 *
 * A rendered element rather than a `borderLeft` style, so the spine can round
 * with the card and the card keeps one uniform border on all four sides.
 */
const PRIORITY_SPINE: Record<ActionPriority, string> = {
  critical: "bg-danger",
  high: "bg-warn",
  medium: "bg-brand",
  low: "bg-ink-5",
};

/** The same priority, said in words, for the meta line. */
const PRIORITY_INK: Record<ActionPriority, string> = {
  critical: "text-danger",
  high: "text-warn-deep",
  medium: "text-brand",
  low: "text-ink-4",
};

const STAGE_PILL: Record<string, string> = {
  open: "bg-warn-soft text-warn-deep ring-warn-line",
  investigating: "bg-brand-soft text-brand-deep ring-brand-line",
  action_taken: "bg-brand-soft text-brand-deep ring-brand-line",
  verification: "bg-teal-soft text-teal-deep ring-teal-line",
  closed: "bg-teal-soft text-teal-deep ring-teal-line",
};

/**
 * Issues as cards — the batch record's Issues tab. The Issues & CAPA screen
 * itself is a table now (`ActionsTable`).
 */
export function ActionList({
  actions,
  onOpen,
}: {
  actions: FactoryAction[];
  onOpen: (action: FactoryAction) => void;
}) {
  // Read per render through the hook, so the relative times below stay as
  // current as they were before the React Compiler (see `useRenderClock`).
  const now = useRenderClock(secondNow);
  return (
    <ul className="space-y-2.5">
      {actions.map((action) => (
        <li key={action.id}>
          <button
            type="button"
            onClick={() => onOpen(action)}
            className="group relative block w-full overflow-hidden rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-5 text-left shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong hover:shadow-lift focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/12 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-0 left-0 w-1.5",
                PRIORITY_SPINE[action.priority],
              )}
            />

            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <h3 className="text-sm font-semibold break-words text-ink transition group-hover:text-brand-deep">
                {action.title}
              </h3>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {/* Escalated first — it is the reason this row is being read. */}
                {action.is_escalated && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-deep uppercase ring-1 ring-violet-line">
                    <ArrowUpRight className="size-3" />
                    Escalated
                  </span>
                )}
                {/* Only when it isn't already escalated: an escalated action is
                    overdue by definition, and saying both is noise. */}
                {action.is_overdue && !action.is_escalated && (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-danger-deep uppercase ring-1 ring-danger-line">
                    Overdue
                  </span>
                )}
                {/* The second clock. A fix waiting on a signature isn't
                    urgent, but it isn't done either — and this is the state
                    an issue quietly dies in. */}
                {action.is_verify_overdue && (
                  <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-warn-deep uppercase ring-1 ring-warn-line">
                    Sign-off late
                  </span>
                )}
                {/* Closed and closed-without-a-CAPA are both "Closed", and
                    for anyone scanning the tab for what was actually
                    investigated, the difference is the only thing worth
                    knowing about the row. */}
                {action.resolved_direct && (
                  <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ink-4 uppercase ring-1 ring-line">
                    No CAPA
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                    STAGE_PILL[action.status],
                  )}
                >
                  {STAGE_LABELS[action.status]}
                </span>
              </div>
            </div>

            {/* Room · category · priority, with the priority carrying its own
                colour — it is the one of the three that ranks the row, and in
                flat grey it read as filing detail. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-5">
              <span className="font-medium text-ink-4">
                {action.unit_name ?? "Factory-wide"}
              </span>
              <Dot />
              <span>{action.category}</span>
              <Dot />
              <span
                className={cn(
                  "font-semibold capitalize",
                  PRIORITY_INK[action.priority],
                )}
              >
                {action.priority}
              </span>
            </p>

            {/* The batch, on its own line rather than appended to the one
                above: it is the detail that ties an issue to a run, and
                buried at the end of four grey words nobody reads it. */}
            {action.batch_no && (
              <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-lg bg-sunken px-2 py-1 text-xs ring-1 ring-line-soft">
                <Package className="size-3.5 shrink-0 text-ink-5" />
                <span className="font-mono font-semibold text-ink">
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

            {/* A ruled footer, so owner and clock read as the row's standing
                facts rather than as two more sentences in the body. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line-soft pt-2.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs",
                  action.assigned_to
                    ? "font-medium text-ink-2"
                    : "font-medium text-warn-deep italic",
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
              <span className="font-mono text-[11px] tabular-nums text-ink-5">
                {action.status === "closed" ? (
                  <>
                    Closed {action.closed_at && relativeTime(action.closed_at, now)}
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
                      {relativeTime(action.verify_due_at, now)}
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
                      {relativeTime(action.due_at, now)}
                    </span>
                  </>
                )}
              </span>
            </div>

            {/* The one number that turns "overdue" into something actionable:
                how long before this becomes a management problem. */}
            {action.is_overdue && !action.is_escalated && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-warn-tint px-2 py-1 text-[11px] font-medium text-warn-deep ring-1 ring-warn-line">
                <AlertTriangle className="size-3 shrink-0" />
                Escalates {relativeTime(action.escalates_at, now)}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The separator in a meta line, dimmer than the words it separates. */
function Dot() {
  return (
    <span aria-hidden className="text-ink-6">
      ·
    </span>
  );
}
