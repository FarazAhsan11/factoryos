"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";

import {
  productSchema,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import { todayKey } from "@/lib/factory/dates";

import { FIELD } from "@/components/factory/admin/settings-ui";
import { DateField } from "@/components/ui/date-picker";
const MONO = "font-mono tracking-tight";
const LABEL = "text-xs font-medium text-ink-3";

const EMPTY: ProductValues = {
  batchNo: "",
  code: "",
  name: "",
  workOrder: "",
  requiredQty: 0,
  plannedFor: "",
};

/**
 * Adds one batch to the catalogue. Kept presentational — the panel owns the
 * React Query mutation and passes it in, so this stays reusable if products
 * ever get their own screen.
 */
export function AddProductForm({
  onAdd,
}: {
  onAdd: (values: ProductValues) => Promise<void>;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: EMPTY,
  });

  async function onSubmit(values: ProductValues) {
    await onAdd(values);
    reset(EMPTY);
  }

  const firstError =
    errors.batchNo?.message ??
    errors.name?.message ??
    errors.code?.message ??
    errors.requiredQty?.message ??
    errors.plannedFor?.message;

  // Read once per render rather than at module load: a tab left open overnight
  // would otherwise still be refusing today.
  const today = todayKey();

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-line bg-sunken p-4 shadow-[inset_0_1px_2px_rgb(20_22_43/0.04)]"
    >
      <p className="mb-3 text-[11px] font-bold tracking-[0.07em] text-ink-4 uppercase">
        Add product{" "}
        <span className="font-normal text-ink-5">
          — the batch number links it in the shift log
        </span>
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[105px_120px_1fr_105px_115px_150px_auto] lg:items-end">
        <div className="space-y-1.5">
          <label htmlFor="p-batch" className={LABEL}>
            Batch / W.O.
          </label>
          <input
            id="p-batch"
            placeholder="46004"
            aria-invalid={Boolean(errors.batchNo)}
            className={`${FIELD} ${MONO}`}
            {...register("batchNo")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="p-code" className={LABEL}>
            Product code
          </label>
          <input
            id="p-code"
            placeholder="PC2934"
            className={`${FIELD} ${MONO}`}
            {...register("code")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="p-name" className={LABEL}>
            Product name
          </label>
          <input
            id="p-name"
            placeholder="JSHealth Capsules…"
            aria-invalid={Boolean(errors.name)}
            className={FIELD}
            {...register("name")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="p-wo" className={LABEL}>
            Work order
          </label>
          <input
            id="p-wo"
            placeholder="46004"
            className={`${FIELD} ${MONO}`}
            {...register("workOrder")}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="p-qty" className={LABEL}>
            Required qty
          </label>
          <input
            id="p-qty"
            type="number"
            step="any"
            min={0}
            placeholder="100000"
            aria-invalid={Boolean(errors.requiredQty)}
            className={`${FIELD} ${MONO}`}
            {...register("requiredQty", { valueAsNumber: true })}
          />
        </div>

        {/* The batch's own start date. Optional — leave it blank and the batch
            reaches the pipeline the other way, when a manager ticks it in New
            job. `min` stops the picker offering a past day at all; the schema
            and migration 0018 both re-check it, because a date can still be
            typed straight into the field. */}
        <div className="space-y-1.5">
          <label htmlFor="p-planned" className={LABEL}>
            Plan for <span className="text-[10px] text-ink-5">(optional)</span>
          </label>
          {/* Through a Controller rather than `register`: the picker owns a
              formatted value and a popover, so it is a controlled field. The
              string it stores is the same `YYYY-MM-DD` the schema validates. */}
          <Controller
            name="plannedFor"
            control={control}
            render={({ field }) => (
              <DateField
                id="p-planned"
                value={field.value ?? ""}
                onChange={field.onChange}
                min={today}
                title="The day this batch joins the pipeline as Planned"
                placeholder="Not scheduled"
                ariaInvalid={Boolean(errors.plannedFor)}
              />
            )}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Add
        </button>
      </div>

      {firstError && (
        <p role="alert" className="mt-2.5 text-xs text-danger-deep">
          {firstError}
        </p>
      )}
    </form>
  );
}
