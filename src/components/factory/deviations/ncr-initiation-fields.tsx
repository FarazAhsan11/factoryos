"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";

import {
  parseBatches,
  type NcrInitiationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  Field,
  SelectControl,
} from "@/components/factory/deviations/deviation-fields";
import {
  BatchesResolved,
  Segmented,
} from "@/components/factory/deviations/deviation-initiation-fields";
import { DateTimeField } from "@/components/ui/date-picker";
import { deviationKeys, fetchDeviations } from "@/lib/factory/deviation-queries";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import {
  NCR_DETECTION_POINTS,
  NC_ITEMS,
  SUPPLIED_BY,
  batchRequired,
  isMaterialItem,
  isProductItem,
  parseLots,
} from "@/lib/factory/ncr";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

/**
 * A non-conformance's initiation — the reference QMS's NCR raise form
 * (qms-v12, `ncrFields`), in its order, two columns wide:
 *
 *   Title
 *   What is non-conforming?                   (Other → What is it?)
 *   material:  Supplied by
 *              Material code             Supplier / Customer
 *              Lot number(s)             Quantity affected
 *   product:   Batches affected          Quantity affected
 *   other:     Quantity affected
 *   Detected at                         Date found
 *   Department                          Location
 *   material:  Affected batch(es)
 *   Requirement / specification         Description of non-conformance
 *   Immediate action                              (None needed)
 *   Quarantine the lot? / Put the batch on hold?  (No → Why not)
 *   product:   Equipment
 *   Reference document / SOP
 *
 * Used by the raise page (`/deviations/new?type=ncr`). Once raised, the
 * case's Details tab shows the answers read-only (`NcrInitiationFacts`).
 */
export function NcrInitiationFields({
  form,
  factoryId,
  caseId,
}: {
  form: UseFormReturn<NcrInitiationValues>;
  factoryId: string;
  /** The case being completed (0078) — never its own "already open" match. */
  caseId?: string;
}) {
  const {
    register,
    control,
    setValue,
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

  const ncItem = useWatch({ control, name: "ncItem" });
  const suppliedBy = useWatch({ control, name: "suppliedBy" });
  const detectionPoint = useWatch({ control, name: "detectionPoint" });
  const departmentId = useWatch({ control, name: "departmentId" });
  const equipmentNo = useWatch({ control, name: "equipmentNo" });
  const immediateAction = useWatch({ control, name: "immediateAction" });
  const hold = useWatch({ control, name: "hold" });
  const batchesText = useWatch({ control, name: "batches" });

  const material = isMaterialItem(ncItem);
  const product = isProductItem(ncItem);
  const party = suppliedBy === "customer" ? "Customer" : "Supplier";
  const needBatch = batchRequired(ncItem, detectionPoint);
  const holding = hold === "yes";

  const departmentOptions = departments
    .filter((d) => d.active || d.id === departmentId)
    .map((d) => ({ value: d.id, label: d.name }));

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  return (
    <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
      <Field
        label="Title"
        htmlFor="ncr-title"
        required
        error={errors.title?.message}
        className="md:col-span-2"
      >
        <input
          id="ncr-title"
          placeholder={
            material
              ? "e.g. Dented capsules in incoming lot CT-902"
              : "e.g. Bulk tablets below hardness limit"
          }
          aria-invalid={Boolean(errors.title)}
          className={CONTROL}
          {...register("title")}
        />
      </Field>

      <Field
        label="What is non-conforming?"
        required
        className="md:col-span-2"
        hint="Decides the fields. A material needs supplier, lot and quantity; bulk and finished product need batches."
      >
        <Segmented
          control={control}
          name="ncItem"
          label="What is non-conforming?"
          className="flex-wrap"
          options={NC_ITEMS.map((i) => ({ value: i, label: i }))}
        />
      </Field>

      {ncItem === "Other" && (
        <Field
          label="What is it?"
          htmlFor="ncr-item-other"
          required
          error={errors.ncItemOther?.message}
          className="md:col-span-2"
        >
          <input
            id="ncr-item-other"
            placeholder="e.g. Contract-tested stability samples, a calibration service"
            aria-invalid={Boolean(errors.ncItemOther)}
            className={CONTROL}
            {...register("ncItemOther")}
          />
        </Field>
      )}

      {material && (
        <>
          <Field
            label="Supplied by"
            required
            hint={
              suppliedBy === "customer"
                ? "Client-supplied: the customer, not a supplier, is notified and asked for corrective action."
                : undefined
            }
          >
            <Segmented
              control={control}
              name="suppliedBy"
              label="Supplied by"
              className="flex-wrap"
              options={SUPPLIED_BY.map((s) => ({ value: s.value, label: s.label }))}
            />
          </Field>
          <div className="hidden md:block" />

          <Field
            label="Material code"
            htmlFor="ncr-material"
            required
            error={errors.materialCode?.message}
          >
            <input
              id="ncr-material"
              placeholder="e.g. RM5521"
              aria-invalid={Boolean(errors.materialCode)}
              className={cn(CONTROL, "font-mono")}
              {...register("materialCode")}
            />
          </Field>

          <Field
            label={party}
            htmlFor="ncr-supplier"
            required
            error={errors.supplierName?.message}
          >
            <input
              id="ncr-supplier"
              placeholder={party === "Customer" ? "Customer whose material it is" : "e.g. CapsuTech"}
              aria-invalid={Boolean(errors.supplierName)}
              className={CONTROL}
              {...register("supplierName")}
            />
          </Field>

          <Field
            label={`${party} lot number(s)`}
            htmlFor="ncr-lots"
            required
            error={errors.lots?.message}
          >
            <input
              id="ncr-lots"
              placeholder="e.g. CT-902, CT-903"
              aria-invalid={Boolean(errors.lots)}
              className={cn(CONTROL, "font-mono")}
              {...register("lots")}
            />
            <LotHint factoryId={factoryId} form={form} caseId={caseId} />
          </Field>

          <QuantityField form={form} required />
        </>
      )}

      {product && (
        <>
          <Field
            label="Batches affected"
            htmlFor="ncr-batches"
            required
            error={errors.batches?.message}
          >
            <input
              id="ncr-batches"
              placeholder="e.g. 46686, 46690"
              aria-invalid={Boolean(errors.batches)}
              className={cn(CONTROL, "font-mono")}
              {...register("batches")}
            />
            <BatchesResolved
              factoryId={factoryId}
              control={control}
              name="batches"
              holding={holding}
              emptyHint="One or more."
            />
          </Field>
          <QuantityField form={form} required placeholder="e.g. 1,200 bottles" />
        </>
      )}

      {ncItem === "Other" && (
        <>
          <QuantityField form={form} placeholder="If it applies" />
          <div className="hidden md:block" />
        </>
      )}

      <Field
        label="Detected at"
        htmlFor="ncr-detected"
        required
        error={errors.detectionPoint?.message}
      >
        <SelectControl
          control={control}
          name="detectionPoint"
          id="ncr-detected"
          placeholder="Select…"
          invalid={Boolean(errors.detectionPoint)}
          options={NCR_DETECTION_POINTS.map((d) => ({ value: d, label: d }))}
        />
      </Field>

      <Field
        label="Date found"
        htmlFor="ncr-found"
        required
        error={errors.occurredAt?.message}
      >
        <Controller
          name="occurredAt"
          control={control}
          render={({ field }) => (
            <DateTimeField
              id="ncr-found"
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Pick the date and time"
            />
          )}
        />
      </Field>

      <Field
        label="Department"
        htmlFor="ncr-department"
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
          id="ncr-department"
          placeholder="Select…"
          searchPlaceholder="Department…"
          emptyMessage="No departments."
          invalid={Boolean(errors.departmentId)}
          options={departmentOptions}
        />
      </Field>

      <Field label="Location" htmlFor="ncr-location" note="(optional)">
        <input
          id="ncr-location"
          placeholder="e.g. Receiving bay, Room 17"
          className={CONTROL}
          {...register("location")}
        />
      </Field>

      {material && (
        <>
          <Field
            label="Affected batch(es)"
            htmlFor="ncr-found-batch"
            required={needBatch}
            note={needBatch ? undefined : "(optional)"}
            error={errors.batches?.message}
          >
            <input
              id="ncr-found-batch"
              placeholder="e.g. 46686"
              aria-invalid={Boolean(errors.batches)}
              className={cn(CONTROL, "font-mono")}
              {...register("batches")}
            />
            <BatchesResolved
              factoryId={factoryId}
              control={control}
              name="batches"
              holding={holding}
              emptyHint={
                needBatch
                  ? `Required: found during ${detectionPoint.toLowerCase()}, so the batch is known.`
                  : "If the material was already in a batch."
              }
            />
          </Field>
          <div className="hidden md:block" />
        </>
      )}

      <Field
        label="Requirement / specification"
        htmlFor="ncr-requirement"
        required
        error={errors.specification?.message}
      >
        <textarea
          id="ncr-requirement"
          rows={3}
          placeholder="Spec and limit, e.g. Spec RM5521 rev 4: dented capsules within AQL 0.65"
          aria-invalid={Boolean(errors.specification)}
          className={AREA}
          {...register("specification")}
        />
      </Field>

      <Field
        label="Description of non-conformance"
        htmlFor="ncr-actual"
        required
        error={errors.actual?.message}
      >
        <textarea
          id="ncr-actual"
          rows={3}
          placeholder="What was found against the limit, e.g. 6 dented in 200 sampled"
          aria-invalid={Boolean(errors.actual)}
          className={AREA}
          {...register("actual")}
        />
      </Field>

      <Field
        label="Immediate action"
        htmlFor="ncr-immediate"
        required
        error={errors.immediateAction?.message}
        className="md:col-span-2"
      >
        <textarea
          id="ncr-immediate"
          rows={3}
          placeholder="What was done straight away, or “None needed”"
          aria-invalid={Boolean(errors.immediateAction)}
          className={AREA}
          {...register("immediateAction")}
        />
        <label className="inline-flex items-center gap-2 text-xs text-ink-3">
          <input
            type="checkbox"
            checked={immediateAction === "None needed"}
            onChange={(e) =>
              setValue("immediateAction", e.target.checked ? "None needed" : "", {
                shouldValidate: Boolean(errors.immediateAction),
              })
            }
            className="size-3.5 accent-brand"
          />
          None needed
        </label>
      </Field>

      <Field
        label={material ? "Quarantine the lot?" : "Put the batch on hold?"}
        required
        error={errors.hold?.message}
        hint={
          material
            ? `Labels the lot “Quarantine — do not use” and blocks its issue until QA records the disposition.${parseBatches(batchesText ?? "").length > 0 ? " The batch where it was found is held too." : ""}`
            : "Holds the batch card and blocks production work in the shift log."
        }
      >
        <Segmented
          control={control}
          name="hold"
          label={material ? "Quarantine the lot?" : "Put the batch on hold?"}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
      </Field>

      {hold === "no" ? (
        <Field
          label="Why not"
          htmlFor="ncr-hold-why"
          required
          error={errors.holdNotReason?.message}
        >
          <input
            id="ncr-hold-why"
            placeholder={
              material
                ? "e.g. Rejected at the dock, never received into stock"
                : "e.g. Batch already rejected"
            }
            aria-invalid={Boolean(errors.holdNotReason)}
            className={CONTROL}
            {...register("holdNotReason")}
          />
        </Field>
      ) : (
        <div className="hidden md:block" />
      )}

      {product && (
        <Field label="Equipment" htmlFor="ncr-eq" note="(optional)">
          <input
            id="ncr-eq"
            placeholder="e.g. EQ-ENC2"
            className={cn(CONTROL, "font-mono")}
            {...register("equipmentNo")}
          />
          {(equipmentNo ?? "").trim() && (
            <p className="text-[0.6875rem] text-ink-5">
              {equipment ? equipment.name : "Not in the machine register."}
            </p>
          )}
        </Field>
      )}

      <Field label="Reference document / SOP" htmlFor="ncr-sop" note="(optional)">
        <input
          id="ncr-sop"
          placeholder="e.g. SOP-QC-021"
          className={cn(CONTROL, "font-mono")}
          {...register("sopNumber")}
        />
      </Field>
    </div>
  );
}

function QuantityField({
  form,
  required = false,
  placeholder = "e.g. 25,000 of 250,000 capsules",
}: {
  form: UseFormReturn<NcrInitiationValues>;
  required?: boolean;
  placeholder?: string;
}) {
  const error = form.formState.errors.qtyAffected?.message;
  return (
    <Field
      label="Quantity affected"
      htmlFor="ncr-qty"
      required={required}
      note={required ? undefined : "(optional)"}
      error={error}
    >
      <input
        id="ncr-qty"
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        className={CONTROL}
        {...form.register("qtyAffected")}
      />
    </Field>
  );
}

/**
 * Under the lot field, as the reference has it: an open NCR that already
 * covers one of these lots ("add to it instead?"), else one open for the same
 * material, else how to type several.
 */
function LotHint({
  factoryId,
  form,
  caseId,
}: {
  factoryId: string;
  form: UseFormReturn<NcrInitiationValues>;
  caseId?: string;
}) {
  const lotsText = useWatch({ control: form.control, name: "lots" });
  const materialCode = useWatch({ control: form.control, name: "materialCode" });
  const { data: cases = [] } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });

  const { sameLot, sameMaterial } = useMemo(() => {
    const lots = parseLots(lotsText ?? "").map((l) => l.toLowerCase());
    const code = (materialCode ?? "").trim().toLowerCase();
    const open = cases.filter((c) => c.type === "ncr" && c.status === "open" && c.id !== caseId);
    const sameLot = open.filter((c) =>
      c.supplier_lots.some((l) => lots.includes(l.toLowerCase())),
    );
    const sameMaterial = code
      ? open.filter((c) => (c.material_code ?? "").toLowerCase() === code)
      : [];
    return { sameLot, sameMaterial };
  }, [cases, lotsText, materialCode, caseId]);

  if (sameLot.length > 0) {
    return (
      <p className="text-[0.6875rem] leading-snug text-warn-ink">
        {sameLot.map((c) => c.deviation_no).join(", ")} already open for{" "}
        {sameLot.length > 1 ? "these lots" : "this lot"}. Add to it instead of
        raising a new NCR?
      </p>
    );
  }
  if (sameMaterial.length > 0) {
    return (
      <p className="text-[0.6875rem] leading-snug text-ink-5">
        Also open for {(materialCode ?? "").trim()}:{" "}
        {sameMaterial.map((c) => c.deviation_no).join(", ")}
      </p>
    );
  }
  return (
    <p className="text-[0.6875rem] leading-snug text-ink-5">
      One or more, separated by commas. Each lot is quarantined on its own row.
    </p>
  );
}
