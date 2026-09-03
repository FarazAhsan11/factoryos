"use client";

import { useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Boxes,
  Cog,
  Gauge,
  Loader2,
  MapPin,
  MessageSquareText,
  Package,
  PenLine,
  Plus,
  ShieldCheck,
  Users,
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
  decomposeSpeedUnit,
  editEntrySchema,
  logEntryFieldsSchema,
  operatorsRequired,
  speedTypeTakesRate,
  targetQtyFromSpeed,
  type ActionFlag,
  type EditEntryParsed,
  type EditEntryValues,
  type ProcessCategory,
  type QtyUnit,
} from "@/app/factory/[slug]/log/schemas";
import { EquipmentAutofill } from "@/components/factory/log/equipment-autofill";
import {
  CONTROL,
  Field,
  FieldRow,
  MONO,
  SECTION,
  SectionTitle,
} from "@/components/factory/log/log-fields";
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import { actionKeys } from "@/lib/factory/action-queries";
import {
  batchStageKeys,
  fetchFactoryStages,
  stageName,
} from "@/lib/factory/batch-stage-queries";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  durationMinutes,
  entryColumns,
  formatMinutes,
  logKeys,
  updateLogEntry,
} from "@/lib/factory/shift-log-queries";
import { logTableKeys } from "@/lib/factory/shift-log-table-queries";
import {
  formatReportDate,
  shiftReportKeys,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import {
  fetchShiftTimes,
  resolveShiftForEntry,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * Shift report → correct an entry.
 *
 * The other half of the audit model. `AmendEntryDialog` attaches a note beside
 * numbers that stay as they were, which is the right answer when the record is
 * true but needs explaining. This is the answer when it is simply **wrong** —
 * a room typed 200 where it made 2,000, or filed an hour against the wrong
 * batch — because a note saying the figure is wrong still leaves the shift
 * total, the batch accumulative, the stage progress and the pipeline card all
 * reading the wrong figure.
 *
 * It opens from the report rather than only from the entry feed on purpose:
 * reading the sheet is when a supervisor notices, and the row they are looking
 * at is the one they need to fix.
 *
 * Nothing is deleted and nothing is quiet. The correction costs a note;
 * `shift_log_amend_guard` refuses the write without one, stamps who and when,
 * and forces the entry's provenance back to its original whatever this sends.
 * What the row used to say stays readable in the appended amendment history.
 */
export function EditEntryDialog({
  entry,
  factoryId,
  date,
  shift,
  units,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that entry. */
  entry: ShiftReportRow | null;
  factoryId: string;
  /** The sheet currently on screen — its cache key is the one to refresh. */
  date: string;
  shift: RunningShift;
  units: { singular: string; plural: string };
  onClose: () => void;
}) {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-[min(64rem,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-surface p-0 print:hidden"
        showCloseButton={false}
      >
        {/* Remounted per entry rather than reset into: the form derives a
            dozen values from the row it opened on, and `key` is the one way
            to be certain none of them survives into the next row. */}
        {entry && (
          <EditEntryForm
            key={entry.id}
            entry={entry}
            factoryId={factoryId}
            date={date}
            shift={shift}
            units={units}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Reading a filed row back into a form ─────────────────────────────── */

/** Postgres hands `time` back as `06:45:00`; every control here speaks HH:MM. */
function clock(value: string | null | undefined): string {
  return (value ?? "").slice(0, 5);
}

/** A numeric column, or undefined for "not recorded" — never 0 by accident. */
function num(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toFormValues(
  entry: ShiftReportRow,
  factoryId: string,
): EditEntryValues {
  const speed = decomposeSpeedUnit(entry.speed_unit);
  const names = (entry.operators ?? []).filter(Boolean);
  return {
    factoryId,
    unitId: entry.unit_id,
    processId: entry.process_id,
    shift: entry.shift === "afternoon" ? "afternoon" : "morning",
    startTime: clock(entry.start_time),
    endTime: clock(entry.end_time),
    equipmentNo: entry.equipment_no ?? "",
    batchNo: entry.batch_no ?? "",
    batchStageId: entry.batch_stage_id ?? "",
    targetQty: num(entry.target_qty),
    qty: num(entry.qty),
    qtyUnit: (entry.qty_unit as QtyUnit | null) ?? "",
    qtyRejected: num(entry.qty_rejected),
    speedType: speed.type,
    speedRate: speed.rate,
    targetSpeed: num(entry.target_speed),
    actualSpeed: num(entry.actual_speed),
    slowReason: entry.slow_reason ?? "",
    // Always at least one row, so the picker has somewhere to render even on
    // an entry filed with nobody named against it.
    operators: (names.length ? names : [""]).map((name) => ({ name })),
    comment: entry.comment ?? "",
    actionFlag: (entry.action_flag as ActionFlag | null) ?? "",
    category:
      (entry.process_category as ProcessCategory | null) ?? "production",
    hasMachine: Boolean(entry.has_machine),
    note: "",
  };
}

/* ── The form ─────────────────────────────────────────────────────────── */

function EditEntryForm({
  entry,
  factoryId,
  date,
  shift,
  units,
  onClose,
}: {
  entry: ShiftReportRow;
  factoryId: string;
  date: string;
  shift: RunningShift;
  units: { singular: string; plural: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  /* Every list the entry form reads, on the same cache keys — arriving here
     from a page that already loaded the rooms and the board costs nothing. */
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
  const { data: equipmentList = [] } = useQuery({
    queryKey: equipmentKeys.all(factoryId),
    queryFn: () => fetchEquipment(factoryId),
  });
  const { data: employees = [] } = useQuery({
    queryKey: employeeKeys.all(factoryId),
    queryFn: () => fetchEmployees(factoryId),
  });
  const { data: pipelineJobs = [] } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  const { data: allStages = [] } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });
  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  /**
   * A retired room or activity stays in the picker **when this entry uses
   * one**. A room retired last month still ran this shift, and dropping it
   * would leave the dropdown blank on an entry that is perfectly correct —
   * turning "fix the quantity" into "also re-pick a room that no longer
   * exists".
   */
  const selectableUnits = useMemo(
    () => unitList.filter((u) => u.active || u.id === entry.unit_id),
    [unitList, entry.unit_id],
  );
  const selectableProcesses = useMemo(
    () => processList.filter((p) => p.active || p.id === entry.process_id),
    [processList, entry.process_id],
  );
  const processGroups = useMemo(
    () =>
      PROCESS_CATEGORIES.map((c) => ({
        label: c.label,
        items: selectableProcesses.filter((p) => p.category === c.value),
      })).filter((g) => g.items.length > 0),
    [selectableProcesses],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EditEntryValues, unknown, EditEntryParsed>({
    resolver: zodResolver(editEntrySchema),
    defaultValues: toFormValues(entry, factoryId),
  });

  const {
    fields: operatorFields,
    append: addOperator,
    remove: removeOperator,
  } = useFieldArray({ control, name: "operators" });

  // The whole form, watched: the change summary below is a diff of every
  // field against what was filed, so there is no subset worth naming.
  const values = useWatch({ control }) as EditEntryValues;
  const {
    processId,
    batchNo,
    batchStageId,
    equipmentNo,
    startTime,
    endTime,
    category,
    hasMachine,
    speedType,
    speedRate,
    targetSpeed,
  } = values;

  // The activity decides which of the three shapes the record takes, so its
  // category is mirrored into the form values — that is what the schema's
  // cross-field rules read, and what decides which fields render at all.
  useEffect(() => {
    const process = selectableProcesses.find((p) => p.id === processId);
    if (!process) return;
    setValue("category", (process.category as ProcessCategory) ?? "production");
    setValue(
      "hasMachine",
      process.category === "production" && Boolean(process.flags.machine),
    );
  }, [processId, selectableProcesses, setValue]);

  const isDowntime = category === "downtime";
  const isPreparatory = category === "preparatory";
  const isProduction = category === "production";
  const needsOperators = operatorsRequired(
    (category as ProcessCategory) ?? "production",
  );

  const duration =
    startTime && endTime ? durationMinutes(startTime, endTime) : 0;

  const product = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  const job = useMemo(
    () =>
      product
        ? (pipelineJobs.find((j) => j.product_id === product.id) ?? null)
        : null,
    [pipelineJobs, product],
  );

  const stageChoices = useMemo(() => {
    if (!job || !processId) return [];
    return allStages.filter(
      (s) => s.job_id === job.id && s.process_id === processId,
    );
  }, [allStages, job, processId]);

  const mustPickStage = stageChoices.length > 1;

  /**
   * The stage this correction will point at.
   *
   * Resolved here rather than left to the database, and that is load-bearing:
   * `shift_log_stage_guard` returns early on an update whose stage is
   * unchanged, so an entry moved to a different batch or activity would
   * silently keep counting towards the stage it used to belong to.
   */
  const resolvedStageId = useMemo(() => {
    if (isDowntime) return null;
    if (stageChoices.length === 1) return stageChoices[0].id;
    return stageChoices.find((s) => s.id === batchStageId)?.id ?? null;
  }, [isDowntime, stageChoices, batchStageId]);

  // Clear a stage picked under a different activity — it would be validated
  // against a control no longer on screen, and refused by the guard.
  useEffect(() => {
    if (batchStageId && !stageChoices.some((s) => s.id === batchStageId)) {
      setValue("batchStageId", "");
    }
  }, [stageChoices, batchStageId, setValue]);

  const blockedByIssue = Boolean(job && !job.issued_at && !isDowntime);

  /**
   * The shift follows the corrected times, exactly as it does on the entry
   * form: it is a fact about when the activity ran, not about who typed it in.
   * Correcting a start time from 15:10 to 13:10 and leaving the entry on the
   * afternoon sheet would be a row that contradicts its own clock — and the
   * change summary names it, so an entry that leaves this sheet says so before
   * it goes.
   */
  useEffect(() => {
    if (!shiftTimes) return;
    const resolved = resolveShiftForEntry(
      shiftTimes,
      startTime ?? "",
      duration,
    );
    if (resolved) setValue("shift", resolved);
  }, [shiftTimes, startTime, duration, setValue]);

  /**
   * The shift target is arithmetic: target speed × how long the activity ran.
   *
   * Recomputed whenever it *can* be, and cleared only when the inputs behind
   * it actually changed. A correction to a comment must not silently wipe the
   * target on an entry whose speed unit — RPM, Batches — never supported
   * deriving one; that would be this dialog deleting a number nobody asked it
   * to touch.
   */
  const original = useMemo(() => decomposeSpeedUnit(entry.speed_unit), [entry]);
  const derivedTarget = targetQtyFromSpeed(
    speedType,
    speedRate,
    num(targetSpeed as number | undefined),
    duration,
  );
  const speedInputsChanged =
    speedType !== original.type ||
    speedRate !== original.rate ||
    num(targetSpeed as number | undefined) !== num(entry.target_speed) ||
    startTime !== clock(entry.start_time) ||
    endTime !== clock(entry.end_time);

  useEffect(() => {
    if (derivedTarget !== null) {
      setValue("targetQty", derivedTarget, { shouldValidate: true });
    } else if (speedInputsChanged) {
      setValue("targetQty", undefined, { shouldValidate: true });
    }
  }, [derivedTarget, speedInputsChanged, setValue]);

  /* ── What this correction will change ───────────────────────────────── */

  const unitNames = useMemo(
    () => new Map(unitList.map((u) => [u.id, u.name])),
    [unitList],
  );
  const processNames = useMemo(
    () => new Map(processList.map((p) => [p.id, p.name])),
    [processList],
  );

  const changes = useMemo(
    () =>
      describeChanges(entry, values, {
        productId: product?.id ?? null,
        unitNames,
        processNames,
        unitWord: units.singular,
      }),
    [entry, values, product, unitNames, processNames, units.singular],
  );

  const save = useMutation({
    mutationFn: (parsed: EditEntryParsed) =>
      updateLogEntry(
        entry.id,
        parsed,
        product?.id ?? null,
        resolvedStageId,
        entry.amend_note,
      ),
    onSuccess: async () => {
      /* Every reader of this row. The write re-runs the shift log's triggers,
         so a corrected quantity moves its stage's accumulated total, a
         corrected flag can raise an issue or release a hold, and the board
         may move — none of which the caches in memory know about. */
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: shiftReportKeys.entries(factoryId, date, shift),
        }),
        queryClient.invalidateQueries({ queryKey: logKeys.factory(factoryId) }),
        queryClient.invalidateQueries({
          queryKey: logTableKeys.all(factoryId),
        }),
        queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        }),
        queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
        queryClient.invalidateQueries({
          queryKey: batchStageKeys.all(factoryId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["shift_log_batch", factoryId],
        }),
      ]);
      toast.success("Entry corrected — the change is recorded on the record.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={handleSubmit(
        // Reported by `onError`; catching keeps the refusal from surfacing a
        // second time as an unhandled rejection.
        (parsed) => save.mutateAsync(parsed).catch(() => {}),
        // A silent no-op is the worst failure a form this tall can have. Any
        // error whose field is off screen — inside a section the current
        // category has hidden — gets said out loud here.
        (errs) => {
          const first = Object.values(errs).find((e) => e?.message);
          toast.error(
            first?.message
              ? String(first.message)
              : "Some details are missing — check the highlighted fields.",
          );
        },
      )}
      /* `contents` so the header and the scrolling body are the dialog's own
         grid rows: a form element between them would collapse the row sizing
         and put the page's scrollbar back on the whole box. */
      className="contents"
    >
      <EditHeader entry={entry} onClose={onClose} disabled={isSubmitting} />

      <div className="scrollbar-slim min-h-0 space-y-3.5 overflow-y-auto bg-sunken/60 p-4 sm:p-5">
        {/* ── Where & when ───────────────────────────────────────────── */}
        <section className={cn(SECTION, "bg-surface")}>
          <SectionTitle icon={MapPin}>Where &amp; when</SectionTitle>
          <FieldRow cols={3}>
            <Field
              label={units.singular}
              htmlFor="edit-unit"
              error={errors.unitId?.message}
            >
              <Controller
                name="unitId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="edit-unit"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.unitId)}
                    searchPlaceholder={`${units.singular} name…`}
                    emptyMessage={`No ${units.singular.toLowerCase()} matches that.`}
                    options={selectableUnits.map((u) => ({
                      value: u.id,
                      label: u.name,
                      meta: u.active ? undefined : "retired",
                    }))}
                  />
                )}
              />
            </Field>
            <Field
              label="Activity / stage"
              htmlFor="edit-process"
              error={errors.processId?.message}
            >
              <Controller
                name="processId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="edit-process"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.processId)}
                    searchPlaceholder="Activity name…"
                    emptyMessage="No activity matches that."
                    groups={processGroups.map((g) => ({
                      label: g.label,
                      options: g.items.map((proc) => ({
                        value: proc.id,
                        label: proc.name,
                        meta: proc.active ? undefined : "retired",
                      })),
                    }))}
                  />
                )}
              />
            </Field>
            <Field label="Duration" note="(auto)">
              <output
                className={cn(
                  CONTROL,
                  MONO,
                  "flex items-center border-brand-line bg-brand-tint font-semibold text-brand",
                )}
              >
                {duration ? formatMinutes(duration) : "—"}
              </output>
            </Field>
          </FieldRow>

          {/* Changing the activity changes the shape of the record, so the
              shape is stated rather than left to be inferred from which
              fields appeared and disappeared. */}
          <CategoryNote category={category as ProcessCategory} />

          <FieldRow cols={2} className="mt-3">
            <Field
              label="Activity start"
              htmlFor="edit-start"
              error={errors.startTime?.message}
            >
              <Controller
                name="startTime"
                control={control}
                render={({ field }) => (
                  <TimeField
                    id="edit-start"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    className="h-11 w-full"
                  />
                )}
              />
            </Field>
            <Field
              label="Activity end"
              htmlFor="edit-end"
              error={errors.endTime?.message}
            >
              <Controller
                name="endTime"
                control={control}
                render={({ field }) => (
                  <TimeField
                    id="edit-end"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    className="h-11 w-full"
                  />
                )}
              />
            </Field>
          </FieldRow>
        </section>

        {/* ── Equipment ──────────────────────────────────────────────── */}
        {hasMachine && (
          <section className={cn(SECTION, "bg-surface")}>
            <SectionTitle icon={Cog}>Equipment</SectionTitle>
            <Field
              label="Equipment no."
              optional
              htmlFor="edit-equipment"
              error={errors.equipmentNo?.message}
            >
              <div className="space-y-2">
                <input
                  id="edit-equipment"
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. EQ383, EQ112…"
                  autoComplete="off"
                  {...register("equipmentNo")}
                />
                <EquipmentAutofill
                  query={(equipmentNo ?? "").trim()}
                  equipment={equipment}
                />
              </div>
            </Field>
          </section>
        )}

        {/* ── Batch ──────────────────────────────────────────────────── */}
        <section className={cn(SECTION, "space-y-2.5 bg-surface")}>
          <SectionTitle icon={Package}>Batch</SectionTitle>
          <Field
            label="Batch number"
            optional
            htmlFor="edit-batch"
            error={errors.batchNo?.message}
          >
            <input
              id="edit-batch"
              className={cn(CONTROL, MONO)}
              placeholder="e.g. 46004, 45972…"
              autoComplete="off"
              {...register("batchNo")}
            />
          </Field>

          {/* Which catalogue row the number resolved to. That resolution is
              what re-points the entry at a different product, stage and
              pipeline card, so it is shown rather than done quietly. */}
          {(batchNo ?? "").trim() !== "" && (
            <p
              className={cn(
                "rounded-xl px-3.5 py-2 text-[11px]",
                product
                  ? "bg-teal-soft text-teal-deep"
                  : "border border-dashed border-ink-6 bg-sunken text-ink-4",
              )}
            >
              {product ? (
                <>
                  <span className="font-semibold">{product.name}</span>
                  {product.code && (
                    <span className="ml-1.5 font-mono">{product.code}</span>
                  )}
                  <span className="ml-1.5">
                    · required{" "}
                    {Number(product.required_qty ?? 0).toLocaleString()}
                  </span>
                </>
              ) : (
                "Not in the catalogue — the number stays on the record as typed, with no product against it."
              )}
            </p>
          )}

          {blockedByIssue && (
            <p className="flex items-start gap-2 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
              <Cog className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">
                  Batch {batchNo} isn&rsquo;t issued for production yet.
                </strong>{" "}
                The database refuses a producing entry against it — issue it on
                the Pipeline first, or leave this entry on a downtime activity.
              </span>
            </p>
          )}

          {mustPickStage && (
            <Field
              label="Stage / work order"
              note="this batch runs this activity more than once"
              htmlFor="edit-stage"
              error={errors.batchStageId?.message}
            >
              <Controller
                name="batchStageId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="edit-stage"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.batchStageId)}
                    options={stageChoices.map((stage) => ({
                      value: stage.id,
                      label: stageName(stage),
                      meta: stage.target_qty
                        ? `${Number(stage.target_qty).toLocaleString()} ${stage.target_unit}`
                        : undefined,
                    }))}
                  />
                )}
              />
            </Field>
          )}
        </section>

        {/* ── Output ─────────────────────────────────────────────────── */}
        {isPreparatory && (
          <section className={cn(SECTION, "bg-surface")}>
            <SectionTitle icon={Boxes}>Output</SectionTitle>
            <Field
              label="Qty / batches processed"
              htmlFor="edit-qty-prep"
              error={errors.qty?.message ?? errors.qtyUnit?.message}
            >
              <div className="flex gap-2">
                <input
                  id="edit-qty-prep"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO, "flex-1")}
                  placeholder="e.g. 2 batches, 150 kg"
                  {...register("qty", { valueAsNumber: true })}
                />
                <Controller
                  name="qtyUnit"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      id="edit-qty-unit"
                      ariaLabel="Unit"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ariaInvalid={Boolean(errors.qtyUnit)}
                      placeholder="Unit…"
                      clearable
                      options={QTY_UNITS.map((unit) => ({
                        value: unit,
                        label: unit,
                      }))}
                      className="w-36 shrink-0"
                    />
                  )}
                />
              </div>
            </Field>
          </section>
        )}

        {isProduction && (
          <section className={cn(SECTION, "bg-surface")}>
            <SectionTitle icon={Boxes}>Output</SectionTitle>
            <FieldRow>
              <Field
                label="Shift target qty"
                note="(auto)"
                htmlFor="edit-target-qty"
                error={errors.targetQty?.message}
              >
                <input
                  id="edit-target-qty"
                  type="number"
                  step="any"
                  min={0}
                  // Read-only rather than disabled: a disabled input drops out
                  // of form serialisation and the tab order, and the number
                  // still has to be readable.
                  readOnly
                  tabIndex={-1}
                  className={cn(
                    CONTROL,
                    MONO,
                    "cursor-default border-brand-line bg-brand-tint font-semibold text-brand shadow-none focus:border-brand-line focus:bg-brand-tint focus:ring-0",
                  )}
                  placeholder="Set a target speed"
                  {...register("targetQty", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Actual qty produced"
                htmlFor="edit-qty"
                error={errors.qty?.message}
              >
                <input
                  id="edit-qty"
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
                htmlFor="edit-rejected"
                error={errors.qtyRejected?.message}
              >
                <input
                  id="edit-rejected"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 1240"
                  {...register("qtyRejected", { valueAsNumber: true })}
                />
              </Field>
            </FieldRow>
          </section>
        )}

        {isDowntime && (
          <p className="flex items-start gap-2 rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-3 text-xs text-ink-4">
            <Cog className="mt-px size-3.5 shrink-0 text-ink-5" aria-hidden />
            <span>
              <strong className="font-semibold text-ink-2">Downtime</strong> —
              no quantities, speed or operators are kept, only the time it
              consumed. Saving clears any this entry still carries, and the
              summary below lists each one.
            </span>
          </p>
        )}

        {/* ── Speed ──────────────────────────────────────────────────── */}
        {hasMachine && (
          <section className={cn(SECTION, "bg-surface")}>
            <SectionTitle icon={Gauge} hint="→ feeds Performance OEE">
              Speed
            </SectionTitle>
            <FieldRow>
              <Field label="Speed unit" htmlFor="edit-speed-type">
                <div className="flex gap-1.5">
                  <Controller
                    name="speedType"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="edit-speed-type"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        options={SPEED_TYPES.map((type) => ({
                          value: type.value,
                          label: type.label,
                        }))}
                        className="flex-1"
                      />
                    )}
                  />
                  {/* RPM and Batches already carry their own period, so the
                      rate choice would be meaningless for them. */}
                  {speedTypeTakesRate(speedType ?? "") && (
                    <div
                      role="group"
                      aria-label="Speed rate"
                      className="flex shrink-0 overflow-hidden rounded-xl border border-line bg-surface"
                    >
                      {(["min", "hr"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setValue("speedRate", option, { shouldDirty: true })
                          }
                          aria-pressed={speedRate === option}
                          className={cn(
                            "px-2.5 text-xs font-semibold transition",
                            speedRate === option
                              ? "bg-brand text-white"
                              : "text-ink-5 hover:bg-sunken hover:text-ink",
                          )}
                        >
                          /{option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
              <Field
                label="Target speed"
                optional
                htmlFor="edit-target-speed"
                error={errors.targetSpeed?.message}
              >
                <input
                  id="edit-target-speed"
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
                htmlFor="edit-actual-speed"
                error={errors.actualSpeed?.message}
              >
                <input
                  id="edit-actual-speed"
                  type="number"
                  step="any"
                  min={0}
                  className={cn(CONTROL, MONO)}
                  placeholder="e.g. 980"
                  {...register("actualSpeed", { valueAsNumber: true })}
                />
              </Field>
            </FieldRow>

            <Field
              label="Reason it ran slow"
              className="mt-3"
              error={errors.slowReason?.message}
            >
              <Controller
                name="slowReason"
                control={control}
                render={({ field }) => (
                  <SelectField
                    ariaLabel="Reason it ran slow"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.slowReason)}
                    placeholder="Select reason…"
                    clearable
                    options={SLOW_REASONS.map((reason) => ({
                      value: reason,
                      label: reason,
                    }))}
                  />
                )}
              />
            </Field>
          </section>
        )}

        {/* ── Operators ──────────────────────────────────────────────── */}
        {!isDowntime && (
          <section className={cn(SECTION, "bg-surface")}>
            <SectionTitle icon={Users}>Operators</SectionTitle>
            <FieldRow cols={2}>
              {operatorFields.map((row, i) => (
                <OperatorPicker
                  // `row.id`, not the index: removing a middle row would
                  // otherwise re-key every picker below it and carry the wrong
                  // free-text state down with it.
                  key={row.id}
                  control={control}
                  name={`operators.${i}.name` as const}
                  label={`Operator ${i + 1}`}
                  optional={!needsOperators}
                  employees={employees}
                  shift={(values.shift ?? shift) as RunningShift}
                  exclude={(values.operators ?? [])
                    .filter((_, j) => j !== i)
                    .map((o) => o?.name)
                    .filter((n): n is string => Boolean(n))}
                  action={
                    i > 0 ? (
                      <button
                        type="button"
                        onClick={() => removeOperator(i)}
                        className="text-[11px] font-semibold text-ink-5 transition hover:text-danger-deep"
                      >
                        Remove
                      </button>
                    ) : undefined
                  }
                />
              ))}
              {operatorFields.length < MAX_OPERATORS && (
                <div className="flex flex-col space-y-1.5">
                  <span className="text-xs" aria-hidden>
                    &nbsp;
                  </span>
                  <button
                    type="button"
                    onClick={() => addOperator({ name: "" })}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink-6 bg-surface text-sm font-medium text-ink-4 transition hover:border-brand hover:bg-brand-tint hover:text-brand"
                  >
                    <Plus className="size-4" aria-hidden />
                    Add operator
                  </button>
                </div>
              )}
            </FieldRow>
          </section>
        )}

        {/* ── Notes ──────────────────────────────────────────────────── */}
        <section className={cn(SECTION, "space-y-3 bg-surface")}>
          <SectionTitle icon={MessageSquareText}>Notes</SectionTitle>
          <Field
            label="Comments"
            optional
            htmlFor="edit-comment"
            error={errors.comment?.message}
          >
            <input
              id="edit-comment"
              className={CONTROL}
              placeholder="e.g. dosing changed, capping issue…"
              {...register("comment")}
            />
          </Field>
          {!isDowntime && (
            <Field
              label="Flag for action?"
              note="(raises an action item)"
              htmlFor="edit-flag"
              error={errors.actionFlag?.message}
            >
              <Controller
                name="actionFlag"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="edit-flag"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.actionFlag)}
                    clearable
                    clearLabel="No — routine entry"
                    placeholder="No — routine entry"
                    options={ACTION_FLAGS.map((flag) => ({
                      value: flag,
                      label: ACTION_FLAG_LABELS[flag],
                    }))}
                  />
                )}
              />
            </Field>
          )}
        </section>

        {/* ── The correction itself ──────────────────────────────────── */}
        <ChangeSummary changes={changes} />

        <section
          className={cn(SECTION, "border-brand-line bg-brand-tint/60")}
          aria-labelledby="edit-note-label"
        >
          <SectionTitle icon={PenLine} className="mb-3">
            <span id="edit-note-label">Reason for this correction</span>
          </SectionTitle>
          <textarea
            id="edit-note"
            rows={3}
            aria-invalid={Boolean(errors.note)}
            className={cn(
              "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-placeholder focus:ring-4 focus:ring-brand/12",
              errors.note
                ? "border-danger-line focus:border-danger"
                : "border-line focus:border-brand",
            )}
            placeholder="What was wrong, and what you corrected it to…"
            {...register("note")}
          />
          {errors.note ? (
            <p className="mt-1.5 text-xs font-medium text-danger-deep">
              {errors.note.message}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-ink-5">
              Appended to this entry&rsquo;s amendment history and stamped with
              your name — it is the only record of what the row used to say.
            </p>
          )}

          {entry.amend_note && (
            <div className="mt-3 rounded-xl border border-line bg-surface p-3">
              <p className="mb-1 text-[10px] font-bold tracking-[0.6px] text-ink-5 uppercase">
                Earlier amendments
              </p>
              <p className="text-xs whitespace-pre-line text-ink-3">
                {entry.amend_note}
              </p>
            </div>
          )}
        </section>

        <EditFooter
          changeCount={changes.length}
          isSubmitting={isSubmitting}
          onCancel={onClose}
        />
      </div>
    </form>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────── */

function EditHeader({
  entry,
  onClose,
  disabled,
}: {
  entry: ShiftReportRow;
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
      <div className="min-w-0">
        <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand-line text-brand">
            <PenLine className="size-4" />
          </span>
          Correct entry
        </DialogTitle>
        <DialogDescription className="mt-1 truncate text-xs text-ink-4">
          {entry.unit_name ?? "—"} · {entry.process_name ?? "—"}
          {entry.batch_no && ` · batch ${entry.batch_no}`} ·{" "}
          {formatReportDate(entry.log_date)} · {entry.shift} shift
        </DialogDescription>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[10px] font-semibold text-teal-deep ring-1 ring-teal-line/70 sm:inline-flex">
          <ShieldCheck className="size-3" />
          Audit-protected
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-5 transition hover:bg-sunken hover:text-ink disabled:opacity-50"
        >
          Close
        </button>
      </div>
    </header>
  );
}

function EditFooter({
  changeCount,
  isSubmitting,
  onCancel,
}: {
  changeCount: number;
  isSubmitting: boolean;
  onCancel: () => void;
}) {
  return (
    /* Sticky inside the scroll box rather than pinned outside it: the note the
       button acts on is the last thing above it, and the count has to stay
       reachable from anywhere in a form this tall. */
    <footer className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:-mb-5 sm:px-5">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-5">
        <ShieldCheck className="size-3 shrink-0" aria-hidden />
        {changeCount === 0
          ? "Nothing changed yet."
          : `${changeCount} ${changeCount === 1 ? "field" : "fields"} will change.`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="h-10 rounded-xl border border-line px-4 text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-6 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.995] disabled:pointer-events-none disabled:opacity-70"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Saving…" : "Save correction"}
        </button>
      </div>
    </footer>
  );
}

/** Which of the three shapes the record is in — it changes with the activity. */
function CategoryNote({ category }: { category: ProcessCategory }) {
  const meta = PROCESS_CATEGORIES.find((c) => c.value === category);
  if (!meta) return null;
  return (
    <p className="mt-3 rounded-xl bg-sunken px-3 py-2 text-[11px] text-ink-4">
      <span className="font-bold tracking-[0.06em] text-ink-2 uppercase">
        {meta.label}
      </span>{" "}
      — {meta.hint}
    </p>
  );
}

/* ── The diff ─────────────────────────────────────────────────────────── */

interface FieldChange {
  label: string;
  from: string;
  to: string;
}

/** Thousands separators, an em-dash for "not recorded". */
function qty(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : String(value);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = Array.isArray(value) ? value.join(" / ") : String(value);
  return s.trim() === "" ? "—" : s;
}

/**
 * What this correction is about to change, in the record's own terms.
 *
 * Diffed against the **stored** shape rather than against the controls,
 * because the two differ exactly where it matters most: re-pointing an entry
 * at a downtime activity clears its quantities, its speed and its operators,
 * and a summary that only said "Activity" would hide four deletions behind one
 * line. `entryColumns` is the same function the write uses, so what is listed
 * here and what lands in the database cannot disagree.
 *
 * Returns nothing while the form is incomplete — a half-typed number is not a
 * change worth announcing, and the schema speaks for itself on submit.
 */
function describeChanges(
  entry: ShiftReportRow,
  values: EditEntryValues,
  lookups: {
    productId: string | null;
    unitNames: Map<string, string>;
    processNames: Map<string, string>;
    unitWord: string;
  },
): FieldChange[] {
  const parsed = logEntryFieldsSchema.safeParse(values);
  if (!parsed.success) return [];

  const next = entryColumns(
    { ...parsed.data, note: "" },
    lookups.productId,
  ) as Record<string, unknown>;
  const before = entry as unknown as Record<string, unknown>;

  const rows: {
    key: string;
    label: string;
    format: (v: unknown) => string;
  }[] = [
    {
      key: "unit_id",
      label: lookups.unitWord,
      format: (v) => lookups.unitNames.get(String(v)) ?? "—",
    },
    {
      key: "process_id",
      label: "Activity",
      format: (v) => lookups.processNames.get(String(v)) ?? "—",
    },
    { key: "shift", label: "Shift", format: text },
    { key: "start_time", label: "Start", format: (v) => clock(v as string) },
    { key: "end_time", label: "End", format: (v) => clock(v as string) },
    {
      key: "duration_minutes",
      label: "Duration",
      format: (v) => formatMinutes(Number(v ?? 0)),
    },
    { key: "equipment_no", label: "Equipment", format: text },
    { key: "batch_no", label: "Batch", format: text },
    { key: "target_qty", label: "Target qty", format: qty },
    { key: "qty", label: "Qty produced", format: qty },
    { key: "qty_unit", label: "Qty unit", format: text },
    { key: "qty_rejected", label: "Rejected", format: qty },
    { key: "speed_unit", label: "Speed unit", format: text },
    { key: "target_speed", label: "Target speed", format: qty },
    { key: "actual_speed", label: "Actual speed", format: qty },
    { key: "slow_reason", label: "Slow reason", format: text },
    { key: "operators", label: "Operators", format: text },
    { key: "comment", label: "Comment", format: text },
    { key: "action_flag", label: "Action flag", format: text },
  ];

  return rows.flatMap(({ key, label, format }) => {
    const from = format(before[key] ?? null);
    const to = format(next[key] ?? null);
    return from === to ? [] : [{ label, from, to }];
  });
}

function ChangeSummary({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <section className={cn(SECTION, "border-warn-line bg-warn-tint/70")}>
      <SectionTitle icon={PenLine}>What this changes</SectionTitle>
      <ul className="space-y-1.5">
        {changes.map((change) => (
          <li
            key={change.label}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
          >
            <span className="min-w-[7.5rem] font-semibold text-ink-2">
              {change.label}
            </span>
            <span className="font-mono text-[11.5px] text-ink-5 line-through decoration-danger/60">
              {change.from}
            </span>
            <ArrowRight className="size-3 shrink-0 text-ink-5" aria-hidden />
            <span className="font-mono text-[11.5px] font-semibold text-ink">
              {change.to}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
