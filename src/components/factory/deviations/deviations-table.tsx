"use client";

import { FileWarning, Lock } from "lucide-react";

import {
  CELL,
  PinnedCell,
  RegisterEmpty,
  RegisterRow,
  RegisterTable,
  TH,
  TH_PINNED,
  Val,
} from "@/components/factory/register-table";
import {
  Badge,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import {
  RISK_PILL,
  STATUS_LABELS,
  STATUS_PILL,
  dispositionMeta,
  priorityMeta,
  typeMeta,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { cn } from "@/lib/utils";

/* The register is a table, not a stack of cards: it is read the way the
   reference QMS is read — scanned down one column at a time ("which of these
   is High risk?", "what is still open on 44637?"), which cards make
   impossible. The frame is shared with Issues & CAPA and Breakdown
   maintenance (`register-table.tsx`). */

export function DeviationsTable({
  deviations,
  onOpen,
  emptyTitle,
  emptyBody,
}: {
  deviations: Deviation[];
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  if (deviations.length === 0) {
    return (
      <RegisterEmpty icon={FileWarning} title={emptyTitle} body={emptyBody} />
    );
  }

  return (
    <RegisterTable
      head={
        <>
          <th className={TH_PINNED}>Case no.</th>
          <th className={TH}>Type</th>
          <th className={TH}>Status</th>
          <th className={TH}>Priority</th>
          <th className={TH}>Risk</th>
          <th className={TH}>Title</th>
          <th className={TH}>Batch</th>
          <th className={TH}>Product</th>
          <th className={TH}>Product code</th>
          <th className={TH}>Disposition</th>
          <th className={TH}>Non-conformance</th>
          <th className={TH}>Customer</th>
          <th className={TH}>Supplier</th>
          <th className={TH}>Origin</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Raised</th>
          <th className={TH}>SLA</th>
          <th className={`${TH} text-right`}>Age</th>
          <th className={TH}>Closed</th>
        </>
      }
    >
      {deviations.map((d) => {
        const meta = typeMeta(d.type);
        const priority = priorityMeta(d.priority);
        const disposition = d.disposition
          ? dispositionMeta(d.disposition)
          : null;
        const closed = d.status === "closed";
        return (
          <RegisterRow key={d.id} onOpen={() => onOpen(d.id)} dim={closed}>
            <PinnedCell spine={meta.spine}>
              {d.deviation_no}
              {d.is_quarantining && (
                <Lock
                  className="size-3.5 shrink-0 text-danger"
                  aria-label="Batch held"
                />
              )}
            </PinnedCell>

            <td className={CELL}>
              <Badge className={meta.pill}>{meta.short}</Badge>
            </td>
            <td className={CELL}>
              <Badge className={STATUS_PILL[d.status]}>
                {STATUS_LABELS[d.status]}
              </Badge>
              {d.is_overdue && (
                <Badge className="ml-1 bg-danger-soft text-danger-deep">
                  Overdue
                </Badge>
              )}
            </td>
            <td className={CELL}>
              <Badge className={priority.pill}>{priority.label}</Badge>
            </td>
            <td className={CELL}>
              {d.risk_conclusion ? (
                <Badge className={RISK_PILL[d.risk_conclusion]}>
                  {d.risk_conclusion}
                </Badge>
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>

            <td className="max-w-[26rem] min-w-[16rem] px-3 py-2.5 align-middle">
              <span className="block truncate font-medium text-ink">
                {d.title}
              </span>
            </td>

            <td className={cn(CELL, "font-mono")}>
              <Val value={d.batch_no} />
            </td>
            <td className="max-w-[18rem] px-3 py-2.5 align-middle text-[13px]">
              <span className="block truncate">
                <Val value={d.product_name} />
              </span>
            </td>
            <td className={cn(CELL, "font-mono")}>
              <Val value={d.product_code} />
            </td>
            <td className={CELL}>
              {disposition ? (
                <Badge className={disposition.pill}>{disposition.label}</Badge>
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>
            <td className={CELL}>
              <Val value={d.nc_category} />
            </td>
            <td className={CELL}>
              <Val value={d.customer_name} />
            </td>
            <td className={CELL}>
              <Val value={d.supplier_name} />
            </td>
            <td className={CELL}>
              <Val value={d.origin} />
            </td>
            <td className={CELL}>
              <Val value={d.owner_name ?? d.raised_by} />
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {formatDate(d.created_at.slice(0, 10))}
            </td>
            <td
              className={cn(
                CELL,
                "tabular-nums",
                d.is_overdue && "font-semibold text-danger-deep",
              )}
            >
              {formatDate(d.sla_date)}
            </td>
            <td className={cn(CELL, "text-right tabular-nums")}>
              {d.age_days}d
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {d.closed_at ? formatDate(d.closed_at.slice(0, 10)) : "—"}
            </td>
          </RegisterRow>
        );
      })}
    </RegisterTable>
  );
}
