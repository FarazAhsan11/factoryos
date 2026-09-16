"use client";

import { useMemo } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Loader2, Lock } from "lucide-react";

import {
  productEditSchema,
  productSchema,
  type ProductInput,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import { FIELD } from "@/components/factory/admin/settings-ui";
import { DateField } from "@/components/ui/date-picker";
import { todayKey } from "@/lib/factory/dates";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

const MONO = "font-mono tracking-tight";

/** A blank catalogue row — what Add product opens on. */
export const EMPTY_PRODUCT: ProductValues = {
  batchNo: "",
  code: "",
  name: "",
  workOrder: "",
  requiredQty: 0,
  plannedFor: "",
  customerCode: "",
  customerName: "",
  salesOrderNo: "",
  salesRep: "",
  orderValue: undefined,
  orderedOn: "",
  dueDate: "",
  expectedStart: "",
  expectedFinish: "",
};

type DateName =
  | "orderedOn"
  | "expectedStart"
  | "expectedFinish"
  | "dueDate"
  | "plannedFor";

/**
 * Every field a catalogue row carries, for adding one and for editing one.
 *
 * One form for both on purpose: Add product and the row's Edit dialog ask
 * the same fifteen questions, and two copies of them is how the two drift —
 * one gains a limit, the other a placeholder. The differences are narrow and
 * named. In edit the batch number is locked, because it is what the shift log,
 * the paperwork and every issue are filed under; and the planned date is
 * locked once the batch has a card, because migration 0018 freezes it then.
 *
 * Presentational, like the rest of the catalogue: the caller owns the
 * mutation. `onSubmit` resolves when saved and rejects to keep the form open.
 */
export function ProductForm({
  mode,
  initial,
  plannedLocked,
  customers,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: ProductValues;
  /** Why the planned date can't change, when it can't. */
  plannedLocked?: string;
  /** Customer code (lower-cased) → name, from the catalogue already loaded. */
  customers: Map<string, string>;
  onSubmit: (values: ProductValues) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = mode === "edit";
  // In edit a planned date that has since gone by may be kept — the one rule
  // the two modes don't share. See `productEditSchema`.
  const resolver = useMemo(
    () =>
      zodResolver(
        editing ? productEditSchema(initial.plannedFor || null) : productSchema,
      ),
    [editing, initial.plannedFor],
  );

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProductInput, unknown, ProductValues>({
    resolver,
    defaultValues: initial,
  });

  // Read per render rather than at module load: a tab left open overnight
  // would otherwise still be refusing today. Through the hook, or the React
  // Compiler caches the first read for the life of the form.
  const today = useRenderClock(todayKey);

  async function submit(values: ProductValues) {
    try {
      await onSubmit(values);
    } catch {
      // The mutation has already said why in a toast. Staying open is the
      // point — a fifteen-field form lost to a duplicate batch number is how
      // a batch never gets entered at all.
    }
  }

  /**
   * Fills the customer's name in from its code. On blur rather than per
   * keystroke, or "PHY50" on its way to "PHY502" could match a different
   * customer first; and never over a name somebody has already typed.
   */
  function fillCustomer(code: string) {
    const known = customers.get(code.trim().toLowerCase());
    if (known && !getValues("customerName")?.trim()) {
      setValue("customerName", known, { shouldDirty: true });
    }
  }

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* The fields are the only thing that scrolls, so Save never leaves
          the bottom of the dialog on a short screen. */}
      <div className="scrollbar-slim min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Section title="Product & batch">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Batch / W.O."
              htmlFor="pf-batch"
              required
              error={errors.batchNo?.message}
              hint={editing ? "Locked — work is filed under it." : undefined}
            >
              <div className="relative">
                <input
                  id="pf-batch"
                  autoFocus={!editing}
                  // readOnly, not disabled: react-hook-form reads a disabled
                  // input as undefined, and the schema would then refuse it.
                  readOnly={editing}
                  placeholder="44075"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.batchNo)}
                  className={cn(
                    FIELD,
                    MONO,
                    editing && "cursor-not-allowed bg-sunken pr-8 text-ink-4",
                  )}
                  {...register("batchNo")}
                />
                {editing && (
                  <Lock
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-ink-5"
                  />
                )}
              </div>
            </Field>

            <Field label="Work order" htmlFor="pf-wo" error={errors.workOrder?.message}>
              <input
                id="pf-wo"
                placeholder="Same as batch"
                autoComplete="off"
                className={cn(FIELD, MONO)}
                {...register("workOrder")}
              />
            </Field>

            <Field label="Product code" htmlFor="pf-code" error={errors.code?.message}>
              <input
                id="pf-code"
                placeholder="PC2766.120"
                autoComplete="off"
                className={cn(FIELD, MONO)}
                {...register("code")}
              />
            </Field>

            <Field
              label="Required qty"
              htmlFor="pf-qty"
              error={errors.requiredQty?.message}
            >
              <input
                id="pf-qty"
                type="number"
                step="any"
                min={0}
                placeholder="76500"
                aria-invalid={Boolean(errors.requiredQty)}
                className={cn(FIELD, MONO)}
                {...register("requiredQty", { valueAsNumber: true })}
              />
            </Field>

            <Field
              label="Product name"
              htmlFor="pf-name"
              required
              error={errors.name?.message}
              className="sm:col-span-4"
            >
              <input
                id="pf-name"
                placeholder="Item description, as on the order"
                aria-invalid={Boolean(errors.name)}
                className={FIELD}
                {...register("name")}
              />
            </Field>
          </div>
        </Section>

        <Section title="Customer order">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Customer code"
              htmlFor="pf-cust-code"
              error={errors.customerCode?.message}
            >
              <input
                id="pf-cust-code"
                placeholder="CUS104"
                autoComplete="off"
                className={cn(FIELD, MONO)}
                {...register("customerCode", {
                  onBlur: (e) => fillCustomer(e.target.value),
                })}
              />
            </Field>

            <Field
              label="Customer name"
              htmlFor="pf-cust-name"
              error={errors.customerName?.message}
              className="sm:col-span-3"
            >
              <input
                id="pf-cust-name"
                placeholder="Filled in from a code the catalogue already knows"
                className={FIELD}
                {...register("customerName")}
              />
            </Field>

            <Field
              label="SO order no"
              htmlFor="pf-so"
              error={errors.salesOrderNo?.message}
            >
              <input
                id="pf-so"
                placeholder="56006"
                autoComplete="off"
                className={cn(FIELD, MONO)}
                {...register("salesOrderNo")}
              />
            </Field>

            <Field
              label="Order value"
              htmlFor="pf-value"
              error={errors.orderValue?.message}
            >
              <input
                id="pf-value"
                type="number"
                step="any"
                min={0}
                placeholder="124695"
                aria-invalid={Boolean(errors.orderValue)}
                className={cn(FIELD, MONO)}
                {...register("orderValue", { valueAsNumber: true })}
              />
            </Field>

            <Field
              label="Rep / sales manager"
              htmlFor="pf-rep"
              error={errors.salesRep?.message}
              className="sm:col-span-2"
            >
              <input
                id="pf-rep"
                placeholder="Who owns the customer"
                className={FIELD}
                {...register("salesRep")}
              />
            </Field>
          </div>
        </Section>

        <Section title="Dates">
          {/* Left to right in the order they happen: the order comes in,
              production starts and finishes, the customer expects it. */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Order received" htmlFor="pf-ordered" error={errors.orderedOn?.message}>
              <DateControl control={control} name="orderedOn" id="pf-ordered" />
            </Field>
            <Field
              label="Exp. start"
              htmlFor="pf-start"
              error={errors.expectedStart?.message}
            >
              <DateControl control={control} name="expectedStart" id="pf-start" />
            </Field>
            <Field
              label="Exp. finish"
              htmlFor="pf-finish"
              error={errors.expectedFinish?.message}
            >
              <DateControl
                control={control}
                name="expectedFinish"
                id="pf-finish"
                invalid={Boolean(errors.expectedFinish)}
              />
            </Field>
            <Field label="Due date" htmlFor="pf-due" error={errors.dueDate?.message}>
              <DateControl control={control} name="dueDate" id="pf-due" />
            </Field>
          </div>

          {/* Set apart and tinted because it is the one date here that *does*
              something. The four above are records and estimates; this one
              puts a card on the pipeline board on the day. */}
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <CalendarPlus className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0">
                <label htmlFor="pf-planned" className="text-xs font-medium text-ink-3">
                  Plan for{" "}
                  <span className="text-[10px] font-normal text-ink-5">(optional)</span>
                </label>
                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-5">
                  {plannedLocked ??
                    "Joins the pipeline board as Planned on this day. Unlike Exp. start it moves the batch — leave it blank to add it from New batch instead."}
                </p>
                {errors.plannedFor?.message && (
                  <p role="alert" className="mt-1 text-[11.5px] text-danger-deep">
                    {errors.plannedFor.message}
                  </p>
                )}
              </div>
            </div>
            <div className="sm:w-48">
              <DateControl
                control={control}
                name="plannedFor"
                id="pf-planned"
                min={today}
                disabled={Boolean(plannedLocked)}
                placeholder="Not scheduled"
                invalid={Boolean(errors.plannedFor)}
              />
            </div>
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
        <button
          type="button"
          onClick={onCancel}
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
          {editing ? "Save changes" : "Add product"}
        </button>
      </div>
    </form>
  );
}

/** A `DateField` wired through a Controller — it owns a popover, so it's controlled. */
function DateControl({
  control,
  name,
  id,
  min,
  disabled,
  invalid,
  placeholder = "Not set",
}: {
  control: Control<ProductInput, unknown, ProductValues>;
  name: DateName;
  id: string;
  min?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <DateField
          id={id}
          value={field.value ?? ""}
          onChange={field.onChange}
          min={min}
          disabled={disabled}
          placeholder={placeholder}
          ariaInvalid={invalid}
        />
      )}
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
    <section>
      <h3 className="mb-2.5 text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[11.5px] text-danger-deep">
          {error}
        </p>
      ) : (
        hint && <p className="text-[11px] text-ink-5">{hint}</p>
      )}
    </div>
  );
}
