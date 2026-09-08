"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Beaker, Loader2, Package, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  BATCH_TYPES,
  BULK_UNITS,
  PACK_UNITS,
  PRIORITIES,
  PRIORITY_LABELS,
  bulkNeeded,
  newBatchSchema,
  type BatchType,
  type NewBatchParsed,
  type NewBatchValues,
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
import { createBatchJob, type PipelineJob } from "@/lib/factory/pipeline-queries";
import type { Product } from "@/lib/factory/product-queries";
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

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Pipeline → New batch.
 *
 * Two steps, because the first one changes what the second asks for. Picking
 * Manufacturing, Packing or Combined is not a field among fields — it decides
 * whether this batch produces bulk, draws on someone else's, or does both
 * under one number, and each answer needs a different half-dozen questions.
 * Asking all of them at once produced a form where two thirds of the boxes
 * were always irrelevant.
 *
 * The batch itself is **picked**, never typed. Admin → Products owns the
 * batch number, product name, code, work order and required quantity, and the
 * shift log resolves entries against that same row — so a batch typed here
 * would be a second place the name can be spelt and a second number for the
 * overrun check to disagree with. This dialog asks only what the *pipeline*
 * knows: what kind of batch it is, whose bulk it draws on, how it is packed.
 *
 * `NewJobDialog` is the bulk sibling — many batches, none of this detail.
 */
export function NewBatchDialog({
  factoryId,
  userId,
  products,
  jobs,
  onCreated,
  /** Opens straight onto Packing with this parent pre-filled. */
  presetParentId,
  open: controlledOpen,
  onOpenChange,
  trigger = true,
}: {
  factoryId: string;
  userId: string;
  /** Admin → Products: the batches this can be raised for. */
  products: Product[];
  /** The board, for the parent picker and for hiding batches already on it. */
  jobs: PipelineJob[];
  onCreated: () => void;
  presetParentId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False when the caller opens it itself — the families view does. */
  trigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    // Three generics, like `LogEntryForm`: the fields hold the *input* shape
    // while the submit handler receives what zod transformed — so "" becomes
    // undefined on the way out without the callback having to cast.
  } = useForm<NewBatchValues, unknown, NewBatchParsed>({
    resolver: zodResolver(newBatchSchema),
    defaultValues: emptyValues(factoryId),
  });

  const [batchType, productId, packSize, parentJobId] = useWatch({
    control,
    name: ["batchType", "productId", "packSize", "parentJobId"],
  });

  /**
   * Reset on open rather than on close, so a dialog dismissed by accident can
   * be reopened without the previous answers already gone — and so a preset
   * parent lands on a clean form every time the families view asks for one.
   */
  useEffect(() => {
    if (!open) return;
    reset({
      ...emptyValues(factoryId),
      ...(presetParentId
        ? { batchType: "packing" as const, parentJobId: presetParentId }
        : {}),
    });
  }, [open, factoryId, presetParentId, reset]);

  /** Manufacturing batches on the board are the only possible bulk sources. */
  const bulkSources = useMemo(
    () => jobs.filter((job) => job.batch_type === "manufacturing"),
    [jobs],
  );

  /**
   * The batches this dialog will offer.
   *
   * Active ones with no job yet — a batch is run once, so one already on the
   * board has nothing to add, and the unique index on `product_id` would
   * refuse it anyway. Retired batches are left out for the same reason they
   * are left out of the shift log: a date or a card on a retired batch is
   * history, not a plan.
   */
  const onBoard = useMemo(
    () => new Set(jobs.map((job) => job.product_id)),
    [jobs],
  );
  const available = useMemo(
    () => products.filter((p) => p.active && !onBoard.has(p.id)),
    [products, onBoard],
  );

  /** The catalogue row behind the picked batch — the source of every detail. */
  const picked = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  const create = useMutation({
    mutationFn: (values: NewBatchParsed) => createBatchJob(values, userId),
    onSuccess: () => {
      toast.success(`Batch ${picked?.batch_no ?? ""} added to Planned.`);
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const type = (batchType ?? "combined") as BatchType;
  const isManufacturing = type === "manufacturing";
  const isPacking = type === "packing";
  const meta = BATCH_TYPES.find((t) => t.value === type);

  // Containers come from the catalogue, pack size from this form — the two
  // halves of "how much bulk does this run need", from the two places that
  // own them.
  const needed = isPacking
    ? bulkNeeded(
        picked?.required_qty || undefined,
        typeof packSize === "number" ? packSize : undefined,
      )
    : null;
  const parent = bulkSources.find((j) => j.id === parentJobId);

  return (
    <>
      {trigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
        >
          <Plus className="size-4" />
          New batch
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="text-ink">New batch</DialogTitle>
            <DialogDescription>
              It lands in Planned and moves itself as entries are logged
              against it.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit((values) => create.mutateAsync(values))}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* ── Step 1 — the type ──────────────────────────────────── */}
              <section className="space-y-2">
                <p className={LABEL}>Step 1 — what type of batch is this?</p>
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
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => field.onChange(option.value)}
                            className={cn(
                              "rounded-2xl border p-3 text-left transition",
                              on
                                ? "border-brand bg-brand-tint shadow-[0_0_0_3px_rgba(79,70,229,0.10)]"
                                : "border-line bg-surface hover:border-ink-6 hover:bg-sunken",
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
                {meta && (
                  <p className="text-[11px] text-ink-5">{meta.hint}</p>
                )}
              </section>

              {/* ── Step 2 — the batch ─────────────────────────────────── */}
              <section className="space-y-3">
                <p className={LABEL}>Step 2 — which batch?</p>

                <Field
                  label="Batch"
                  htmlFor="nb-product"
                  error={errors.productId?.message}
                >
                  <Controller
                    name="productId"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="nb-product"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ariaInvalid={Boolean(errors.productId)}
                        placeholder="Select a batch…"
                        // The catalogue runs to hundreds of rows, so this is
                        // the picker the search box exists for. The code and
                        // work order are searchable through `meta` even
                        // though the row shows only the number and the name.
                        searchPlaceholder="Batch number, code or product…"
                        emptyMessage="No batch matches that."
                        options={available.map((product) => ({
                          value: product.id,
                          label: `${product.batch_no} — ${product.name}`,
                          meta: product.code || product.work_order || undefined,
                        }))}
                      />
                    )}
                  />
                </Field>

                {/* Read back, never re-typed. The catalogue owns the batch
                    number, the product name, the code, the work order and the
                    required quantity; the shift log resolves entries against
                    that same row. A second copy typed here would be a second
                    place the name can be spelt differently. */}
                {picked ? (
                  <dl className="grid gap-1.5 rounded-xl border border-brand-soft bg-brand-tint p-3.5 text-xs">
                    <Row label="Product" value={picked.name} />
                    <Row label="Code" value={picked.code || "—"} mono />
                    <Row
                      label="Work order"
                      value={picked.work_order || picked.batch_no}
                      mono
                    />
                    <Row
                      label={
                        isPacking
                          ? "Containers to fill"
                          : isManufacturing
                            ? "Bulk target"
                            : "Required qty"
                      }
                      value={
                        picked.required_qty ? fmt(picked.required_qty) : "Not set"
                      }
                      mono
                    />
                  </dl>
                ) : (
                  <p className="rounded-xl border border-dashed border-line-strong bg-surface px-3.5 py-3 text-xs text-ink-5">
                    {available.length === 0
                      ? "Every active batch is already on the board. Add more in Admin & Settings → Products."
                      : "Pick a batch and its product details fill in from Admin & Settings → Products."}
                  </p>
                )}

                {/* A packing run with no quantity contributes nothing to its
                    parent's allocation, so the family bar would silently
                    under-read. Said here, but fixed in Admin — that column is
                    the catalogue's, and editing it in two places is how the
                    two stop agreeing. */}
                {picked && !picked.required_qty && (
                  <p className="rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-[11px] text-warn-ink">
                    Batch {picked.batch_no} has no required quantity. Set it in
                    Admin &amp; Settings → Products, or this batch shows no
                    progress and counts as nothing against its bulk.
                  </p>
                )}


                {/* ── Tolerance ──────────────────────────────────────────
                    Sits with priority and the due date rather than in a type
                    section, because unlike overage it belongs to every batch
                    type: a packing stage has a target like any other, and 600
                    bottles against a 500-bottle run is the same mistake as 26
                    kg against a 20 kg mix.

                    Worth the sentence underneath. This dialog now carries two
                    percentages, and the difference between them is the whole
                    point: overage is extra deliberately *made* and raises a
                    flag; tolerance is how far past a stage's plan an entry may
                    be *recorded*, and it stops the entry. */}
                <Field
                  label="Stage tolerance %"
                  note="how far past a planned stage the log will accept"
                  optional
                  htmlFor="nb-tolerance"
                  error={errors.tolerancePct?.message}
                >
                  <input
                    id="nb-tolerance"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    placeholder="e.g. 5"
                    className={cn(FIELD, MONO, "sm:max-w-[12rem]")}
                    {...register("tolerancePct", { valueAsNumber: true })}
                  />
                </Field>
                {/* Outside the Field, like OverageNote: the inline error
                    belongs directly under the input, and the explanation
                    under both. */}
                <ToleranceNote control={control} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Priority" htmlFor="nb-priority">
                    <Controller
                      name="priority"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          id="nb-priority"
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
                    htmlFor="nb-due"
                    error={errors.dueDate?.message}
                  >
                    <Controller
                      name="dueDate"
                      control={control}
                      render={({ field }) => (
                        <DateField
                          id="nb-due"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="No date"
                        />
                      )}
                    />
                  </Field>
                </div>
              </section>

              {/* ── Manufacturing ──────────────────────────────────────── */}
              {isManufacturing && (
                <TypeSection
                  icon={Beaker}
                  title="Bulk production details"
                  tone="border-warn-line bg-warn-tint"
                >
                  {/* Two fields, and neither is obvious from its label — the
                      section said what it was called and not what it was for.
                      Both exist to make this batch's bulk *divisible*: the
                      unit is what its packing runs are measured back in, and
                      the overage is the slack they are allowed to eat. */}
                  <p className="mb-2.5 text-[11px] leading-snug text-ink-4">
                    This batch produces bulk that packing batches draw from.
                    {picked?.required_qty ? (
                      <>
                        {" "}
                        Its target is{" "}
                        <strong className="font-semibold text-ink-2">
                          {fmt(picked.required_qty)}
                        </strong>
                        , from the catalogue.
                      </>
                    ) : null}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Bulk unit"
                      htmlFor="nb-bulk-unit"
                      error={errors.bulkUnit?.message}
                    >
                      <Controller
                        name="bulkUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            id="nb-bulk-unit"
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
                      htmlFor="nb-overage"
                      error={errors.overagePct?.message}
                    >
                      <input
                        id="nb-overage"
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
                  <OverageNote control={control} required={picked?.required_qty} />
                </TypeSection>
              )}

              {/* ── Single batch ───────────────────────────────────────────
                  A single batch manufactures too — it just packs under the
                  same number — so it has the same reason to make a few percent
                  extra, and the same need for the over-production flag to know
                  that. It carries a pack size and unit for the same reason a
                  finished lot does: it ends in containers, and nothing else
                  says how many units go in one.

                  It needs no bulk unit: nothing else draws on it, so there is
                  no allocation to read back in one. */}
              {type === "combined" && (
                <TypeSection
                  icon={RefreshCw}
                  title="Single batch details"
                  tone="border-teal-line bg-teal-soft"
                >
                  {/* The ordered quantity is read, not typed. It lives on the
                      catalogue row as `required_qty`, and a second copy on the
                      job would give the overrun check (0023) and the plan's
                      own total different numbers to be right about. Shown here
                      so the panel still answers "how many", with the one place
                      it can be changed named. */}
                  <p className="mb-2.5 text-[11px] leading-snug text-ink-4">
                    Made and packed under one number.
                    {picked?.required_qty ? (
                      <>
                        {" "}
                        Ordered:{" "}
                        <strong className="font-semibold text-ink-2">
                          {fmt(picked.required_qty)}
                        </strong>
                        , from the catalogue — change it in Admin &amp; Settings
                        → Products.
                      </>
                    ) : picked ? (
                      <>
                        {" "}
                        This batch has no ordered quantity yet — set one in
                        Admin &amp; Settings → Products, or the stage plan has
                        nothing to be measured against.
                      </>
                    ) : null}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Pack size"
                      note="units per container"
                      optional
                      htmlFor="nb-pack-size-combined"
                      error={errors.packSize?.message}
                    >
                      <input
                        id="nb-pack-size-combined"
                        type="number"
                        step="any"
                        min={0}
                        placeholder="e.g. 60"
                        aria-invalid={Boolean(errors.packSize)}
                        className={cn(FIELD, MONO)}
                        {...register("packSize", { valueAsNumber: true })}
                      />
                    </Field>
                    <Field
                      label="Pack unit"
                      optional
                      htmlFor="nb-pack-unit-combined"
                      error={errors.packUnit?.message}
                    >
                      <Controller
                        name="packUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            id="nb-pack-unit-combined"
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
                      note="extra made on purpose"
                      optional
                      htmlFor="nb-overage-combined"
                      error={errors.overagePct?.message}
                    >
                      <input
                        id="nb-overage-combined"
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
                  <OverageNote control={control} required={picked?.required_qty} />
                </TypeSection>
              )}

              {/* ── Packing ────────────────────────────────────────────── */}
              {isPacking && (
                <TypeSection
                  icon={Package}
                  title="Finished lot details"
                  tone="border-brand-line bg-brand-tint"
                >
                  {/* The family link is made from the *child's* side, and
                      only here — a manufacturing batch has no children to
                      point at when it is created. The other way in is
                      "Add packing batch" on a family, which opens this dialog
                      with the parent already chosen. */}
                  <Field
                    label="Bulk from"
                    htmlFor="nb-parent"
                    error={errors.parentJobId?.message}
                  >
                    <Controller
                      name="parentJobId"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          id="nb-parent"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          // Not a placeholder: drawing bulk from outside the
                          // plant is a real answer, so it stays a named row.
                          clearable
                          clearLabel="No parent — external bulk"
                          placeholder="No parent — external bulk"
                          searchPlaceholder="Batch number or product…"
                          emptyMessage="No manufacturing batch matches that."
                          options={bulkSources.map((job) => ({
                            value: job.id,
                            label: `${job.batch_no} — ${job.product_name}`,
                            meta: job.bulk_unit ?? undefined,
                          }))}
                        />
                      )}
                    />
                  </Field>
                  {/* An empty list looks like a broken control otherwise: the
                      only option is "external bulk" and nothing says why. */}
                  {bulkSources.length === 0 && (
                    <p className="mt-1.5 text-[11px] text-ink-5">
                      No manufacturing batches on the board yet — add one first
                      to link this run to its bulk.
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Pack size"
                      note="units per container"
                      htmlFor="nb-pack-size"
                      error={errors.packSize?.message}
                    >
                      <input
                        id="nb-pack-size"
                        type="number"
                        step="any"
                        min={0}
                        placeholder="e.g. 60"
                        aria-invalid={Boolean(errors.packSize)}
                        className={cn(FIELD, MONO)}
                        {...register("packSize", { valueAsNumber: true })}
                      />
                    </Field>
                    <Field
                      label="Pack unit"
                      htmlFor="nb-pack-unit"
                      error={errors.packUnit?.message}
                    >
                      <Controller
                        name="packUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            id="nb-pack-unit"
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
                      htmlFor="nb-market"
                      error={errors.market?.message}
                    >
                      <input
                        id="nb-market"
                        placeholder="AU, NZ, UK…"
                        className={FIELD}
                        {...register("market")}
                      />
                    </Field>
                  </div>

                  <Field
                    label="Bulk qty received"
                    note="if it differs from what pack size implies"
                    optional
                    htmlFor="nb-bulk-received"
                    error={errors.bulkQtyReceived?.message}
                    className="mt-3"
                  >
                    <input
                      id="nb-bulk-received"
                      type="number"
                      step="any"
                      min={0}
                      placeholder={needed ? String(needed) : "e.g. 60000"}
                      className={cn(FIELD, MONO)}
                      {...register("bulkQtyReceived", { valueAsNumber: true })}
                    />
                  </Field>

                  {/* The arithmetic said out loud while it is being typed —
                      the same number the family allocation bar will show, so
                      the two can never look like different calculations. */}
                  {needed !== null && (
                    <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-3">
                      Bulk needed:{" "}
                      <strong className="font-mono font-semibold text-brand">
                        {fmt(needed)}
                      </strong>
                      {parent ? (
                        <>
                          {" "}
                          of {parent.batch_no}&rsquo;s{" "}
                          {fmt(parent.required_qty)}{" "}
                          {parent.bulk_unit ?? "units"}
                        </>
                      ) : null}
                    </p>
                  )}
                </TypeSection>
              )}

              <Field
                label="Notes"
                optional
                htmlFor="nb-notes"
                error={errors.notes?.message}
              >
                <input
                  id="nb-notes"
                  placeholder="Materials ready, setup scheduled…"
                  className={FIELD}
                  {...register("notes")}
                />
              </Field>
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
                Add to pipeline
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function emptyValues(factoryId: string): NewBatchValues {
  return {
    // "" is the unpicked state the select submits; zod refuses it, which is
    // what makes "pick a batch" an error on the control rather than a silent
    // insert of nothing.
    factoryId,
    batchType: "combined",
    productId: "",
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

/** The tinted block a batch type's own fields live in. */
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

/** One line of the read-back panel: what the catalogue says about the batch. */
function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-4">{label}</dt>
      <dd
        className={cn(
          "truncate font-medium text-ink",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * What declaring an overage actually buys, with this batch's own numbers in
 * it.
 *
 * Worth the space because the field is otherwise indistinguishable from a
 * note-to-self. Since migration 0032 it moves the threshold the shift log's
 * over-production flag measures against, and that is a rule about other
 * people's screens — the operator who gets flagged is not the planner who
 * typed the 4.
 */
/**
 * What the tolerance will actually do, in the batch's own terms.
 *
 * Spelt out because this dialog carries two percentages and they are one word
 * apart: overage is extra deliberately *made* against the work order and
 * raises a flag a manager clears; tolerance is how far past a single stage's
 * plan an entry may be *recorded*, and it refuses the entry outright. Someone
 * setting one while meaning the other gets a plant that either blocks nothing
 * or blocks everything.
 */
function ToleranceNote({
  control,
}: {
  control: Control<NewBatchValues, unknown, NewBatchParsed>;
}) {
  const pct = useWatch({ control, name: "tolerancePct" });
  const value = typeof pct === "number" && !Number.isNaN(pct) ? pct : 0;

  if (!value) {
    return (
      <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
        Left blank, every stage is held to its target exactly — an entry taking
        a 20&nbsp;kg mixing stage past 20&nbsp;kg is refused. Set a few percent
        if your rooms weigh and count with any slack.
      </p>
    );
  }

  return (
    <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
      Each planned stage will accept up to{" "}
      <strong className="font-semibold text-ink-2">its target +{value}%</strong>{" "}
      — a stage planned for 20&nbsp;kg takes{" "}
      <strong className="font-mono font-semibold text-ink-2">
        {fmt(Math.round(20 * (1 + value / 100) * 100) / 100)}&nbsp;kg
      </strong>
      . An entry that would push it past that is refused, and the stage&rsquo;s
      progress bar in the shift log turns red. A manager can raise the stage
      target on the plan, or this tolerance on the batch — it is set once here
      and every stage of the plan inherits it.
    </p>
  );
}

function OverageNote({
  control,
  required,
}: {
  control: Control<NewBatchValues, unknown, NewBatchParsed>;
  required?: number | null;
}) {
  const pct = useWatch({ control, name: "overagePct" });
  const value = typeof pct === "number" && !Number.isNaN(pct) ? pct : 0;

  if (!value) {
    return (
      <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
        Leave blank if this batch must make exactly what was ordered. Any extra
        is then flagged in the shift log for a manager to explain.
      </p>
    );
  }

  return (
    <p className="mt-2.5 text-[11px] leading-snug text-ink-4">
      The shift log won&rsquo;t flag over-production until this batch passes{" "}
      {required ? (
        <strong className="font-mono font-semibold text-ink-2">
          {fmt(Math.floor(required * (1 + value / 100)))}
        </strong>
      ) : (
        <>its required quantity +{value}%</>
      )}
      {required ? ` (${fmt(required)} +${value}%)` : ""} — so making the extra
      on purpose doesn&rsquo;t raise a flag someone has to clear.
    </p>
  );
}
