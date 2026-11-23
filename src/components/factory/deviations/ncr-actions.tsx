"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ncrCustomerSchema,
  ncrDispositionSignSchema,
  ncrSupplierSchema,
  type NcrCustomerValues,
  type NcrDispositionValues,
  type NcrSupplierValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import {
  AREA,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Muted,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { Segmented } from "@/components/factory/deviations/deviation-initiation-fields";
import { formatDay } from "@/lib/factory/dates";
import {
  deviationKeys,
  ncrCustomerValues,
  ncrDispositionValues,
  ncrSupplierValues,
  reopenNcrDisposition,
  saveNcrCustomer,
  saveNcrDisposition,
  saveNcrFollowUp,
  saveNcrSupplier,
  signNcrDisposition,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { fetchHolds, holdKeys } from "@/lib/factory/hold-queries";
import {
  NCR_DISPOSITIONS,
  dispositionLabel,
  isMaterialItem,
  numberIn,
  partyWord,
  rejectsHolds,
} from "@/lib/factory/ncr";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * A non-conformance's own actions (qms-v12), above its corrections and the
 * CAPA decision:
 *
 *   · **Disposition** — QA's decision on the material or product, signed:
 *     signing releases or rejects the quarantined lots (a material) or the
 *     held batches; changing it needs a reason and puts them back on hold.
 *     Reject and return then ask their follow-up record.
 *   · **Supplier** (a material) — notified, claim, corrective action
 *     requested and its reply, tightened inspection. Client-supplied: the
 *     customer, the same questions.
 *   · **Customer notification** (finished product).
 */
export function NcrActions({
  deviation: d,
  factoryId,
  canEdit,
  viewerName,
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up, on an open case. */
  canEdit: boolean;
  viewerName: string;
  userId?: string;
}) {
  return (
    <>
      <DispositionSection
        deviation={d}
        factoryId={factoryId}
        canEdit={canEdit}
        viewerName={viewerName}
        userId={userId}
      />
      {isMaterialItem(d.nc_item) && (
        <SupplierSection deviation={d} factoryId={factoryId} canEdit={canEdit} />
      )}
      {d.nc_item === "Finished product" && (
        <CustomerSection deviation={d} factoryId={factoryId} canEdit={canEdit} />
      )}
    </>
  );
}

function useRefresh(factoryId: string, caseId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: holdKeys.forCase(factoryId, caseId) }),
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
    ]);
}

/* ── Disposition ──────────────────────────────────────────────────────── */

function DispositionSection({
  deviation: d,
  factoryId,
  canEdit,
  viewerName,
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
  viewerName: string;
  userId?: string;
}) {
  const signed = Boolean(d.disposition_signed_at);
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Disposition</h3>
      {signed ? (
        <SignedDisposition
          deviation={d}
          factoryId={factoryId}
          canEdit={canEdit}
          viewerName={viewerName}
          userId={userId}
        />
      ) : canEdit ? (
        <DispositionForm deviation={d} factoryId={factoryId} viewerName={viewerName} />
      ) : (
        <p className="text-sm text-ink-5">Not recorded yet — QA records the disposition.</p>
      )}
    </section>
  );
}

function DispositionForm({
  deviation: d,
  factoryId,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  viewerName: string;
}) {
  const refresh = useRefresh(factoryId, d.id);
  const material = isMaterialItem(d.nc_item);
  const holdWord = material ? "lot" : "batch";
  const { data: holds = [] } = useQuery({
    queryKey: holdKeys.forCase(factoryId, d.id),
    queryFn: () => fetchHolds(d.id),
  });
  const form = useForm<NcrDispositionValues>({
    resolver: zodResolver(ncrDispositionSignSchema),
    defaultValues: ncrDispositionValues(d),
  });
  const { control, formState } = form;
  const errors = formState.errors;
  const [saving, setSaving] = useState(false);

  const disposition = useWatch({ control, name: "disposition" });
  const onHold = holds
    .filter((h) => h.status === "on_hold" && (!material || h.kind === "lot"))
    .map((h) => h.batch_no);

  async function record(v: NcrDispositionValues) {
    const rej = rejectsHolds(v.disposition);
    // Said here first, in the database's words.
    if (!d.assessed_at) {
      toast.error("Sign the initial assessment first.");
      return;
    }
    if (!rej && d.investigation_required !== false && !(d.impact ?? "").trim()) {
      toast.error("Record the product impact assessment on the Investigation tab first.");
      return;
    }
    if (d.detection_point === "QC testing" && d.lab_check !== "Yes") {
      toast.error("Rule out a lab error first (Investigation → Laboratory check).");
      return;
    }
    try {
      await signNcrDisposition(d.id, v, viewerName);
      await refresh();
      toast.success(
        onHold.length > 0
          ? `Disposition recorded — ${holdWord} ${onHold.join(", ")} ${rej ? "rejected" : "released"}.`
          : "Disposition recorded.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await saveNcrDisposition(d.id, form.getValues());
      await refresh();
      toast.success("Disposition saved — not recorded yet.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(record)}
      className="space-y-5"
    >
      {d.disposition_reopen_reason && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
          Disposition reopened: “{d.disposition_reopen_reason}”. What it decided is back on hold.
        </p>
      )}
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <Field
          label="Disposition"
          htmlFor="disp-choice"
          required
          error={errors.disposition?.message}
          hint={`QA decides what happens to the non-conforming ${material ? "material" : "product"}.`}
        >
          <SelectControl
            control={control}
            name="disposition"
            id="disp-choice"
            placeholder="Select…"
            invalid={Boolean(errors.disposition)}
            options={NCR_DISPOSITIONS.map((x) => ({ value: x.value, label: x.label }))}
          />
        </Field>
        <div className="hidden md:block" />
        <DispositionFields form={form} deviation={d} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
        <button
          type="submit"
          disabled={formState.isSubmitting || saving}
          className={PRIMARY_BUTTON}
        >
          {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Record disposition
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
          {onHold.length > 0 && disposition
            ? `Signing ${rejectsHolds(disposition) ? "rejects" : "releases"} ${holdWord} ${onHold.join(", ")}.`
            : "QA signs the decision."}
        </span>
      </div>
    </form>
  );
}

/** The fields the chosen disposition asks. */
function DispositionFields({
  form,
  deviation: d,
}: {
  form: UseFormReturn<NcrDispositionValues>;
  deviation: Deviation;
}) {
  const { control, register, formState } = form;
  const errors = formState.errors;
  const disposition = useWatch({ control, name: "disposition" });
  const concession = useWatch({ control, name: "concession" });
  const accepted = useWatch({ control, name: "sortAccepted" });
  const rejected = useWatch({ control, name: "sortRejected" });
  const retest = useWatch({ control, name: "retest" });

  if (disposition === "use_as_is") {
    return (
      <>
        <Field
          label="Scope of the concession"
          htmlFor="disp-scope"
          required
          error={errors.concessionScope?.message}
          hint="A concession covers one lot and quantity, so it cannot quietly become permanent."
        >
          <input
            id="disp-scope"
            placeholder="Which lot and how much, e.g. Lot CT-902 only, 25,000 capsules"
            className={CONTROL}
            {...register("concessionScope")}
          />
        </Field>
        <div className="hidden md:block" />
        <Field
          label="Why it can be used as is"
          htmlFor="disp-why"
          required
          error={errors.dispositionReason?.message}
        >
          <textarea
            id="disp-why"
            rows={2}
            placeholder="e.g. Dents are cosmetic; capsules pass closing and fill-weight checks"
            className={AREA}
            {...register("dispositionReason")}
          />
        </Field>
        <Field
          label="Customer concession"
          htmlFor="disp-concession"
          required
          error={errors.concession?.message}
        >
          <SelectControl
            control={control}
            name="concession"
            id="disp-concession"
            placeholder="Select…"
            invalid={Boolean(errors.concession)}
            options={[
              { value: "not_needed", label: "Not needed — our own material" },
              { value: "customer", label: "Approved by the customer" },
            ]}
          />
        </Field>
        {concession === "customer" && (
          <Field
            label="Concession reference"
            htmlFor="disp-concession-ref"
            required
            error={errors.concessionRef?.message}
            hint="Attach the customer's approval once the disposition is recorded."
          >
            <input
              id="disp-concession-ref"
              placeholder="Customer approval, e.g. email of 12 Nov"
              className={CONTROL}
              {...register("concessionRef")}
            />
          </Field>
        )}
      </>
    );
  }

  if (disposition === "sort") {
    const a = numberIn(accepted);
    const r = numberIn(rejected);
    const q = numberIn(d.qty_affected);
    const off = a !== null && r !== null && q !== null && a + r !== q;
    return (
      <>
        <Field
          label="Sorting record"
          htmlFor="disp-sort-ref"
          required
          error={errors.sortRef?.message}
          className="md:col-span-2"
        >
          <input
            id="disp-sort-ref"
            placeholder="e.g. 100% visual sort record SR-118"
            className={CONTROL}
            {...register("sortRef")}
          />
        </Field>
        <Field
          label="Quantity accepted"
          htmlFor="disp-sort-acc"
          required
          error={errors.sortAccepted?.message}
        >
          <input
            id="disp-sort-acc"
            placeholder="e.g. 21,900 capsules"
            className={CONTROL}
            {...register("sortAccepted")}
          />
        </Field>
        <Field
          label="Quantity rejected"
          htmlFor="disp-sort-rej"
          required
          error={errors.sortRejected?.message}
          hint={
            off
              ? undefined
              : q !== null
                ? `Should add up to ${q.toLocaleString()} (quantity affected).`
                : undefined
          }
        >
          <input
            id="disp-sort-rej"
            placeholder="e.g. 3,100 capsules"
            className={CONTROL}
            {...register("sortRejected")}
          />
          {off && (
            <p className="text-[0.6875rem] leading-snug text-warn-ink">
              Accepted + rejected = {(a! + r!).toLocaleString()}, but the quantity
              affected is {q!.toLocaleString()}.
            </p>
          )}
        </Field>
      </>
    );
  }

  if (disposition === "rework") {
    return (
      <>
        <Field
          label="Rework instruction"
          htmlFor="disp-rework"
          required
          error={errors.reworkInstruction?.message}
        >
          <input
            id="disp-rework"
            placeholder="Approved document or batch record reference"
            className={CONTROL}
            {...register("reworkInstruction")}
          />
        </Field>
        <Field
          label="Re-test result"
          required
          error={errors.retest?.message}
        >
          <Segmented
            control={control}
            name="retest"
            label="Re-test result"
            options={[
              { value: "Pass", label: "Pass" },
              { value: "Fail", label: "Fail" },
            ]}
          />
          {retest === "Fail" && !errors.retest && (
            <p className="text-[0.6875rem] font-medium text-danger-deep">
              Failed re-test: choose Reject or Return to supplier.
            </p>
          )}
        </Field>
      </>
    );
  }

  return null;
}

function SignedDisposition({
  deviation: d,
  factoryId,
  canEdit,
  viewerName,
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
  viewerName: string;
  userId?: string;
}) {
  const refresh = useRefresh(factoryId, d.id);
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const followKind =
    d.ncr_disposition === "destroy" ? "destroy" : d.ncr_disposition === "return" ? "return" : null;
  const [followUp, setFollowUp] = useState(
    (followKind === "destroy" ? d.destruction_ref : d.return_ref) ?? "",
  );

  async function reopen() {
    if (reason.trim().length < 5) {
      toast.error("Say why the disposition is changing.");
      return;
    }
    setBusy(true);
    try {
      await reopenNcrDisposition(d.id, reason.trim(), viewerName);
      await refresh();
      toast.success("Disposition reopened — what it decided is back on hold.");
      setChanging(false);
      setReason("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFollowUp() {
    setBusy(true);
    try {
      await saveNcrFollowUp(d, followUp);
      await refresh();
      toast.success("Saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
        <CheckCircle2 className="size-4 shrink-0" />
        <span>
          <span className="font-semibold">{dispositionLabel(d.ncr_disposition)}</span> —
          recorded by {d.disposition_signed_by_name ?? "—"} on{" "}
          {formatDay(d.disposition_signed_at!)}
        </span>
        {canEdit && !changing && (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="font-semibold text-brand hover:underline"
          >
            Change
          </button>
        )}
      </p>

      {changing && (
        <div className="space-y-2.5 rounded-xl border border-line bg-sunken p-3.5">
          <label htmlFor="disp-reopen" className="block text-sm font-semibold text-ink-2">
            Why is the disposition changing?
          </label>
          <textarea
            id="disp-reopen"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={AREA}
          />
          <p className="text-xs text-ink-5">
            What this disposition released or rejected goes back on hold until a
            new one is recorded.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={reopen} disabled={busy} className={PRIMARY_BUTTON}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Change disposition
            </button>
            <button
              type="button"
              onClick={() => setChanging(false)}
              disabled={busy}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <DispositionFacts deviation={d} />

      {followKind && (
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field
            label={followKind === "destroy" ? "Destruction record" : "Return note / RMA"}
            htmlFor="disp-follow"
            required
            hint="Needed to close the case."
          >
            {canEdit ? (
              <div className="flex gap-2">
                <input
                  id="disp-follow"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder={
                    followKind === "destroy"
                      ? "e.g. Destruction certificate DC-2026-031"
                      : "e.g. RMA-5521-902"
                  }
                  className={CONTROL}
                />
                <button
                  type="button"
                  onClick={saveFollowUp}
                  disabled={busy}
                  className={SECONDARY_BUTTON}
                >
                  Save
                </button>
              </div>
            ) : (
              <p className="text-sm text-ink">
                {(followKind === "destroy" ? d.destruction_ref : d.return_ref) ?? (
                  <Muted>Not recorded</Muted>
                )}
              </p>
            )}
          </Field>
        </div>
      )}

      {(followKind || (d.ncr_disposition === "use_as_is" && d.concession === "customer")) && (
        <DispositionFiles
          deviation={d}
          factoryId={factoryId}
          canAttach={canEdit}
          viewerName={viewerName}
          userId={userId}
        />
      )}
    </div>
  );
}

/** Customer approval, destruction certificate, RMA or dispatch note. */
function DispositionFiles({
  deviation: d,
  factoryId,
  canAttach,
  viewerName,
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  canAttach: boolean;
  viewerName: string;
  userId?: string;
}) {
  const what =
    d.ncr_disposition === "destroy"
      ? "Destruction certificate"
      : d.ncr_disposition === "return"
        ? "RMA or dispatch note"
        : "Customer approval (email or form)";
  return (
    <CaseAttachments
      factoryId={factoryId}
      deviationId={d.id}
      section="disposition"
      userId={userId ?? ""}
      userName={viewerName}
      canAttach={canAttach && Boolean(userId)}
      title={`${what} (optional)`}
    />
  );
}

/** The signed decision's fields, read-only. */
function DispositionFacts({ deviation: d }: { deviation: Deviation }) {
  if (d.ncr_disposition === "use_as_is") {
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Scope of the concession" wide>
          {d.concession_scope ?? <Muted>—</Muted>}
        </Fact>
        <Fact label="Why it can be used as is" wide>
          {d.disposition_reason ?? <Muted>—</Muted>}
        </Fact>
        <Fact label="Customer concession">
          {d.concession === "customer" ? "Approved by the customer" : "Not needed — our own material"}
        </Fact>
        {d.concession === "customer" && (
          <Fact label="Concession reference">{d.concession_ref ?? <Muted>—</Muted>}</Fact>
        )}
      </dl>
    );
  }
  if (d.ncr_disposition === "sort") {
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Sorting record">{d.sort_ref ?? <Muted>—</Muted>}</Fact>
        <Fact label="Quantity accepted">{d.sort_accepted ?? <Muted>—</Muted>}</Fact>
        <Fact label="Quantity rejected">{d.sort_rejected ?? <Muted>—</Muted>}</Fact>
      </dl>
    );
  }
  if (d.ncr_disposition === "rework") {
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Rework instruction">{d.rework_instruction ?? <Muted>—</Muted>}</Fact>
        <Fact label="Re-test result">{d.retest_result ?? <Muted>—</Muted>}</Fact>
      </dl>
    );
  }
  return null;
}

/* ── Supplier (or customer, client-supplied) ──────────────────────────── */

function SupplierSection({
  deviation: d,
  factoryId,
  canEdit,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
}) {
  const refresh = useRefresh(factoryId, d.id);
  const customer = d.supplied_by === "customer";
  const party = partyWord(d.supplied_by);
  const Party = customer ? "Customer" : "Supplier";
  const form = useForm<NcrSupplierValues>({
    resolver: zodResolver(ncrSupplierSchema),
    defaultValues: ncrSupplierValues(d),
  });
  const { control, register, formState } = form;
  const scar = useWatch({ control, name: "scar" });
  const accepted = useWatch({ control, name: "scarAccepted" });
  const tightened = useWatch({ control, name: "tightened" });

  async function save(v: NcrSupplierValues) {
    try {
      await saveNcrSupplier(d.id, v);
      await refresh();
      toast.success(`${Party} follow-up saved.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
        {customer ? "Customer (client-supplied material)" : "Supplier"}
        {d.supplier_name && (
          <span className="text-sm font-normal text-ink-4">{d.supplier_name}</span>
        )}
      </h3>
      <form noValidate onSubmit={form.handleSubmit(save)} className="space-y-5">
        <fieldset disabled={!canEdit} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
          <Field label={`${Party} notified on`} htmlFor="sup-notified" required>
            <DateControl control={control} name="notifiedOn" id="sup-notified" />
          </Field>
          <Field
            label={customer ? "Cost agreed with the customer" : "Supplier claim or credit"}
            htmlFor="sup-claim"
            note="(optional)"
          >
            <input
              id="sup-claim"
              placeholder="e.g. Credit note CN-4471, $3,200"
              className={CONTROL}
              {...register("claim")}
            />
          </Field>

          <Field
            label={`Corrective action requested from the ${party}${customer ? "" : " (SCAR)"}?`}
            required
          >
            <Segmented
              control={control}
              name="scar"
              label="Corrective action requested?"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
          </Field>
          {scar === "no" ? (
            <Field label="Why not" htmlFor="sup-scar-why" required>
              <input
                id="sup-scar-why"
                placeholder={`e.g. One-off transit damage; ${party} informed`}
                className={CONTROL}
                {...register("scarNotReason")}
              />
            </Field>
          ) : (
            <div className="hidden md:block" />
          )}

          {scar === "yes" && (
            <>
              <Field
                label={customer ? "Request reference" : "SCAR reference"}
                htmlFor="sup-scar-ref"
                required
              >
                <input
                  id="sup-scar-ref"
                  placeholder="e.g. SCAR-2026-014"
                  className={cn(CONTROL, "font-mono")}
                  {...register("scarRef")}
                />
              </Field>
              <Field label={`${Party} reply due`} htmlFor="sup-scar-due">
                <DateControl control={control} name="scarDue" id="sup-scar-due" />
              </Field>
              <Field label={`${Party} reply received on`} htmlFor="sup-scar-reply" required>
                <DateControl control={control} name="scarReplyOn" id="sup-scar-reply" />
              </Field>
              <Field
                label={`${Party}’s root cause and fix`}
                required
                hint={
                  accepted === "no"
                    ? undefined
                    : "Accept once their root cause and corrective action make sense."
                }
              >
                <Segmented
                  control={control}
                  name="scarAccepted"
                  label="Root cause and fix"
                  options={[
                    { value: "yes", label: "Accepted" },
                    { value: "no", label: "Not accepted" },
                  ]}
                />
                {accepted === "no" && (
                  <p className="text-[0.6875rem] leading-snug text-warn-ink">
                    Not accepted: decide on a CAPA below
                    {customer
                      ? "."
                      : ", and follow up under supplier management (re-audit or reduced status)."}
                  </p>
                )}
              </Field>
            </>
          )}

          <Field
            label="Tightened inspection for the next lots?"
            required
            hint="More sampling on the next deliveries until the problem is shown to be fixed."
          >
            <Segmented
              control={control}
              name="tightened"
              label="Tightened inspection?"
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
          </Field>
          {tightened === "yes" ? (
            <Field label="For how many lots" htmlFor="sup-tight" required>
              <input
                id="sup-tight"
                placeholder="e.g. Next 3 lots"
                className={CONTROL}
                {...register("tightenedLots")}
              />
            </Field>
          ) : (
            <div className="hidden md:block" />
          )}
        </fieldset>
        {canEdit && (
          <button type="submit" disabled={formState.isSubmitting} className={SECONDARY_BUTTON}>
            {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Save {party} follow-up
          </button>
        )}
      </form>
    </section>
  );
}

/* ── Customer notification (finished product) ────────────────────────── */

function CustomerSection({
  deviation: d,
  factoryId,
  canEdit,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
}) {
  const refresh = useRefresh(factoryId, d.id);
  const form = useForm<NcrCustomerValues>({
    resolver: zodResolver(ncrCustomerSchema),
    defaultValues: ncrCustomerValues(d),
  });
  const { control, register, formState } = form;
  const notify = useWatch({ control, name: "notify" });

  async function save(v: NcrCustomerValues) {
    try {
      await saveNcrCustomer(d.id, v);
      await refresh();
      toast.success("Customer notification saved.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
        Customer notification
        {d.customer_name && (
          <span className="text-sm font-normal text-ink-4">{d.customer_name}</span>
        )}
      </h3>
      <form noValidate onSubmit={form.handleSubmit(save)} className="space-y-5">
        <fieldset disabled={!canEdit} className="grid min-w-0 gap-x-6 gap-y-5 md:grid-cols-2">
          <Field
            label="Customer (brand owner) notified?"
            required
            hint="Quality agreements usually require it for anything affecting their product."
          >
            <Segmented
              control={control}
              name="notify"
              label="Customer notified?"
              options={[
                { value: "yes", label: "Yes" },
                { value: "not_needed", label: "Not needed" },
              ]}
            />
          </Field>
          {notify === "yes" ? (
            <Field label="Notified on" htmlFor="cus-on" required>
              <DateControl control={control} name="notifiedOn" id="cus-on" />
            </Field>
          ) : notify === "not_needed" ? (
            <Field label="Why not" htmlFor="cus-why" required>
              <input
                id="cus-why"
                placeholder="e.g. Caught before release; no customer impact"
                className={CONTROL}
                {...register("reason")}
              />
            </Field>
          ) : (
            <div className="hidden md:block" />
          )}
        </fieldset>
        {canEdit && (
          <button type="submit" disabled={formState.isSubmitting} className={SECONDARY_BUTTON}>
            {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Save customer notification
          </button>
        )}
      </form>
    </section>
  );
}
