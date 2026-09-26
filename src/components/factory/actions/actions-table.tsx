"use client";

import { ClipboardCheck } from "lucide-react";

import { Badge } from "@/components/factory/deviations/deviation-fields";
import {
  CELL,
  PinnedCell,
  RegisterEmpty,
  RegisterRow,
  RegisterTable,
  TH,
  TH_PINNED,
  TextCell,
  Val,
} from "@/components/factory/register-table";
import {
  STAGE_LABELS,
  formatDue,
  relativeTime,
  type ActionPriority,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { formatDay } from "@/lib/factory/dates";
import { secondNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/** Priority ranks the row, so it is the spine colour — as on the cards it replaced. */
const PRIORITY_SPINE: Record<ActionPriority, string> = {
  critical: "bg-danger",
  high: "bg-warn",
  medium: "bg-brand",
  low: "bg-ink-5",
};

const PRIORITY_PILL: Record<ActionPriority, string> = {
  critical: "bg-danger-soft text-danger-deep",
  high: "bg-warn-soft text-warn-deep",
  medium: "bg-brand-soft text-brand-deep",
  low: "bg-sunken-2 text-ink-4",
};

const STAGE_PILL: Record<string, string> = {
  open: "bg-warn-soft text-warn-deep",
  investigating: "bg-brand-soft text-brand-deep",
  action_taken: "bg-brand-soft text-brand-deep",
  verification: "bg-teal-soft text-teal-deep",
  closed: "bg-teal-soft text-teal-deep",
};

/**
 * Issues & CAPA as a register, in the Deviations & NCRs frame: one row per
 * issue, every stage's evidence a column, the title pinned behind its
 * priority spine. The row opens the same staged dialog the cards did.
 */
export function ActionsTable({
  actions,
  unitWord,
  onOpen,
  emptyTitle,
  emptyBody,
}: {
  actions: FactoryAction[];
  unitWord: string;
  onOpen: (action: FactoryAction) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  // Read per render through the hook, so the relative clocks stay current
  // under the React Compiler (see `useRenderClock`).
  const now = useRenderClock(secondNow);

  if (actions.length === 0) {
    return (
      <RegisterEmpty
        icon={ClipboardCheck}
        title={emptyTitle}
        body={emptyBody}
      />
    );
  }

  return (
    <RegisterTable
      head={
        <>
          <th className={TH_PINNED}>Issue</th>
          <th className={TH}>Stage</th>
          <th className={TH}>Priority</th>
          <th className={TH}>{unitWord}</th>
          <th className={TH}>Category</th>
          <th className={TH}>Batch</th>
          <th className={TH}>Product</th>
          <th className={TH}>Product code</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Raised</th>
          <th className={TH}>Fix due</th>
          <th className={TH}>Sign-off due</th>
          <th className={TH}>Root cause</th>
          <th className={TH}>Corrective action</th>
          <th className={TH}>Preventive action</th>
          <th className={TH}>Verification</th>
          <th className={TH}>Closed</th>
        </>
      }
    >
      {actions.map((action) => {
        const closed = action.status === "closed";
        // The fix clock stops once the corrective action is in; after that
        // only the sign-off clock is running.
        const fixRunning = !closed && !action.verification_at;
        return (
          <RegisterRow
            key={action.id}
            onOpen={() => onOpen(action)}
            dim={closed}
          >
            <PinnedCell
              spine={PRIORITY_SPINE[action.priority]}
              className="max-w-[22rem] font-sans text-[13px]"
            >
              <span className="min-w-0 truncate" title={action.title}>
                {action.title}
              </span>
            </PinnedCell>

            <td className={CELL}>
              <span className="flex items-center gap-1">
                <Badge className={STAGE_PILL[action.status]}>
                  {STAGE_LABELS[action.status]}
                </Badge>
                {/* Escalated says overdue already; saying both is noise. */}
                {action.is_escalated ? (
                  <Badge className="bg-violet-soft text-violet-deep">
                    Escalated
                  </Badge>
                ) : (
                  action.is_overdue && (
                    <Badge className="bg-danger-soft text-danger-deep">
                      Overdue
                    </Badge>
                  )
                )}
                {action.is_verify_overdue && (
                  <Badge className="bg-warn-soft text-warn-deep">
                    Sign-off late
                  </Badge>
                )}
                {action.resolved_direct && (
                  <Badge className="bg-sunken-2 text-ink-4">No CAPA</Badge>
                )}
              </span>
            </td>
            <td className={CELL}>
              <Badge className={PRIORITY_PILL[action.priority]}>
                {action.priority}
              </Badge>
            </td>
            <td className={CELL}>
              <Val value={action.unit_name} fallback="Factory-wide" />
            </td>
            <td className={CELL}>
              <Val value={action.category} />
            </td>
            <td className={cn(CELL, "font-mono")}>
              <Val value={action.batch_no} />
            </td>
            <TextCell value={action.product_name} />
            <td className={cn(CELL, "font-mono")}>
              <Val value={action.product_code} />
            </td>
            <td className={CELL}>
              {/* Unassigned is a problem, not a blank — nobody has picked it up. */}
              <Val
                value={action.assigned_to}
                fallback={
                  <span className="font-medium text-warn-deep italic">
                    Unassigned
                  </span>
                }
              />
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {formatDay(action.created_at)}
            </td>
            <td
              className={cn(
                CELL,
                "tabular-nums",
                fixRunning &&
                  action.is_overdue &&
                  "font-semibold text-danger-deep",
              )}
            >
              {formatDue(action.due_at)}
              {fixRunning && (
                <span className="ml-1.5 text-[11px] text-ink-5">
                  {relativeTime(action.due_at, now)}
                </span>
              )}
            </td>
            <td
              className={cn(
                CELL,
                "tabular-nums",
                action.is_verify_overdue && "font-semibold text-warn-deep",
              )}
            >
              {action.verify_due_at ? (
                <>
                  {formatDue(action.verify_due_at)}
                  <span className="ml-1.5 text-[11px] text-ink-5">
                    {relativeTime(action.verify_due_at, now)}
                  </span>
                </>
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>
            <TextCell value={action.root_cause} />
            <TextCell value={action.corrective_action} />
            <TextCell value={action.preventive_action} />
            <TextCell value={action.verification} />
            <td className={cn(CELL, "tabular-nums")}>
              {action.closed_at ? formatDay(action.closed_at) : "—"}
            </td>
          </RegisterRow>
        );
      })}
    </RegisterTable>
  );
}
