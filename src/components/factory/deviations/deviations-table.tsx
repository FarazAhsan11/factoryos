"use client";

import { FileWarning, Lock } from "lucide-react";

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
   impossible. Every field on file is a column, so it scrolls sideways with
   the case number pinned, exactly as the products table does. */
const CELL = "px-3 py-2.5 align-middle text-[13px] whitespace-nowrap";
const STICKY_LEFT = "sticky left-0 z-10 shadow-[inset_-1px_0_0_var(--color-line)]";
const TH =
  "sticky top-0 z-20 bg-sunken-2 px-3 py-2.5 shadow-[inset_0_-1px_0_var(--color-line)]";

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
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
          <FileWarning className="size-6" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink-3">{emptyTitle}</p>
        <p className="mt-1 text-xs text-ink-5">{emptyBody}</p>
      </div>
    );
  }

  return (
    // Scrolls both ways inside itself so the header row can stick to its top —
    // a sticky header only sticks within its nearest scrolling box.
    <div className="scrollbar-slim h-full overflow-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="text-left text-[10px] font-bold tracking-[0.07em] whitespace-nowrap text-ink-3 uppercase">
            <th
              className={cn(
                TH,
                "left-0 z-30 shadow-[inset_-1px_-1px_0_var(--color-line)]",
              )}
            >
              Case no.
            </th>
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
            <th className={cn(TH, "text-right")}>Age</th>
            <th className={TH}>Closed</th>
          </tr>
        </thead>
        <tbody>
          {deviations.map((d) => {
            const meta = typeMeta(d.type);
            const priority = priorityMeta(d.priority);
            const disposition = d.disposition
              ? dispositionMeta(d.disposition)
              : null;
            const closed = d.status === "closed";
            return (
              <tr
                key={d.id}
                onClick={() => onOpen(d.id)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(d.id);
                  }
                }}
                className={cn(
                  "group cursor-pointer border-b border-sunken last:border-0 transition",
                  "hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:outline-none",
                  closed && "text-ink-4",
                )}
              >
                {/* The pinned cell paints its own ground, or the scrolling
                    columns show through it. A spine in the type's colour is
                    what makes a screen of rows scannable. */}
                <td
                  className={cn(
                    STICKY_LEFT,
                    CELL,
                    "bg-surface font-mono text-[12.5px] font-semibold text-ink group-hover:bg-brand-tint group-focus-visible:bg-brand-tint",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-5 w-1 shrink-0 rounded-full"
                      style={{ background: meta.spine }}
                    />
                    {d.deviation_no}
                    {d.is_quarantining && (
                      <Lock
                        className="size-3.5 shrink-0 text-danger"
                        aria-label="Batch held"
                      />
                    )}
                  </span>
                </td>

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
                    <Badge className={disposition.pill}>
                      {disposition.label}
                    </Badge>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A value, or the dash that means nobody recorded one. */
function Val({ value }: { value: string | null }) {
  return value ? <>{value}</> : <span className="text-ink-6">—</span>;
}
