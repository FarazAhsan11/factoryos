"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Lock } from "lucide-react";

import {
  NC_CATEGORIES,
  ORIGINS,
  RECEIVED_VIA,
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
  PersonControl,
  SelectControl,
  YesNo,
} from "@/components/factory/deviations/deviation-fields";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import {
  DEVIATION_TYPES,
  DISPOSITIONS,
  PRIORITIES,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
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
 * The **case type is a dropdown**. It decides the case's number — DEV, NCR
 * or CMP — so on an existing case it is locked and says why. Raised from a
 * Quality screen it offers only that screen's types, and when there is only
 * one (a non-conformance, a complaint) it is shown, not asked.
 *
 * **A deviation's form is shorter** (planned / unplanned only): no
 * non-conformance category, supplier, QA reviewer, materials, document
 * number, specification or potential impact; the customer is taken from the
 * batch rather than typed; the case owner is a plain name; "Raised by" is
 * prefilled with the signed-in person (editable); and the SLA date is called the due date. The fields stay
 * in the schema and are simply not drawn, so an older deviation keeps what it
 * had and saves it back unchanged. NCRs and complaints keep the full form.
 *
 * The "Linked CAPA" picker that pointed at Issues & CAPA is no longer drawn:
 * a case's CAPA is chosen on its CAPA tab now. `actionId` stays in the form's
 * values, so an old link is saved back unchanged.
 */
export function InitiationFields({
  form,
  factoryId,
  locked,
  types,
}: {
  form: UseFormReturn<InitiationValues>;
  factoryId: string;
  /** True on an existing case: the type is part of its number. */
  locked?: boolean;
  /** The types this form may raise; every type when absent. */
  types?: DeviationType[];
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
  const { data: workers = [] } = useWorkers(factoryId);

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

  // A deviation's shorter form: raised from the Deviations screen (only
  // planned / unplanned on offer), or an existing planned / unplanned case.
  const deviationForm =
    (types ?? (type ? [type] : [])).every(
      (t) => t === "planned" || t === "unplanned",
    ) &&
    (types !== undefined || type !== undefined);

  // The batch already knows whose order it is (migration 0041). On a
  // deviation the customer is not typed at all — it is the batch's, kept in
  // step as the number changes (once the catalogue has loaded, so an
  // existing case is not blanked while it is still arriving). Elsewhere it is
  // only filled while the field is empty, so a customer the catalogue never
  // recorded is never overwritten.
  useEffect(() => {
    if (deviationForm) {
      if (products.length === 0) return;
      const next = matched?.customer_name ?? "";
      if (next !== (customerName ?? "")) setValue("customerName", next);
      return;
    }
    if (matched?.customer_name && !(customerName ?? "").trim()) {
      setValue("customerName", matched.customer_name);
    }
  }, [deviationForm, products, matched, customerName, setValue]);

  const isNcr = type === "ncr";
  const isComplaint = type === "complaint";
  const offered = DEVIATION_TYPES.filter(
    (t) => !types || types.includes(t.value),
  );
  // One type on offer is not a question.
  const fixedType = locked || offered.length === 1;
  const quarantine = isNcr && disposition === "quarantine";
  const typed = (batchNo ?? "").trim();

  return (
    <div className="space-y-6">
      <Group title="Case details">
        {/* The title first, on every form: it is what the case is called.
            On a deviation the due date sits beside it — the title takes the
            room, the date a narrow column. */}
        <div
          className={cn(
            "grid gap-3",
            deviationForm && "sm:grid-cols-[minmax(0,1fr)_14rem]",
          )}
        >
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

          {deviationForm && (
            <Field
              label="Due date"
              htmlFor="dev-sla"
              note="(optional)"
              hint="When it should be closed by."
            >
              <DateControl control={control} name="slaDate" id="dev-sla" />
            </Field>
          )}
        </div>

        <Cols>
          <Field
            label="Case type"
            htmlFor="dev-type"
            required
            error={errors.type?.message}
            note={locked ? "(fixed)" : undefined}
          >
            {fixedType ? (
              <p
                className={cn(
                  CONTROL,
                  "flex items-center gap-2 bg-sunken text-ink-3",
                )}
              >
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
                options={offered.map((t) => ({
                  value: t.value,
                  label: t.label,
                  hint: t.hint,
                }))}
              />
            )}
            {locked && (
              <p className="text-[0.6875rem] text-ink-5">
                The type is part of the case number — raise a new case to change
                it.
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

        {isComplaint && (
          <Cols>
            <Field
              label="Received via"
              htmlFor="dev-received"
              required
              error={errors.receivedVia?.message}
            >
              <SelectControl
                control={control}
                name="receivedVia"
                id="dev-received"
                placeholder="How it reached you…"
                invalid={Boolean(errors.receivedVia)}
                options={RECEIVED_VIA.map((r) => ({ value: r, label: r }))}
              />
            </Field>
            <Field
              label="Injury or adverse reaction reported"
              hint="Leave unanswered until it is known — the close-out asks for it."
            >
              <YesNo control={control} name="adverseReaction" />
            </Field>
          </Cols>
        )}

        {/* NCRs and complaints: category and SLA date on their own row. */}
        {!deviationForm && (
          <Cols>
            {
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
            }

            <Field
              label="SLA date"
              htmlFor="dev-sla"
              note="(optional)"
              hint="When it should be closed by."
            >
              <DateControl control={control} name="slaDate" id="dev-sla" />
            </Field>
          </Cols>
        )}
      </Group>

      <Group title="Product & batch">
        {/* On a deviation the batch's details sit beside its number, one
            compact row; elsewhere the card stays under the fields. */}
        <div
          className={cn(
            deviationForm
              ? "grid items-start gap-3 sm:grid-cols-[13rem_minmax(0,1fr)]"
              : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
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

          {/* A deviation's customer is the batch's: shown in the batch card
              below and stored with the case, not typed. */}
          {!deviationForm && (
            <>
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
            </>
          )}

          {deviationForm && (
            <BatchSummary
              factoryId={factoryId}
              batchNo={batchNo ?? ""}
              showCustomer
              inline
              // Level with the input, below the field's label.
              className="sm:mt-[1.4rem]"
            />
          )}
        </div>

        {/* Product name and code are never typed: they are the batch's, and a
            second copy here would be the one that went stale. */}
        {!deviationForm && (
          <BatchSummary factoryId={factoryId} batchNo={batchNo ?? ""} />
        )}

        {!deviationForm && (
          <Cols of={2}>
            <Field
              label="Supplier name"
              htmlFor="dev-supplier"
              note="(optional)"
            >
              <input
                id="dev-supplier"
                placeholder="Who supplied the material"
                className={CONTROL}
                {...register("supplierName")}
              />
            </Field>
          </Cols>
        )}
      </Group>

      <Group title="People">
        <Cols>
          <Field label="Case owner" htmlFor="dev-owner" note="(optional)">
            {/* A typed name on a deviation for now; the workforce picker
                elsewhere. */}
            {deviationForm ? (
              <input
                id="dev-owner"
                placeholder="Who is carrying this case"
                className={CONTROL}
                {...register("ownerName")}
              />
            ) : (
              <PersonControl
                control={control}
                name="ownerName"
                id="dev-owner"
                workers={workers}
                label="Case owner"
                placeholder="Who is carrying this case"
              />
            )}
          </Field>
          {/* Prefilled with whoever is signed in and raising it, and still
              editable — the person holding the pen is not always the login. */}
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
          {!deviationForm && (
            <Field label="QA reviewer" htmlFor="dev-qa" note="(optional)">
              <input
                id="dev-qa"
                placeholder="QA manager name"
                className={CONTROL}
                {...register("qaReviewer")}
              />
            </Field>
          )}
        </Cols>
      </Group>

      <Group
        title={
          deviationForm
            ? "Equipment & procedure"
            : "Materials, equipment & documents"
        }
      >
        <Cols>
          {!deviationForm && (
            <>
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
            </>
          )}

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
              <p className="text-[0.6875rem] text-ink-5">
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
          {!deviationForm && (
            <Field label="Document number" htmlFor="dev-doc" note="(optional)">
              <input
                id="dev-doc"
                placeholder="Related document"
                className={cn(CONTROL, "font-mono")}
                {...register("documentNumber")}
              />
            </Field>
          )}
        </Cols>
      </Group>

      <Group title="The event">
        {!deviationForm && (
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
        )}

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

        {!deviationForm && (
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
        )}
      </Group>

      {/* What was done straight away. It was its own Containment tab; it is
          part of identifying the case, as the reference QMS has it. Both
          fields are optional until the close-out, which demands them. */}
      <Group title="Immediate / containment action">
        <Cols>
          <Field
            label="Immediate action date"
            htmlFor="dev-ia-date"
            note="(needed to close)"
          >
            <DateControl
              control={control}
              name="immediateActionDate"
              id="dev-ia-date"
            />
          </Field>
        </Cols>
        <Field
          label="Immediate action taken"
          htmlFor="dev-ia"
          note="(needed to close)"
          hint="What stopped this getting further — holds, quarantine, line stops."
          error={errors.immediateAction?.message}
        >
          <textarea
            id="dev-ia"
            rows={3}
            placeholder="e.g. Stock quarantined and returned for decanting, milling and compression."
            className={AREA}
            {...register("immediateAction")}
          />
        </Field>
      </Group>

      {isNcr && (
        <Group title="Batch disposition">
          <Field
            label="Disposition decision"
            required
            error={errors.disposition?.message}
          >
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
                    <span className="block text-[0.6875rem] text-ink-5">
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
