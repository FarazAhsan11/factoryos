"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { AssessmentValues } from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Muted,
  SECONDARY_BUTTON,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { Segmented } from "@/components/factory/deviations/deviation-initiation-fields";
import { DateField } from "@/components/ui/date-picker";
import {
  REPORT_TYPES,
  STOCK_AFFECTED,
  regulatorOf,
  reportTriggerReason,
  urgentComplaint,
} from "@/lib/factory/complaint";
import { formatDay } from "@/lib/factory/dates";
import {
  deviationKeys,
  notifyDue,
  reportDueFor,
  saveComplaintReporting,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

const todayKey = () => {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

/**
 * Market impact and reporting (qms-v12 "v11"), on a complaint's initial
 * assessment: could released stock be affected; when the customer is the
 * sponsor, when they were notified (due 1 day with an adverse reaction or red
 * flag, else 3 — Quality settings); and a regulator report, asked only when
 * an adverse reaction, a red flag or suspected counterfeit points to it.
 */
export function ComplaintReportingFields({
  form,
  deviation: d,
  factoryId,
}: {
  form: UseFormReturn<AssessmentValues>;
  deviation: Deviation;
  factoryId: string;
}) {
  const { control, register, setValue, getValues, formState } = form;
  const errors = formState.errors;
  const settings = useQualitySettings(factoryId);
  const today = useRenderClock(todayKey);
  const redFlags = useWatch({ control, name: "redFlags" }) ?? [];
  const category = useWatch({ control, name: "category" });
  const stock = useWatch({ control, name: "stockAffected" });
  const notified = useWatch({ control, name: "sponsorNotifiedOn" });
  const reportable = useWatch({ control, name: "reportable" });
  const reportType = useWatch({ control, name: "reportType" });
  const reg = regulatorOf(d.country);
  const live = { ...d, red_flags: redFlags as string[], nc_category: category || null };
  const triggered =
    d.adverse_reaction === true ||
    redFlags.length > 0 ||
    category === "Suspected counterfeit or tampering";
  const urgent = urgentComplaint(live);
  const due = notifyDue(live, { urgent: settings.notifyUrgentDays, other: settings.notifyDays });

  // Choosing the report type sets its due date (it can still be changed).
  useEffect(() => {
    if (reportType && !getValues("reportDue")) {
      setValue(
        "reportDue",
        reportDueFor(d, reportType, {
          serious: settings.tgaSeriousDays,
          other: settings.tgaOtherDays,
        }),
      );
    }
  }, [reportType, d, settings, getValues, setValue]);

  return (
    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
      <Field
        label="Could released stock be affected?"
        required
        error={errors.stockAffected?.message}
        hint={
          stock && stock !== "No"
            ? "Decide the market action on the Actions tab. If in doubt, quarantine the stock now."
            : "Other units or batches already with customers."
        }
      >
        <Segmented
          control={control}
          name="stockAffected"
          label="Could released stock be affected?"
          options={STOCK_AFFECTED.map((s) => ({ value: s, label: s }))}
        />
      </Field>
      <div className="hidden md:block" />

      {d.sponsor === "customer" ? (
        <>
          <Field
            label={`${d.customer_name || "The customer"} (sponsor) notified on`}
            htmlFor="as-notified"
          >
            <DateControl control={control} name="sponsorNotifiedOn" id="as-notified" />
            {!notified && (
              <p
                className={cn(
                  "text-[0.6875rem] leading-snug",
                  today > due ? "font-semibold text-danger-deep" : "text-warn-ink",
                )}
              >
                Due {formatDay(due)}: within{" "}
                {urgent ? settings.notifyUrgentDays : settings.notifyDays} day
                {(urgent ? settings.notifyUrgentDays : settings.notifyDays) === 1 ? "" : "s"} of
                receipt{urgent ? " (adverse reaction or red flag)" : ""}, per the quality agreement.
              </p>
            )}
          </Field>
          <div className="hidden md:block" />
        </>
      ) : d.sponsor === "us" ? (
        <p className="rounded-xl border border-line-soft bg-sunken px-4 py-2.5 text-xs text-ink-3 md:col-span-2">
          We are the sponsor for this product: any regulator report is ours.
        </p>
      ) : null}

      {triggered ? (
        <>
          <Field
            label={`Report to the ${reg} needed?`}
            required
            error={errors.reportable?.message}
            hint={`Asked because ${reportTriggerReason(live)}.`}
          >
            <Segmented
              control={control}
              name="reportable"
              label="Report needed?"
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
            />
          </Field>
          {reportable === "no" ? (
            <Field label="Why not" htmlFor="as-report-why" required error={errors.reportReason?.message}>
              <textarea id="as-report-why" rows={2} className={AREA} {...register("reportReason")} />
            </Field>
          ) : reportable === "yes" ? (
            <Field
              label="Report type"
              htmlFor="as-report-type"
              required
              error={errors.reportType?.message}
              hint={`Serious: ${settings.tgaSeriousDays} calendar days from receipt. Other: ${settings.tgaOtherDays} days.`}
            >
              <SelectControl
                control={control}
                name="reportType"
                id="as-report-type"
                placeholder="Select…"
                invalid={Boolean(errors.reportType)}
                options={REPORT_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
          ) : (
            <div className="hidden md:block" />
          )}
          {reportable === "yes" && (
            <>
              <Field
                label="Report due"
                htmlFor="as-report-due"
                required
                error={errors.reportDue?.message}
                hint={d.sponsor === "customer" ? "The sponsor submits it; record their confirmation." : undefined}
              >
                <DateControl control={control} name="reportDue" id="as-report-due" />
              </Field>
              <Field label="Date reported" htmlFor="as-reported" note="(optional)">
                <DateControl control={control} name="reportedOn" id="as-reported" />
              </Field>
              <Field label={`${reg} reference`} htmlFor="as-report-ref" note="(optional)">
                <input id="as-report-ref" className={CONTROL} {...register("reportRef")} />
              </Field>
              <div className="hidden md:block" />
            </>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-line-soft bg-sunken px-4 py-2.5 text-xs text-ink-3 md:col-span-2">
          No {reg} report expected: no adverse reaction, red flag, counterfeit or
          market action. This question appears if one is recorded.
        </p>
      )}
    </div>
  );
}

/**
 * After the assessment is signed, its market impact and reporting read as
 * facts — and the two dates that come later (the sponsor notified, the report
 * made) are still recorded here.
 */
export function ComplaintReportingFacts({
  deviation: d,
  factoryId,
  canEdit,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const settings = useQualitySettings(factoryId);
  const today = useRenderClock(todayKey);
  const reg = regulatorOf(d.country);
  const [notifiedOn, setNotifiedOn] = useState(d.sponsor_notified_on ?? "");
  const [reportedOn, setReportedOn] = useState(d.reported_on ?? "");
  const [reportRef, setReportRef] = useState(d.report_ref ?? "");
  const [busy, setBusy] = useState(false);
  const due = notifyDue(d, { urgent: settings.notifyUrgentDays, other: settings.notifyDays });
  const open = d.status === "open";
  const editable = canEdit && open;
  const askNotify = d.sponsor === "customer";
  const askReport = d.reportable === true;

  async function save() {
    setBusy(true);
    try {
      await saveComplaintReporting(d.id, { sponsorNotifiedOn: notifiedOn, reportedOn, reportRef });
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Released stock affected">{d.stock_affected ?? <Muted>—</Muted>}</Fact>
        <Fact label={`Report to the ${reg}`}>
          {d.reportable === null ? (
            <Muted>Not in question</Muted>
          ) : d.reportable ? (
            `Yes — ${d.report_type ?? ""}, due ${d.report_due ? formatDay(d.report_due) : "—"}`
          ) : (
            "No"
          )}
        </Fact>
        {d.reportable === false && (
          <Fact label="Why not" wide>
            {d.report_reason ?? <Muted>—</Muted>}
          </Fact>
        )}
      </dl>
      {(askNotify || askReport) && (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {askNotify && (
            <Field label={`${d.customer_name || "The customer"} (sponsor) notified on`} htmlFor="rp-notified">
              {editable ? (
                <DateField id="rp-notified" value={notifiedOn} onChange={setNotifiedOn} />
              ) : (
                <p className="text-sm">{d.sponsor_notified_on ? formatDay(d.sponsor_notified_on) : <Muted>Not recorded</Muted>}</p>
              )}
              {!d.sponsor_notified_on && open && (
                <p className={cn("text-[0.6875rem]", today > due ? "font-semibold text-danger-deep" : "text-warn-ink")}>
                  Due {formatDay(due)}
                </p>
              )}
            </Field>
          )}
          {askReport && (
            <>
              <Field label="Date reported" htmlFor="rp-reported">
                {editable ? (
                  <DateField id="rp-reported" value={reportedOn} onChange={setReportedOn} />
                ) : (
                  <p className="text-sm">{d.reported_on ? formatDay(d.reported_on) : <Muted>Not recorded</Muted>}</p>
                )}
              </Field>
              <Field label={`${reg} reference`} htmlFor="rp-ref">
                {editable ? (
                  <input id="rp-ref" value={reportRef} onChange={(e) => setReportRef(e.target.value)} className={CONTROL} />
                ) : (
                  <p className="text-sm">{d.report_ref ?? <Muted>—</Muted>}</p>
                )}
              </Field>
            </>
          )}
        </div>
      )}
      {editable && (askNotify || askReport) && (
        <button type="button" onClick={save} disabled={busy} className={SECONDARY_BUTTON}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Save notification dates
        </button>
      )}
    </div>
  );
}
