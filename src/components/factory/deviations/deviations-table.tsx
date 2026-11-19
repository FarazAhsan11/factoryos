"use client";

import { FileWarning, Lock } from "lucide-react";

import {
  Badge,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import {
  CELL,
  RegisterEmpty,
  RegisterRow,
  RegisterTable,
  TH,
  Val,
} from "@/components/factory/register-table";
import {
  CASE_STAGES,
  RISK_TEXT,
  devRiskLabel,
  isLegacyRisk,
  caseStage,
  dispositionMeta,
  priorityMeta,
  typeMeta,
  type Deviation,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { cn } from "@/lib/utils";

/*
 * The case register, laid out the way the client's reference QMS lists it:
 * a short row of columns that answer "what, which batch, where is it, how
 * bad, whose, by when, under which CAPA" — and a Columns menu for the rest.
 * The record is opened for everything else; the list is for finding it.
 *
 * Status is read from the case (`caseStage`): Open, Awaiting CAPA, Ready to
 * close, Closed. The SLA date turns amber inside five days and red once past.
 */

/** Every column a viewer may add to the fixed ones. */
export const OPTIONAL_COLUMNS = [
  { key: "capa", label: "CAPA" },
  { key: "type", label: "Type" },
  { key: "priority", label: "Priority" },
  { key: "product_code", label: "Product code" },
  { key: "raw_material", label: "Raw material" },
  { key: "disposition", label: "Disposition" },
  { key: "nc_category", label: "Non-conformance category" },
  { key: "root_cause_category", label: "Root cause category" },
  { key: "customer", label: "Customer" },
  { key: "supplier", label: "Supplier" },
  { key: "origin", label: "Origin" },
  { key: "received_via", label: "Received via" },
  { key: "adverse_reaction", label: "Adverse reaction" },
  { key: "raised", label: "Raised" },
  { key: "age", label: "Age" },
] as const;

export type CaseColumn = (typeof OPTIONAL_COLUMNS)[number]["key"];

/** The columns a screen opens with — what its kind of case is read by. */
export function defaultColumns(types: DeviationType[]): CaseColumn[] {
  if (types.length === 1 && types[0] === "ncr") {
    return ["raw_material", "disposition", "capa"];
  }
  if (types.length === 1 && types[0] === "complaint") {
    return ["customer", "received_via", "adverse_reaction", "capa"];
  }
  return ["capa"];
}

const DEFAULT_SHOWN: CaseColumn[] = ["type", "capa"];

export function DeviationsTable({
  deviations,
  onOpen,
  emptyTitle,
  emptyBody,
  columns = DEFAULT_SHOWN,
}: {
  deviations: Deviation[];
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyBody: string;
  /** The optional columns switched on; drawn in `OPTIONAL_COLUMNS` order. */
  columns?: CaseColumn[];
}) {
  if (deviations.length === 0) {
    return (
      <RegisterEmpty icon={FileWarning} title={emptyTitle} body={emptyBody} />
    );
  }

  const extra = OPTIONAL_COLUMNS.filter((c) => columns.includes(c.key));

  return (
    <RegisterTable
      plain
      head={
        <>
          <th className={TH}>Case no.</th>
          <th className={TH}>Title</th>
          <th className={TH}>Product</th>
          <th className={TH}>Batch</th>
          <th className={TH}>Status</th>
          <th className={TH}>Risk</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Due date</th>
          {extra.map((c) => (
            <th key={c.key} className={TH}>
              {c.label}
            </th>
          ))}
        </>
      }
    >
      {deviations.map((d) => {
        const stage = CASE_STAGES[caseStage(d)];
        const closed = d.status === "closed";
        const dueSoon =
          !closed &&
          !d.is_overdue &&
          d.days_to_sla !== null &&
          d.days_to_sla <= 5;
        return (
          <RegisterRow key={d.id} onOpen={() => onOpen(d.id)}>
            <td className={cn(CELL, "font-mono text-[0.78rem] font-medium text-brand")}>
              <span className="inline-flex items-center gap-1.5">
                {d.deviation_no}
                {d.is_quarantining && (
                  <Lock
                    className="size-3.5 shrink-0 text-danger"
                    aria-label="Batch held"
                  />
                )}
              </span>
            </td>

            <td className="max-w-[26rem] min-w-[14rem] px-3 py-3 align-middle text-[0.8125rem] font-medium text-ink">
              {d.title}
            </td>

            <td className="max-w-[14rem] min-w-[9rem] px-3 py-3 align-middle text-[0.8125rem]">
              {(d.product_names.length > 0
                ? d.product_names.join(", ")
                : d.product_name) ?? <span className="text-ink-6">—</span>}
            </td>

            <td className={cn(CELL, "font-mono tabular-nums")}>
              <Val
                value={
                  d.batch_nos.length > 0 ? d.batch_nos.join(", ") : d.batch_no
                }
              />
            </td>

            <td className={CELL}>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", stage.dot)}
                />
                {stage.label}
              </span>
            </td>

            <td className={CELL}>
              {/* A deviation scored on the risk table (0068) reads "S3 · L2"
                  once assessed; everything else shows its Low / Medium / High. */}
              {(d.type === "planned" || d.type === "unplanned") &&
              d.assessed_at &&
              !isLegacyRisk(d) ? (
                <span className="font-mono text-ink-3">{devRiskLabel(d) ?? "—"}</span>
              ) : d.risk_conclusion ? (
                <span className={RISK_TEXT[d.risk_conclusion]}>
                  {d.risk_conclusion}
                </span>
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>

            <td className={CELL}>
              <Val value={d.owner_name ?? d.raised_by} />
            </td>

            <td
              className={cn(
                CELL,
                "tabular-nums",
                d.is_overdue && "font-semibold text-danger-deep",
                dueSoon && "text-warn-deep",
              )}
            >
              {closed ? (
                <span className="text-ink-5">
                  {d.closed_at ? formatDate(d.closed_at.slice(0, 10)) : "—"}
                </span>
              ) : (
                formatDate(d.sla_date)
              )}
            </td>

            {extra.map((c) => (
              <ExtraCell key={c.key} column={c.key} d={d} />
            ))}
          </RegisterRow>
        );
      })}
    </RegisterTable>
  );
}

function ExtraCell({ column, d }: { column: CaseColumn; d: Deviation }) {
  const dash = <span className="text-ink-6">—</span>;
  switch (column) {
    case "capa":
      return (
        <td className={cn(CELL, "font-mono text-[0.78rem]")}>
          {d.capa_no ? (
            <span
              className={
                d.capa_status === "effective" ? "text-teal-deep" : "text-brand"
              }
            >
              {d.capa_no}
            </span>
          ) : d.capa_needed === false ? (
            <span className="font-sans text-ink-5">Not needed</span>
          ) : (
            dash
          )}
        </td>
      );
    case "type": {
      const meta = typeMeta(d.type);
      return (
        <td className={CELL}>
          <Badge className={meta.pill}>{meta.short}</Badge>
        </td>
      );
    }
    case "priority": {
      const p = priorityMeta(d.priority);
      return (
        <td className={CELL}>
          <Badge className={p.pill}>{p.label}</Badge>
        </td>
      );
    }
    case "product_code":
      return (
        <td className={cn(CELL, "font-mono")}>
          <Val value={d.product_code} />
        </td>
      );
    case "raw_material":
      return (
        <td className={CELL}>
          {d.raw_material_code || d.raw_material_name ? (
            <Val
              value={[d.raw_material_code, d.raw_material_name]
                .filter(Boolean)
                .join(" · ")}
            />
          ) : (
            dash
          )}
        </td>
      );
    case "disposition":
      return (
        <td className={CELL}>
          {d.disposition ? (
            <Badge className={dispositionMeta(d.disposition).pill}>
              {dispositionMeta(d.disposition).label}
            </Badge>
          ) : (
            dash
          )}
        </td>
      );
    case "nc_category":
      return (
        <td className={CELL}>
          <Val value={d.nc_category} />
        </td>
      );
    case "root_cause_category":
      return (
        <td className={CELL}>
          <Val value={d.root_cause_category} />
        </td>
      );
    case "customer":
      return (
        <td className={CELL}>
          <Val value={d.customer_name} />
        </td>
      );
    case "supplier":
      return (
        <td className={CELL}>
          <Val value={d.supplier_name} />
        </td>
      );
    case "origin":
      return (
        <td className={CELL}>
          <Val value={d.origin} />
        </td>
      );
    case "received_via":
      return (
        <td className={CELL}>
          <Val value={d.received_via} />
        </td>
      );
    case "adverse_reaction":
      return (
        <td className={CELL}>
          {d.adverse_reaction === null ? (
            dash
          ) : d.adverse_reaction ? (
            <span className="font-semibold text-danger-deep">Yes</span>
          ) : (
            "No"
          )}
        </td>
      );
    case "raised":
      return (
        <td className={cn(CELL, "tabular-nums")}>
          {formatDate(d.created_at.slice(0, 10))}
        </td>
      );
    case "age":
      return (
        <td className={cn(CELL, "tabular-nums")}>{d.age_days}d</td>
      );
  }
}
