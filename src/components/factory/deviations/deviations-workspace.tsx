"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileWarning,
  Link2,
  Lock,
  Package,
  User,
} from "lucide-react";

import { DeviationDetailDialog } from "@/components/factory/deviations/deviation-detail-dialog";
import { NewDeviationDialog } from "@/components/factory/deviations/new-deviation-dialog";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  DEVIATION_TYPES,
  STATUS_LABELS,
  STATUS_PILL,
  deviationKeys,
  dispositionMeta,
  fetchDeviations,
  typeMeta,
  type Deviation,
  type DeviationStatus,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { formatRaised } from "@/lib/factory/maintenance-queries";
import { cn } from "@/lib/utils";

type StatusFilter = DeviationStatus | "all";
type TypeFilter = DeviationType | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string; hint: string }[] = [
  { key: "open", label: "Open", hint: "Raised, waiting for QA to close" },
  { key: "closed", label: "Closed", hint: "Signed off by QA" },
  { key: "all", label: "All", hint: "Every record ever raised" },
];

/**
 * Deviations & NCRs — the QA register.
 *
 * Filtered two ways, because they are two questions: *is anyone still holding
 * it* (open / closed, with counts), and *what kind of record is it*. Opening
 * a row opens the record, with the close form inside it while it is open.
 *
 * Nothing here decides what a record may do next — `deviations_guard` does —
 * and nothing here touches the pipeline: an open quarantine NCR holds its
 * batch from the database.
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
  const [openId, setOpenId] = useState<string | null>(null);

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
      queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      }),
    [queryClient, factoryId],
  );

  // The status counts follow the type filter, so "Open 3" always describes
  // the list the chip would show.
  const ofType = useMemo(
    () =>
      type === "all" ? deviations : deviations.filter((d) => d.type === type),
    [deviations, type],
  );

  const counts = useMemo(
    () => ({
      open: ofType.filter((d) => d.status === "open").length,
      closed: ofType.filter((d) => d.status === "closed").length,
      all: ofType.length,
    }),
    [ofType],
  );

  const visible = useMemo(
    () =>
      status === "all" ? ofType : ofType.filter((d) => d.status === status),
    [ofType, status],
  );

  // Read out of the fetched list rather than held in state, so the open
  // dialog shows the closed record the moment it is signed.
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
            Record a departure from spec or a non-conforming material, decide
            what happens to it, and have QA close it out.
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

      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Deviation status"
          className="scrollbar-slim flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-sunken-2 p-1"
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

        {/* The kind of record cuts across the status chips rather than joining
            them: an NCR is not a place a record can be. */}
        <div
          aria-label="Record type"
          className="scrollbar-slim flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1 shadow-soft"
        >
          {[
            { value: "all" as const, short: "All types" },
            ...DEVIATION_TYPES,
          ].map((t) => {
            const active = type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => setType(t.value)}
                className={cn(
                  "shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  active
                    ? "bg-sunken-2 text-ink ring-1 ring-line"
                    : "text-ink-4 hover:text-ink",
                )}
              >
                {t.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scrollbar-slim -mx-1 min-h-0 flex-1 px-1 pb-1 lg:overflow-y-auto">
        {isPending ? (
          <ListSkeleton />
        ) : isError ? (
          <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
            Could not load deviations: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
              <FileWarning className="size-6" />
            </span>
            <p className="mt-3 text-sm font-medium text-ink-3">
              {deviations.length === 0
                ? "No deviations or NCRs yet."
                : "Nothing matches that filter."}
            </p>
            <p className="mt-1 text-xs text-ink-5">
              {deviations.length === 0
                ? "Raise one when something departs from spec."
                : status === "open"
                  ? "Nothing is waiting on QA."
                  : "Try another filter."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visible.map((deviation) => (
              <DeviationRow
                key={deviation.id}
                deviation={deviation}
                onOpen={() => setOpenId(deviation.id)}
              />
            ))}
          </ul>
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

/**
 * One deviation, as a card.
 *
 * Exported because the batch record shows the same cards under its
 * Deviations tab — a second card built to look like this one would drift.
 */
export function DeviationRow({
  deviation,
  onOpen,
}: {
  deviation: Deviation;
  onOpen: () => void;
}) {
  const meta = typeMeta(deviation.type);
  const disposition = deviation.disposition
    ? dispositionMeta(deviation.disposition)
    : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group relative block w-full overflow-hidden rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-5 text-left shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong hover:shadow-lift focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/12 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: meta.spine }}
        />

        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-sunken-2 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-ink-3 ring-1 ring-line">
              {deviation.deviation_no}
            </span>
            <Pill className={meta.pill}>{meta.label}</Pill>
            {disposition && (
              <Pill className={disposition.pill}>{disposition.label}</Pill>
            )}
          </p>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* The one state on this screen that reaches past it: the batch
                is held, and nothing can be produced against it. */}
            {deviation.is_quarantining && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-danger-deep uppercase ring-1 ring-danger-line">
                <Lock className="size-3" />
                Batch held
              </span>
            )}
            <Pill className={STATUS_PILL[deviation.status]}>
              {STATUS_LABELS[deviation.status]}
            </Pill>
            <ChevronRight className="size-4 text-ink-6 transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </div>
        </div>

        <p className="mt-2 line-clamp-2 text-[13px] break-words whitespace-pre-wrap text-ink-2">
          {deviation.actual}
        </p>
        {deviation.specification && (
          <p className="mt-1 line-clamp-1 text-xs text-ink-5">
            <span className="font-semibold text-ink-4">Spec:</span>{" "}
            {deviation.specification}
          </p>
        )}

        {deviation.batch_no && (
          <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-lg bg-sunken px-2 py-1 text-xs ring-1 ring-line-soft">
            <Package className="size-3.5 shrink-0 text-ink-5" />
            <span className="font-mono font-semibold text-ink">
              {deviation.batch_no}
            </span>
            {deviation.product_name && (
              <span className="text-ink-4">{deviation.product_name}</span>
            )}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line-soft pt-2.5 text-xs">
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
              <User className="size-3.5 shrink-0 text-ink-5" />
              {deviation.status === "closed"
                ? `Closed by ${deviation.qa_sign_name}`
                : deviation.qa_reviewer
                  ? `QA: ${deviation.qa_reviewer}`
                  : "No QA reviewer yet"}
            </span>
            {deviation.action_title && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-4">
                <Link2 className="size-3.5 shrink-0 text-ink-5" />
                <span className="truncate">{deviation.action_title}</span>
              </span>
            )}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-ink-5">
            {deviation.raised_by && `${deviation.raised_by} · `}
            {formatRaised(deviation.created_at)}
          </span>
        </div>
      </button>
    </li>
  );
}

function Pill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-line bg-surface p-4"
        >
          <span className="block h-3.5 w-2/5 animate-pulse rounded bg-sunken-2" />
          <span className="mt-3 block h-2.5 w-4/5 animate-pulse rounded bg-sunken-2" />
          <span className="mt-2 block h-2.5 w-1/3 animate-pulse rounded bg-sunken-2" />
          <span className="mt-4 block h-2.5 w-1/4 animate-pulse rounded bg-sunken-2" />
        </div>
      ))}
    </div>
  );
}
