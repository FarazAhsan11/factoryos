"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";

import { CapaDetailDialog } from "@/components/factory/capa/capa-detail-dialog";
import { formatDate } from "@/components/factory/deviations/deviation-fields";
import {
  CELL,
  RegisterEmpty,
  RegisterFoot,
  RegisterRow,
  RegisterSearch,
  RegisterSkeleton,
  RegisterTable,
  RegisterViews,
  TH,
  Val,
} from "@/components/factory/register-table";
import type { FactoryRole } from "@/lib/factory/context";
import {
  CAPA_STATUS_LABELS,
  capaKeys,
  fetchCapas,
  type Capa,
  type CapaStatus,
} from "@/lib/factory/capa-queries";
import { typeMeta } from "@/lib/factory/deviation-queries";
import { cn } from "@/lib/utils";

type StatusFilter = CapaStatus | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string; hint: string }[] = [
  { key: "open", label: "Open", hint: "Actions still being worked, or not yet verified" },
  { key: "effective", label: "Effective", hint: "Verified and signed" },
  { key: "all", label: "All", hint: "Every CAPA ever raised" },
];

function haystack(c: Capa): string {
  return [
    c.capa_no,
    c.title,
    c.owner_name,
    ...c.cases.map((k) => k.deviation_no),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The CAPA register — every corrective and preventive action plan.
 *
 * A CAPA is raised from a case's CAPA tab, never here: a plan with no problem
 * behind it is not a CAPA. One CAPA can cover several cases, so the cases are
 * a column of their own, and each opens its case.
 */
export function CapaRegister({
  factoryId,
  role,
  onOpenCase,
}: {
  factoryId: string;
  role: FactoryRole;
  onOpenCase: (caseId: string) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const term = useDeferredValue(search).trim().toLowerCase();

  const {
    data: capas = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });

  const narrowed = useMemo(
    () => capas.filter((c) => !term || haystack(c).includes(term)),
    [capas, term],
  );
  const counts = useMemo(
    () => ({
      open: narrowed.filter((c) => c.status === "open").length,
      effective: narrowed.filter((c) => c.status === "effective").length,
      all: narrowed.length,
    }),
    [narrowed],
  );
  const visible = useMemo(
    () =>
      status === "all" ? narrowed : narrowed.filter((c) => c.status === status),
    [narrowed, status],
  );

  const open = capas.find((c) => c.id === openId) ?? null;

  return (
    <>
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          CAPA register
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-4">
          Every corrective and preventive action plan. A CAPA is raised from a
          case&apos;s CAPA tab, and one CAPA can cover several cases.
        </p>
      </div>

      <div className="mb-4 shrink-0">
        <RegisterViews
          views={STATUS_FILTERS.map((f) => ({ ...f, count: counts[f.key] }))}
          value={status}
          onChange={setStatus}
          label="CAPA views"
        />
      </div>

      <div className="mb-3 flex shrink-0 justify-end">
        <div className="w-full sm:w-80">
          <RegisterSearch
            value={search}
            onChange={setSearch}
            placeholder="Search CAPA no., title, owner, case no.…"
            label="Search CAPAs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        {isPending ? (
          <RegisterSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load the register: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <RegisterEmpty
            icon={ClipboardCheck}
            title={
              capas.length === 0
                ? "No CAPAs yet."
                : "Nothing matches those filters."
            }
            body={
              capas.length === 0
                ? "Raise one from a case's CAPA tab when the case needs one."
                : term
                  ? "Try a different keyword, or clear the filter."
                  : "Try another filter."
            }
          />
        ) : (
          <CapaTable
            capas={visible}
            onOpen={setOpenId}
            onOpenCase={onOpenCase}
          />
        )}
      </div>
      {!isPending && !isError && <RegisterFoot count={visible.length} />}

      <CapaDetailDialog
        capa={open}
        factoryId={factoryId}
        role={role}
        onClose={() => setOpenId(null)}
        onOpenCase={(caseId) => {
          setOpenId(null);
          onOpenCase(caseId);
        }}
      />
    </>
  );
}

function CapaTable({
  capas,
  onOpen,
  onOpenCase,
}: {
  capas: Capa[];
  onOpen: (id: string) => void;
  onOpenCase: (caseId: string) => void;
}) {
  return (
    <RegisterTable
      plain
      head={
        <>
          <th className={TH}>CAPA no.</th>
          <th className={TH}>Title</th>
          <th className={TH}>Cases</th>
          <th className={TH}>Status</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Reason</th>
          <th className={TH}>Target date</th>
          <th className={TH}>Actions closed</th>
          <th className={TH}>Overdue</th>
          <th className={TH}>Verify by</th>
          <th className={TH}>Raised</th>
        </>
      }
    >
      {capas.map((c) => {
        const effective = c.status === "effective";
        return (
          <RegisterRow key={c.id} onOpen={() => onOpen(c.id)}>
            <td
              className={cn(
                CELL,
                "font-mono text-[0.78rem] font-medium text-brand",
              )}
            >
              {c.capa_no}
            </td>
            <td className="max-w-[26rem] min-w-[14rem] px-3 py-3 align-middle text-[0.8125rem] font-medium text-ink">
              {c.title}
            </td>
            <td className={CELL}>
              {c.cases.length === 0 ? (
                <span className="text-ink-6">—</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {c.cases.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      // The row opens the CAPA; a case number opens the case.
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCase(k.id);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold ring-1 ring-current/15 transition hover:brightness-95",
                        typeMeta(k.type).pill,
                      )}
                    >
                      {k.deviation_no}
                    </button>
                  ))}
                </span>
              )}
            </td>
            <td className={CELL}>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    effective ? "bg-teal" : "bg-brand",
                  )}
                />
                {CAPA_STATUS_LABELS[c.status]}
              </span>
            </td>
            <td className={CELL}>
              <Val value={c.owner_name} />
            </td>
            <td className={CELL}>
              <Val value={c.reason} />
            </td>
            <td
              className={cn(
                CELL,
                "tabular-nums",
                c.is_overdue && "font-semibold text-danger-deep",
              )}
            >
              {formatDate(c.target_date)}
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {c.actions_closed} of {c.action_count}
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {c.actions_overdue > 0 ? (
                <span className="font-semibold text-danger-deep">
                  {c.actions_overdue}
                </span>
              ) : (
                <span className="text-ink-6">—</span>
              )}
            </td>
            <td
              className={cn(
                CELL,
                "tabular-nums",
                c.is_verify_overdue && "font-semibold text-danger-deep",
              )}
            >
              {formatDate(c.verify_by)}
            </td>
            <td className={cn(CELL, "tabular-nums")}>
              {formatDate(c.created_at.slice(0, 10))}
            </td>
          </RegisterRow>
        );
      })}
    </RegisterTable>
  );
}
