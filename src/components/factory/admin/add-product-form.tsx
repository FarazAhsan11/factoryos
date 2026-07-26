"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";

import {
  productSchema,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";

const FIELD =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12";
const MONO = "font-mono tracking-tight";
const LABEL = "text-xs font-medium text-[#475569]";

const EMPTY: ProductValues = {
  batchNo: "",
  code: "",
  name: "",
  workOrder: "",
  requiredQty: 0,
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
    errors.requiredQty?.message;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4"
    >
      <p className="mb-3 text-[13px] font-semibold text-[#0F1B34]">
        Add product{" "}
        <span className="font-normal text-[#94A3B8]">
          — the batch number links it in the shift log
        </span>
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[110px_130px_1fr_110px_130px_auto] lg:items-end">
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
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
        <p role="alert" className="mt-2.5 text-xs text-[#B91C1C]">
          {firstError}
        </p>
      )}
    </form>
  );
}
