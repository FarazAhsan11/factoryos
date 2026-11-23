"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Clock,
  Loader2,
  Lock,
  Minus,
  Package,
  Printer,
  UserRound,
} from "lucide-react";

import { AssessmentTab } from "@/components/factory/deviations/assessment-tab";
import { BatchHolds } from "@/components/factory/deviations/batch-holds";
import { CapaTab } from "@/components/factory/deviations/capa-tab";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import { DevCloseOutTab } from "@/components/factory/deviations/dev-closeout-tab";
import {
  DueExtensions,
  ExtendDueDialog,
  canRequestExtension,
  useExtensions,
} from "@/components/factory/deviations/due-extensions";
import { DevInvestigationTab } from "@/components/factory/deviations/dev-investigation-tab";
import { CaseHistory } from "@/components/factory/deviations/case-history";
import { InitiationTab } from "@/components/factory/deviations/deviation-tab-forms";
import { NcrCompleteDetails } from "@/components/factory/deviations/ncr-complete-details";
import { ComplaintCommunication } from "@/components/factory/deviations/complaint-details";
import { canReview } from "@/lib/factory/action-queries";
import type { FactoryRole } from "@/lib/factory/context";
import { capaKeys, fetchCapas, stepLabel, type Capa } from "@/lib/factory/capa-queries";
import { addDays, formatDateTime, formatDay } from "@/lib/factory/dates";
import {
  DEV_STAGE_DOT,
  devRiskLabel,
  devStage,
  deviationKeys,
  ncrNeedsDetails,
  typeActsDone,
  fetchDeviations,
  nextStep,
  typeMeta,
  type CaseSection,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { fetchHolds, holdKeys } from "@/lib/factory/hold-queries";
import { isMaterialItem, partyWord } from "@/lib/factory/ncr";
import { useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { cn } from "@/lib/utils";

const SECTIONS: { id: CaseSection; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "assessment", label: "Assessment" },
  { id: "investigation", label: "Investigation" },
  { id: "actions", label: "Actions" },
  { id: "closeout", label: "Close-out" },
  { id: "history", label: "History" },
];

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
      if (d.type === "complaint") {
        return d.received_on && d.received_via && d.complainant && d.sponsor && d.sample
          ? "ok"
          : "todo";
      }
      if (d.type === "ncr") {
        return d.occurred_at &&
          d.department_id &&
          d.detection_point &&
          (d.specification ?? "").trim() &&
          (d.immediate_action ?? "").trim() &&
          d.hold_batch !== null
          ? "ok"
          : "todo";
      }
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
      return (d.capa_needed === false ||
        (d.capa_needed && Boolean(d.capa_plan_approved_at))) &&
        typeActsDone(d)
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
  const settings = useQualitySettings(factoryId);
  // Due date extensions (0072), for the header, the banner and the button.
  const { data: extensions = [] } = useExtensions(factoryId, caseId);
  const [extending, setExtending] = useState(false);
  // The linked CAPA's step, for the header (P3) — the register's cached list.
  const { data: capas = [] } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
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
  // A deviation, or an NCR raised on the qms-v12 form (0076). An NCR raised
  // before, and a complaint, open in the case dialog on the register — a
  // link here sends them on to it.
  if (!d) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
        <p className="text-sm text-ink-3">This case could not be found.</p>
        <Link href={listHref} className="mt-2 inline-block text-sm text-brand hover:underline">
          Back to the register
        </Link>
      </div>
    );
  }

  const ncr = d.type === "ncr";
  const material = ncr && isMaterialItem(d.nc_item);
  const complaint = d.type === "complaint";
  const tabParam = ncr ? "?tab=ncr" : complaint ? "?tab=complaints" : "";
  const registerHref = `${listHref}${tabParam}`;

  const reviewer = canReview(role);
  const open = d.status === "open";
  const next = nextStep(d);
  const onHold = holds
    .filter((h) => h.status === "on_hold" && h.kind === "batch")
    .map((h) => h.batch_no);
  const lotsHeld = holds
    .filter((h) => h.status === "on_hold" && h.kind === "lot")
    .map((h) => h.batch_no);
  const released = holds.filter((h) => h.status === "released").map((h) => h.batch_no);
  const pendingExtension = extensions.find((e) => e.status === "requested") ?? null;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
          <Link href={registerHref} className="text-brand hover:underline">
            {ncr ? "Non-conformances" : complaint ? "Customer complaints" : "Deviations"}
          </Link>
          <span className="mx-1.5 text-ink-5">/</span>
          <span className="font-mono">{d.deviation_no}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href={`${listHref}/${d.id}/print${tabParam}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Printer className="size-4" />
            Print report
          </Link>
        </div>
      </div>
      <ExtendDueDialog
        deviation={d}
        factoryId={factoryId}
        viewerName={viewerName}
        open={extending}
        onOpenChange={setExtending}
      />

      <div className="mt-3 rounded-2xl border border-line bg-surface shadow-soft">
        <CaseHeader
          deviation={d}
          capa={capas.find((c) => c.id === d.capa_id) ?? null}
          capaHref={d.capa_id ? `/factory/${slug}/deviations/capa/${d.capa_id}` : undefined}
          assessDays={settings.assessDays}
          ackDays={settings.ackDays}
          extended={extensions.some((e) => e.status === "approved")}
          onExtend={
            reviewer && canRequestExtension(d, extensions)
              ? () => setExtending(true)
              : undefined
          }
          className="px-5 pt-5 sm:px-7 sm:pt-6"
        />

        <div className="space-y-3 px-5 pt-5 sm:px-7">
          {open && pendingExtension && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink">
              <span>
                Due date extension to{" "}
                <span className="font-semibold">{formatDay(pendingExtension.to_date)}</span>{" "}
                requested by {pendingExtension.requested_by_name ?? "—"} — waiting for
                QA to approve or reject it.
              </span>
              {section !== "history" && (
                <button
                  type="button"
                  onClick={() => setSection("history")}
                  className="rounded-lg border border-warn-line bg-surface px-3 py-1.5 text-xs font-semibold text-warn-ink transition hover:border-warn"
                >
                  Go to History
                </button>
              )}
            </div>
          )}
          {open && material && lotsHeld.length > 0 ? (
            <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep">
              Lot {lotsHeld.join(", ")} in quarantine — labelled “Quarantine —
              do not use”; it cannot be issued until QA records the disposition
              (Actions).
              {onHold.length > 0 &&
                ` Batch ${onHold.join(", ")} on hold — production work is blocked in the shift log.`}
            </p>
          ) : open && onHold.length > 0 ? (
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
          <LockedBanner deviation={d} section={section} className="mb-6" />
          {section === "details" && (
            <div className="space-y-8">
              {complaint && (
                <ComplaintCommunication
                  deviation={d}
                  factoryId={factoryId}
                  canEdit={open && reviewer}
                  viewerName={viewerName}
                />
              )}
              {reviewer && ncrNeedsDetails(d) ? (
                <NcrCompleteDetails deviation={d} factoryId={factoryId} viewerName={viewerName} />
              ) : (
                <InitiationTab
                  deviation={d}
                  factoryId={factoryId}
                  readOnly={!open || !reviewer}
                />
              )}
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
              hideSignature
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
              viewerName={viewerName}
              userId={userId}
            />
          )}
          {section === "closeout" && d.not_case_reason && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
                <Check className="size-4 shrink-0" />
                {d.status_reason ?? "Closed — not a case"} — closed by {d.qa_sign_name ?? "—"}
                {d.closed_at && ` · ${formatDateTime(d.closed_at)}`}
              </p>
              <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
                Reason: {d.not_case_reason}
              </p>
            </div>
          )}
          {section === "closeout" && !d.not_case_reason && (
            <DevCloseOutTab
              deviation={d}
              factoryId={factoryId}
              canEdit={reviewer}
              viewerName={viewerName}
            />
          )}
          {section === "history" && (
            <CaseHistory
              deviation={d}
              factoryId={factoryId}
              extensions={
                <DueExtensions
                  deviation={d}
                  factoryId={factoryId}
                  canDecide={open && reviewer}
                  viewerName={viewerName}
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What locked a section — the signature that fixed it, by whom and when — or
 * null while it can still be edited.
 */
function lockOf(
  d: Deviation,
  section: CaseSection,
): { what: string; by: string | null; at: string } | null {
  switch (section) {
    case "details":
    case "assessment":
      return d.assessed_at
        ? {
            what: section === "details" ? "signed with the initial assessment" : "signed",
            by: d.assessed_by_name,
            at: d.assessed_at,
          }
        : null;
    case "investigation":
      return d.investigation_approved_at
        ? {
            what: "approved",
            by: d.investigation_approved_by_name,
            at: d.investigation_approved_at,
          }
        : null;
    case "closeout":
      if (d.status === "closed" && d.closed_at) {
        return { what: "closed", by: d.qa_sign_name, at: d.closed_at };
      }
      return d.close_first_signed_at
        ? {
            what: "first signature",
            by: d.close_first_signed_by_name,
            at: d.close_first_signed_at,
          }
        : null;
    default:
      return null;
  }
}

/**
 * "Locked — signed … by M. Lee on 20 Nov 2026, 01:57." above a signed
 * section.
 *
 * Placeholder: "Correct this section" does nothing yet. It marks where a
 * correction with a reason (a new version of the section, kept in the audit
 * trail) will start.
 */
function LockedBanner({
  deviation,
  section,
  className,
}: {
  deviation: Deviation;
  section: CaseSection;
  className?: string;
}) {
  const lock = lockOf(deviation, section);
  if (!lock) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3",
        className,
      )}
    >
      <span className="inline-flex items-start gap-2">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-warn-deep" />
        <span>
          <span className="font-semibold text-ink">Locked</span> — {lock.what}
          {lock.by && ` by ${lock.by}`} on {formatDateTime(lock.at)}. To fix a
          mistake, correct it with a reason.
        </span>
      </span>
      <button
        type="button"
        aria-disabled
        title="Coming soon"
        className="cursor-not-allowed rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-3"
      >
        Correct this section
      </button>
    </div>
  );
}

/**
 * The case's title, what identifies it, and five facts — stage, class, risk,
 * due (or closed) date and owner. Shared by the case page and its printed
 * report, so the two always agree.
 */
export function CaseHeader({
  deviation: d,
  capa = null,
  capaHref,
  assessDays,
  ackDays = 2,
  extended = false,
  onExtend,
  className,
}: {
  deviation: Deviation;
  /** The linked CAPA, for its step under its number (P3). */
  capa?: Capa | null;
  /** Where the CAPA number links; absent in print. */
  capaHref?: string;
  /** Days QA has to sign the initial assessment — Configuration → Quality settings. */
  assessDays: number;
  /** Days to acknowledge a complaint — Configuration → Quality settings (0079). */
  ackDays?: number;
  /** An approved due date extension moved the due date (0072). */
  extended?: boolean;
  /** Shows "Extend" under the due date; absent when it cannot be asked (or in print). */
  onExtend?: () => void;
  className?: string;
}) {
  const open = d.status === "open";
  const stage = devStage(d);
  const batches = d.batch_nos.length > 0 ? d.batch_nos : d.batch_no ? [d.batch_no] : [];
  // A complaint counts from the day it was received (0079).
  const start = d.type === "complaint" && d.received_on ? d.received_on : d.created_at.slice(0, 10);
  const assessBy = addDays(start, assessDays);
  const type = typeMeta(d.type);
  return (
    <header
      className={cn(
        "grid gap-x-10 gap-y-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-sunken px-2 py-0.5 font-mono text-xs font-medium text-ink-3">
            {d.deviation_no}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", type.pill)}>
            {d.type === "ncr"
              ? "Non-conformance"
              : d.type === "complaint"
                ? "Customer complaint"
                : `${type.short} deviation`}
          </span>
          {d.type === "ncr" && d.nc_item && (
            <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-xs font-semibold text-ink-3">
              {d.nc_item === "Other" ? (d.nc_item_other ?? "Other") : d.nc_item}
            </span>
          )}
          {!open && (
            <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-xs font-semibold text-ink-4">
              Closed
            </span>
          )}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight break-words text-ink sm:text-2xl">
          {d.title}
        </h1>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-4">
          <MetaItem icon={UserRound} label="Raised by">
            {d.raised_by ?? "—"}
            {/* The raise date only when it differs from when it happened —
                found on the night shift, raised next morning. */}
            {(!d.occurred_at ||
              formatDay(d.occurred_at) !== formatDay(d.created_at)) && (
              <span className="text-ink-5"> · raised {formatDay(d.created_at)}</span>
            )}
          </MetaItem>
          {d.occurred_at && (
            <MetaItem icon={Clock} label={d.type === "ncr" ? "Found" : "Happened"}>
              {formatDay(d.occurred_at)}
            </MetaItem>
          )}
          {d.type === "complaint" && d.received_on && (
            <MetaItem icon={Clock} label="Received">
              received {formatDay(d.received_on)}
              {d.complainant && (
                <span className="text-ink-5"> from {d.complainant.toLowerCase()}</span>
              )}
            </MetaItem>
          )}
          {d.type === "complaint" && d.batch_nos.length === 0 && d.product_label && (
            <MetaItem icon={Package} label="Product">
              {d.product_label}
            </MetaItem>
          )}
          {d.material_code && (
            <MetaItem icon={Package} label="Material">
              <span className="font-mono text-ink-3">{d.material_code}</span>
              {d.supplier_lots.length > 0 && (
                <span className="text-ink-5">
                  {" "}· lot <span className="font-mono">{d.supplier_lots.join(", ")}</span>
                </span>
              )}
              {d.supplier_name && (
                <span className="text-ink-5">
                  {" "}· {d.supplier_name}
                  {d.supplied_by === "customer" && ` (${partyWord(d.supplied_by)})`}
                </span>
              )}
            </MetaItem>
          )}
          {d.department_name && (
            <MetaItem icon={Building2} label="Department">
              {d.department_name}
              {d.location && <span className="text-ink-5"> · {d.location}</span>}
            </MetaItem>
          )}
          {batches.length > 0 && (
            <MetaItem icon={Package} label={batches.length > 1 ? "Batches" : "Batch"}>
              <span className="font-mono text-ink-3">{batches.join(", ")}</span>
              {d.product_names.length > 0 && (
                <span className="text-ink-5"> · {d.product_names.join(", ")}</span>
              )}
            </MetaItem>
          )}
        </ul>
      </div>

      <dl className="flex flex-wrap gap-y-3 divide-x divide-line-soft xl:flex-nowrap xl:justify-end">
        <HeadFact label="Stage">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", DEV_STAGE_DOT[stage])} />
            {stage}
          </span>
        </HeadFact>
        {/* Class, risk and owner come with the initial assessment — not
            shown as "—" before it (P3). */}
        {d.assessed_at && (
          <>
            <HeadFact label="Class">
              <span className={d.classification ? CLASS_TEXT[d.classification] : undefined}>
                {d.classification ?? "—"}
              </span>
            </HeadFact>
            <HeadFact label="Risk">{devRiskLabel(d) ?? "—"}</HeadFact>
          </>
        )}
        {d.capa_id && (
          <HeadFact label={capa ? stepLabel(capa) : "CAPA"}>
            {capaHref ? (
              <Link href={capaHref} className="font-mono text-brand hover:underline">
                {capa?.capa_no ?? d.capa_no}
              </Link>
            ) : (
              <span className="font-mono">{capa?.capa_no ?? d.capa_no}</span>
            )}
          </HeadFact>
        )}
        <HeadFact
          label={
            !open ? (
              "Closed"
            ) : d.assessed_at ? (
              onExtend ? (
                <>
                  Due ·{" "}
                  <button
                    type="button"
                    onClick={onExtend}
                    className="font-medium text-brand hover:underline"
                  >
                    Extend
                  </button>
                </>
              ) : (
                "Due"
              )
            ) : (
              "Assess by"
            )
          }
        >
          {!open ? (
            <span className="text-ink-4">{d.closed_at ? formatDay(d.closed_at) : "—"}</span>
          ) : d.assessed_at ? (
            <span className={cn(d.is_overdue && "text-danger-deep")}>
              {d.sla_date ? formatDay(d.sla_date) : "—"}
              {extended && (
                <span className="ml-1 font-normal text-ink-5" title="Extended">
                  (ext.)
                </span>
              )}
            </span>
          ) : (
            formatDay(assessBy)
          )}
        </HeadFact>
        {d.assessed_at && <HeadFact label="Owner">{d.owner_name ?? "—"}</HeadFact>}
        {/* A complaint's acknowledgement is due from day one (0079). */}
        {d.type === "complaint" && open && !d.ack_on && (
          <HeadFact label="Acknowledge by">
            <span className="text-warn-deep">{formatDay(addDays(start, ackDays))}</span>
          </HeadFact>
        )}
      </dl>
    </header>
  );
}

function MetaItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="inline-flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-3.5 shrink-0 text-ink-5" />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function HeadFact({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[6.5rem] px-4 first:pl-0 last:pr-0">
      <dd className="text-sm font-semibold whitespace-nowrap text-ink">{children}</dd>
      <dt className="mt-1 text-xs text-ink-5">{label}</dt>
    </div>
  );
}
