"use client";

import { Wrench } from "lucide-react";

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
  STATUS_LABELS,
  STATUS_PILL,
  formatMinutes,
  formatRaised,
  formatStamp,
  minutesSince,
  priorityMeta,
  type MaintenanceRequest,
} from "@/lib/factory/maintenance-queries";
import { secondNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * Breakdown maintenance as a register, in the Deviations & NCRs frame: the
 * request number pinned behind its priority spine, then all three sections
 * of the paper form — initiation, engineering, QA review — as columns. The
 * row opens the same three-tab document the cards did.
 */
export function MaintenanceTable({
  requests,
  unitWord,
  onOpen,
  emptyTitle,
  emptyBody,
}: {
  requests: MaintenanceRequest[];
  unitWord: string;
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  // Read per render through the hook, so a running downtime keeps counting
  // under the React Compiler (see `useRenderClock`).
  const now = useRenderClock(secondNow);

  if (requests.length === 0) {
    return <RegisterEmpty icon={Wrench} title={emptyTitle} body={emptyBody} />;
  }

  return (
    <RegisterTable
      head={
        <>
          <th className={TH_PINNED}>Request no.</th>
          <th className={TH}>Status</th>
          <th className={TH}>Priority</th>
          <th className={TH}>EQ no.</th>
          <th className={TH}>Equipment</th>
          <th className={TH}>{unitWord}</th>
          <th className={TH}>Fault</th>
          <th className={TH}>Raised by dept.</th>
          <th className={TH}>Dept. needed</th>
          <th className={TH}>Batch</th>
          <th className={TH}>Product</th>
          <th className={TH}>Reported by</th>
          <th className={TH}>Raised</th>
          <th className={TH}>Assigned to</th>
          <th className={`${TH} text-right`}>Response</th>
          <th className={`${TH} text-right`}>Downtime</th>
          <th className={TH}>Work done</th>
          <th className={TH}>Completed</th>
          <th className={TH}>QA sign-off</th>
          <th className={TH}>Verified</th>
        </>
      }
    >
      {requests.map((r) => {
        const meta = priorityMeta(r.priority);
        return (
          <RegisterRow
            key={r.id}
            onOpen={() => onOpen(r.id)}
            dim={r.status === "verified"}
          >
            <PinnedCell spine={meta.dot}>{r.request_no}</PinnedCell>

            <td className={CELL}>
              <Badge className={STATUS_PILL[r.status]}>
                {STATUS_LABELS[r.status]}
              </Badge>
            </td>
            <td className={CELL}>
              <Badge className={meta.pill}>{meta.label}</Badge>
            </td>
            <td className={cn(CELL, "font-mono font-semibold text-ink")}>
              <Val value={r.equipment_no} />
            </td>
            <TextCell value={r.equipment_name} />
            <td className={CELL}>
              <Val
                value={r.unit_name}
                fallback={
                  <span className="text-ink-5">
                    Not {unitWord.toLowerCase()}-specific
                  </span>
                }
              />
            </td>
            <td
              className="max-w-[24rem] min-w-[14rem] px-3 py-2.5 align-middle text-[13px]"
              title={r.description}
            >
              <span className="block truncate font-medium text-ink">
                {r.description}
              </span>
            </td>
            <td className={CELL}>
              <Val value={r.initiating_department_name} />
            </td>
            <td className={CELL}>
              <Val value={r.department_name} />
            </td>
            <td className={cn(CELL, "font-mono")}>
              <Val value={r.batch_no} />
            </td>
            <TextCell value={r.product_name} />
            <td className={CELL}>
              <Val value={r.reported_by} />
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {formatRaised(r.created_at)}
            </td>
            <td className={CELL}>
              {/* The state a broken machine waits in — outstanding, not blank. */}
              <Val
                value={r.assigned_to}
                fallback={
                  <span className="font-medium text-warn-deep italic">
                    Unassigned
                  </span>
                }
              />
            </td>
            <td className={cn(CELL, "text-right tabular-nums")}>
              {r.response_minutes !== null ? (
                formatMinutes(r.response_minutes)
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>
            <td className={cn(CELL, "text-right tabular-nums")}>
              <Downtime request={r} now={now} />
            </td>
            <TextCell value={r.work_details} />
            <td className={cn(CELL, "tabular-nums")}>
              {formatStamp(r.completed_at)}
            </td>
            <td className={CELL}>
              <Val value={r.qa_sign_name} />
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {formatStamp(r.verified_at)}
            </td>
          </RegisterRow>
        );
      })}
    </RegisterTable>
  );
}

/**
 * Downtime, only when it means something: counting while the tools are down,
 * a fact once the work is signed, and nothing before work starts — a "0m"
 * there would read as a machine that never broke.
 */
function Downtime({
  request,
  now,
}: {
  request: MaintenanceRequest;
  now: number;
}) {
  if (request.downtime_minutes !== null) {
    return <>{formatMinutes(request.downtime_minutes)}</>;
  }
  if (request.work_started_at) {
    return (
      <span className="rounded-md bg-warn-soft px-1.5 py-0.5 font-semibold text-warn-deep ring-1 ring-warn-line">
        {formatMinutes(minutesSince(request.work_started_at, now))} · running
      </span>
    );
  }
  return <span className="text-ink-6">—</span>;
}
