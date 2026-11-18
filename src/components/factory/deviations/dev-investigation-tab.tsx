"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useWatch,
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  CHECKS_REVIEWED,
  DEV_RCA_METHODS,
  RC_CONCLUSIONS,
  ROOT_CAUSE_6M,
  devInvestigationSubmitSchema,
  parseBatches,
  type DevInvestigationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import { Segmented } from "@/components/factory/deviations/deviation-initiation-fields";
import {
  AREA,
  CONTROL,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { formatDateTime } from "@/lib/factory/dates";
import {
  approveDevInvestigation,
  deviationKeys,
  devInvestigationValues,
  saveDevInvestigation,
  sendBackDevInvestigation,
  submitDevInvestigation,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * A deviation's investigation, as the reference QMS lays it out (qms-v4):
 * Impact (other batches, product impact), What was reviewed, Root cause
 * (findings, 6M categories — with the human-error questions when "Man" is
 * ticked — the root cause, its conclusion and the method), and attachments.
 *
 * Written and saved as a draft, then **submitted** for QA, who **approves**
 * it or **sends it back** with a reason. Submitted or approved, it is
 * read-only — the same form, disabled — and `deviations_investigation_guard`
 * refuses changes to it.
 */
export function DevInvestigationTab({
  deviation: d,
  factoryId,
  canEdit,
  userId,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up, on an open case. */
  canEdit: boolean;
  userId: string;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<DevInvestigationValues>({
    resolver: zodResolver(devInvestigationSubmitSchema),
    defaultValues: devInvestigationValues(d),
  });
  const { control, register, formState } = form;
  const errors = formState.errors;
  const [saving, setSaving] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  const submitted = Boolean(d.investigation_submitted_at);
  const approved = Boolean(d.investigation_approved_at);
  const locked = !canEdit || submitted || approved;

  const categories = useWatch({ control, name: "rootCauseCategories" }) ?? [];
  const human = categories.includes("Man (people)");
  const proc = useWatch({ control, name: "humanProcedureClear" });
  const trained = useWatch({ control, name: "humanTrained" });
  const preventable = useWatch({ control, name: "humanPreventable" });
  const humanHint = proc === "no" || trained === "no" || preventable === "yes";

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const submit = useMutation({
    mutationFn: (v: DevInvestigationValues) =>
      submitDevInvestigation(d.id, v, viewerName),
    onSuccess: async () => {
      await refresh();
      toast.success("Investigation submitted for approval.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: () => {
      // QA should not approve the investigation of a case they own. Said,
      // not enforced — for now, so it can be tested with one login.
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (norm(viewerName) && norm(viewerName) === norm(d.owner_name)) {
        toast.warning(
          `You own ${d.deviation_no} — another QA approver should normally approve its investigation.`,
        );
      }
      return approveDevInvestigation(d.id, viewerName);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Investigation approved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendBack = useMutation({
    mutationFn: () => sendBackDevInvestigation(d.id, returnReason, viewerName),
    onSuccess: async () => {
      setReturning(false);
      setReturnReason("");
      await refresh();
      toast.success(`Sent back to ${d.owner_name || "the owner"}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveDraft() {
    setSaving(true);
    try {
      await saveDevInvestigation(d.id, form.getValues());
      await refresh();
      toast.success("Investigation saved — not submitted yet.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const busy = formState.isSubmitting || saving;

  return (
    <div className="space-y-7">
      {approved ? (
        <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
          <CheckCircle2 className="size-4 shrink-0" />
          Investigation approved by {d.investigation_approved_by_name} ·{" "}
          {formatDateTime(d.investigation_approved_at!)}
        </p>
      ) : submitted ? (
        <p className="rounded-xl border border-brand-soft bg-brand-tint px-4 py-3 text-sm text-brand-deep">
          Submitted for approval by {d.investigation_submitted_by_name} ·{" "}
          {formatDateTime(d.investigation_submitted_at!)}. Read-only while QA
          reviews it.
        </p>
      ) : d.investigation_returned_at ? (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink">
          Sent back by {d.investigation_returned_by_name} ·{" "}
          {formatDateTime(d.investigation_returned_at)}: “
          {d.investigation_return_reason}”
        </p>
      ) : !d.assessed_at && d.status === "open" ? (
        <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
          The investigation opens after the initial assessment. You can start
          writing notes now.
        </p>
      ) : null}

      <form
        noValidate
        onSubmit={form.handleSubmit(
          (v) => submit.mutateAsync(v).catch(() => {}),
          () =>
            requestAnimationFrame(() =>
              document
                .querySelector('main [role="alert"]')
                ?.scrollIntoView({ block: "center", behavior: "smooth" }),
            ),
        )}
        className="space-y-7"
      >
        {/* Disabled as one, so a submitted or approved investigation reads as
            the same form rather than a second layout. */}
        <fieldset disabled={locked} className="min-w-0 space-y-7">
          <Section title="Impact">
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <Field
                label="Other batches affected"
                htmlFor="inv-other"
                note="(optional)"
              >
                <input
                  id="inv-other"
                  placeholder="e.g. 46690, 46691 — or leave blank if none"
                  className={cn(CONTROL, "font-mono")}
                  {...register("otherBatches")}
                />
                <OtherBatches factoryId={factoryId} control={control} />
              </Field>
              <div />
              <Field
                label="Product impact assessment"
                htmlFor="inv-impact"
                required
                error={errors.impact?.message}
                hint="Quality, safety, efficacy, regulatory compliance, other batches."
                className="md:col-span-2"
              >
                <textarea
                  id="inv-impact"
                  rows={3}
                  placeholder="Quality, safety, efficacy, regulatory compliance, other batches"
                  className={AREA}
                  {...register("impact")}
                />
              </Field>
            </div>
          </Section>

          <Section title="What was reviewed">
            <Field
              label="Tick what the investigation looked at"
              note="(optional)"
            >
              <Chips control={control} name="checksReviewed" options={CHECKS_REVIEWED} />
            </Field>
          </Section>

          <Section title="Root cause">
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <Field
                label="Findings"
                htmlFor="inv-findings"
                required
                error={errors.findings?.message}
                className="md:col-span-2"
              >
                <textarea
                  id="inv-findings"
                  rows={4}
                  placeholder="What the investigation found"
                  className={AREA}
                  {...register("findings")}
                />
              </Field>

              <Field
                label="Root cause categories"
                required
                error={errors.rootCauseCategories?.message}
                hint="Tick all that apply. The first one ticked is used for trending."
                className="md:col-span-2"
              >
                <Chips
                  control={control}
                  name="rootCauseCategories"
                  options={ROOT_CAUSE_6M}
                />
              </Field>

              {human && (
                <>
                  <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink md:col-span-2">
                    “Man (people)” is rarely the whole root cause. Inspectors
                    expect you to ask why the error was possible.
                  </p>
                  <Field
                    label="Was the procedure clear and correct?"
                    required
                    error={errors.humanProcedureClear?.message}
                  >
                    <Segmented
                      control={control}
                      name="humanProcedureClear"
                      label="Was the procedure clear and correct?"
                      options={[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                      ]}
                    />
                  </Field>
                  <Field
                    label="Was the person trained and assessed on it?"
                    required
                    error={errors.humanTrained?.message}
                  >
                    <Segmented
                      control={control}
                      name="humanTrained"
                      label="Was the person trained and assessed on it?"
                      options={[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                      ]}
                    />
                  </Field>
                  <Field
                    label="Could the process or equipment have prevented the error?"
                    required
                    error={errors.humanPreventable?.message}
                    className="md:col-span-2"
                  >
                    <Segmented
                      control={control}
                      name="humanPreventable"
                      label="Could the process or equipment have prevented the error?"
                      options={[
                        { value: "no", label: "No" },
                        { value: "yes", label: "Yes" },
                      ]}
                    />
                    {humanHint && (
                      <p className="text-[0.6875rem] text-warn-deep">
                        Then the root cause is the procedure, training or
                        design. Tick Method or Machine too, and fix that.
                      </p>
                    )}
                  </Field>
                </>
              )}

              <Field
                label="Root cause"
                htmlFor="inv-root"
                required
                error={errors.rootCause?.message}
                className="md:col-span-2"
              >
                <textarea
                  id="inv-root"
                  rows={2}
                  className={AREA}
                  {...register("rootCause")}
                />
              </Field>

              <Field
                label="Root cause conclusion"
                required
                error={errors.conclusion?.message}
              >
                <Segmented
                  control={control}
                  name="conclusion"
                  label="Root cause conclusion"
                  options={RC_CONCLUSIONS.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field
                label="Method"
                htmlFor="inv-method"
                required
                error={errors.method?.message}
              >
                <SelectControl
                  control={control}
                  name="method"
                  id="inv-method"
                  placeholder="Select…"
                  invalid={Boolean(errors.method)}
                  options={DEV_RCA_METHODS.map((m) => ({ value: m, label: m }))}
                />
              </Field>
            </div>
          </Section>
        </fieldset>

        <Section title="">
          <CaseAttachments
            factoryId={factoryId}
            deviationId={d.id}
            section="investigation"
            userId={userId}
            userName={viewerName}
            canAttach={canEdit && !approved}
          />
        </Section>

        {canEdit && !submitted && !approved && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
            {d.assessed_at && (
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                {formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Submit for approval
              </button>
            )}
            <button
              type="button"
              onClick={saveDraft}
              disabled={busy}
              className={d.assessed_at ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save draft
            </button>
            <span className="text-[0.8125rem] text-ink-4">
              QA approves the root cause before actions are agreed.
            </span>
          </div>
        )}
      </form>

      {canEdit && submitted && !approved && (
        <div className="space-y-3 border-t border-line-soft pt-5">
          {returning && (
            <Field
              label="What needs to change?"
              htmlFor="inv-return"
              required
            >
              <textarea
                id="inv-return"
                rows={2}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className={AREA}
              />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!returning ? (
              <>
                <button
                  type="button"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate()}
                  className={PRIMARY_BUTTON}
                >
                  {approve.isPending && <Loader2 className="size-4 animate-spin" />}
                  Approve investigation
                </button>
                <button
                  type="button"
                  onClick={() => setReturning(true)}
                  className={SECONDARY_BUTTON}
                >
                  Send back
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={sendBack.isPending || returnReason.trim().length < 5}
                  onClick={() => sendBack.mutate()}
                  className={PRIMARY_BUTTON}
                >
                  {sendBack.isPending && <Loader2 className="size-4 animate-spin" />}
                  Send back
                </button>
                <button
                  type="button"
                  onClick={() => setReturning(false)}
                  className={SECONDARY_BUTTON}
                >
                  Cancel
                </button>
              </>
            )}
            <span className="text-[0.8125rem] text-ink-4">As {viewerName}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Each "other batch", resolved from the register like the case's own. */
function OtherBatches({
  factoryId,
  control,
}: {
  factoryId: string;
  control: Control<DevInvestigationValues>;
}) {
  const typed = useWatch({ control, name: "otherBatches" });
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  const rows = useMemo(() => {
    const by = new Map(products.map((p) => [p.batch_no.toLowerCase(), p]));
    return parseBatches(typed ?? "").map((b) => ({
      batch: b,
      product: by.get(b.toLowerCase()) ?? null,
    }));
  }, [products, typed]);
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1">
      {rows.map(({ batch, product }) => (
        <li
          key={batch}
          className={cn(
            "flex flex-wrap items-baseline gap-x-2 rounded-lg border px-2.5 py-1.5 text-[0.7188rem]",
            product
              ? "border-brand-soft bg-brand-tint text-ink-3"
              : "border-warn-line bg-warn-tint text-warn-ink",
          )}
        >
          <span className="font-mono font-semibold text-ink">{batch}</span>
          {product ? (
            <span className="font-medium text-ink">{product.name}</span>
          ) : (
            <span>Not in the batch register — saved as typed.</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Tick-boxes as chips, for a list answer. Order ticked is kept. */
function Chips<T extends FieldValues>({
  control,
  name,
  options,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  options: readonly string[];
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const value = (field.value as string[]) ?? [];
        return (
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const on = value.includes(o);
              return (
                <label
                  key={o}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition has-[:disabled]:cursor-default",
                    on
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line bg-surface text-ink-3 hover:border-line-strong",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      field.onChange(
                        on ? value.filter((x) => x !== o) : [...value, o],
                      )
                    }
                    className="size-4 accent-brand"
                  />
                  {o}
                </label>
              );
            })}
          </div>
        );
      }}
    />
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
      {title && <h3 className="mb-4 text-base font-semibold text-ink">{title}</h3>}
      {children}
    </section>
  );
}
