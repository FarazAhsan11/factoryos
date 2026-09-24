"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Lock } from "lucide-react";

import {
  NC_CATEGORIES,
  ORIGINS,
  type InitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import {
  AREA,
  Cols,
  CONTROL,
  DateControl,
  Field,
  Group,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import { useCapaOptions } from "@/components/factory/deviations/use-capa-options";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import {
  DEVIATION_TYPES,
  DISPOSITIONS,
  PRIORITIES,
} from "@/lib/factory/deviation-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/**
 * Tab 1 — Initiation and identification.
 *
 * The same fields whether the case is being raised or corrected later, so
 * they live here and both forms compose them; a second copy in the raise
 * dialog would be the one that missed the next field added.
 *
 * Two things resolve themselves as they are typed: the **batch** (to a
 * product, its name and code shown under the field, the customer filled in
 * from the order if the field is still empty) and the **equipment number**
 * (to a machine name from the register). Both are the same conveniences the
 * shift log and the maintenance form already give.
 *
 * The **case type is a dropdown**. It decides the case's number — DEV or NCR
 * — so on an existing case it is locked and says why.
 */
export function InitiationFields({
  form,
  factoryId,
  locked,
}: {
  form: UseFormReturn<InitiationValues>;
  factoryId: string;
  /** True on an existing case: the type is part of its number. */
  locked?: boolean;
}) {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = form;

  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  const { data: equipmentList = [] } = useQuery({
    queryKey: equipmentKeys.all(factoryId),
    queryFn: () => fetchEquipment(factoryId),
  });
  const capaGroups = useCapaOptions(factoryId);

  const type = useWatch({ control, name: "type" });
  const disposition = useWatch({ control, name: "disposition" });
  const batchNo = useWatch({ control, name: "batchNo" });
  const equipmentNo = useWatch({ control, name: "equipmentNo" });
  const customerName = useWatch({ control, name: "customerName" });

  const matched = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  // The batch already knows whose order it is (migration 0041). Filled in
  // only while the field is empty, so a case raised against a customer the
  // catalogue never recorded is never overwritten.
  useEffect(() => {
    if (matched?.customer_name && !(customerName ?? "").trim()) {
      setValue("customerName", matched.customer_name);
    }
  }, [matched, customerName, setValue]);

  const isNcr = type === "ncr";
  const quarantine = isNcr && disposition === "quarantine";
  const typed = (batchNo ?? "").trim();

  return (
    <div className="space-y-6">
      <Group title="Case details">
        <Cols>
          <Field
            label="Case type"
            htmlFor="dev-type"
            required
            error={errors.type?.message}
            note={locked ? "(fixed)" : undefined}
          >
            {locked ? (
              <p className={cn(CONTROL, "flex items-center gap-2 bg-sunken text-ink-3")}>
                <Lock className="size-3.5 shrink-0 text-ink-5" />
                {DEVIATION_TYPES.find((t) => t.value === type)?.label}
              </p>
            ) : (
              <SelectControl
                control={control}
                name="type"
                id="dev-type"
                placeholder="Select case type…"
                invalid={Boolean(errors.type)}
                options={DEVIATION_TYPES.map((t) => ({
                  value: t.value,
                  label: t.label,
                  meta: t.hint,
                }))}
              />
            )}
            {locked && (
              <p className="text-[11px] text-ink-5">
                The type is part of the case number — raise a new case to
                change it.
              </p>
            )}
          </Field>

          <Field label="Priority" htmlFor="dev-priority">
            <SelectControl
              control={control}
              name="priority"
              id="dev-priority"
              options={PRIORITIES.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
            />
          </Field>

          <Field label="Origin" htmlFor="dev-origin" note="(optional)">
            <SelectControl
              control={control}
              name="origin"
              id="dev-origin"
              clearable
              clearLabel="Not recorded"
              placeholder="Where it came from…"
              options={ORIGINS.map((o) => ({ value: o, label: o }))}
            />
          </Field>
        </Cols>

        <Field
          label="Case title"
          htmlFor="dev-title"
          required
          hint="The line this case is found by in a list of six hundred."
          error={errors.title?.message}
        >
          <input
            id="dev-title"
            placeholder="e.g. PC2831 Creatine Chewable — tablets softening in pack"
            aria-invalid={Boolean(errors.title)}
            className={CONTROL}
            {...register("title")}
          />
        </Field>

        <Cols>
          <Field
            label="Non-conformance category"
            htmlFor="dev-nc"
            note="(optional)"
          >
            <SelectControl
              control={control}
              name="ncCategory"
              id="dev-nc"
              clearable
              clearLabel="Not categorised"
              placeholder="What kind…"
              options={NC_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>

          <Field
            label="SLA date"
            htmlFor="dev-sla"
            note="(optional)"
            hint="When it should be closed by."
          >
            <DateControl control={control} name="slaDate" id="dev-sla" />
          </Field>
        </Cols>
      </Group>

      <Group title="Product & batch">
        <Cols>
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
          </Field>

          <Field label="Customer" htmlFor="dev-customer" note="(optional)">
            <input
              id="dev-customer"
              placeholder={matched?.customer_name ?? "Customer name"}
              className={CONTROL}
              {...register("customerName")}
            />
          </Field>

          <Field
            label="Customer others"
            htmlFor="dev-customer-other"
            note="(optional)"
          >
            <input
              id="dev-customer-other"
              placeholder="Anyone else it concerns"
              className={CONTROL}
              {...register("customerOther")}
            />
          </Field>
        </Cols>

        {/* Product name and code are never typed: they are the batch's, and a
            second copy here would be the one that went stale. */}
        <BatchSummary factoryId={factoryId} batchNo={batchNo ?? ""} />

        <Cols of={2}>
          <Field label="Supplier name" htmlFor="dev-supplier" note="(optional)">
            <input
              id="dev-supplier"
              placeholder="Who supplied the material"
              className={CONTROL}
              {...register("supplierName")}
            />
          </Field>
        </Cols>
      </Group>

      <Group title="People">
        <Cols>
          <Field label="Case owner" htmlFor="dev-owner" note="(optional)">
            <input
              id="dev-owner"
              placeholder="Who is carrying this case"
              className={CONTROL}
              {...register("ownerName")}
            />
          </Field>
          <Field label="Raised by" htmlFor="dev-raised" note="(optional)">
            <input
              id="dev-raised"
              placeholder="Your name"
              className={CONTROL}
              {...register("raisedBy")}
            />
          </Field>
          <Field
            label="Supervisor's name"
            htmlFor="dev-supervisor"
            note="(optional)"
          >
            <input
              id="dev-supervisor"
              placeholder="Supervisor on shift"
              className={CONTROL}
              {...register("supervisorName")}
            />
          </Field>
          <Field label="QA reviewer" htmlFor="dev-qa" note="(optional)">
            <input
              id="dev-qa"
              placeholder="QA manager name"
              className={CONTROL}
              {...register("qaReviewer")}
            />
          </Field>
          <Field label="Linked CAPA" htmlFor="dev-capa" note="(optional)">
            <SelectControl
              control={control}
              name="actionId"
              id="dev-capa"
              clearable
              clearLabel="No CAPA"
              placeholder="None"
              searchPlaceholder="Issue title or batch…"
              emptyMessage="No issues raised yet."
              groups={capaGroups}
            />
          </Field>
        </Cols>
      </Group>

      <Group title="Materials, equipment & documents">
        <Cols>
          <Field
            label="Raw material code"
            htmlFor="dev-rm-code"
            note="(optional)"
          >
            <input
              id="dev-rm-code"
              placeholder="e.g. RM1042"
              className={cn(CONTROL, "font-mono")}
              {...register("rawMaterialCode")}
            />
          </Field>
          <Field
            label="Raw material name"
            htmlFor="dev-rm-name"
            note="(optional)"
          >
            <input
              id="dev-rm-name"
              placeholder="e.g. Creatine monohydrate"
              className={CONTROL}
              {...register("rawMaterialName")}
            />
          </Field>
          <Field
            label="Packaging material code"
            htmlFor="dev-pm-code"
            note="(optional)"
          >
            <input
              id="dev-pm-code"
              placeholder="e.g. PM3701 10g silica sachet"
              className={cn(CONTROL, "font-mono")}
              {...register("packagingMaterialCode")}
            />
          </Field>

          <Field label="Equipment no." htmlFor="dev-eq" note="(optional)">
            <input
              id="dev-eq"
              placeholder="e.g. EQ296"
              className={cn(CONTROL, "font-mono")}
              {...register("equipmentNo")}
            />
            {/* Resolved from the machine register, exactly as the shift log
                resolves it — so a typo shows up as "not in the register". */}
            {(equipmentNo ?? "").trim() && (
              <p className="text-[11px] text-ink-5">
                {equipment ? equipment.name : "Not in the machine register."}
              </p>
            )}
          </Field>

          <Field label="Procedure name" htmlFor="dev-proc" note="(optional)">
            <input
              id="dev-proc"
              placeholder="Procedure it departs from"
              className={CONTROL}
              {...register("procedureName")}
            />
          </Field>
          <Field label="SOP number" htmlFor="dev-sop" note="(optional)">
            <input
              id="dev-sop"
              placeholder="e.g. SOP-QA-014"
              className={cn(CONTROL, "font-mono")}
              {...register("sopNumber")}
            />
          </Field>
          <Field label="Document number" htmlFor="dev-doc" note="(optional)">
            <input
              id="dev-doc"
              placeholder="Related document"
              className={cn(CONTROL, "font-mono")}
              {...register("documentNumber")}
            />
          </Field>
        </Cols>
      </Group>

      <Group title="The event">
        <Field
          label="Specification / requirement"
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
          label="Event description"
          htmlFor="dev-actual"
          required
          hint="What actually happened, and how it was found."
          error={errors.actual?.message}
        >
          <textarea
            id="dev-actual"
            rows={3}
            placeholder="e.g. Silica sachet drawing moisture from the chewable tablets, tablets returning to powder state."
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
      </Group>

      {isNcr && (
        <Group title="Batch disposition">
          <Field label="Disposition decision" required error={errors.disposition?.message}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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

            {/* Quarantine is the one answer with consequences outside this
                screen, so the form says what it will do before it is saved. */}
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
                    : `Batch ${matched.batch_no} goes on hold. Preparatory and production work can't be logged against it until this case is closed; downtime still can.`}
              </p>
            )}
          </Field>
        </Group>
      )}
    </div>
  );
}
