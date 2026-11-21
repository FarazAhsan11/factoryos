"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  CLASSES,
  DEV_LIKELIHOOD,
  DEV_LIKELIHOOD_HELP,
  DEV_SEVERITY,
  DEV_SEVERITY_EXAMPLES,
  NC_CATEGORIES,
  PREVIOUS_WINDOW_MONTHS,
  RED_FLAGS,
  RISK_MATRIX,
  SEVERITY_ROWS,
  assessmentSignSchema,
  proposedClass,
  severityRow,
  suggestedLikelihood,
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
  fetchDeviations,
  isLegacyRisk,
  saveAssessment,
  signAssessment,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { dueDaysFor, useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

const SEVERITY_OPTIONS = DEV_SEVERITY.map((label, i) => ({
  value: String(i + 1),
  label: `${i + 1} — ${label}`,
}));

/** The severity and detection scales of an assessment signed before 0068. */
const LEGACY_SEVERITY = [
  "No product impact — documentation or GMP slip only",
  "Within specification; no effect on safety, efficacy or identity",
  "Out of specification, but recoverable or caught before release",
  "Could reach the market with reduced quality; complaint likely",
  "Patient safety risk, wrong product or label, or recall likely",
];
const LEGACY_DETECTION = [
  "Automated 100% check (checkweigher, vision, metal detector)",
  "100% in-process check by an operator, under an SOP",
  "Sampling: in-process (IPC) or QC release testing",
  "Visual or occasional checks only",
  "Nothing would catch it before the customer",
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

/** A matrix cell, tinted by its class. */
const CLASS_CELL: Record<string, string> = {
  Minor: "bg-teal-soft text-teal-deep",
  Major: "bg-warn-tint text-warn-deep",
  Critical: "bg-danger-soft text-danger-deep",
};

const DAY_MS = 86_400_000;

/** Where a case opens: a deviation's page, or the register's case dialog. */
function caseHref(slug: string, c: Deviation): string {
  if (c.type === "planned" || c.type === "unplanned") {
    return `/factory/${slug}/deviations/${c.id}`;
  }
  return `/factory/${slug}/deviations?tab=${c.type === "ncr" ? "ncr" : "complaints"}&case=${c.id}`;
}

/** What the previous-case search looks through. */
function haystack(c: Deviation): string {
  return [
    c.deviation_no,
    c.title,
    c.actual,
    c.product_names.join(" "),
    c.product_name,
    c.batch_nos.join(" "),
    c.batch_no,
    c.raw_material_code,
    c.raw_material_name,
    c.equipment_no,
    c.equipment_name,
    c.root_cause,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Initial assessment — QA classifies the deviation, sets its owner, decides
 * whether it needs an investigation and scores the risk. Signing accepts it
 * into the quality system and sets the due date from the class.
 *
 * The risk is the reference QMS's (qms-v5, migration 0068): severity 1–5 and
 * likelihood 1–3, read against one table for the class. The likelihood is
 * backed by evidence — the previous cases of the same problem, picked from
 * every case in the factory, or a tick that none was found — and the picked
 * cases suggest the likelihood. Detection is not asked.
 *
 * It saves as a draft until it is signed; once signed it is read-only, and
 * `deviations_assessment_guard` refuses any change to it.
 */
export function AssessmentTab({
  deviation,
  factoryId,
  slug,
  canEdit,
  viewerName,
  hideSignature = false,
}: {
  deviation: Deviation;
  factoryId: string;
  slug: string;
  /** Supervisor and up, on an open case. */
  canEdit: boolean;
  viewerName: string;
  /**
   * The case page says who signed in its Locked line above the tab, so the
   * tab's own "signed by" line is left out there. The printed report keeps it.
   */
  hideSignature?: boolean;
}) {
  // The case page has this list already; it is the cache, not a fetch.
  const { data: cases = [] } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });

  if (deviation.assessed_at || !canEdit) {
    return (
      <AssessmentFacts
        deviation={deviation}
        cases={cases}
        slug={slug}
        hideSignature={hideSignature}
      />
    );
  }
  return (
    <AssessmentForm
      deviation={deviation}
      cases={cases}
      factoryId={factoryId}
      slug={slug}
      viewerName={viewerName}
    />
  );
}

function AssessmentForm({
  deviation,
  cases,
  factoryId,
  slug,
  viewerName,
}: {
  deviation: Deviation;
  cases: Deviation[];
  factoryId: string;
  slug: string;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const settings = useQualitySettings(factoryId);
  const form = useForm<AssessmentValues>({
    resolver: zodResolver(assessmentSignSchema),
    defaultValues: assessmentValues(deviation, cases),
  });
  const { control, register, setValue, formState } = form;
  const errors = formState.errors;
  const [saving, setSaving] = useState(false);

  const values = useWatch({ control }) as AssessmentValues;
  const flags = values.redFlags ?? [];
  const sev = values.severity ? Number(values.severity) : null;
  const lik = values.likelihood ? Number(values.likelihood) : null;
  const previous = values.previousCases ?? [];
  const suggested = suggestedLikelihood(deviation.created_at, previous);
  const proposed = proposedClass({
    redFlags: flags,
    severity: values.severity ?? "",
    likelihood: values.likelihood ?? "",
  });
  const cls = values.classification;
  // What signing will set — the database reads the same settings (0071).
  const dueDays = cls ? dueDaysFor(settings, cls) : null;
  const dueOn =
    dueDays !== null
      ? formatDay(addDays(deviation.created_at.slice(0, 10), dueDays))
      : null;
  const dueText =
    dueOn && cls
      ? `Due ${dueDays} days after raising: ${dueOn}.${cls === "Critical" ? " Close-out needs two QA signatures." : ""}`
      : "";
  // QA asked to pick the class themselves (the "Change" link).
  const [changingClass, setChangingClass] = useState(false);
  const below = lik !== null && previous.length > 0 && lik < suggested;
  const rationaleRequired = cls === "Critical" || cls === "Major" || below;

  // The class follows the table until QA picks another one: when the
  // proposal moves, a class that was blank or was the old proposal moves
  // with it; one QA chose stays.
  const lastProposed = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastProposed.current;
    lastProposed.current = proposed;
    if (!proposed || prev === proposed) return;
    const current = form.getValues("classification");
    if (current === "" || current === prev) {
      form.setValue("classification", proposed, {
        shouldValidate: form.formState.isSubmitted,
      });
    }
  }, [proposed, form]);

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
    onSuccess: async (_, v) => {
      await refresh();
      toast.success(
        v.likelihood === "3"
          ? `Initial assessment of ${deviation.deviation_no} signed — recurring, so a CAPA is required.`
          : `Initial assessment of ${deviation.deviation_no} signed.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveDraft() {
    setSaving(true);
    try {
      await saveAssessment(deviation.id, form.getValues(), viewerName);
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
        <div className="grid gap-y-5">
          <Field
            label="Severity"
            htmlFor="as-sev"
            required
            error={errors.severity?.message}
            hint={
              flags.length > 0
                ? "Set to 5 by the red flag above. Untick the red flag to change it."
                : sev
                  ? DEV_SEVERITY_EXAMPLES[sev - 1]
                  : "Pick the outcome for the product, not the cause. The key question: was it contained before release (3) or did it reach the market (4)?"
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
                  options={SEVERITY_OPTIONS}
                />
              )}
            />
          </Field>

          <Field
            label="Likelihood — how often has this happened?"
            required
            error={errors.likelihood?.message}
            hint={
              lik
                ? DEV_LIKELIHOOD_HELP[lik - 1]
                : "Search below for previous cases first, then pick."
            }
          >
            <Controller
              name="likelihood"
              control={control}
              render={({ field, fieldState }) => (
                <div
                  role="radiogroup"
                  aria-label="Likelihood"
                  aria-invalid={Boolean(fieldState.error)}
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {DEV_LIKELIHOOD.map((label, i) => {
                    const value = String(i + 1);
                    const active = field.value === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => field.onChange(value)}
                        onBlur={field.onBlur}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition",
                          active
                            ? "border-brand bg-brand-soft text-brand-deep ring-2 ring-brand/15"
                            : fieldState.error
                              ? "border-danger bg-surface text-ink-3"
                              : "border-line bg-surface text-ink-3 hover:border-line-strong",
                        )}
                      >
                        {value} — {label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </Field>

          <LikelihoodEvidence
            form={form}
            deviation={deviation}
            cases={cases}
            slug={slug}
          />

          {below && (
            <Note tone="warn">
              The {previous.length} picked case{previous.length > 1 ? "s suggest" : " suggests"}{" "}
              likelihood {suggested}. Choose {suggested}, or explain the lower
              choice in the rationale.
            </Note>
          )}
          {lik === 3 ? (
            <Note tone="warn">Recurring: a CAPA is required for this case.</Note>
          ) : lik === 2 ? (
            <Note>Happened before: consider a CAPA.</Note>
          ) : null}
        </div>

        <div className="mt-6">
          <RiskMatrix severity={sev} likelihood={lik} />
        </div>

        <div className="mt-6 grid gap-x-6 gap-y-5 md:grid-cols-2">
          {changingClass || (cls && proposed && cls !== proposed) ? (
            <Field
              label="Classification"
              required
              error={errors.classification?.message}
              hint={
                dueOn && cls
                  ? `${dueText}${proposed ? ` The table says ${proposed}.` : ""}`
                  : "Set by the table once severity and likelihood are chosen."
              }
            >
              <Segmented
                control={control}
                name="classification"
                label="Classification"
                options={CLASSES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
          ) : (
            // The table's answer as a result, not three buttons that look like
            // a choice (qms-v8) — Change opens them.
            <div className="md:col-span-2">
              <p className="text-xs font-medium text-ink-3">
                Classification<span className="ml-0.5 text-danger">*</span>
              </p>
              {cls ? (
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
                  <b className={cn("text-base font-semibold", CLASS_TEXT[cls])}>{cls}</b>
                  <span className="text-ink-4">
                    {cls === proposed ? "from the table" : "set by QA"}
                    {dueText && ` · ${dueText}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setChangingClass(true)}
                    className="font-medium text-brand hover:underline"
                  >
                    Change
                  </button>
                </p>
              ) : (
                <p className="mt-1.5 text-sm text-ink-5">
                  Set by the table once severity and likelihood are chosen.
                </p>
              )}
              {errors.classification?.message && (
                <p role="alert" className="mt-1 text-[0.7188rem] text-danger">
                  {errors.classification.message}
                </p>
              )}
            </div>
          )}
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
          ) : changingClass ? (
            <div />
          ) : null}
          <Field
            label="Rationale"
            htmlFor="as-rationale"
            required={rationaleRequired}
            note={rationaleRequired ? undefined : "(optional)"}
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

/**
 * The evidence for the likelihood: the previous cases picked as the same
 * problem, a search over every case in the factory to pick them from, the
 * "none found" tick, and cases kept outside FactoryOS.
 */
function LikelihoodEvidence({
  form,
  deviation,
  cases,
  slug,
}: {
  form: UseFormReturn<AssessmentValues>;
  deviation: Deviation;
  cases: Deviation[];
  slug: string;
}) {
  const { control, register, setValue, getValues, formState } = form;
  const [query, setQuery] = useState("");
  const previous = useWatch({ control, name: "previousCases" });
  const likelihood = useWatch({ control, name: "likelihood" });
  const byId = new Map(cases.map((c) => [c.id, c]));
  const pickedIds = new Set(previous.map((p) => p.id));

  const q = query.trim().toLowerCase();
  const from = new Date(deviation.created_at).getTime();
  const results =
    q.length < 2
      ? []
      : cases
          .filter(
            (c) => c.id !== deviation.id && !pickedIds.has(c.id) && haystack(c).includes(q),
          )
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 8);

  const opts = { shouldDirty: true, shouldValidate: formState.isSubmitted };

  function pick(c: Deviation) {
    const next = [...getValues("previousCases"), { id: c.id, raisedAt: c.created_at }];
    setValue("previousCases", next, opts);
    setValue("noPreviousFound", false, opts);
    // Picking raises the likelihood to what the cases suggest, never lowers it.
    const suggested = suggestedLikelihood(deviation.created_at, next);
    const current = Number(getValues("likelihood") || 0);
    if (current < suggested) {
      setValue("likelihood", String(suggested) as AssessmentValues["likelihood"], opts);
    }
  }

  function unpick(id: string) {
    setValue(
      "previousCases",
      getValues("previousCases").filter((p) => p.id !== id),
      opts,
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink-2">Evidence for likelihood</p>

      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
        {previous.length === 0 ? (
          <li className="bg-surface px-3.5 py-2.5 text-sm text-ink-5">
            No previous cases picked.
          </li>
        ) : (
          previous.map((p) => {
            const c = byId.get(p.id);
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 bg-surface px-3.5 py-2.5"
              >
                <CaseLine c={c} slug={slug} />
                <button
                  type="button"
                  onClick={() => unpick(p.id)}
                  className="shrink-0 text-xs font-semibold text-brand hover:underline"
                >
                  Remove
                </button>
              </li>
            );
          })
        )}
      </ul>

      <Field
        label="Search all cases — any product"
        htmlFor="as-prev-q"
        hint="Searches the number, title, what happened, product, batch, material, equipment and root cause across every case. You decide which are the same problem."
      >
        <input
          id="as-prev-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a word, e.g. dent, capsule shell, humidity, a batch number"
          autoComplete="off"
          className={CONTROL}
        />
      </Field>
      {q.length >= 2 && (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
          {results.length === 0 ? (
            <li className="bg-surface px-3.5 py-2.5 text-sm text-ink-5">No cases match.</li>
          ) : (
            results.map((c) => {
              const old =
                Math.abs(from - new Date(c.created_at).getTime()) >
                PREVIOUS_WINDOW_MONTHS * 30.4 * DAY_MS;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-4 bg-surface px-3.5 py-2.5"
                >
                  <CaseLine
                    c={c}
                    slug={slug}
                    extra={old ? `older than ${PREVIOUS_WINDOW_MONTHS} months` : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
                  >
                    Same problem
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

      {likelihood === "1" && previous.length === 0 && (
        <Controller
          name="noPreviousFound"
          control={control}
          render={({ field }) => (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                className="size-4 accent-brand"
              />
              Searched records — no previous case found
              {field.value && deviation.no_previous_found_at && (
                <span className="text-xs text-ink-5">
                  · {deviation.no_previous_found_by_name ?? "—"}{" "}
                  {formatDateTime(deviation.no_previous_found_at)}
                </span>
              )}
            </label>
          )}
        />
      )}

      <Field
        label="Previous cases recorded outside FactoryOS"
        htmlFor="as-prev-ext"
        note="(optional)"
        hint="Old system or paper records. Counts as evidence for likelihood 2 or 3."
      >
        <input
          id="as-prev-ext"
          placeholder="e.g. NCR0083 (old system, Mar 2025); paper log p.14"
          className={CONTROL}
          {...register("previousCasesExternal")}
        />
      </Field>
    </div>
  );
}

/** A case as one line: number (opens it in a new tab), title, products, date. */
function CaseLine({
  c,
  slug,
  extra,
}: {
  c: Deviation | undefined;
  slug: string;
  extra?: string;
}) {
  if (!c) {
    return <span className="text-sm text-ink-5">A case no longer listed</span>;
  }
  const products = c.product_names.length > 0 ? c.product_names.join(", ") : "—";
  return (
    <span className="min-w-0 text-sm text-ink-2">
      <Link
        href={caseHref(slug, c)}
        target="_blank"
        rel="noopener"
        className="mr-2 font-mono text-brand hover:underline"
      >
        {c.deviation_no}
      </Link>
      {c.title}{" "}
      <span className="text-xs text-ink-5">
        · {products} · {formatDay(c.created_at)}
        {extra && ` · ${extra}`}
      </span>
    </span>
  );
}

/** Severity row × likelihood → class, with the case's own cell marked. */
function RiskMatrix({
  severity,
  likelihood,
}: {
  severity: number | null;
  likelihood: number | null;
}) {
  const row = severity ? severityRow(severity) : null;
  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-ink-4">Severity</th>
            {DEV_LIKELIHOOD.map((label, i) => (
              <th key={label} className="px-3 py-2 text-left text-xs font-semibold text-ink-4">
                Likelihood {i + 1}
                <span className="block font-normal text-ink-5">{label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SEVERITY_ROWS.map((label, r) => (
            <tr key={label}>
              <td className="px-3 py-2 text-xs text-ink-3">{label}</td>
              {RISK_MATRIX[r].map((cls, l) => {
                const on = row === r && likelihood === l + 1;
                return (
                  <td
                    key={l}
                    className={cn(
                      "rounded-lg px-3 py-2 font-semibold",
                      CLASS_CELL[cls],
                      on ? "ring-2 ring-ink ring-offset-1 ring-offset-surface" : "opacity-60",
                    )}
                  >
                    {cls}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A signed assessment, or one read by someone below supervisor. */
function AssessmentFacts({
  deviation: d,
  cases,
  slug,
  hideSignature = false,
}: {
  deviation: Deviation;
  cases: Deviation[];
  slug: string;
  hideSignature?: boolean;
}) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const legacy = isLegacyRisk(d);
  return (
    <div className="space-y-7">
      {d.assessed_at ? (
        !hideSignature && (
        <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
          <CheckCircle2 className="size-4 shrink-0" />
          Initial assessment signed by {d.assessed_by_name} ·{" "}
          {formatDateTime(d.assessed_at)}
        </p>
        )
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
        {legacy ? (
          <LegacyRisk d={d} />
        ) : (
          <>
            <dl className="grid gap-3">
              <Fact label="Severity" wide>
                {d.severity ? (
                  `${d.severity} — ${DEV_SEVERITY[d.severity - 1]}`
                ) : (
                  <Muted>—</Muted>
                )}
              </Fact>
              <Fact label="Likelihood" wide>
                {d.likelihood ? (
                  `${d.likelihood} — ${DEV_LIKELIHOOD[d.likelihood - 1] ?? ""}`
                ) : (
                  <Muted>—</Muted>
                )}
              </Fact>
              <Fact label="Evidence for likelihood" wide>
                {d.previous_case_ids.length > 0 ? (
                  <span className="grid gap-1">
                    {d.previous_case_ids.map((id) => (
                      <CaseLine key={id} c={byId.get(id)} slug={slug} />
                    ))}
                  </span>
                ) : d.no_previous_found_at ? (
                  `Searched records — no previous case found · ${d.no_previous_found_by_name ?? "—"} ${formatDateTime(d.no_previous_found_at)}`
                ) : (
                  <Muted>No previous cases picked</Muted>
                )}
              </Fact>
              {d.previous_cases_external && (
                <Fact label="Previous cases outside FactoryOS" wide>
                  {d.previous_cases_external}
                </Fact>
              )}
            </dl>
            <div className="mt-5">
              <RiskMatrix severity={d.severity} likelihood={d.likelihood} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-3">
              <Out label="Risk (severity · likelihood)">
                {d.severity && d.likelihood ? `S${d.severity} · L${d.likelihood}` : "—"}
              </Out>
              <Out label="Classification">
                <span className={d.classification ? CLASS_TEXT[d.classification] : undefined}>
                  {d.classification ?? "—"}
                </span>
              </Out>
              <Out label="Due">{d.sla_date ? formatDay(d.sla_date) : "—"}</Out>
            </div>
          </>
        )}
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

/** An assessment signed on the old scale — severity × likelihood × detection. */
function LegacyRisk({ d }: { d: Deviation }) {
  const lik = RISK_SCALES.likelihood.options.find(
    (o) => o.value === String(d.likelihood),
  );
  return (
    <>
      <p className="mb-4 text-xs text-ink-5">
        Scored on the earlier scale (severity × likelihood × detection, 1–125).
      </p>
      <dl className="grid gap-3">
        <Fact label="Severity" wide>
          {d.severity ? `${d.severity} — ${LEGACY_SEVERITY[d.severity - 1]}` : <Muted>—</Muted>}
        </Fact>
        <Fact label="Control that would catch it" wide>
          {d.detection ? `${d.detection} — ${LEGACY_DETECTION[d.detection - 1]}` : <Muted>—</Muted>}
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
    </>
  );
}

function Note({
  tone,
  children,
}: {
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-xl border px-4 py-2.5 text-xs",
        tone === "warn"
          ? "border-warn-line bg-warn-tint text-warn-ink"
          : "border-line-soft bg-sunken text-ink-3",
      )}
    >
      {children}
    </p>
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
