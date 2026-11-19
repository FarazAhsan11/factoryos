"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus } from "lucide-react";

import { AssessmentTab } from "@/components/factory/deviations/assessment-tab";
import { BatchHolds } from "@/components/factory/deviations/batch-holds";
import { CapaTab } from "@/components/factory/deviations/capa-tab";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import { DevCloseOutTab } from "@/components/factory/deviations/dev-closeout-tab";
import { DevInvestigationTab } from "@/components/factory/deviations/dev-investigation-tab";
import { CaseHistory } from "@/components/factory/deviations/case-history";
import { InitiationTab } from "@/components/factory/deviations/deviation-tab-forms";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import { addDays, formatDay } from "@/lib/factory/dates";
import {
  DEV_STAGE_DOT,
  devRiskLabel,
  devStage,
  deviationKeys,
  fetchDeviations,
  nextStep,
  type CaseSection,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { fetchHolds, holdKeys } from "@/lib/factory/hold-queries";
import { cn } from "@/lib/utils";

const SECTIONS: { id: CaseSection; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "assessment", label: "Assessment" },
  { id: "investigation", label: "Investigation" },
  { id: "actions", label: "Actions" },
  { id: "closeout", label: "Close-out" },
  { id: "history", label: "History" },
];

/** Days QA has to sign the initial assessment, from raising. */
const ASSESS_DAYS = 2;

const CLASS_TEXT: Record<string, string> = {
  Minor: "text-teal-deep",
  Major: "text-warn-deep",
  Critical: "text-danger-deep",
};

function resolveSection(value: string | null): CaseSection {
  return SECTIONS.some((s) => s.id === value)
    ? (value as CaseSection)
    : "details";
}

/** ✓ done, – not needed, ○ to do, or nothing (History). */
function sectionState(d: Deviation, id: CaseSection): "ok" | "na" | "todo" | null {
  switch (id) {
    case "details":
      return d.occurred_at &&
        d.department_id &&
        d.detection_point &&
        (d.immediate_action ?? "").trim() &&
        d.hold_batch !== null
        ? "ok"
        : "todo";
    case "assessment":
      return d.assessed_at ? "ok" : "todo";
    case "investigation":
      if (d.investigation_required === false) return "na";
      return d.investigation_approved_at ? "ok" : "todo";
    case "actions":
      return d.capa_needed === false ||
        (d.capa_needed && d.capa_status === "effective")
        ? "ok"
        : "todo";
    case "closeout":
      return d.status === "closed" ? "ok" : "todo";
    default:
      return null;
  }
}

/**
 * One deviation, on a page of its own — the reference QMS's case page
 * (qms-v4): the title and what identifies it, five facts (stage, class, risk
 * score, due date, owner), any hold, what happens next, and the case's
 * sections as tabs. Details is the raise form, filled in.
 *
 * The case comes out of the register's cached list, so a save on any tab
 * (which invalidates that list) redraws the header with it.
 */
export function DeviationCasePage({
  factoryId,
  slug,
  caseId,
  role,
  userId,
  viewerName,
}: {
  factoryId: string;
  slug: string;
  caseId: string;
  role: FactoryRole;
  userId: string;
  viewerName: string;
}) {
  const searchParams = useSearchParams();
  const [section, setSectionState] = useState<CaseSection>(() =>
    resolveSection(searchParams.get("section")),
  );
  // Kept in the URL so a reload or a shared link opens the same tab.
  const setSection = (next: CaseSection) => {
    setSectionState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "details") params.delete("section");
    else params.set("section", next);
    const q = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}`,
    );
  };

  const { data: deviations, isPending, isError, error } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });
  // The case's batch holds, for the banner (and the Details tab's section).
  const { data: holds = [] } = useQuery({
    queryKey: holdKeys.forCase(factoryId, caseId),
    queryFn: () => fetchHolds(caseId),
  });
  const listHref = `/factory/${slug}/deviations`;
  const d = deviations?.find((x) => x.id === caseId) ?? null;

  if (isPending) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-5" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
        Could not load the case: {(error as Error).message}
      </p>
    );
  }
  if (!d || (d.type !== "planned" && d.type !== "unplanned")) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
        <p className="text-sm text-ink-3">This deviation could not be found.</p>
        <Link href={listHref} className="mt-2 inline-block text-sm text-brand hover:underline">
          Back to Deviations
        </Link>
      </div>
    );
  }

  const reviewer = canReview(role);
  const open = d.status === "open";
  const stage = devStage(d);
  const next = nextStep(d);
  const batches = d.batch_nos.length > 0 ? d.batch_nos : d.batch_no ? [d.batch_no] : [];
  const assessBy = addDays(d.created_at.slice(0, 10), ASSESS_DAYS);
  const onHold = holds.filter((h) => h.status === "on_hold").map((h) => h.batch_no);
  const released = holds.filter((h) => h.status === "released").map((h) => h.batch_no);

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
        <Link href={listHref} className="text-brand hover:underline">
          Deviations
        </Link>
        <span className="mx-1.5 text-ink-5">/</span>
        <span className="font-mono">{d.deviation_no}</span>
      </nav>

      <div className="mt-3 rounded-2xl border border-line bg-surface shadow-soft">
        <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 max-w-3xl">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {d.title}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-4">
              <span className="font-mono">{d.deviation_no}</span> · Deviation ·{" "}
              {d.type === "planned" ? "Planned" : "Unplanned"}
              {d.raised_by && ` · raised by ${d.raised_by}`} on{" "}
              {formatDay(d.created_at)}
              {batches.length > 0 && ` · batch ${batches.join(", ")}`}
              {d.product_names.length > 0 && ` · ${d.product_names.join(", ")}`}
            </p>
          </div>

          <dl className="flex flex-wrap divide-x divide-line-soft">
            <HeadFact label="Stage">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", DEV_STAGE_DOT[stage])} />
                {stage}
              </span>
            </HeadFact>
            <HeadFact label="Class">
              <span className={d.classification ? CLASS_TEXT[d.classification] : undefined}>
                {d.classification ?? "—"}
              </span>
            </HeadFact>
            <HeadFact label="Risk">{d.assessed_at ? (devRiskLabel(d) ?? "—") : "—"}</HeadFact>
            <HeadFact label={!open ? "Closed" : d.assessed_at ? "Due" : "Assess by"}>
              {!open ? (
                <span className="text-ink-4">{d.closed_at ? formatDay(d.closed_at) : "—"}</span>
              ) : d.assessed_at ? (
                <span className={cn(d.is_overdue && "text-danger-deep")}>
                  {d.sla_date ? formatDay(d.sla_date) : "—"}
                </span>
              ) : (
                formatDay(assessBy)
              )}
            </HeadFact>
            <HeadFact label="Owner">{d.owner_name ?? "—"}</HeadFact>
          </dl>
        </header>

        <div className="space-y-3 px-5 pt-5 sm:px-7">
          {open && onHold.length > 0 ? (
            <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep">
              Batch {onHold.join(", ")} on hold — preparatory and production work
              is blocked in the shift log. QA can release it once the impact is
              assessed (Details → Batch holds). Downtime can still be logged.
            </p>
          ) : open && released.length > 0 ? (
            <p className="rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
              Batch {released.join(", ")} released by QA while the case stays open.
            </p>
          ) : null}
          {next && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
              <span>
                <span className="font-semibold text-ink">Next:</span> {next.text}
              </span>
              {section !== next.tab && (
                <button
                  type="button"
                  onClick={() => setSection(next.tab)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand"
                >
                  Go to {SECTIONS.find((s) => s.id === next.tab)?.label}
                </button>
              )}
            </div>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Case sections"
          className="scrollbar-slim mt-4 flex gap-6 overflow-x-auto overflow-y-hidden px-5 shadow-[inset_0_-1px_0_var(--color-line)] sm:px-7"
        >
          {SECTIONS.map(({ id, label }) => {
            const active = section === id;
            const state = sectionState(d, id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm transition",
                  active
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent text-ink-4 hover:text-ink",
                )}
              >
                {state && (
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 place-items-center rounded-full",
                      state === "ok"
                        ? "bg-teal-soft text-teal-deep"
                        : state === "na"
                          ? "bg-sunken-2 text-ink-4"
                          : "border border-line-strong",
                    )}
                  >
                    {state === "ok" && <Check className="size-3" />}
                    {state === "na" && <Minus className="size-3" />}
                  </span>
                )}
                {label}
              </button>
            );
          })}
        </div>

        <div className="px-5 py-6 sm:px-7">
          {section === "details" && (
            <div className="space-y-8">
              <InitiationTab
                deviation={d}
                factoryId={factoryId}
                readOnly={!open || !reviewer}
              />
              <div className="border-t border-line-soft pt-6">
                <BatchHolds
                  deviation={d}
                  factoryId={factoryId}
                  canDecide={open && reviewer}
                  viewerName={viewerName}
                />
              </div>
              <div className="border-t border-line-soft pt-6">
                <CaseAttachments
                  factoryId={factoryId}
                  deviationId={d.id}
                  section="details"
                  userId={userId}
                  userName={viewerName}
                  canAttach={open && reviewer}
                />
              </div>
            </div>
          )}
          {section === "assessment" && (
            <AssessmentTab
              deviation={d}
              factoryId={factoryId}
              slug={slug}
              canEdit={open && reviewer}
              viewerName={viewerName}
            />
          )}
          {section === "investigation" &&
            (d.investigation_required === false ? (
              <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
                Investigation not required. Reason:{" "}
                {d.investigation_not_required_reason}
              </p>
            ) : (
              <DevInvestigationTab
                deviation={d}
                factoryId={factoryId}
                canEdit={open && reviewer}
                userId={userId}
                viewerName={viewerName}
              />
            ))}
          {section === "actions" && (
            <CapaTab
              deviation={d}
              factoryId={factoryId}
              readOnly={!open || !reviewer}
            />
          )}
          {section === "closeout" && (
            <DevCloseOutTab
              deviation={d}
              factoryId={factoryId}
              canEdit={reviewer}
              viewerName={viewerName}
            />
          )}
          {section === "history" && (
            <CaseHistory deviation={d} factoryId={factoryId} />
          )}
        </div>
      </div>
    </div>
  );
}

function HeadFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[6.5rem] px-4 first:pl-0 last:pr-0">
      <dd className="text-sm font-semibold whitespace-nowrap text-ink">{children}</dd>
      <dt className="mt-1 text-xs text-ink-5">{label}</dt>
    </div>
  );
}
