"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useWatch } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  CLASSES,
  CLASS_DUE_DAYS,
  NC_CATEGORIES,
  RED_FLAGS,
  assessmentSignSchema,
  proposedClass,
  type AssessmentValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { Segmented } from "@/components/factory/deviations/deviation-initiation-fields";
import {
  AREA,
  CONTROL,
  Fact,
  Field,
  Muted,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { SelectField } from "@/components/ui/select-field";
import { addDays, formatDateTime, formatDay } from "@/lib/factory/dates";
import {
  RISK_SCALES,
  assessmentValues,
  deviationKeys,
  saveAssessment,
  signAssessment,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * The reference QMS's severity anchors — each point something that can be
 * checked rather than a feeling.
 */
export const DEV_SEVERITY = [
  { value: "1", label: "1 — No product impact — documentation or GMP slip only" },
  { value: "2", label: "2 — Within specification; no effect on safety, efficacy or identity" },
  { value: "3", label: "3 — Out of specification, but recoverable or caught before release" },
  { value: "4", label: "4 — Could reach the market with reduced quality; complaint likely" },
  { value: "5", label: "5 — Patient safety risk, wrong product or label, or recall likely" },
];

/**
 * Detection as the control that would catch it before release — the control
 * is the evidence for the score. Stored as the 1–5 `detection` it implies.
 */
export const DEV_DETECTION = [
  { value: "1", label: "1 — Automated 100% check (checkweigher, vision, metal detector)" },
  { value: "2", label: "2 — 100% in-process check by an operator, under an SOP" },
  { value: "3", label: "3 — Sampling: in-process (IPC) or QC release testing" },
  { value: "4", label: "4 — Visual or occasional checks only" },
  { value: "5", label: "5 — Nothing would catch it before the customer" },
];

const LEVEL_TEXT: Record<string, string> = {
  Low: "text-teal-deep",
  Medium: "text-warn-deep",
  High: "font-semibold text-danger-deep",
};

const CLASS_TEXT: Record<string, string> = {
  Minor: "text-teal-deep",
  Major: "text-warn-deep",
  Critical: "font-semibold text-danger-deep",
};

function levelOf(sev: number, n: number): "Low" | "Medium" | "High" {
  if (sev === 5 || n >= 60) return "High";
  return n >= 20 ? "Medium" : "Low";
}

/**
 * Initial assessment — QA classifies the deviation, sets its owner, decides
 * whether it needs an investigation and scores the risk. Signing accepts it
 * into the quality system and sets the due date from the class.
 *
 * As the reference QMS lays it out (qms-v4), with one difference: likelihood
 * is this application's 1–5 dropdown, not counted from similar cases.
 *
 * It saves as a draft until it is signed; once signed it is read-only, and
 * `deviations_assessment_guard` refuses any change to it.
 */
export function AssessmentTab({
  deviation,
  factoryId,
  canEdit,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up, on an open case. */
  canEdit: boolean;
  viewerName: string;
}) {
  if (deviation.assessed_at || !canEdit) {
    return <AssessmentFacts deviation={deviation} />;
  }
  return (
    <AssessmentForm
      deviation={deviation}
      factoryId={factoryId}
      viewerName={viewerName}
    />
  );
}

function AssessmentForm({
  deviation,
  factoryId,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<AssessmentValues>({
    resolver: zodResolver(assessmentSignSchema),
    defaultValues: assessmentValues(deviation),
  });
  const { control, register, setValue, formState } = form;
  const errors = formState.errors;
  const [saving, setSaving] = useState(false);

  const values = useWatch({ control }) as AssessmentValues;
  const flags = values.redFlags ?? [];
  const sev = values.severity ? Number(values.severity) : null;
  const det = values.detection ? Number(values.detection) : null;
  const lik = values.likelihood ? Number(values.likelihood) : null;
  const score = sev && det && lik ? sev * det * lik : null;
  const level = score !== null && sev ? levelOf(sev, score) : null;
  const proposed = proposedClass({
    redFlags: flags,
    severity: values.severity ?? "",
    detection: values.detection ?? "",
    likelihood: values.likelihood ?? "",
  });
  const cls = values.classification;
  const dueOn = cls
    ? formatDay(addDays(deviation.created_at.slice(0, 10), CLASS_DUE_DAYS[cls]))
    : null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const sign = useMutation({
    mutationFn: (v: AssessmentValues) => {
      // The assessment should be independent of whoever raised the case. Said,
      // not enforced — for now the raiser may sign it, so it can be tested.
      const same = (a: string | null) => (a ?? "").trim().toLowerCase();
      if (same(viewerName) !== "" && same(viewerName) === same(deviation.raised_by)) {
        toast.warning(
          `You raised ${deviation.deviation_no} — another QA approver should normally sign its initial assessment.`,
        );
      }
      return signAssessment(deviation.id, v, viewerName);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(`Initial assessment of ${deviation.deviation_no} signed.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveDraft() {
    setSaving(true);
    try {
      await saveAssessment(deviation.id, form.getValues());
      await refresh();
      toast.success("Assessment saved — not signed yet.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(
        (v) => sign.mutateAsync(v).catch(() => {}),
        () =>
          requestAnimationFrame(() =>
            document
              .querySelector('main [role="alert"]')
              ?.scrollIntoView({ block: "center", behavior: "smooth" }),
          ),
      )}
      className="space-y-7"
    >
      <p className="rounded-xl border border-brand-soft bg-brand-tint px-4 py-3 text-sm text-brand-deep">
        QA reviews the case, classifies it and scores the risk. Signing accepts
        it into the quality system and sets the due date.
      </p>

      <Section title="Classification">
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <Field label="Category" htmlFor="as-category" required error={errors.category?.message}>
            <SelectControl
              control={control}
              name="category"
              id="as-category"
              placeholder="Select…"
              invalid={Boolean(errors.category)}
              options={NC_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Case owner" htmlFor="as-owner" required error={errors.ownerName?.message}>
            <input
              id="as-owner"
              placeholder="Who is carrying this case"
              aria-invalid={Boolean(errors.ownerName)}
              className={CONTROL}
              {...register("ownerName")}
            />
          </Field>
          <Field
            label="Investigation required?"
            required
            error={errors.investigationRequired?.message}
          >
            <Segmented
              control={control}
              name="investigationRequired"
              label="Investigation required?"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
          </Field>
          {values.investigationRequired === "no" ? (
            <Field
              label="Why not"
              htmlFor="as-inv-why"
              required
              error={errors.investigationNotRequiredReason?.message}
            >
              <textarea
                id="as-inv-why"
                rows={2}
                placeholder="e.g. Documentation slip, corrected at the time"
                className={AREA}
                {...register("investigationNotRequiredReason")}
              />
            </Field>
          ) : (
            <div />
          )}
        </div>
      </Section>

      <Section title="Red flags — escalate to QA manager">
        <Field label="Tick any that apply — most cases tick none" note="(optional)">
          <Controller
            name="redFlags"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {RED_FLAGS.map((f) => {
                  const on = field.value.includes(f);
                  return (
                    <label
                      key={f}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
                        on
                          ? "border-danger bg-danger-soft text-danger-deep"
                          : "border-line bg-surface text-ink-3 hover:border-line-strong",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = on
                            ? field.value.filter((x) => x !== f)
                            : [...field.value, f];
                          field.onChange(next);
                          // A red flag is severity 5 — the database says so too.
                          if (next.length > 0) {
                            setValue("severity", "5", {
                              shouldValidate: formState.isSubmitted,
                            });
                          }
                        }}
                        className="size-4 accent-danger"
                      />
                      {f}
                    </label>
                  );
                })}
              </div>
            )}
          />
        </Field>
        {flags.length > 0 && (
          <p className="mt-3 rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
            Red flag: severity is set to 5, so the case is Critical. Escalate it
            to the QA manager.
          </p>
        )}
      </Section>

      <Section title="Risk">
        {/* One row of three on a wide screen — the three factors of one
            product, read side by side; stacked on a narrow one. */}
        <div className="grid items-start gap-x-6 gap-y-5 lg:grid-cols-3">
          <Field
            label="Severity"
            htmlFor="as-sev"
            required
            error={errors.severity?.message}
            hint={
              flags.length > 0
                ? "Set to 5 by the red flag above. Untick the red flag to change it."
                : undefined
            }
          >
            <Controller
              name="severity"
              control={control}
              render={({ field }) => (
                <SelectField
                  id="as-sev"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  disabled={flags.length > 0}
                  placeholder="Select…"
                  ariaInvalid={Boolean(errors.severity)}
                  options={DEV_SEVERITY}
                />
              )}
            />
          </Field>
          <Field
            label="Which control would catch it before release?"
            htmlFor="as-det"
            required
            error={errors.detection?.message}
          >
            <SelectControl
              control={control}
              name="detection"
              id="as-det"
              placeholder="Select…"
              invalid={Boolean(errors.detection)}
              options={DEV_DETECTION}
            />
          </Field>
          <Field
            label="Likelihood"
            htmlFor="as-lik"
            required
            error={errors.likelihood?.message}
          >
            <SelectControl
              control={control}
              name="likelihood"
              id="as-lik"
              placeholder="Select…"
              invalid={Boolean(errors.likelihood)}
              options={RISK_SCALES.likelihood.options}
            />
          </Field>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
          <Out label="Severity × likelihood × detection">
            {sev ?? "—"} × {lik ?? "—"} × {det ?? "—"}
          </Out>
          <Out label="Risk score (1–125)">{score ?? "—"}</Out>
          <Out label="Level (20+ Medium, 60+ High)">
            <span className={level ? LEVEL_TEXT[level] : undefined}>
              {level ?? "—"}
            </span>
          </Out>
          <Out label="Proposed class · severity 4 is at least Major, 5 is Critical">
            <span className={proposed ? CLASS_TEXT[proposed] : undefined}>
              {proposed ?? "—"}
            </span>
          </Out>
        </div>

        <div className="mt-5 grid gap-x-6 gap-y-5 md:grid-cols-2">
          <Field
            label="Classification"
            required
            error={errors.classification?.message}
            hint={
              dueOn && cls
                ? `Due ${CLASS_DUE_DAYS[cls]} days after raising: ${dueOn}.`
                : undefined
            }
          >
            <Segmented
              control={control}
              name="classification"
              label="Classification"
              options={CLASSES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          {cls && proposed && cls !== proposed ? (
            <Field
              label={`Why ${cls}, not ${proposed}`}
              htmlFor="as-cls-why"
              required
              error={errors.classificationReason?.message}
            >
              <textarea
                id="as-cls-why"
                rows={2}
                className={AREA}
                {...register("classificationReason")}
              />
            </Field>
          ) : (
            <div />
          )}
          <Field
            label="Rationale"
            htmlFor="as-rationale"
            required={cls === "Critical" || cls === "Major"}
            note={cls === "Critical" || cls === "Major" ? undefined : "(optional)"}
            error={errors.rationale?.message}
            className="md:col-span-2"
          >
            <textarea
              id="as-rationale"
              rows={2}
              placeholder="One or two lines on why these scores"
              className={AREA}
              {...register("rationale")}
            />
          </Field>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
        <button
          type="submit"
          disabled={formState.isSubmitting || saving}
          className={PRIMARY_BUTTON}
        >
          {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Sign initial assessment
        </button>
        <button
          type="button"
          onClick={saveDraft}
          disabled={formState.isSubmitting || saving}
          className={SECONDARY_BUTTON}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save draft
        </button>
        <span className="text-[0.8125rem] text-ink-4">
          Signed as {viewerName || "you"}
        </span>
      </div>
    </form>
  );
}

/** A signed assessment, or one read by someone below supervisor. */
function AssessmentFacts({ deviation: d }: { deviation: Deviation }) {
  const sev = DEV_SEVERITY.find((o) => o.value === String(d.severity));
  const det = DEV_DETECTION.find((o) => o.value === String(d.detection));
  const lik = RISK_SCALES.likelihood.options.find(
    (o) => o.value === String(d.likelihood),
  );
  return (
    <div className="space-y-7">
      {d.assessed_at ? (
        <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
          <CheckCircle2 className="size-4 shrink-0" />
          Initial assessment signed by {d.assessed_by_name} ·{" "}
          {formatDateTime(d.assessed_at)}
        </p>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-4">
          Not assessed yet — a supervisor or QA signs the initial assessment.
        </p>
      )}
      <Section title="Classification">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Category">{d.nc_category ?? <Muted>—</Muted>}</Fact>
          <Fact label="Case owner">{d.owner_name ?? <Muted>—</Muted>}</Fact>
          <Fact label="Investigation required">
            {d.investigation_required === null ? (
              <Muted>—</Muted>
            ) : d.investigation_required ? (
              "Yes"
            ) : (
              "No"
            )}
          </Fact>
          {d.investigation_required === false && (
            <Fact label="Why not" wide>
              {d.investigation_not_required_reason}
            </Fact>
          )}
          <Fact label="Red flags" wide>
            {d.red_flags.length > 0 ? d.red_flags.join(", ") : <Muted>None</Muted>}
          </Fact>
        </dl>
      </Section>
      <Section title="Risk">
        <dl className="grid gap-3">
          <Fact label="Severity" wide>{sev?.label ?? <Muted>—</Muted>}</Fact>
          <Fact label="Control that would catch it" wide>
            {det?.label ?? <Muted>—</Muted>}
          </Fact>
          <Fact label="Likelihood" wide>{lik?.label ?? <Muted>—</Muted>}</Fact>
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
          <Out label="Risk score (1–125)">{d.risk_score ?? "—"}</Out>
          <Out label="Level">
            <span className={d.risk_conclusion ? LEVEL_TEXT[d.risk_conclusion] : undefined}>
              {d.risk_conclusion ?? "—"}
            </span>
          </Out>
          <Out label="Classification">
            <span className={d.classification ? CLASS_TEXT[d.classification] : undefined}>
              {d.classification ?? "—"}
            </span>
          </Out>
          <Out label="Due">{d.sla_date ? formatDay(d.sla_date) : "—"}</Out>
        </div>
        <dl className="mt-4 grid gap-3">
          {d.classification_reason && (
            <Fact label="Why this class" wide>{d.classification_reason}</Fact>
          )}
          <Fact label="Rationale" wide>
            {d.risk_description ?? <Muted>—</Muted>}
          </Fact>
        </dl>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line-soft pb-7 last:border-b-0 last:pb-0">
      <h3 className="mb-4 text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Out({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-lg font-semibold tabular-nums text-ink">{children}</p>
      <p className="mt-0.5 text-[0.6875rem] leading-snug text-ink-5">{label}</p>
    </div>
  );
}
