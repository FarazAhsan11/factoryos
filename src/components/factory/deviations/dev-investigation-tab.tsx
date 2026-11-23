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
import { DecisionForm } from "@/components/factory/deviations/batch-holds";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
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
import { formatDateTime, formatDay } from "@/lib/factory/dates";
import {
  approveDevInvestigation,
  deviationKeys,
  devInvestigationValues,
  saveDevInvestigation,
  sendBackDevInvestigation,
  submitDevInvestigation,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import {
  HOLD_STATUS_LABEL,
  decideHold,
  fetchHolds,
  holdKeys,
  placeHolds,
} from "@/lib/factory/hold-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";
import { NotACaseButton } from "@/components/factory/deviations/ncr-not-a-case";
import { LAB_CHECK, NCR_CHECKS, isMaterialItem, requiredChecks } from "@/lib/factory/ncr";
import { COMPLAINT_CHECKS, SCOPES, complaintRequiredChecks } from "@/lib/factory/complaint";

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
  const ncr = d.type === "ncr";
  const material = ncr && isMaterialItem(d.nc_item);
  const labRequired = ncr && d.detection_point === "QC testing";
  const labCheck = useWatch({ control, name: "labCheck" });
  const complaint = d.type === "complaint";
  const scope = useWatch({ control, name: "scope" });
  const checkItems: readonly string[] = complaint
    ? COMPLAINT_CHECKS
    : ncr
      ? NCR_CHECKS
      : CHECKS_REVIEWED;
  const mustCover = complaint ? complaintRequiredChecks(d) : requiredChecks(d);

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
      {/* Approved: the case page's Locked line says who approved it. */}
      {approved ? null : submitted ? (
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
        {labRequired && (
          <Section title="Laboratory check">
            <fieldset disabled={locked} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
              <Field
                label="Lab error ruled out?"
                required
                error={errors.labCheck?.message}
                hint={
                  labCheck === "No"
                    ? undefined
                    : "Before an out-of-specification result is blamed on the material (FDA OOS guidance, GMP)."
                }
              >
                <Segmented
                  control={control}
                  name="labCheck"
                  label="Lab error ruled out?"
                  options={LAB_CHECK.map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <Field
                label="Lab investigation reference"
                htmlFor="inv-lab-ref"
                required
                error={errors.labRef?.message}
              >
                <input
                  id="inv-lab-ref"
                  placeholder="e.g. OOS-2026-017"
                  aria-invalid={Boolean(errors.labRef)}
                  className={cn(CONTROL, "font-mono")}
                  {...register("labRef")}
                />
              </Field>
            </fieldset>
            {labCheck === "No" && (
              <div className="mt-4 space-y-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep">
                <p>
                  A lab error was found: the result is invalid. Close this case
                  as not a non-conformance.
                </p>
                {canEdit &&
                  (d.lab_check === "No" ? (
                    <NotACaseButton deviation={d} factoryId={factoryId} viewerName={viewerName} />
                  ) : (
                    <p className="text-xs">Save the draft, then close it here.</p>
                  ))}
              </div>
            )}
          </Section>
        )}

        {complaint ? (
          <>
            <Section title="Result">
              <fieldset disabled={locked} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
                <Field
                  label="Complaint confirmed?"
                  required
                  error={errors.conclusion?.message}
                  hint="The headline result, used for trending: justified (confirmed) and not justified complaints."
                >
                  <Segmented
                    control={control}
                    name="conclusion"
                    label="Complaint confirmed?"
                    options={RC_CONCLUSIONS.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
              </fieldset>
            </Section>
            <Section title="Scope">
              <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
                <fieldset disabled={locked} className="min-w-0">
                  <Field
                    label="How far does the problem go?"
                    required
                    error={errors.scope?.message}
                    hint={
                      scope && scope !== "Isolated unit(s)"
                        ? "Batch-wide: check the market action on the Actions tab."
                        : "The product is already on the market, so the question is how many units or batches share the problem."
                    }
                  >
                    <Segmented
                      control={control}
                      name="scope"
                      label="How far does the problem go?"
                      className="flex-wrap"
                      options={SCOPES.map((x) => ({ value: x, label: x }))}
                    />
                  </Field>
                </fieldset>
                {scope === "Other batches too" ? (
                  <fieldset disabled={locked} className="min-w-0">
                    <Field
                      label="Other batches affected"
                      htmlFor="inv-other"
                      required
                      error={errors.otherBatches?.message}
                    >
                      <input
                        id="inv-other"
                        placeholder="e.g. 46651, 46652"
                        className={cn(CONTROL, "font-mono")}
                        {...register("otherBatches")}
                      />
                    </Field>
                  </fieldset>
                ) : (
                  <div className="hidden md:block" />
                )}
                {scope === "Other batches too" && (
                  <OtherBatchHolds
                    deviation={d}
                    factoryId={factoryId}
                    control={control}
                    canHold={canEdit}
                    viewerName={viewerName}
                    className="md:col-span-2"
                  />
                )}
              </div>
            </Section>
          </>
        ) : (
          <Section title="Impact">
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              {/* Disabled with the rest of the form once submitted or approved. */}
              <fieldset disabled={locked} className="min-w-0">
                <Field
                  label={material ? "Other batches made with this lot" : "Other batches affected"}
                  htmlFor="inv-other"
                  note="(optional)"
                >
                  <input
                    id="inv-other"
                    placeholder="e.g. 46690, 46691 — or leave blank if none"
                    className={cn(CONTROL, "font-mono")}
                    {...register("otherBatches")}
                  />
                </Field>
              </fieldset>
              <div className="hidden md:block" />
              {/* Outside the fieldset: a batch may need holding, releasing or
                  rejecting after the investigation is submitted. */}
              <OtherBatchHolds
                deviation={d}
                factoryId={factoryId}
                control={control}
                canHold={canEdit}
                viewerName={viewerName}
                className="md:col-span-2"
              />
              <fieldset disabled={locked} className="min-w-0 md:col-span-2">
                <Field
                  label="Product impact assessment"
                  htmlFor="inv-impact"
                  required
                  error={errors.impact?.message}
                  hint="Quality, safety, efficacy, regulatory compliance, other batches. Needed before QA can release a held batch."
                >
                  <textarea
                    id="inv-impact"
                    rows={3}
                    placeholder="Quality, safety, efficacy, regulatory compliance, other batches"
                    className={AREA}
                    {...register("impact")}
                  />
                </Field>
              </fieldset>
            </div>
          </Section>
        )}

        {/* Disabled as one, so a submitted or approved investigation reads as
            the same form rather than a second layout. */}
        <fieldset disabled={locked} className="min-w-0 space-y-7">

          <Section title="What was reviewed">
            <ReviewChecks
              control={control}
              error={errors.reviewChecks?.message}
              items={checkItems}
              required={mustCover}
            />
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

              {!complaint && (
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
              )}
              <Field
                label="Analysis tool"
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

/**
 * Each "other batch affected", as it is typed — resolved from the register,
 * and asked about one at a time: **put it on hold?** A hold placed here is the
 * same hold as one placed at raise (`place_batch_holds`, 0069): it is listed
 * on Details → Batch holds too, and released or rejected the same way, with
 * the same rules — here or there.
 *
 * "No" is remembered only while the page is open; the batch then reads "Not
 * on hold" with a link to hold it later.
 */
function OtherBatchHolds({
  deviation: d,
  factoryId,
  control,
  canHold,
  viewerName,
  className,
}: {
  deviation: Deviation;
  factoryId: string;
  control: Control<DevInvestigationValues>;
  /** Supervisor and up, on an open case. */
  canHold: boolean;
  viewerName: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const typed = useWatch({ control, name: "otherBatches" });
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  const { data: holds = [] } = useQuery({
    queryKey: holdKeys.forCase(factoryId, d.id),
    queryFn: () => fetchHolds(d.id),
  });
  const [declined, setDeclined] = useState<string[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{
    id: string;
    decision: "released" | "rejected";
  } | null>(null);

  const rows = useMemo(() => {
    const byBatch = new Map(products.map((p) => [p.batch_no.toLowerCase(), p]));
    return parseBatches(typed ?? "").map((batch) => {
      const key = batch.toLowerCase();
      const mine = holds.filter((h) => h.batch_no.toLowerCase() === key);
      // A live hold first; otherwise the latest decision.
      const hold =
        mine.find((h) => h.status === "on_hold") ?? mine[mine.length - 1] ?? null;
      return { batch, key, product: byBatch.get(key) ?? null, hold };
    });
  }, [products, holds, typed]);

  if (rows.length === 0) return null;

  // Holds move the board's cards, the case header and its stage with them.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
    ]);

  async function hold(batch: string) {
    setPlacing(batch);
    try {
      await placeHolds(d.id, [batch], viewerName);
      await refresh();
      toast.success(`Batch ${batch} put on hold.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlacing(null);
    }
  }

  function startDecision(id: string, decision: "released" | "rejected") {
    // The database checks the saved impact, not what is typed.
    if (
      decision === "released" &&
      d.investigation_required !== false &&
      !(d.impact ?? "").trim()
    ) {
      toast.error(
        "Write the product impact assessment and save the draft before releasing a batch.",
      );
      return;
    }
    setDeciding({ id, decision });
  }

  const investigationPending =
    d.investigation_required !== false && !d.investigation_approved_at;

  return (
    <div className={cn("space-y-2", className)}>
      <ul className="space-y-2">
        {rows.map(({ batch, key, product, hold: h }) => {
          const asking = canHold && product && !h && !declined.includes(key);
          return (
            <li
              key={key}
              className={cn(
                "rounded-xl border px-3.5 py-2.5 text-sm",
                asking
                  ? "border-warn-line bg-warn-tint"
                  : h?.status === "on_hold"
                    ? "border-danger-line bg-danger-soft"
                    : "border-line bg-surface",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="min-w-0">
                  <span className="font-mono font-semibold text-ink">{batch}</span>
                  {product ? (
                    <span className="ml-2 text-ink-3">{product.name}</span>
                  ) : (
                    <span className="ml-2 text-warn-ink">
                      Not in the batch register — saved as typed; it cannot be put on hold.
                    </span>
                  )}
                </span>

                {product && (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    {asking ? (
                      <>
                        <span className="font-semibold text-warn-ink">
                          Put this batch on hold?
                        </span>
                        <button
                          type="button"
                          onClick={() => hold(batch)}
                          disabled={placing !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-warn-line bg-surface px-3 py-1.5 font-semibold text-warn-ink transition hover:border-warn disabled:opacity-60"
                        >
                          {placing === batch && <Loader2 className="size-3.5 animate-spin" />}
                          Yes, put on hold
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeclined((list) => [...list, key])}
                          disabled={placing !== null}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 font-semibold text-ink-3 transition hover:border-line-strong disabled:opacity-60"
                        >
                          No
                        </button>
                      </>
                    ) : !h ? (
                      <>
                        <span className="text-ink-4">Not on hold</span>
                        {canHold && (
                          <button
                            type="button"
                            onClick={() => hold(batch)}
                            disabled={placing !== null}
                            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline disabled:opacity-60"
                          >
                            {placing === batch && <Loader2 className="size-3.5 animate-spin" />}
                            Put on hold
                          </button>
                        )}
                      </>
                    ) : h.status === "on_hold" ? (
                      <>
                        <span className="font-semibold text-danger-deep">
                          On hold
                          <span className="font-normal text-ink-4">
                            {" "}· {h.placed_by_name ?? "—"} · {formatDay(h.placed_at)}
                          </span>
                        </span>
                        {canHold && deciding?.id !== h.id && (
                          <span>
                            <button
                              type="button"
                              onClick={() => startDecision(h.id, "released")}
                              className="font-semibold text-brand hover:underline"
                            >
                              Release
                            </button>
                            <span className="mx-1.5 text-ink-5">·</span>
                            <button
                              type="button"
                              onClick={() => startDecision(h.id, "rejected")}
                              className="font-semibold text-danger-deep hover:underline"
                            >
                              Reject
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <span
                        className={cn(
                          "font-semibold",
                          h.status === "released" ? "text-teal-deep" : "text-ink-3",
                        )}
                        title={h.reason ?? undefined}
                      >
                        {HOLD_STATUS_LABEL[h.status]}
                        <span className="font-normal text-ink-4">
                          {" "}· {h.decided_by_name ?? "—"}
                          {h.decided_at && ` · ${formatDay(h.decided_at)}`}
                        </span>
                      </span>
                    )}
                  </span>
                )}
              </div>

              {h && deciding?.id === h.id && (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <DecisionForm
                    batch={h.batch_no}
                    decision={deciding.decision}
                    warn={
                      deciding.decision === "released" && investigationPending
                        ? "The investigation is not approved yet."
                        : null
                    }
                    onCancel={() => setDeciding(null)}
                    onDecide={async (reason) => {
                      await decideHold(h.id, deciding.decision, reason, viewerName);
                      await refresh();
                      toast.success(
                        `Batch ${h.batch_no} ${deciding.decision === "released" ? "released" : "rejected"}.`,
                      );
                      setDeciding(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[0.6875rem] text-ink-5">
        A held batch is blocked in the shift log for preparatory and production
        work. Holds are also listed on Details → Batch holds, and released or
        rejected the same way there.
      </p>
    </div>
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

/**
 * What was reviewed (qms-v5, 0070): tick each item the investigation looked
 * at and write what it showed. The usual list comes first; "Add other item"
 * names anything else, which then sits in the list like the rest. Submitting
 * needs a finding beside every ticked item.
 */
function ReviewChecks({
  control,
  error,
  items: listed,
  required,
}: {
  control: Control<DevInvestigationValues>;
  error?: string;
  /** The usual list — a deviation's or an NCR's. */
  items: readonly string[];
  /** Items the investigation must cover (an NCR's), marked Required. */
  required: readonly string[];
}) {
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState("");
  return (
    <Controller
      name="reviewChecks"
      control={control}
      render={({ field }) => {
        const value = field.value ?? [];
        const find = (item: string) =>
          value.find((c) => c.item.toLowerCase() === item.toLowerCase());
        const extra = value
          .map((c) => c.item)
          .filter((i) => !listed.some((x) => x.toLowerCase() === i.toLowerCase()));
        const items = [...listed, ...extra];

        const toggle = (item: string, on: boolean) =>
          field.onChange(
            on
              ? [...value, { item, finding: "" }]
              : value.filter((c) => c.item.toLowerCase() !== item.toLowerCase()),
          );
        const setFinding = (item: string, finding: string) =>
          field.onChange(
            value.map((c) =>
              c.item.toLowerCase() === item.toLowerCase() ? { ...c, finding } : c,
            ),
          );
        const addOther = () => {
          const item = other.trim();
          if (!item) return;
          if (!find(item)) field.onChange([...value, { item, finding: "" }]);
          setOther("");
          setAdding(false);
        };

        return (
          <div className="space-y-3">
            <p className="text-xs text-ink-5">
              Tick each item the investigation looked at, and write what it showed.
              {required.length > 0 && (
                <>
                  {" "}
                  <span className="font-semibold text-ink-3">Required</span> items must be covered.
                </>
              )}
            </p>
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
              {items.map((item) => {
                const entry = find(item);
                const missing = Boolean(error) && entry !== undefined && !entry.finding.trim();
                return (
                  <li
                    key={item}
                    className="grid items-center gap-x-4 gap-y-2 bg-surface px-3.5 py-2.5 md:grid-cols-[16rem_minmax(0,1fr)]"
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2 has-[:disabled]:cursor-default">
                      <input
                        type="checkbox"
                        checked={entry !== undefined}
                        onChange={(e) => toggle(item, e.target.checked)}
                        className="size-4 accent-brand"
                      />
                      {item}
                      {required.includes(item) && (
                        <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-brand-deep">
                          Required
                        </span>
                      )}
                    </label>
                    {entry ? (
                      <input
                        value={entry.finding}
                        onChange={(e) => setFinding(item, e.target.value)}
                        onBlur={field.onBlur}
                        placeholder="What did it show?"
                        aria-label={`What ${item} showed`}
                        aria-invalid={missing}
                        maxLength={1000}
                        className={cn(CONTROL, missing && "border-danger")}
                      />
                    ) : (
                      <span className="hidden md:block" />
                    )}
                  </li>
                );
              })}
            </ul>
            {error && (
              <p role="alert" className="text-xs font-medium text-danger-deep">
                {error}
              </p>
            )}
            {adding ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOther();
                    }
                  }}
                  placeholder="What else did the investigation look at?"
                  maxLength={120}
                  aria-label="Other item reviewed"
                  className={cn(CONTROL, "min-w-0 flex-1")}
                />
                <button type="button" onClick={addOther} className={SECONDARY_BUTTON}>
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setOther("");
                  }}
                  className="text-xs font-semibold text-ink-4 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-60"
              >
                Add other item
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

/**
 * The investigation as text, for the printed report: every answer the form
 * asks, "Not recorded" where there is none. A disabled form clips its
 * textareas on paper, and a printed record should read as a record.
 */
export function InvestigationFacts({ deviation: d }: { deviation: Deviation }) {
  const yn = (b: boolean | null) =>
    b === null ? <Muted>Not answered</Muted> : b ? "Yes" : "No";
  const human = d.root_cause_categories.includes("Man (people)");
  return (
    <div className="space-y-7">
      {d.investigation_approved_at ? (
        <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
          <CheckCircle2 className="size-4 shrink-0" />
          Investigation approved by {d.investigation_approved_by_name} ·{" "}
          {formatDateTime(d.investigation_approved_at)}
        </p>
      ) : d.investigation_submitted_at ? (
        <p className="rounded-xl border border-brand-soft bg-brand-tint px-4 py-3 text-sm text-brand-deep">
          Submitted for approval by {d.investigation_submitted_by_name} ·{" "}
          {formatDateTime(d.investigation_submitted_at)} — not approved yet.
        </p>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-4">
          Draft — not submitted for approval.
          {d.investigation_returned_at &&
            ` Last sent back by ${d.investigation_returned_by_name} · ${formatDateTime(d.investigation_returned_at)}: “${d.investigation_return_reason}”`}
        </p>
      )}

      {d.type === "ncr" && d.detection_point === "QC testing" && (
        <Section title="Laboratory check">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact label="Lab error ruled out?">{d.lab_check ?? <Muted>Not answered</Muted>}</Fact>
            <Fact label="Lab investigation reference" mono>
              {d.lab_ref ?? <Muted>Not recorded</Muted>}
            </Fact>
          </dl>
        </Section>
      )}

      {d.type === "complaint" && (
        <Section title="Result and scope">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact label="Complaint confirmed?">
              {d.root_cause_conclusion ?? <Muted>Not recorded</Muted>}
            </Fact>
            <Fact label="Scope">{d.scope ?? <Muted>Not recorded</Muted>}</Fact>
            {d.other_batch_nos.length > 0 && (
              <Fact label="Other batches affected" mono>
                {d.other_batch_nos.join(", ")}
              </Fact>
            )}
          </dl>
        </Section>
      )}

      {d.type !== "complaint" && (
      <Section title="Impact">
        <dl className="grid gap-3">
          <Fact
            label={
              d.type === "ncr" && isMaterialItem(d.nc_item)
                ? "Other batches made with this lot"
                : "Other batches affected"
            }
            mono
          >
            {d.other_batch_nos.length > 0 ? d.other_batch_nos.join(", ") : <Muted>None</Muted>}
          </Fact>
          <Fact label="Product impact assessment" wide>
            {d.impact ?? <Muted>Not recorded</Muted>}
          </Fact>
        </dl>
      </Section>
      )}

      <Section title="What was reviewed">
        {d.review_checks.length > 0 ? (
          <dl className="grid gap-3">
            {d.review_checks.map((c) => (
              <Fact key={c.item} label={c.item} wide>
                {c.finding.trim() ? c.finding : <Muted>No finding recorded</Muted>}
              </Fact>
            ))}
          </dl>
        ) : (
          <Muted>Nothing recorded</Muted>
        )}
      </Section>

      <Section title="Root cause">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Findings" wide>
            {d.investigation_findings ?? <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="Root cause categories" wide>
            {d.root_cause_categories.length > 0 ? (
              d.root_cause_categories.join(", ")
            ) : (
              <Muted>Not recorded</Muted>
            )}
          </Fact>
          {human && (
            <>
              <Fact label="Procedure clear and correct">{yn(d.human_procedure_clear)}</Fact>
              <Fact label="Person trained and assessed">{yn(d.human_trained)}</Fact>
              <Fact label="Process or equipment could have prevented it">
                {yn(d.human_preventable)}
              </Fact>
            </>
          )}
          <Fact label="Root cause" wide>
            {d.root_cause ?? <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="Conclusion">
            {d.root_cause_conclusion ?? <Muted>Not recorded</Muted>}
          </Fact>
          <Fact label="Analysis tool">{d.rca_method ?? <Muted>Not recorded</Muted>}</Fact>
        </dl>
      </Section>
    </div>
  );
}
