"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import { DeviationDetailDialog } from "@/components/factory/deviations/deviation-detail-dialog";
import { DeviationsTable } from "@/components/factory/deviations/deviations-table";
import { NewDeviationDialog } from "@/components/factory/deviations/new-deviation-dialog";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  DEVIATION_TYPES,
  deviationKeys,
  fetchDeviations,
  type Deviation,
  type DeviationStatus,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { cn } from "@/lib/utils";

type StatusFilter = DeviationStatus | "all";
type TypeFilter = DeviationType | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string; hint: string }[] = [
  { key: "open", label: "Open", hint: "Raised, not yet closed out" },
  { key: "closed", label: "Closed", hint: "Signed off by QA" },
  { key: "all", label: "All", hint: "Every case ever raised" },
];

/** What the keyword box searches — the columns somebody actually types into. */
function haystack(d: Deviation): string {
  return [
    d.deviation_no,
    d.title,
    d.batch_no,
    d.product_name,
    d.product_code,
    d.customer_name,
    d.supplier_name,
    d.nc_category,
    d.owner_name,
    d.raised_by,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Deviations & NCRs — the QMS register.
 *
 * A table, not a tray of cards: this is a list that gets read down a column
 * — every High risk case, everything still open on batch 44637 — and read
 * across only once you have found the row you want, which is what opening it
 * is for. Every field the case carries is a column; the case number stays
 * pinned while the rest scroll.
 *
 * Filtered by three things that answer different questions: status (with
 * counts), type, and a keyword box over the columns people type into.
 */
export function DeviationsWorkspace({
  factoryId,
  userId,
  role,
}: {
  factoryId: string;
  userId: string;
  role: FactoryRole;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [type, setType] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // The table re-filters on a background render, so typing stays responsive
  // with six hundred cases in the cache.
  const term = useDeferredValue(search).trim().toLowerCase();

  const {
    data: deviations = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
    [queryClient, factoryId],
  );

  // The status counts follow the other two filters, so "Open 3" always
  // describes the list its chip would show.
  const narrowed = useMemo(
    () =>
      deviations.filter(
        (d) =>
          (type === "all" || d.type === type) &&
          (!term || haystack(d).includes(term)),
      ),
    [deviations, type, term],
  );

  const counts = useMemo(
    () => ({
      open: narrowed.filter((d) => d.status === "open").length,
      closed: narrowed.filter((d) => d.status === "closed").length,
      all: narrowed.length,
    }),
    [narrowed],
  );

  const visible = useMemo(
    () =>
      status === "all" ? narrowed : narrowed.filter((d) => d.status === status),
    [narrowed, status],
  );

  // Read out of the fetched list rather than held in state, so an open case
  // re-renders the moment one of its tabs is saved.
  const open = deviations.find((d) => d.id === openId) ?? null;

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold tracking-[0.09em] text-ink-5 uppercase">
            Quality assurance
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Deviations &amp; NCRs
          </h1>
          <p className="mt-1 text-sm text-ink-4">
            Every case, from what was found to how it was closed out —
            identification, containment, risk, investigation and the CAPA.
          </p>
        </div>

        {canReview(role) && (
          <NewDeviationDialog
            factoryId={factoryId}
            userId={userId}
            onCreated={refresh}
          />
        )}
      </div>

      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Case status"
          className="flex gap-1 rounded-xl border border-line bg-sunken-2 p-1"
        >
          {STATUS_FILTERS.map(({ key, label, hint }) => {
            const active = status === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                title={hint}
                onClick={() => setStatus(key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
                    : "text-ink-4 hover:bg-surface/60 hover:text-ink",
                )}
              >
                {label}
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

        {/* The kind of case cuts across the status chips rather than joining
            them: an NCR is not a place a case can be. */}
        <div
          aria-label="Case type"
          className="flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-soft"
        >
          {[{ value: "all" as const, short: "All types" }, ...DEVIATION_TYPES].map(
            (t) => {
              const active = type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setType(t.value)}
                  className={cn(
                    "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                    active
                      ? "bg-sunken-2 text-ink ring-1 ring-line"
                      : "text-ink-4 hover:text-ink",
                  )}
                >
                  {t.short}
                </button>
              );
            },
          )}
        </div>

        <div className="relative min-w-[13rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by case no., title, batch, product, customer…"
            aria-label="Filter cases"
            className="h-[38px] w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-sm text-ink shadow-soft outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/12"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear the filter"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-ink-5 transition hover:bg-sunken-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 lg:overflow-hidden">
        {isPending ? (
          <TableSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load the register: {(error as Error).message}
          </p>
        ) : (
          <DeviationsTable
            deviations={visible}
            onOpen={setOpenId}
            emptyTitle={
              deviations.length === 0
                ? "No deviations or NCRs yet."
                : "Nothing matches those filters."
            }
            emptyBody={
              deviations.length === 0
                ? "Raise a case when something departs from spec."
                : term
                  ? "Try a different keyword, or clear the filter."
                  : status === "open"
                    ? "Nothing is waiting on QA."
                    : "Try another filter."
            }
          />
        )}
      </div>

      <DeviationDetailDialog
        deviation={open}
        factoryId={factoryId}
        role={role}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="h-10 animate-pulse bg-sunken-2" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse bg-sunken/60" />
      ))}
    </div>
  );
}
