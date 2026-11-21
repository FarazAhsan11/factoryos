"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useWatch } from "react-hook-form";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DEV_CLOSE_REASONS,
  devCloseOutSignSchema,
  type DevCloseOutValues,
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
import { formatDateTime } from "@/lib/factory/dates";
import {
  closeDevCase,
  devChecklist,
  devCloseOutValues,
  deviationKeys,
  firstSignDevCloseOut,
  saveDevCloseOut,
  signaturesNeeded,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * A deviation's close-out, as the reference QMS lays it out (qms-v4): what
 * must be done in the other tabs first, then the close-out itself — any
 * unresolved risk, the summary and residual risk, the reason (and what it
 * duplicates, or the cost of quality) — and the signature. A Critical case
 * takes two: the first leaves it open with the close-out fixed, a second QA
 * approver closes it.
 *
 * The list shows only the other tabs' items; the close-out's own fields are
 * checked when it is signed, with the error beside each field. The text by
 * Sign names whatever is still open. The database re-checks all of it.
 */
export function DevCloseOutTab({
  deviation: d,
  factoryId,
  canEdit,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up. */
  canEdit: boolean;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const form = useForm<DevCloseOutValues>({
    resolver: zodResolver(devCloseOutSignSchema),
    defaultValues: devCloseOutValues(d),
  });
  const { control, register, formState } = form;
  const errors = formState.errors;
  const [saving, setSaving] = useState(false);

  const open = d.status === "open";
  const firstSigned = Boolean(d.close_first_signed_at);
  const locked = !canEdit || !open || firstSigned;
  const needed = signaturesNeeded(d);

  const risk = useWatch({ control, name: "unresolvedRisk" });
  const reason = useWatch({ control, name: "reason" });

  // The other tabs' items only; this form's fields are checked on Sign (P1).
  const items = devChecklist(d).filter((i) => !i.here);
  const stillOpen = items.filter((i) => !i.done);
  const ready = stillOpen.length === 0;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const sign = useMutation({
    mutationFn: async (v: DevCloseOutValues) => {
      if (needed === 2 && !firstSigned) {
        await firstSignDevCloseOut(d.id, v, viewerName);
        return "first" as const;
      }
      // The second signature should be another person. Said, not enforced —
      // for now, so it can be tested with one login.
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (firstSigned && norm(viewerName) === norm(d.close_first_signed_by_name)) {
        toast.warning(
          "You signed the first close-out signature — the second should normally be another QA approver.",
        );
      }
      await closeDevCase(d, v, viewerName);
      return "closed" as const;
    },
    onSuccess: async (result) => {
      await refresh();
      if (result === "first") {
        toast.success("Signed — a second QA signature is needed.");
        return;
      }
      if (d.is_quarantining) {
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(
          `${d.deviation_no} closed. The held batch is released by its next preparatory or production entry.`,
        );
      } else {
        toast.success(`${d.deviation_no} closed.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveDraft() {
    setSaving(true);
    try {
      await saveDevCloseOut(d.id, form.getValues());
      await refresh();
      toast.success("Close-out saved — not signed yet.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const busy = formState.isSubmitting || saving;

  return (
    <div className="space-y-7">
      {(firstSigned || !open) && (
        <div className="space-y-2">
          {firstSigned && (
            <Signature
              text={`${needed === 2 ? "First signature" : "Signed"} by ${d.close_first_signed_by_name}`}
              at={d.close_first_signed_at!}
            />
          )}
          {!open && d.closed_at && (
            <Signature
              text={`${firstSigned ? "Second signature — closed" : "Closed"} by ${d.qa_sign_name}`}
              at={d.closed_at}
            />
          )}
        </div>
      )}

      <Section title="Done in the other tabs">
        <ul className="divide-y divide-line-soft">
          {items.map((item) => (
            <li key={item.label} className="relative flex items-center gap-3 py-2.5 text-sm">
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full",
                  item.done ? "bg-teal-soft text-teal-deep" : "border border-line-strong",
                )}
              >
                {item.done && <Check className="size-3.5" />}
              </span>
              <span className={item.done ? "text-ink" : "text-ink-3"}>
                {item.label}
              </span>
              <span className="sr-only">{item.done ? "done" : "not done"}</span>
            </li>
          ))}
        </ul>
        {d.is_quarantining && open && (
          <p className="mt-3 rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
            Release or reject each batch still on hold (Details → Batch holds)
            before signing. A released batch&rsquo;s card comes off hold with its next
            preparatory or production entry in the shift log.
          </p>
        )}
      </Section>

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
        className="space-y-6"
      >
        <Section title="Close-out">
          <fieldset disabled={locked} className="min-w-0">
            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <Field
                label="Any unresolved product or patient risk?"
                required
                error={errors.unresolvedRisk?.message}
              >
                <Segmented
                  control={control}
                  name="unresolvedRisk"
                  label="Any unresolved product or patient risk?"
                  options={[
                    { value: "no", label: "No" },
                    { value: "yes", label: "Yes" },
                  ]}
                />
                {risk === "yes" && !errors.unresolvedRisk && (
                  <p className="text-[0.6875rem] font-medium text-danger-deep">
                    The case cannot close while risk remains. Keep it open or
                    raise a new case.
                  </p>
                )}
              </Field>
              <div />

              <Field
                label="Close-out summary and residual risk"
                htmlFor="co-summary"
                required
                error={errors.summary?.message}
                className="md:col-span-2"
              >
                <textarea
                  id="co-summary"
                  rows={3}
                  placeholder="What was decided, what was done, and any risk that remains"
                  className={AREA}
                  {...register("summary")}
                />
              </Field>

              <Field
                label="Reason for closing"
                htmlFor="co-reason"
                required
                error={errors.reason?.message}
              >
                <SelectControl
                  control={control}
                  name="reason"
                  id="co-reason"
                  placeholder="Select…"
                  invalid={Boolean(errors.reason)}
                  options={DEV_CLOSE_REASONS.map((r) => ({ value: r, label: r }))}
                />
              </Field>

              {reason === "Duplicate" ? (
                <Field
                  label="Duplicate of"
                  htmlFor="co-dup"
                  required
                  error={errors.duplicateOf?.message}
                >
                  <input
                    id="co-dup"
                    placeholder="e.g. DEV-2026-004"
                    className={cn(CONTROL, "font-mono")}
                    {...register("duplicateOf")}
                  />
                </Field>
              ) : (
                <Field
                  label="Cost of quality ($)"
                  htmlFor="co-cost"
                  note="(optional)"
                  error={errors.cost?.message}
                >
                  <input
                    id="co-cost"
                    inputMode="decimal"
                    placeholder="e.g. 1250.50"
                    className={cn(CONTROL, "tabular-nums")}
                    {...register("cost")}
                  />
                </Field>
              )}
            </div>
          </fieldset>
        </Section>

        {canEdit && open && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-5">
            <button
              type="submit"
              disabled={busy || !ready}
              className={PRIMARY_BUTTON}
            >
              {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {firstSigned ? "Second signature" : "Sign close-out"}
            </button>
            {!firstSigned && (
              <button
                type="button"
                onClick={saveDraft}
                disabled={busy}
                className={SECONDARY_BUTTON}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save draft
              </button>
            )}
            <span className="text-[0.8125rem] text-ink-4">
              {!ready
                ? `Still open: ${stillOpen.map((i) => i.label).join(", ")}.`
                : needed === 2
                  ? firstSigned
                    ? "Critical: one more QA signature."
                    : "Critical: two QA signatures needed."
                  : "One QA signature."}{" "}
              Signing as {viewerName}.
            </span>
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * The close-out as text, for the printed report: the signatures, the
 * checklist as it stands, and the answers — "Not recorded" where there are
 * none.
 */
export function CloseOutFacts({ deviation: d }: { deviation: Deviation }) {
  const open = d.status === "open";
  const firstSigned = Boolean(d.close_first_signed_at);
  const needed = signaturesNeeded(d);
  return (
    <div className="space-y-7">
      {firstSigned || !open ? (
        <div className="space-y-2">
          {firstSigned && (
            <Signature
              text={`${needed === 2 ? "First signature" : "Signed"} by ${d.close_first_signed_by_name}`}
              at={d.close_first_signed_at!}
            />
          )}
          {!open && d.closed_at && (
            <Signature
              text={`${firstSigned ? "Second signature — closed" : "Closed"} by ${d.qa_sign_name}`}
              at={d.closed_at}
            />
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-ink-4">
          Not signed — the case is open.
          {needed === 2 && " Critical: two QA signatures are needed to close it."}
        </p>
      )}

      <Section title="Done in the other tabs">
        <ul className="divide-y divide-line-soft">
          {devChecklist(d)
            .filter((i) => !i.here)
            .map((item) => (
            <li key={item.label} className="relative flex items-center gap-3 py-2 text-sm">
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full",
                  item.done ? "bg-teal-soft text-teal-deep" : "border border-line-strong",
                )}
              >
                {item.done && <Check className="size-3.5" />}
              </span>
              <span className={item.done ? "text-ink" : "text-ink-3"}>{item.label}</span>
              <span className="sr-only">{item.done ? "done" : "not done"}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Close-out">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Unresolved product or patient risk">
            {d.unresolved_risk === null ? (
              <Muted>Not answered</Muted>
            ) : d.unresolved_risk ? (
              "Yes"
            ) : (
              "No"
            )}
          </Fact>
          <Fact label="Reason for closing">
            {d.status_reason ?? <Muted>Not recorded</Muted>}
          </Fact>
          {d.status_reason === "Duplicate" ? (
            <Fact label="Duplicate of" mono>
              {d.duplicate_of ?? <Muted>—</Muted>}
            </Fact>
          ) : (
            <Fact label="Cost of quality ($)">
              {d.cost_of_quality !== null ? (
                Number(d.cost_of_quality).toFixed(2)
              ) : (
                <Muted>Not recorded</Muted>
              )}
            </Fact>
          )}
          <Fact label="Close-out summary and residual risk" wide>
            {d.closing_note ?? <Muted>Not recorded</Muted>}
          </Fact>
        </dl>
      </Section>
    </div>
  );
}

function Signature({ text, at }: { text: string; at: string }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
      <CheckCircle2 className="size-4 shrink-0" />
      {text} · {formatDateTime(at)}
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
