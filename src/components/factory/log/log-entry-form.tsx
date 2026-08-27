"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Boxes,
  Cog,
  Gauge,
  Loader2,
  MapPin,
  MessageSquareText,
  Package,
  Plus,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_FLAGS,
  ACTION_FLAG_LABELS,
  MAX_OPERATORS,
  PROCESS_CATEGORIES,
  QTY_UNITS,
  SLOW_REASONS,
  SPEED_TYPES,
  logEntrySchema,
  operatorsRequired,
  speedTypeTakesRate,
  targetQtyFromSpeed,
  type LogEntryParsed,
  type LogEntryValues,
  type ProcessCategory,
} from "@/app/factory/[slug]/log/schemas";
import { BatchAutofill } from "@/components/factory/log/batch-autofill";
import { EquipmentAutofill } from "@/components/factory/log/equipment-autofill";
import {
  CONTROL,
  Field,
  FieldRow,
  MONO,
  SECTION,
  SELECT,
  SectionTitle,
} from "@/components/factory/log/log-fields";
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import { actionKeys } from "@/lib/factory/action-queries";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  clockNow,
  fetchShiftTimes,
  resolveCurrentShift,
  resolveShiftForEntry,
  shiftTimeKeys,
  todayKey,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import {
  createLogEntry,
  durationMinutes,
  fetchBatchEntries,
  formatMinutes,
  logKeys,
} from "@/lib/factory/shift-log-queries";
import { cn } from "@/lib/utils";

/**
 * Shift log → New entry.
 *
 * One form, **three** shapes, chosen by the `category` set on the activity in
 * Admin & Settings → Processes (migration 0030):
 *
 *   Downtime     Room, activity, start, end, batch, comments. Nothing was
 *                produced and nobody was operating anything, so no
 *                quantities, no speed, no equipment and no operator pickers
 *                appear at all — and null, not 0, is stored for every one of
 *                them, so "not applicable" stays distinguishable from
 *                "produced nothing".
 *   Preparatory  Mixing, drying, granulation. One quantity plus the unit the
 *                room counts in (drums, kg, litres), and who ran it. No speed
 *                and no derived target: a mixing room has no target RPM to
 *                run below.
 *   Production   The full record — equipment and speed when the stage runs on
 *                a machine, a target derived from speed × duration, actual
 *                and rejected quantities, and a reason whenever it runs below
 *                target, because that's what the OEE Pareto is built from.
 */
export function LogEntryForm({
  factoryId,
  userId,
  units,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
}) {
  const queryClient = useQueryClient();
  const [quick, setQuick] = useState(false);

  /**
   * Quick mode hides the Speed fields, so it must also clear them.
   *
   * Leaving the numbers in form state was a trap: the schema still demands a
   * slow-run reason when actual < target, so submitting would fail validation
   * against a field that isn't on screen — an error with nowhere to render and
   * nothing the operator could do about it. Clearing them also matches what
   * Quick means: a fast routine entry that doesn't record speed at all.
   */
  function toggleQuick() {
    const on = !quick;
    setQuick(on);
    if (on) {
      setValue("targetSpeed", undefined);
      setValue("actualSpeed", undefined);
      setValue("slowReason", "");
    }
  }

  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });
  // The machine register, resolved against below the same way the catalogue
  // resolves a batch number.
  const { data: equipmentList = [] } = useQuery({
    queryKey: equipmentKeys.all(factoryId),
    queryFn: () => fetchEquipment(factoryId),
  });
  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });
  const { data: employees = [] } = useQuery({
    queryKey: employeeKeys.all(factoryId),
    queryFn: () => fetchEmployees(factoryId),
  });

  const activeUnits = useMemo(
    () => unitList.filter((u) => u.active),
    [unitList],
  );
  const activeProcesses = useMemo(
    () => processList.filter((p) => p.active),
    [processList],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LogEntryValues, unknown, LogEntryParsed>({
    resolver: zodResolver(logEntrySchema),
    defaultValues: {
      factoryId,
      unitId: "",
      processId: "",
      shift: "morning",
      startTime: "",
      endTime: "",
      speedType: "RPM",
      speedRate: "hr",
      // One row, empty. Empty string rather than undefined: an unset field
      // should read as "nothing chosen yet", which the schema's own message
      // covers, rather than as a missing key that trips zod's type check first.
      operators: [{ name: "" }],
      // Overwritten the moment an activity is picked. Production is the safe
      // opening shape: it is the only one that asks for everything, so no
      // field the operator has already filled disappears on selection.
      category: "production",
      hasMachine: false,
    },
  });

  /**
   * One row per person, added and removed on demand. Beyond the first they're
   * the exception, so the form opens with a single picker rather than a wall
   * of empty dropdowns.
   */
  const {
    fields: operatorFields,
    append: addOperator,
    remove: removeOperator,
  } = useFieldArray({ control, name: "operators" });

  const [
    processId,
    batchNo,
    equipmentNo,
    startTime,
    endTime,
    shift,
    category,
    hasMachine,
    speedType,
    speedRate,
    targetSpeed,
    qty,
    operators,
  ] = useWatch({
    control,
    name: [
      "processId",
      "batchNo",
      "equipmentNo",
      "startTime",
      "endTime",
      "shift",
      "category",
      "hasMachine",
      "speedType",
      "speedRate",
      "targetSpeed",
      "qty",
      "operators",
    ],
  });

  // The activity decides which of the three shapes the form takes, so its
  // category is mirrored into the form values — that's what the schema's
  // cross-field rules read, and what decides which fields are rendered at all.
  useEffect(() => {
    const process = activeProcesses.find((p) => p.id === processId);
    // Production for an activity selected before the lists load: it's the
    // superset, so nothing already on screen flickers away and back.
    const next = (process?.category as ProcessCategory) ?? "production";
    setValue("category", next);
    // Meaningful on production only — the database forces it false for the
    // other two (migration 0030), and mirroring that here keeps the schema's
    // speed rules from firing against fields the form isn't showing.
    setValue(
      "hasMachine",
      next === "production" && Boolean(process?.flags.machine),
    );
  }, [processId, activeProcesses, setValue]);

  const isDowntime = category === "downtime";
  const isPreparatory = category === "preparatory";
  const isProduction = category === "production";

  /**
   * Quick mode trims a production entry down to the fields a hurried operator
   * can fill in later. On downtime there is nothing left to trim — the whole
   * form is six fields, and one of them (Comments) lives in the section Quick
   * collapses. So Quick is switched off rather than obeyed, and its button is
   * hidden, instead of leaving a control that would remove a required field.
   */
  const quickOn = quick && !isDowntime;

  // Once the factory's clock arrives, start the entry at the running shift's
  // start time — the operator usually just adjusts it. Strictly once, so a
  // refetch (a window refocus is enough) can't overwrite what they typed.
  const startPrefilled = useRef(false);
  useEffect(() => {
    if (!shiftTimes || startPrefilled.current) return;
    startPrefilled.current = true;
    if (!getValues("startTime")) {
      const current = resolveCurrentShift(shiftTimes);
      setValue("startTime", shiftTimes[current].startTime);
    }
  }, [shiftTimes, setValue, getValues]);

  const product = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  // Accumulative total: everything already logged for this batch + activity,
  // across every shift — not just what's on screen.
  const { data: batchEntries = [] } = useQuery({
    queryKey: ["shift_log_batch", factoryId, (batchNo ?? "").trim()],
    queryFn: () => fetchBatchEntries(factoryId, (batchNo ?? "").trim()),
    enabled: Boolean(product),
  });

  const previousQty = useMemo(
    () =>
      batchEntries
        .filter((e) => e.process_id === processId)
        .reduce((sum, e) => sum + Number(e.qty ?? 0), 0),
    [batchEntries, processId],
  );
  const thisQty = typeof qty === "number" && !Number.isNaN(qty) ? qty : 0;
  const runningTotal = previousQty + thisQty;

  const duration =
    startTime && endTime ? durationMinutes(startTime, endTime) : 0;

  // Downtime is waiting time — no one is operating anything, so no name is
  // demanded and the pickers aren't rendered. Same predicate the schema
  // validates with, so the marking on screen and the rule that blocks submit
  // can't disagree.
  const needsOperators = operatorsRequired(
    (category as ProcessCategory) ?? "production",
  );

  /**
   * The shift is a fact about the entry's own times, not about when someone
   * got round to typing it, so it's derived rather than picked: whichever
   * window holds more of the activity wins. A run from 14:40 to 15:40
   * straddles the handover and belongs to the morning it mostly happened in,
   * even when it's filed at 16:00.
   */
  useEffect(() => {
    if (!shiftTimes) return;
    setValue(
      "shift",
      resolveShiftForEntry(shiftTimes, startTime ?? "", duration) ??
        resolveCurrentShift(shiftTimes),
    );
  }, [shiftTimes, startTime, duration, setValue]);

  /**
   * The shift target is arithmetic, not an opinion: target speed × how long
   * the activity ran. Deriving it kills a whole class of entry that used to
   * pass validation while being meaningless — a target of 2 against 18,899
   * produced, which reads as 945,000% of plan in every later average.
   *
   * Null means the inputs don't support a target (see `targetQtyFromSpeed`),
   * and the field falls back to being typed.
   */
  const derivedTarget = targetQtyFromSpeed(
    speedType,
    speedRate,
    typeof targetSpeed === "number" && !Number.isNaN(targetSpeed)
      ? targetSpeed
      : undefined,
    duration,
  );

  // Never typed, in either direction. Clearing it when the inputs stop
  // supporting a target matters as much as setting it: switching Capsules to
  // RPM, or turning Quick on, would otherwise leave the last computed number
  // sitting there looking like it still meant something.
  useEffect(() => {
    setValue("targetQty", derivedTarget ?? undefined, { shouldValidate: true });
  }, [derivedTarget, setValue]);

  const submit = useMutation({
    // The working day is read at submit time, not when the page loaded — a
    // form left open across midnight must not file the entry under yesterday.
    mutationFn: (values: LogEntryParsed) =>
      createLogEntry(values, userId, todayKey(), product?.id ?? null),
    onSuccess: async (entry) => {
      // Invalidate every day in the cache, not just today's: the feed may be
      // showing another date, and the new row could belong on it.
      await queryClient.invalidateQueries({
        queryKey: logKeys.factory(factoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["shift_log_batch", factoryId],
      });
      // This entry may have just moved a card: started a planned job, held one
      // on a flag, released a hold, or completed a batch. The move happens in
      // the database trigger, so the only thing to do here is stop trusting
      // the copy of the board we already have.
      await queryClient.invalidateQueries({
        queryKey: pipelineKeys.all(factoryId),
      });
      // A flagged entry also raises an action, by the same route.
      await queryClient.invalidateQueries({
        queryKey: actionKeys.all(factoryId),
      });
      toast.success(
        `Logged — ${entry.unit?.name ?? ""} · ${entry.process?.name ?? ""}` +
          (entry.duration_minutes
            ? ` · ${formatMinutes(entry.duration_minutes)}`
            : ""),
      );

      // Keep unit + activity: an operator stays in one room for a whole shift,
      // and the next entry starts where this one ended.
      const keep = getValues();
      reset({
        factoryId,
        unitId: keep.unitId,
        processId: keep.processId,
        category: keep.category,
        hasMachine: keep.hasMachine,
        shift: keep.shift,
        startTime: keep.endTime,
        endTime: "",
        speedType: keep.speedType,
        speedRate: keep.speedRate,
        targetSpeed: keep.targetSpeed,
        // The same people usually work the whole shift, so the whole list
        // carries over — including however many rows were added for it.
        operators: keep.operators,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setupMissing = activeUnits.length === 0 || activeProcesses.length === 0;

  if (setupMissing) {
    return (
      <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white px-4 py-12 text-center text-sm text-[#94A3B8]">
        {activeUnits.length === 0
          ? `No ${units.plural.toLowerCase()} set up yet.`
          : "No process stages set up yet."}
        <br />
        Add them in Admin &amp; Settings before logging entries.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(
        (values) => submit.mutateAsync(values),
        // A silent no-op is the worst failure this form can have: the operator
        // presses Log entry, nothing happens, and there is nothing on screen to
        // read. Any field whose error isn't rendered — or is inside a section
        // Quick mode has collapsed — gets said out loud here.
        (errs) => {
          const first = Object.values(errs).find((e) => e?.message);
          toast.error(
            first?.message
              ? String(first.message)
              : "Some details are missing — check the highlighted fields.",
          );
        },
      )}
      /* A column, not a document: the header states what this is, the body
         scrolls, and the submit button is pinned where it can always be
         reached. A form eleven fields tall whose button is only findable by
         scrolling past everything is how half-filled entries happen. */
      className="flex flex-col overflow-hidden rounded-2xl border border-[#E6EAF1] bg-white shadow-[0_1px_2px_rgba(15,27,52,0.04),0_12px_32px_-24px_rgba(15,27,52,0.5)] lg:h-full"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F6] bg-white px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#0F1B34]">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[#EFF4FF] to-[#DCE7FF] text-[#2563EB]">
            <Plus className="size-4" />
          </span>
          New entry
        </h2>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[10px] font-semibold text-[#047857] ring-1 ring-[#A7F3D0]/70">
            <ShieldCheck className="size-3" />
            Audit-protected
          </span>
          {/* Nothing left to trim on a downtime entry — see `quickOn`. */}
          {!isDowntime && (
            <button
              type="button"
              onClick={() => toggleQuick()}
              title="Quick mode: fewer fields for routine hourly entries"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                quick
                  ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8] shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
                  : "border-[#E6EAF1] bg-white text-[#64748B] hover:border-[#CBD5E1] hover:text-[#0F1B34]",
              )}
            >
              <Zap className="size-3" />
              {quick ? "Quick on" : "Quick"}
            </button>
          )}
        </div>
      </header>

      <div className="scrollbar-slim min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 sm:p-5">
        {/* ── Where & when ─────────────────────────────────────────── */}
        <section className={SECTION}>
          <SectionTitle icon={MapPin}>Where &amp; when</SectionTitle>
          <FieldRow cols={3}>
            <Field
              label={units.singular}
              htmlFor="log-unit"
              error={errors.unitId?.message}
            >
              <select id="log-unit" className={SELECT} {...register("unitId")}>
                <option value="">Select…</option>
                {activeUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Activity / stage"
              htmlFor="log-process"
              error={errors.processId?.message}
            >
              <select
                id="log-process"
                className={SELECT}
                {...register("processId")}
              >
                <option value="">Select…</option>
                {/* Name only. The machine / output flags are configuration,
                    not something the operator picks between — the form already
                    shows their effect by revealing or hiding Speed and Output
                    the moment a stage is selected. */}
                {activeProcesses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {/* Read-only: the start and end times already say which shift this
                was, so asking again would only invite the two to disagree. */}
            <Field label="Shift" note="(auto)">
              <output
                className={cn(
                  CONTROL,
                  "flex items-center font-medium capitalize text-[#0F1B34]",
                )}
              >
                {shift ?? "—"}
              </output>
            </Field>
          </FieldRow>

          {/* Says out loud which of the three shapes is on screen. Without it
              the form silently grows and shrinks between activities and the
              operator is left wondering which fields went missing. */}
          {processId && <CategoryBadge category={category} />}

          <FieldRow className="mt-3">
            <Field
              label="Activity start"
              htmlFor="log-start"
              error={errors.startTime?.message}
            >
              <div className="flex gap-1.5">
                <input
                  id="log-start"
                  type="time"
                  className={cn(CONTROL, "flex-1")}
                  {...register("startTime")}
                />
                <NowButton onClick={() => setValue("startTime", clockNow())} />
              </div>
            </Field>
            <Field
              label="Activity end"
              htmlFor="log-end"
              error={errors.endTime?.message}
            >
              <div className="flex gap-1.5">
                <input
                  id="log-end"
                  type="time"
                  className={cn(CONTROL, "flex-1")}
                  {...register("endTime")}
                />
                <NowButton onClick={() => setValue("endTime", clockNow())} />
              </div>
            </Field>
            <Field label="Duration" note="(auto)">
              <output
                className={cn(
                  CONTROL,
                  MONO,
                  "flex items-center border-[#DCE7FF] bg-[#F5F8FF] font-semibold text-[#2563EB]",
                )}
              >
                {duration ? formatMinutes(duration) : "—"}
              </output>
            </Field>
          </FieldRow>
        </section>

        {/* Equipment belongs to machine activities — a manual stage has none,
            and neither preparatory nor downtime is ever one. */}
        {hasMachine && !quickOn && (
          <section className={SECTION}>
            <SectionTitle icon={Cog}>Equipment</SectionTitle>
            <Field
              label="Equipment no."
              optional
              htmlFor="log-equipment"
              error={errors.equipmentNo?.message}
            >
              <div className="space-y-2">
                <input
                  id="log-equipment"
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. EQ383, EQ112…"
                  autoComplete="off"
                  {...register("equipmentNo")}
                />
                {/* Resolved out of Admin → Equipment: the operator types the
                  number off the machine, the register supplies the name. */}
                <EquipmentAutofill
                  query={(equipmentNo ?? "").trim()}
                  equipment={equipment}
                />
              </div>
            </Field>
          </section>
        )}

        {/* ── Batch ────────────────────────────────────────────────── */}
        <section className={cn(SECTION, "space-y-2.5")}>
          <SectionTitle icon={Package} hint="→ auto-fills product details">
            Batch
          </SectionTitle>
          <Field
            label="Batch number"
            optional
            htmlFor="log-batch"
            error={errors.batchNo?.message}
          >
            <input
              id="log-batch"
              className={cn(CONTROL, MONO)}
              placeholder="e.g. 46004, 45972…"
              autoComplete="off"
              {...register("batchNo")}
            />
          </Field>
          <BatchAutofill
            query={(batchNo ?? "").trim()}
            product={product}
            runningTotal={runningTotal}
          />
        </section>

        {/* ── Output ───────────────────────────────────────────────────
            Three shapes. Preparatory records one number and the unit the room
            counts in; production records the full target / actual / rejected
            set; downtime records nothing and says so. */}
        {isPreparatory && (
          <section className={SECTION}>
            <SectionTitle icon={Boxes}>Output</SectionTitle>
            <Field
              label="Qty / batches processed"
              htmlFor="log-qty-prep"
              error={errors.qty?.message ?? errors.qtyUnit?.message}
            >
              <div className="flex gap-2">
                <input
                  id="log-qty-prep"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO, "flex-1")}
                  placeholder="e.g. 2 batches, 150 kg"
                  {...register("qty", { valueAsNumber: true })}
                />
                {/* The unit is half the measurement, not a decoration: "3"
                    with no unit is not something anyone can read back. */}
                <select
                  id="log-qty-unit"
                  aria-label="Unit"
                  className={cn(SELECT, "w-36 shrink-0")}
                  {...register("qtyUnit")}
                >
                  <option value="">Unit…</option>
                  {QTY_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </Field>

            {product && (
              <p className="mt-2 text-[11px] text-[#64748B]">
                Accumulative for this batch &amp; activity:{" "}
                <span className="font-mono font-semibold text-[#16A34A]">
                  {runningTotal.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </p>
            )}
          </section>
        )}

        {isProduction && (
          <section className={SECTION}>
            <SectionTitle icon={Boxes}>Output</SectionTitle>
            <FieldRow>
              <Field
                label="Shift target qty"
                note="(auto)"
                htmlFor="log-target-qty"
                error={errors.targetQty?.message}
              >
                <input
                  id="log-target-qty"
                  type="number"
                  step="any"
                  min={0}
                  // Read-only rather than disabled: a disabled input is skipped
                  // by form serialisation and drops out of the tab order, and
                  // the operator still needs to see and copy the number.
                  readOnly
                  tabIndex={-1}
                  className={cn(
                    CONTROL,
                    MONO,
                    "cursor-default border-[#DCE7FF] bg-[#F5F8FF] font-semibold text-[#2563EB] shadow-none focus:border-[#DCE7FF] focus:bg-[#F5F8FF] focus:ring-0",
                  )}
                  placeholder="Set a target speed"
                  {...register("targetQty", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Actual qty produced"
                htmlFor="log-qty"
                error={errors.qty?.message}
              >
                <input
                  id="log-qty"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 231453"
                  {...register("qty", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Qty rejected"
                note="/ rework — blank counts as none"
                htmlFor="log-rejected"
                error={errors.qtyRejected?.message}
              >
                <input
                  id="log-rejected"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 1240"
                  {...register("qtyRejected", { valueAsNumber: true })}
                />
              </Field>
            </FieldRow>

            {product && (
              <p className="mt-2 text-[11px] text-[#64748B]">
                Accumulative for this batch &amp; activity:{" "}
                <span className="font-mono font-semibold text-[#16A34A]">
                  {runningTotal.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>{" "}
                {previousQty > 0 && (
                  <>
                    (previously{" "}
                    {previousQty.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                    )
                  </>
                )}
              </p>
            )}
          </section>
        )}

        {isDowntime && (
          // Not an omission — a stated fact. A break, a breakdown or an idle
          // period stores null quantities, never 0, so it can't drag an
          // output average.
          <p className="flex items-start gap-2 rounded-2xl border border-dashed border-[#CBD5E1] bg-[#FBFCFE] px-4 py-3 text-xs text-[#64748B]">
            <Cog
              className="mt-px size-3.5 shrink-0 text-[#94A3B8]"
              aria-hidden
            />
            <span>
              <strong className="font-semibold text-[#334155]">Downtime</strong>{" "}
              — no quantities, speed or operators are recorded, only the time it
              consumed.
            </span>
          </p>
        )}

        {/* ── Speed — machine activities only ──────────────────────── */}
        {hasMachine && !quickOn && (
          <section className={SECTION}>
            <SectionTitle icon={Gauge} hint="→ feeds Performance OEE">
              Speed
            </SectionTitle>
            <FieldRow>
              <Field label="Speed unit" htmlFor="log-speed-type">
                <div className="flex gap-1.5">
                  <select
                    id="log-speed-type"
                    className={cn(SELECT, "flex-1")}
                    {...register("speedType")}
                  >
                    {SPEED_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  {/* RPM and Batches already carry their own period, so the
                      rate choice would be meaningless for them. */}
                  {speedTypeTakesRate(speedType ?? "") && (
                    <RateToggle control={control} setValue={setValue} />
                  )}
                </div>
              </Field>
              <Field
                label="Target speed"
                optional
                htmlFor="log-target-speed"
                error={errors.targetSpeed?.message}
              >
                <input
                  id="log-target-speed"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 1200"
                  {...register("targetSpeed", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Actual speed"
                optional
                htmlFor="log-actual-speed"
                error={errors.actualSpeed?.message}
              >
                <input
                  id="log-actual-speed"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 980"
                  {...register("actualSpeed", { valueAsNumber: true })}
                />
              </Field>
            </FieldRow>

            <SlowReason control={control} error={errors.slowReason?.message}>
              <select className={SELECT} {...register("slowReason")}>
                <option value="">Select reason…</option>
                {SLOW_REASONS.map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </select>
            </SlowReason>
          </section>
        )}

        {/* ── Operators ────────────────────────────────────────────────
            Outside the Quick gate on purpose. Quick mode trims the fields a
            hurried operator can fill in later; it can't trim who did the work,
            because nothing downstream can reconstruct that from the row.

            Downtime is the one exception, and it comes from the activity
            rather than from Quick — see `operatorsRequired`. There the
            section isn't optional, it's absent: nobody was operating
            anything, so there is no one to name. */}
        {!isDowntime && (
          <section className={SECTION}>
            <SectionTitle icon={Users}>Operators</SectionTitle>
            {/* The pickers render even with an empty roster: "Not on the list…"
              opens a free-text name, so a factory mid-setup can still file a
              shift instead of hitting a required field it has no way to fill. */}
            {employees.length === 0 && needsOperators && (
              <p className="mb-2.5 rounded-xl border border-dashed border-[#CBD5E1] bg-white px-3.5 py-3 text-xs text-[#64748B]">
                No one on the roster yet — add people in Admin &amp; Settings →
                Employees and they&rsquo;ll appear here. Until then, use
                &ldquo;Not on the list…&rdquo; to type a name.
              </p>
            )}
            <FieldRow cols={2}>
              {operatorFields.map((row, i) => (
                <OperatorPicker
                  // `row.id`, not the index: removing a middle row would
                  // otherwise re-key every picker below it and carry the wrong
                  // free-text state down with it.
                  key={row.id}
                  control={control}
                  name={`operators.${i}.name`}
                  label={`Operator ${i + 1}`}
                  optional={!needsOperators}
                  employees={employees}
                  shift={shift as RunningShift}
                  // Everyone picked in the *other* rows, so nobody is named twice.
                  exclude={(operators ?? [])
                    .filter((_, j) => j !== i)
                    .map((o) => o?.name)
                    .filter((n): n is string => Boolean(n))}
                  action={
                    // The first row is the required one and has no Remove — the
                    // schema would reject an empty list anyway, so offering it
                    // would only be a button that fails.
                    i > 0 ? (
                      <button
                        type="button"
                        onClick={() => removeOperator(i)}
                        className="text-[11px] font-semibold text-[#94A3B8] transition hover:text-[#B91C1C]"
                      >
                        Remove
                      </button>
                    ) : undefined
                  }
                />
              ))}
              {/* Takes the next cell in the same grid, so it lands beside the
                last picker on an odd count and starts a fresh row on an even
                one. The blank line stands in for a label, which is what lines
                the button up with the dropdowns rather than their labels. */}
              {operatorFields.length < MAX_OPERATORS && (
                <div className="flex flex-col space-y-1.5">
                  <span className="text-xs" aria-hidden>
                    &nbsp;
                  </span>
                  <button
                    type="button"
                    onClick={() => addOperator({ name: "" })}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#CBD5E1] bg-white text-sm font-medium text-[#64748B] transition hover:border-[#2563EB] hover:bg-[#F5F8FF] hover:text-[#2563EB]"
                  >
                    <Plus className="size-4" aria-hidden />
                    Add operator
                  </button>
                </div>
              )}
            </FieldRow>
          </section>
        )}

        {/* ── Notes ────────────────────────────────────────────────── */}
        {!quickOn && (
          <>
            <section className={cn(SECTION, "space-y-3")}>
              <SectionTitle icon={MessageSquareText}>Notes</SectionTitle>
              <Field
                label="Comments"
                optional
                htmlFor="log-comment"
                error={errors.comment?.message}
              >
                <input
                  id="log-comment"
                  className={CONTROL}
                  placeholder="e.g. dosing changed, capping issue…"
                  {...register("comment")}
                />
              </Field>
              {/* Downtime records the time and nothing else — raising an
                  issue off it is a separate act, done by hand in Issues &
                  CAPAs. */}
              {!isDowntime && (
                <Field
                  label="Flag for action?"
                  note="(creates an action item)"
                  htmlFor="log-flag"
                  error={errors.actionFlag?.message}
                >
                  <select
                    id="log-flag"
                    className={SELECT}
                    {...register("actionFlag")}
                  >
                    <option value="">No — routine entry</option>
                    {ACTION_FLAGS.map((flag) => (
                      <option key={flag} value={flag}>
                        {ACTION_FLAG_LABELS[flag]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </section>
          </>
        )}
      </div>

      {/* Pinned: the button belongs to the form, not to the bottom of the
          scroll. The note sits beside it rather than under it so the footer
          costs one row of height instead of two. */}
      <footer className="shrink-0 border-t border-[#EEF1F6] bg-gradient-to-b from-white to-[#F8FAFC] p-4 sm:px-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] active:scale-[0.995] disabled:pointer-events-none disabled:opacity-70"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Logging…" : "Log entry"}
        </button>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-[#94A3B8]">
          <ShieldCheck className="size-3 shrink-0" aria-hidden />
          Corrections are amendments, not deletes.
        </p>
      </footer>
    </form>
  );
}

/**
 * Per-minute or per-hour. Split out from the unit so a line measured in caps
 * per *minute* can be logged as such — an earlier cut hardcoded "/hr", which
 * silently recorded per-minute numbers against an hour and put every later
 * performance figure out by 60x.
 */
function RateToggle({
  control,
  setValue,
}: {
  control: ReturnType<
    typeof useForm<LogEntryValues, unknown, LogEntryParsed>
  >["control"];
  setValue: ReturnType<
    typeof useForm<LogEntryValues, unknown, LogEntryParsed>
  >["setValue"];
}) {
  const rate = useWatch({ control, name: "speedRate" }) ?? "hr";
  return (
    <div
      role="group"
      aria-label="Speed rate"
      className="flex shrink-0 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white"
    >
      {(["min", "hr"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setValue("speedRate", option, { shouldDirty: true })}
          aria-pressed={rate === option}
          className={cn(
            "px-2.5 text-xs font-semibold transition",
            rate === option
              ? "bg-[#2563EB] text-white"
              : "text-[#94A3B8] hover:bg-[#F8FAFC] hover:text-[#0F1B34]",
          )}
        >
          /{option}
        </button>
      ))}
    </div>
  );
}

/**
 * Which of the three shapes the form is currently in, and what that shape
 * asks for. Reads off the selected activity, never chosen here — it's
 * configuration from Admin → Processes, not a decision at logging time.
 */
const CATEGORY_STYLES: Record<
  ProcessCategory,
  { summary: string; className: string }
> = {
  downtime: {
    summary: "time only",
    className: "bg-[#F1F5F9] text-[#475569] ring-[#E2E8F0]",
  },
  preparatory: {
    summary: "batch & output",
    className: "bg-[#FEF3C7] text-[#92400E] ring-[#FDE68A]",
  },
  production: {
    summary: "full record",
    className: "bg-[#DBEAFE] text-[#1D4ED8] ring-[#BFDBFE]",
  },
};

function CategoryBadge({ category }: { category?: string }) {
  const key = (category ?? "production") as ProcessCategory;
  const style = CATEGORY_STYLES[key];
  const label = PROCESS_CATEGORIES.find((c) => c.value === key)?.label ?? key;
  if (!style) return null;

  return (
    <span
      className={cn(
        "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1",
        style.className,
      )}
    >
      <Cog className="size-3" aria-hidden />
      {label} — {style.summary}
    </span>
  );
}

function NowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Set to now"
      className="h-11 shrink-0 rounded-xl border border-[#DCE7FF] bg-[#F5F8FF] px-3 text-xs font-semibold text-[#2563EB] transition hover:border-[#2563EB] hover:bg-[#EFF4FF] active:scale-95"
    >
      Now
    </button>
  );
}

/**
 * The slow-speed reason only appears once the numbers say the machine ran
 * below target — and once it appears, the schema requires it.
 */
function SlowReason({
  control,
  error,
  children,
}: {
  control: ReturnType<
    typeof useForm<LogEntryValues, unknown, LogEntryParsed>
  >["control"];
  error?: string;
  children: React.ReactNode;
}) {
  const [target, actual] = useWatch({
    control,
    name: ["targetSpeed", "actualSpeed"],
  });
  const isSlow =
    typeof target === "number" &&
    typeof actual === "number" &&
    !Number.isNaN(target) &&
    !Number.isNaN(actual) &&
    target > 0 &&
    actual < target;

  if (!isSlow) return null;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 shadow-[0_1px_2px_rgba(180,83,9,0.06)]">
      <Field
        label="⚠ Reason for running below target speed"
        note="(required)"
        error={error}
      >
        {children}
      </Field>
      <p className="text-[11px] text-[#92400E]">
        This is what the Pareto chart in OEE &amp; Downtime is built from — an
        unexplained slow run is a gap in the analysis later.
      </p>
    </div>
  );
}
