"use client";

import { isQmsCase } from "@/lib/factory/ncr";
import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";

import { AssessmentTab } from "@/components/factory/deviations/assessment-tab";
import { BatchHolds } from "@/components/factory/deviations/batch-holds";
import { CapaTab } from "@/components/factory/deviations/capa-tab";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import { CaseHistory } from "@/components/factory/deviations/case-history";
import { CloseOutFacts } from "@/components/factory/deviations/dev-closeout-tab";
import { InvestigationFacts } from "@/components/factory/deviations/dev-investigation-tab";
import { DueExtensions, useExtensions } from "@/components/factory/deviations/due-extensions";
import { CaseHeader } from "@/components/factory/deviations/deviation-case-page";
import { InitiationTab } from "@/components/factory/deviations/deviation-tab-forms";
import { attachmentKeys, fetchAttachments } from "@/lib/factory/attachment-queries";
import { auditKeys, fetchAudit } from "@/lib/factory/audit-queries";
import { capaKeys, fetchCapas } from "@/lib/factory/capa-queries";
import { formatDateTime } from "@/lib/factory/dates";
import { deviationKeys, fetchDeviations } from "@/lib/factory/deviation-queries";
import { fetchHolds, holdKeys } from "@/lib/factory/hold-queries";
import { useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { useRenderClock } from "@/lib/use-render-clock";

/**
 * A deviation as one printable document — the reference QMS's "Print report"
 * (qms-v5): the case header, then every section of the case one after the
 * other, read-only, and a footer saying who printed it and when. The browser's
 * print dialog prints it or saves it as a PDF.
 *
 * Every section is the case page's own read-only view, so the report always
 * says what the screen says. Investigation and Close-out have text views of
 * their own (`InvestigationFacts`, `CloseOutFacts`): their locked forms are
 * disabled inputs, which clip long answers on paper.
 *
 * The print button waits for the sections' own data (holds, files, audit
 * trail, CAPAs), so a report printed straight away is not missing them. The
 * queries share the sections' keys: they load once.
 */
export function DeviationReport({
  factoryId,
  factoryName,
  slug,
  caseId,
  viewerName,
}: {
  factoryId: string;
  factoryName: string;
  slug: string;
  caseId: string;
  viewerName: string;
}) {
  const { data: deviations, isPending, isError, error } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });
  const holds = useQuery({
    queryKey: holdKeys.forCase(factoryId, caseId),
    queryFn: () => fetchHolds(caseId),
  });
  const files = useQuery({
    queryKey: attachmentKeys.forCase(factoryId, caseId),
    queryFn: () => fetchAttachments(caseId),
  });
  const audit = useQuery({
    queryKey: auditKeys.forCase(factoryId, caseId),
    queryFn: () => fetchAudit(caseId),
  });
  const capas = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });

  const settings = useQualitySettings(factoryId);
  const extensions = useExtensions(factoryId, caseId);
  const d = deviations?.find((x) => x.id === caseId) ?? null;
  const caseHref = `/factory/${slug}/deviations/${caseId}`;
  const caseLink = (t: string) => (t === "ncr" ? `${caseHref}?tab=ncr` : caseHref);

  // The document title is the PDF's default file name.
  const docTitle = d ? `${d.deviation_no} — ${d.title}` : null;
  useEffect(() => {
    if (!docTitle) return;
    const before = document.title;
    document.title = docTitle;
    return () => {
      document.title = before;
    };
  }, [docTitle]);

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
  if (!d || !isQmsCase(d)) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
        <p className="text-sm text-ink-3">This deviation could not be found.</p>
        <Link
          href={`/factory/${slug}/deviations`}
          className="mt-2 inline-block text-sm text-brand hover:underline"
        >
          Back to Deviations
        </Link>
      </div>
    );
  }

  const ready =
    !holds.isPending &&
    !files.isPending &&
    !audit.isPending &&
    !capas.isPending &&
    !extensions.isPending;

  return (
    <div className="case-report mx-auto w-full max-w-[64rem]">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={caseLink(d.type)} className="text-sm text-brand hover:underline">
          Back to <span className="font-mono">{d.deviation_no}</span>
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!ready}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
        >
          {ready ? <Printer className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          Print or save as PDF
        </button>
      </div>

      <article className="mt-3 rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-8 print:mt-0 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <p className="text-[0.6875rem] font-bold tracking-[0.09em] text-ink-4 uppercase">
          {factoryName} · {d.type === "ncr" ? "Non-conformance report" : "Deviation report"}
        </p>
        <CaseHeader
          deviation={d}
          capa={(capas.data ?? []).find((c) => c.id === d.capa_id) ?? null}
          assessDays={settings.assessDays}
          extended={(extensions.data ?? []).some((e) => e.status === "approved")}
          className="mt-3"
        />

        <ReportSection title="Details">
          <div className="space-y-8">
            <InitiationTab deviation={d} factoryId={factoryId} readOnly />
            <BatchHolds
              deviation={d}
              factoryId={factoryId}
              canDecide={false}
              viewerName={viewerName}
            />
            <CaseAttachments
              factoryId={factoryId}
              deviationId={d.id}
              section="details"
              userId=""
              userName={viewerName}
              canAttach={false}
            />
          </div>
        </ReportSection>

        <ReportSection title="Assessment">
          <AssessmentTab
            deviation={d}
            factoryId={factoryId}
            slug={slug}
            canEdit={false}
            viewerName={viewerName}
          />
        </ReportSection>

        <ReportSection title="Investigation">
          {d.investigation_required === false ? (
            <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
              Investigation not required. Reason: {d.investigation_not_required_reason}
            </p>
          ) : (
            <div className="space-y-7">
              <InvestigationFacts deviation={d} />
              <CaseAttachments
                factoryId={factoryId}
                deviationId={d.id}
                section="investigation"
                userId=""
                userName={viewerName}
                canAttach={false}
              />
            </div>
          )}
        </ReportSection>

        <ReportSection title="Actions">
          <CapaTab deviation={d} factoryId={factoryId} readOnly />
        </ReportSection>

        <ReportSection title="Close-out">
          <CloseOutFacts deviation={d} />
        </ReportSection>

        <ReportSection title="History">
          <CaseHistory
            deviation={d}
            factoryId={factoryId}
            extensions={
              <DueExtensions
                deviation={d}
                factoryId={factoryId}
                canDecide={false}
                viewerName={viewerName}
              />
            }
          />
        </ReportSection>

        <PrintedBy viewerName={viewerName} />
      </article>
    </div>
  );
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t-2 border-line pt-6">
      <h2 className="mb-5 text-lg font-semibold text-ink break-after-avoid">{title}</h2>
      {children}
    </section>
  );
}

/** Read through the render clock, so it is the time now, not at mount. */
function PrintedBy({ viewerName }: { viewerName: string }) {
  const at = useRenderClock(() => formatDateTime(new Date().toISOString()));
  return (
    <p className="mt-8 border-t border-line-soft pt-4 text-xs text-ink-5">
      Printed by {viewerName} on {at} from FactoryOS. Uncontrolled when printed.
    </p>
  );
}
