"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useForm,
  useWatch,
  type DefaultValues,
} from "react-hook-form";
import { FileWarning, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  deviationSchema,
  type DeviationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import {
  DEVIATION_TYPES,
  DISPOSITIONS,
  createDeviation,
} from "@/lib/factory/deviation-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useCapaOptions } from "@/components/factory/deviations/use-capa-options";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

const AREA =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

// `type` is left unset on purpose: which kind of record this is decides its
// number, and a pre-selected answer is one nobody gave.
const EMPTY: DefaultValues<DeviationValues> = {
  type: undefined,
  batchNo: "",
  specification: "",
  actual: "",
  impact: "",
  disposition: "",
  raisedBy: "",
  qaReviewer: "",
  actionId: "",
};

/**
 * Raise a deviation or an NCR.
 *
 * The prototype's form, with one departure: **the batch is typed**, as it is
 * on every other form that references one, and resolved against the
 * catalogue as it is typed. A dropdown of open batches stops working the
 * moment the batch is not on the board — and an NCR against incoming
 * material is raised before it ever is.
 *
 * Quarantine is the one answer with consequences outside this screen, so the
 * form says what it will do before it is submitted.
 */
export function NewDeviationDialog({
  factoryId,
  userId,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  const capaGroups = useCapaOptions(factoryId);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeviationValues>({
    resolver: zodResolver(deviationSchema),
    defaultValues: EMPTY,
  });

  const type = useWatch({ control, name: "type" });
  const disposition = useWatch({ control, name: "disposition" });
  const batchNo = useWatch({ control, name: "batchNo" });

  const matched = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const isNcr = type === "ncr";
  const quarantine = isNcr && disposition === "quarantine";
  const typed = (batchNo ?? "").trim();

  const create = useMutation({
    mutationFn: (values: DeviationValues) => {
      // Refused by the database too; said here so it arrives before the
      // round-trip, in the same words.
      if (quarantine && !matched) {
        throw new Error(
          `Quarantine holds a batch — ${values.batchNo} is not one in the product register.`,
        );
      }
      return createDeviation(factoryId, values, userId);
    },
    onSuccess: async (number, values) => {
      reset(EMPTY);
      setOpen(false);
      onCreated();
      if (values.type === "ncr" && values.disposition === "quarantine") {
        // The hold happened in the database; stop trusting the board we have.
        await queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        });
        toast.success(`${number} raised — batch ${values.batchNo} is on hold.`);
      } else {
        toast.success(`${number} raised.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset(EMPTY);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        New deviation / NCR
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="flex items-center gap-2 text-ink">
              <FileWarning className="size-4 text-brand" />
              New deviation / NCR
            </DialogTitle>
            <DialogDescription>
              Numbered when it is raised — DEV for a deviation, NCR for a
              non-conformance. QA closes it once the outcome is known.
            </DialogDescription>
          </DialogHeader>

          <form
            // Awaited so the button stays disabled for the round-trip; the
            // failure is already a toast, so it is not rethrown.
            onSubmit={handleSubmit((values) =>
              create.mutateAsync(values).catch(() => {}),
            )}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <Field label="Type" required error={errors.type?.message}>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DEVIATION_TYPES.map((t) => (
                    <label
                      key={t.value}
                      className="relative flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-xl border border-line bg-surface py-2.5 pr-3 pl-4 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:ring-2 has-[:checked]:ring-brand/15 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/20"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-1"
                        style={{ background: t.spine }}
                      />
                      <input
                        type="radio"
                        value={t.value}
                        {...register("type")}
                        className="sr-only"
                      />
                      <span className="text-sm font-semibold text-ink">
                        {t.label}
                      </span>
                      <span className="text-[11px] text-ink-5">{t.hint}</span>
                    </label>
                  ))}
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Batch number"
                  htmlFor="dev-batch"
                  note={quarantine ? undefined : "(optional)"}
                  required={quarantine}
                  error={errors.batchNo?.message}
                >
                  <input
                    id="dev-batch"
                    placeholder="Type a batch number"
                    aria-invalid={Boolean(errors.batchNo)}
                    className={cn(CONTROL, "font-mono")}
                    {...register("batchNo")}
                  />
                  <div className="mt-1.5">
                    <BatchSummary factoryId={factoryId} batchNo={batchNo ?? ""} />
                  </div>
                </Field>

                <Field label="Raised by" htmlFor="dev-raised" note="(optional)">
                  <input
                    id="dev-raised"
                    placeholder="Your name"
                    className={CONTROL}
                    {...register("raisedBy")}
                  />
                </Field>
              </div>

              <Field
                label="What was the specification / requirement?"
                htmlFor="dev-spec"
                note="(optional)"
                error={errors.specification?.message}
              >
                <input
                  id="dev-spec"
                  placeholder="e.g. Mixing time = 30 min, capsule weight 285–295 mg"
                  className={CONTROL}
                  {...register("specification")}
                />
              </Field>

              <Field
                label="What actually happened?"
                htmlFor="dev-actual"
                required
                error={errors.actual?.message}
              >
                <textarea
                  id="dev-actual"
                  rows={3}
                  placeholder="e.g. Capsule weight 302 mg, outside spec, found at the 10:00 in-process check"
                  aria-invalid={Boolean(errors.actual)}
                  className={AREA}
                  {...register("actual")}
                />
              </Field>

              <Field
                label="Potential impact on product quality"
                htmlFor="dev-impact"
                note="(optional)"
                error={errors.impact?.message}
              >
                <textarea
                  id="dev-impact"
                  rows={2}
                  placeholder="e.g. Minimal — within acceptance criteria after re-test"
                  className={AREA}
                  {...register("impact")}
                />
              </Field>

              {isNcr && (
                <Field
                  label="Batch disposition decision"
                  required
                  error={errors.disposition?.message}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DISPOSITIONS.map((d) => (
                      <label
                        key={d.value}
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:ring-2 has-[:checked]:ring-brand/15"
                      >
                        <input
                          type="radio"
                          value={d.value}
                          {...register("disposition")}
                          className="mt-0.5 size-4 accent-brand"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {d.label}
                          </span>
                          <span className="block text-[11px] text-ink-5">
                            {d.hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* The consequence, said before the submit rather than
                      discovered on the board afterwards. */}
                  {quarantine && (
                    <p
                      className={cn(
                        "mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
                        typed && !matched
                          ? "border-danger-line bg-danger-soft text-danger-deep"
                          : "border-warn-line bg-warn-tint text-warn-ink",
                      )}
                    >
                      <Lock className="mt-0.5 size-3.5 shrink-0" />
                      {!typed
                        ? "Quarantine holds a batch — type its number above."
                        : !matched
                          ? `No batch ${typed} in the product register, so there is nothing to hold.`
                          : `Batch ${matched.batch_no} goes on hold. Preparatory and production work can't be logged against it until this NCR is closed; downtime still can.`}
                    </p>
                  )}
                </Field>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="QA reviewer" htmlFor="dev-qa" note="(optional)">
                  <input
                    id="dev-qa"
                    placeholder="QA manager name"
                    className={CONTROL}
                    {...register("qaReviewer")}
                  />
                </Field>

                <Field label="Link to CAPA" htmlFor="dev-capa" note="(optional)">
                  <Controller
                    name="actionId"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="dev-capa"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        clearable
                        clearLabel="No CAPA"
                        placeholder="None"
                        searchPlaceholder="Issue title or batch…"
                        emptyMessage="No issues raised yet."
                        groups={capaGroups}
                      />
                    )}
                  />
                </Field>
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="h-10 rounded-xl px-4 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {isNcr ? "Raise NCR" : "Raise deviation"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  note,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  note?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
        {note && <span className="ml-1 text-[10px] text-ink-5">{note}</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
