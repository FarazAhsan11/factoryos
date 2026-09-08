"use client";

import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Beaker, Loader2, Package, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  BATCH_TYPES,
  BULK_UNITS,
  PACK_UNITS,
  PRIORITIES,
  PRIORITY_LABELS,
  bulkNeeded,
  editBatchSchema,
  type BatchType,
  type EditBatchParsed,
  type EditBatchValues,
} from "@/app/factory/[slug]/pipeline/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import {
  updateBatchJob,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";
const MONO = "font-mono tracking-tight";
const LABEL = "text-[11px] font-semibold tracking-[0.02em] text-ink-4 uppercase";

const TYPE_ICONS: Record<BatchType, typeof Package> = {
  manufacturing: Beaker,
  packing: Package,
  combined: RefreshCw,
};

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Pipeline → Edit batch.
 *
 * The same questions as New batch, minus the batch itself. Which catalogue row
 * a card is for is not editable and never was: it is what every logged entry
 * resolves through, and changing it would quietly re-point the meaning of work
 * already recorded.
 *
 * This exists mainly for the batches that predate batch families. Migration
 * 0031 backfilled every one of them as **Combined**, which is exactly what
 * they were — manufactured and packed under one number — but a plant that
 * splits its bulk from its packing runs needs to be able to say so about a
 * batch already on the board, not only about the next one.
 */
export function EditBatchDialog({
  job,
  jobs,
  onSaved,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that batch. */
  job: PipelineJob | null;
  /** The board, for the bulk-source picker. */
  jobs: PipelineJob[];
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditBatchValues, unknown, EditBatchParsed>({
    resolver: zodResolver(editBatchSchema),
    defaultValues: emptyValues(),
  });

  const [batchType, packSize, parentJobId] = useWatch({
    control,
    name: ["batchType", "packSize", "parentJobId"],
  });

  // Load the batch's current settings each time it opens, so a dialog closed
  // by accident reopens showing what is actually stored rather than whatever
  // was half-typed last time.
  useEffect(() => {
    if (!job) return;
    reset({
      batchType: job.batch_type,
      priority: job.priority,
      dueDate: job.due_date ?? "",
      notes: job.notes ?? "",
      bulkUnit: (job.bulk_unit ?? "") as EditBatchValues["bulkUnit"],
      overagePct: job.overage_pct ? Number(job.overage_pct) : undefined,
      tolerancePct: job.tolerance_pct ? Number(job.tolerance_pct) : undefined,
      parentJobId: job.parent_job_id ?? "",
      packSize: job.pack_size ? Number(job.pack_size) : undefined,
      packUnit: (job.pack_unit ?? "") as EditBatchValues["packUnit"],
      bulkQtyReceived: job.bulk_qty_received
        ? Number(job.bulk_qty_received)
        : undefined,
      market: job.market ?? "",
    });
  }, [job, reset]);

  /**
   * Possible bulk sources: manufacturing batches other than this one.
   *
   * Excluding itself is not paranoia — `pipeline_jobs_family_guard` refuses a
   * self-reference, so offering it would be a control that fails.
   */
  const bulkSources = useMemo(
    () =>
      jobs.filter((j) => j.batch_type === "manufacturing" && j.id !== job?.id),
    [jobs, job?.id],
  );

  const save = useMutation({
    mutationFn: (values: EditBatchParsed) => updateBatchJob(job!.id, values),
    onSuccess: async () => {
      toast.success(`Batch ${job?.batch_no} updated.`);
      await onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const type = (batchType ?? "combined") as BatchType;
  const isManufacturing = type === "manufacturing";
  const isPacking = type === "packing";
  const meta = BATCH_TYPES.find((t) => t.value === type);

  const needed = isPacking
    ? bulkNeeded(
        job?.required_qty || undefined,
        typeof packSize === "number" ? packSize : undefined,
      )
    : null;
  const parent = bulkSources.find((j) => j.id === parentJobId);

  /**
   * A parent with packing runs drawing on it cannot change type — the guard in
   * 0031 refuses it, because those runs would be left pointing at a batch that
   * is no longer bulk. Said before the attempt rather than as a rejection.
   */
  const lockedByChildren =
    job?.batch_type === "manufacturing" && job.child_count > 0;

  return (
    <Dialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="text-ink">
            Edit batch — {job?.batch_no}
          </DialogTitle>
          <DialogDescription className="break-words">
            {job?.product_name}
            {job?.required_qty ? ` · ${fmt(job.required_qty)} required` : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <section className="space-y-2">
              <p className={LABEL}>What type of batch is this?</p>
              <Controller
                name="batchType"
                control={control}
                render={({ field }) => (
                  <div
                    role="radiogroup"
                    aria-label="Batch type"
                    className="grid gap-2 sm:grid-cols-3"
                  >
                    {BATCH_TYPES.map((option) => {
                      const Icon = TYPE_ICONS[option.value];
                      const on = field.value === option.value;
                      const blocked =
                        lockedByChildren && option.value !== "manufacturing";
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={blocked}
                          title={
                            blocked
                              ? "Packing batches draw on this bulk — unlink them first."
                              : undefined
                          }
                          onClick={() => field.onChange(option.value)}
                          className={cn(
                            "rounded-2xl border p-3 text-left transition",
                            on
                              ? "border-brand bg-brand-tint shadow-[0_0_0_3px_rgba(79,70,229,0.10)]"
                              : "border-line bg-surface hover:border-ink-6 hover:bg-sunken",
                            blocked && "cursor-not-allowed opacity-40",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-4",
                              on ? "text-brand" : "text-ink-5",
                            )}
                            aria-hidden
                          />
                          <span
                            className={cn(
                              "mt-1.5 block text-[13px] font-semibold",
                              on ? "text-brand-deep" : "text-ink",
                            )}
                          >
                            {option.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-ink-5">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              />
              {meta && <p className="text-[11px] text-ink-5">{meta.hint}</p>}
              {lockedByChildren && (
                <p className="rounded-xl border border-warn-line bg-warn-tint px-3 py-2 text-[11px] text-warn-ink">
                  {job?.child_count} packing batch
                  {job?.child_count === 1 ? "" : "es"} draw on this bulk, so its
                  type is fixed while they do. Unlink them first to change it.
                </p>
              )}
            </section>

            {isManufacturing && (
              <TypeSection
                icon={Beaker}
                title="Bulk production details"
                tone="border-warn-line bg-warn-tint"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Bulk unit"
                    htmlFor="eb-bulk-unit"
                    error={errors.bulkUnit?.message}
                  >
                    <Controller
                      name="bulkUnit"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          id="eb-bulk-unit"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          clearable
                          options={BULK_UNITS.map((unit) => ({
                            value: unit,
                            label: unit,
                          }))}
                        />
                      )}
                    />
                  </Field>
                  <Field
                    label="Overage %"
                    note="extra made on purpose"
                    htmlFor="eb-overage"
                    error={errors.overagePct?.message}
                  >
                    <input
                      id="eb-overage"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      placeholder="e.g. 4"
                      className={cn(FIELD, MONO)}
                      {...register("overagePct", { valueAsNumber: true })}
                    />
                  </Field>
                </div>
              </TypeSection>
            )}

            {/* The same three fields New batch offers. A value that can be
                set at creation and not corrected afterwards is the drift this
                dialog exists to prevent — the reason both forms share
                `batchFields` in the first place. */}
            {type === "combined" && (
              <TypeSection
                icon={RefreshCw}
                title="Single batch details"
                tone="border-teal-line bg-teal-soft"
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Pack size"
                    note="units per container"
                    optional
                    htmlFor="eb-pack-size-combined"
                    error={errors.packSize?.message}
                  >
                    <input
                      id="eb-pack-size-combined"
                      type="number"
                      step="any"
                      min={0}
                      placeholder="e.g. 60"
                      className={cn(FIELD, MONO)}
                      {...register("packSize", { valueAsNumber: true })}
                    />
                  </Field>
                  <Field
                    label="Pack unit"
                    optional
                    htmlFor="eb-pack-unit-combined"
                    error={errors.packUnit?.message}
                  >
                    <Controller
                      name="packUnit"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          id="eb-pack-unit-combined"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          clearable
                          options={PACK_UNITS.map((unit) => ({
                            value: unit,
                            label: unit,
                          }))}
                        />
                      )}
                    />
                  </Field>
                  <Field
                    label="Overage %"
                    optional
                    htmlFor="eb-overage-combined"
                    error={errors.overagePct?.message}
                  >
                    <input
                      id="eb-overage-combined"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      placeholder="e.g. 4"
                      className={cn(FIELD, MONO)}
                      {...register("overagePct", { valueAsNumber: true })}
                    />
                  </Field>
                </div>
              </TypeSection>
            )}

            {isPacking && (
              <TypeSection
                icon={Package}
                title="Finished lot details"
                tone="border-brand-line bg-brand-tint"
              >
                <Field
                  label="Bulk from"
                  htmlFor="eb-parent"
                  error={errors.parentJobId?.message}
                >
                  <Controller
                    name="parentJobId"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="eb-parent"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        // Drawing bulk from outside the plant is a real
                        // answer, not an unfilled field — so it keeps a named
                        // row rather than becoming a placeholder.
                        clearable
                        clearLabel="No parent — external bulk"
                        placeholder="No parent — external bulk"
                        searchPlaceholder="Batch number or product…"
                        emptyMessage="No manufacturing batch matches that."
                        options={bulkSources.map((source) => ({
                          value: source.id,
                          label: `${source.batch_no} — ${source.product_name}`,
                          meta: source.bulk_unit ?? undefined,
                        }))}
                      />
                    )}
                  />
                </Field>
                {bulkSources.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-5">
                    No manufacturing batches on the board yet — add one to link
                    this run to its bulk.
                  </p>
                )}

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Pack size"
                    note="units per container"
                    htmlFor="eb-pack-size"
                    error={errors.packSize?.message}
                  >
                    <input
                      id="eb-pack-size"
                      type="number"
                      step="any"
                      min={0}
                      placeholder="e.g. 60"
                      className={cn(FIELD, MONO)}
                      {...register("packSize", { valueAsNumber: true })}
                    />
                  </Field>
                  <Field
                    label="Pack unit"
                    htmlFor="eb-pack-unit"
                    error={errors.packUnit?.message}
                  >
                    <Controller
                      name="packUnit"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          id="eb-pack-unit"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          clearable
                          options={PACK_UNITS.map((unit) => ({
                            value: unit,
                            label: unit,
                          }))}
                        />
                      )}
                    />
                  </Field>
                  <Field
                    label="Market"
                    optional
                    htmlFor="eb-market"
                    error={errors.market?.message}
                  >
                    <input
                      id="eb-market"
                      placeholder="AU, NZ, UK…"
                      className={FIELD}
                      {...register("market")}
                    />
                  </Field>
                </div>

                <Field
                  label="Bulk qty received"
                  optional
                  htmlFor="eb-bulk-received"
                  error={errors.bulkQtyReceived?.message}
                  className="mt-3"
                >
                  <input
                    id="eb-bulk-received"
                    type="number"
                    step="any"
                    min={0}
                    placeholder={needed ? String(needed) : "e.g. 60000"}
                    className={cn(FIELD, MONO)}
                    {...register("bulkQtyReceived", { valueAsNumber: true })}
                  />
                </Field>

                {needed !== null && (
                  <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-3">
                    Bulk needed:{" "}
                    <strong className="font-mono font-semibold text-brand">
                      {fmt(needed)}
                    </strong>
                    {parent
                      ? ` of ${parent.batch_no}'s ${fmt(parent.required_qty)} ${parent.bulk_unit ?? "units"}`
                      : null}
                  </p>
                )}
              </TypeSection>
            )}

            {/* Outside the type sections, unlike overage: every batch type
                has planned stages, so every batch type has a ceiling the log
                enforces against them. Editable after the fact on purpose —
                raising it is the sanctioned way past a refusal, and it leaves
                a record here rather than an amendment on someone's entry. */}
            <Field
              label="Stage tolerance %"
              note="how far past a planned stage the log will accept"
              optional
              htmlFor="eb-tolerance"
              error={errors.tolerancePct?.message}
            >
              <input
                id="eb-tolerance"
                type="number"
                step="any"
                min={0}
                max={100}
                placeholder="e.g. 5"
                className={cn(FIELD, MONO, "sm:max-w-[12rem]")}
                {...register("tolerancePct", { valueAsNumber: true })}
              />
              <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
                Applies to every stage in this batch&rsquo;s plan that
                hasn&rsquo;t been given its own. A stage already past the new
                ceiling isn&rsquo;t unwound — entries already filed stay — but
                its progress bar turns red until the plan agrees with them.
              </p>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Priority" htmlFor="eb-priority">
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      id="eb-priority"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      options={PRIORITIES.map((p) => ({
                        value: p,
                        label: PRIORITY_LABELS[p],
                      }))}
                    />
                  )}
                />
              </Field>
              <Field
                label="Due date"
                optional
                htmlFor="eb-due"
                error={errors.dueDate?.message}
              >
                <Controller
                  name="dueDate"
                  control={control}
                  render={({ field }) => (
                    <DateField
                      id="eb-due"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="No date"
                    />
                  )}
                />
              </Field>
            </div>

            <Field
              label="Notes"
              optional
              htmlFor="eb-notes"
              error={errors.notes?.message}
            >
              <input
                id="eb-notes"
                placeholder="Materials ready, setup scheduled…"
                className={FIELD}
                {...register("notes")}
              />
            </Field>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
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
              Save changes
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyValues(): EditBatchValues {
  return {
    batchType: "combined",
    priority: "medium",
    dueDate: "",
    notes: "",
    bulkUnit: "",
    overagePct: undefined,
    tolerancePct: undefined,
    parentJobId: "",
    packSize: undefined,
    packUnit: "",
    bulkQtyReceived: undefined,
    market: "",
  };
}

function TypeSection({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: typeof Package;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border p-3.5", tone)}>
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.04em] text-ink-2 uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </p>
      {children}
    </section>
  );
}

function Field({
  label,
  note,
  optional,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  note?: string;
  optional?: boolean;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    /* A full-height column with the control pushed to the bottom, so a label
       that wraps to two lines — "Pack size (units per container)" at three
       across — does not push its input a line lower than its neighbours'.
       Aligning on the label instead would only work while every label in the
       row happened to be the same length. */
    <div className={cn("flex h-full flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
        {optional && (
          <span className="ml-1 text-[10px] font-normal normal-case text-ink-6">
            optional
          </span>
        )}
        {note && (
          <span className="ml-1 text-[10px] font-normal normal-case text-ink-6">
            ({note})
          </span>
        )}
      </label>
      <div className="mt-auto">{children}</div>
      {error && (
        <p role="alert" className="text-[11px] text-danger-deep">
          {error}
        </p>
      )}
    </div>
  );
}
