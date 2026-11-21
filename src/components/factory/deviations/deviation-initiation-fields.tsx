"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Controller,
  useWatch,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";

import {
  DETECTION_POINTS,
  parseBatches,
  type DeviationInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  Field,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { DateTimeField } from "@/components/ui/date-picker";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

/**
 * A planned or unplanned deviation's initiation — the reference QMS's raise
 * form (qms-v4), field for field and in its order, two columns wide:
 *
 *   Title
 *   Planned or unplanned      When it happened
 *   Department                Location
 *   Detected at               Batches
 *   What happened
 *   Immediate action
 *   Put the batch on hold?    Equipment
 *   Reference document / SOP  Procedure name
 *
 * Used by the raise page (`/deviations/new`). Once raised, the case's
 * Details tab shows these answers read-only. Owner, category, class and due
 * date are the initial assessment's, on its own tab.
 *
 * The **department** is the factory's own list (Configuration → Departments).
 * The **batches** are typed as one line and each is resolved from the product
 * register as it is typed — product, code and customer — the same lookup the
 * old single batch field made.
 */
export function DeviationInitiationFields({
  form,
  factoryId,
}: {
  form: UseFormReturn<DeviationInitiationValues>;
  factoryId: string;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  const { data: departments = [] } = useQuery({
    queryKey: setupKeys.all("factory_departments", factoryId),
    queryFn: () => fetchSetupItems("factory_departments", factoryId),
  });
  const { data: equipmentList = [] } = useQuery({
    queryKey: equipmentKeys.all(factoryId),
    queryFn: () => fetchEquipment(factoryId),
  });

  const departmentId = useWatch({ control, name: "departmentId" });
  const equipmentNo = useWatch({ control, name: "equipmentNo" });
  const hold = useWatch({ control, name: "hold" });

  // Active departments, plus a retired one the case already names — a case
  // must not lose its department because the list was tidied.
  const departmentOptions = departments
    .filter((d) => d.active || d.id === departmentId)
    .map((d) => ({ value: d.id, label: d.name }));

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <Field
          label="Title"
          htmlFor="dev-title"
          required
          error={errors.title?.message}
          className="md:col-span-2"
        >
          <input
            id="dev-title"
            placeholder="e.g. Capsules dented at closing on encapsulator 2"
            aria-invalid={Boolean(errors.title)}
            className={CONTROL}
            {...register("title")}
          />
        </Field>

        <Field
          label="Planned or unplanned"
          required
          hint="Planned deviations follow the same flow for now."
        >
          <Segmented
            control={control}
            name="type"
            label="Planned or unplanned"
            options={[
              { value: "unplanned", label: "Unplanned" },
              { value: "planned", label: "Planned" },
            ]}
          />
        </Field>

        <Field
          label="When it happened"
          htmlFor="dev-occurred"
          required
          error={errors.occurredAt?.message}
        >
          <Controller
            name="occurredAt"
            control={control}
            render={({ field }) => (
              <DateTimeField
                id="dev-occurred"
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="Pick the date and time"
              />
            )}
          />
        </Field>

        <Field
          label="Department"
          htmlFor="dev-department"
          required
          error={errors.departmentId?.message}
          hint={
            departments.length === 0
              ? "No departments yet — add them in Configuration → Departments."
              : undefined
          }
        >
          <SelectControl
            control={control}
            name="departmentId"
            id="dev-department"
            placeholder="Select…"
            searchPlaceholder="Department…"
            emptyMessage="No departments."
            invalid={Boolean(errors.departmentId)}
            options={departmentOptions}
          />
        </Field>

        <Field
          label="Location"
          htmlFor="dev-location"
          note="(optional)"
          error={errors.location?.message}
        >
          <input
            id="dev-location"
            placeholder="Room, line or equipment area — e.g. Room 17B, powder packing line"
            className={CONTROL}
            {...register("location")}
          />
        </Field>

        <Field
          label="Detected at"
          htmlFor="dev-detected"
          required
          error={errors.detectionPoint?.message}
        >
          <SelectControl
            control={control}
            name="detectionPoint"
            id="dev-detected"
            placeholder="Select…"
            invalid={Boolean(errors.detectionPoint)}
            options={DETECTION_POINTS.map((d) => ({ value: d, label: d }))}
          />
        </Field>

        <Field
          label="Batches"
          htmlFor="dev-batches"
          note={hold === "yes" ? undefined : "(optional)"}
          required={hold === "yes"}
          error={errors.batches?.message}
        >
          <input
            id="dev-batches"
            placeholder="e.g. 46686, 46690"
            aria-invalid={Boolean(errors.batches)}
            className={cn(CONTROL, "font-mono")}
            {...register("batches")}
          />
          <BatchesResolved
            factoryId={factoryId}
            control={control}
            holding={hold === "yes"}
          />
        </Field>

        <Field
          label="What happened"
          htmlFor="dev-actual"
          required
          error={errors.actual?.message}
          className="md:col-span-2"
        >
          <textarea
            id="dev-actual"
            rows={3}
            placeholder="Facts only: what, how much, how it was found."
            aria-invalid={Boolean(errors.actual)}
            className={AREA}
            {...register("actual")}
          />
        </Field>

        <Field
          label="Immediate action"
          htmlFor="dev-immediate"
          required
          error={errors.immediateAction?.message}
          className="md:col-span-2"
        >
          <textarea
            id="dev-immediate"
            rows={3}
            placeholder="What was done straight away"
            aria-invalid={Boolean(errors.immediateAction)}
            className={AREA}
            {...register("immediateAction")}
          />
        </Field>

        <Field
          label="Put the batch on hold?"
          required
          error={errors.hold?.message}
          hint="Yes holds each batch: its card goes On hold and the shift log blocks preparatory and production work until QA releases or rejects it on the case. Downtime can still be logged."
        >
          <Segmented
            control={control}
            name="hold"
            label="Put the batch on hold?"
            options={[
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
            ]}
          />
        </Field>

        <Field label="Equipment" htmlFor="dev-eq" note="(optional)">
          <input
            id="dev-eq"
            placeholder="e.g. EQ296"
            className={cn(CONTROL, "font-mono")}
            {...register("equipmentNo")}
          />
          {/* Resolved from the machine register, as the shift log does — so
              a typo reads as "not in the register". */}
          {(equipmentNo ?? "").trim() && (
            <p className="text-[0.6875rem] text-ink-5">
              {equipment ? equipment.name : "Not in the machine register."}
            </p>
          )}
        </Field>

        <Field
          label="Reference document / SOP"
          htmlFor="dev-sop"
          note="(optional)"
          error={errors.sopNumber?.message}
        >
          <input
            id="dev-sop"
            placeholder="e.g. SOP-PK-012"
            className={cn(CONTROL, "font-mono")}
            {...register("sopNumber")}
          />
        </Field>

        <Field
          label="Procedure name"
          htmlFor="dev-procedure"
          note="(optional)"
          error={errors.procedureName?.message}
        >
          <input
            id="dev-procedure"
            placeholder="Procedure it departs from — e.g. Line clearance, packing"
            className={CONTROL}
            {...register("procedureName")}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Each typed batch, resolved from the product register: product, code and
 * customer, or "not in the register". A number that matches nothing is still
 * saved as typed — unless the batch is going on hold, which holds nothing on
 * a typo, so then it is shown as the error the database will raise.
 */
function BatchesResolved({
  factoryId,
  control,
  holding,
}: {
  factoryId: string;
  control: Control<DeviationInitiationValues>;
  holding: boolean;
}) {
  const typed = useWatch({ control, name: "batches" });
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const rows = useMemo(() => {
    const byBatch = new Map(products.map((p) => [p.batch_no.toLowerCase(), p]));
    return parseBatches(typed ?? "").map((b) => ({
      batch: b,
      product: byBatch.get(b.toLowerCase()) ?? null,
    }));
  }, [products, typed]);

  if (rows.length === 0) {
    return (
      <p className="text-[0.6875rem] leading-snug text-ink-5">
        One or more. Products are filled from the batch register.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {rows.map(({ batch, product }) => (
        <li
          key={batch}
          className={cn(
            "flex flex-wrap items-baseline gap-x-2 rounded-lg border px-2.5 py-1.5 text-[0.7188rem]",
            product
              ? "border-brand-soft bg-brand-tint text-ink-3"
              : holding
                ? "border-danger-line bg-danger-soft text-danger-deep"
                : "border-warn-line bg-warn-tint text-warn-ink",
          )}
        >
          <span className="font-mono font-semibold text-ink">{batch}</span>
          {product ? (
            <>
              <span className="font-medium text-ink">{product.name}</span>
              {product.code && (
                <span className="font-mono text-ink-4">{product.code}</span>
              )}
              {product.customer_name && (
                <span className="text-ink-4">· {product.customer_name}</span>
              )}
            </>
          ) : (
            <span>
              {holding
                ? "Not in the batch register — it can't be put on hold."
                : "Not in the batch register — saved as typed."}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Two or three joined buttons for one answer — the reference form's toggle. */
export function Segmented<T extends FieldValues>({
  control,
  name,
  label,
  options,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <div
          role="radiogroup"
          aria-label={label}
          aria-invalid={Boolean(fieldState.error)}
          className={cn(
            "inline-flex rounded-xl border bg-surface p-0.5 shadow-[0_1px_2px_rgb(20_22_43/0.04)]",
            fieldState.error ? "border-danger" : "border-line",
          )}
        >
          {options.map((o) => {
            const active = field.value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => field.onChange(o.value)}
                onBlur={field.onBlur}
                className={cn(
                  "h-9 min-w-[4.5rem] rounded-[0.6rem] px-4 text-sm font-semibold transition",
                  active
                    ? "bg-brand-soft text-brand-deep ring-1 ring-brand/30"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    />
  );
}
