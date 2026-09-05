"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Popover } from "@base-ui/react/popover";
import { Loader2, Plus, TriangleAlert, Users, X } from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_FLAGS,
  ACTION_FLAG_LABELS,
  MAX_OPERATORS,
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
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import { StageProgress } from "@/components/factory/log/stage-progress";
import { TimeField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import { actionKeys } from "@/lib/factory/action-queries";
import {
  batchStageKeys,
  fetchFactoryStages,
  stageIsOverTolerance,
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
  createLogEntry,
  durationMinutes,
  fetchBatchEntries,
  formatMinutes,
  logKeys,
} from "@/lib/factory/shift-log-queries";
import { shiftReportKeys } from "@/lib/factory/shift-report-queries";
import {
  fetchShiftTimes,
  shiftTimeKeys,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * Shift report → a new entry, typed straight into the sheet.
 *
 * The same record the shift log files, entered the way a spreadsheet is: one
 * control per column, on the grid, in the room whose `+` was pressed. It is
 * not a second way of writing an entry — it parses with `logEntrySchema`, the
 * schema the log form uses, and writes through `createLogEntry`, so every
 * database trigger that governs a logged entry governs this one: the four-rule
 * batch gate (0038), automatic stage resolution (0033), the stage tolerance
 * (0037), the pipeline card move and the action a flag raises.
 *
 * **Two fields have no column**, and pretending otherwise would have meant
 * dropping them: the activity's start and end times, which the sheet shows only
 * as a derived run time. They live in the strip under the row, along with the
 * stage picker where a batch runs one activity twice, every warning the entry
 * has earned, and the buttons. That strip is the formula bar to the row's
 * spreadsheet — the row holds the values, the strip holds what is being said
 * about them.
 *
 * The date is the report's, not today's. Adding a row to a sheet dated last
 * Tuesday files it against last Tuesday, which is the point: this exists so a
 * missed entry can be caught when the sheet is read.
 */
export function NewEntryRow({
  factoryId,
  userId,
  date,
  shift,
  unit,
  canManage,
  onDone,
}: {
  factoryId: string;
  userId: string;
  /**
   * Manager and up. Only decides how wide the two clocks open — see
   * `clockWindow`. Everyone who can reach this sheet may add a row.
   */
  canManage: boolean;
  /** The report's date — what the entry is filed against, not today. */
  date: string;
  /** The report's shift, fixed: the row was added to this sheet. */
  shift: RunningShift;
  /** The room whose `+` was pressed. Not editable — the row belongs to it. */
  unit: { id: string; name: string };
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [operatorsOpen, setOperatorsOpen] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LogEntryValues, unknown, LogEntryParsed>({
    resolver: zodResolver(logEntrySchema),
    defaultValues: {
      factoryId,
      unitId: unit.id,
      processId: "",
      shift,
      startTime: "",
      endTime: "",
      speedType: "RPM",
      speedRate: "hr",
      operators: [{ name: "" }],
      // Production until an activity says otherwise: it is the only shape that
      // asks for everything, so no cell already filled disappears on selection.
      category: "production",
      hasMachine: false,
    },
  });

  const {
    fields: operatorFields,
    append,
    remove,
  } = useFieldArray({
    control,
    name: "operators",
  });

  const [
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
    actualSpeed,
    qty,
    operators,
  ] = useWatch({
    control,
    name: [
      "processId",
      "batchNo",
      "batchStageId",
      "equipmentNo",
      "startTime",
      "endTime",
      "category",
      "hasMachine",
      "speedType",
      "speedRate",
      "targetSpeed",
      "actualSpeed",
      "qty",
      "operators",
    ],
  });

  /* ── The registers this row reads from ──────────────────────────────── */

  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });
  const { data: products = [], isPending: productsPending } = useQuery({
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
  const { data: pipelineJobs = [], isPending: jobsPending } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  const { data: allStages = [], isPending: stagesPending } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });
  const { data: shiftTimes } = useQuery({
    queryKey: shiftTimeKeys.all(factoryId),
    queryFn: () => fetchShiftTimes(factoryId),
  });

  const activeProcesses = useMemo(
    () => processList.filter((p) => p.active),
    [processList],
  );

  /* ── What the activity decides ──────────────────────────────────────── */

  // Mirrored into the form values because that is what the schema's
  // cross-field rules read, and what decides which cells are live at all.
  useEffect(() => {
    const process = activeProcesses.find((p) => p.id === processId);
    const next = (process?.category as ProcessCategory) ?? "production";
    setValue("category", next);
    setValue(
      "hasMachine",
      next === "production" && Boolean(process?.flags.machine),
    );
  }, [processId, activeProcesses, setValue]);

  const isDowntime = category === "downtime";
  const isPreparatory = category === "preparatory";
  const isProduction = category === "production";

  /* ── What the batch decides ─────────────────────────────────────────── */

  const product = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

  const job = useMemo(
    () =>
      product
        ? (pipelineJobs.find((j) => j.product_id === product.id) ?? null)
        : null,
    [pipelineJobs, product],
  );

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  const stageChoices = useMemo(() => {
    if (!job || !processId || isDowntime) return [];
    return allStages.filter(
      (s) => s.job_id === job.id && s.process_id === processId,
    );
  }, [allStages, job, processId, isDowntime]);

  const mustPickStage = stageChoices.length > 1;
  const activeStage = useMemo(() => {
    if (stageChoices.length === 1) return stageChoices[0];
    return stageChoices.find((s) => s.id === batchStageId) ?? null;
  }, [stageChoices, batchStageId]);

  // Clear a stage picked under a different activity — the guard would refuse it.
  useEffect(() => {
    if (batchStageId && !stageChoices.some((s) => s.id === batchStageId)) {
      setValue("batchStageId", "");
    }
  }, [stageChoices, batchStageId, setValue]);

  /**
   * The four rules of `shift_log_stage_guard`, said before the submit rather
   * than after it. Identical in order and wording to the log form's — an entry
   * refused there has to be refused here for the same stated reason.
   */
  const batchBlock = useMemo(() => {
    if (productsPending || jobsPending) return null;
    const typed = (batchNo ?? "").trim();

    if (isDowntime) {
      if (!typed) return null;
      if (!product) return `No batch ${typed} in the product register.`;
      if (!job)
        return `Batch ${typed} isn't on the production board — time can't be charged to it.`;
      return null;
    }

    if (!typed) return "This entry needs a batch number.";
    if (!product) return `No batch ${typed} in the product register.`;
    if (!job) return `Batch ${typed} isn't on the production board.`;
    if (!job.issued_at)
      return `Batch ${typed} isn't issued for production yet.`;
    if (processId && !stagesPending && stageChoices.length === 0) {
      return `This activity isn't in batch ${typed}'s plan.`;
    }
    return null;
  }, [
    isDowntime,
    productsPending,
    jobsPending,
    stagesPending,
    batchNo,
    product,
    job,
    processId,
    stageChoices,
  ]);

  /* ── The figures the sheet's own columns show ───────────────────────── */

  const duration = durationMinutes(startTime ?? "", endTime ?? "");

  const derivedTarget = targetQtyFromSpeed(
    speedType,
    speedRate,
    typeof targetSpeed === "number" && !Number.isNaN(targetSpeed)
      ? targetSpeed
      : undefined,
    duration,
  );

  // Never typed, in either direction — clearing it matters as much as setting
  // it, or a stale figure sits in a read-only cell looking like a fact.
  useEffect(() => {
    setValue("targetQty", derivedTarget ?? undefined);
  }, [derivedTarget, setValue]);

  const { data: batchEntries = [] } = useQuery({
    queryKey: ["shift_log_batch", factoryId, (batchNo ?? "").trim()],
    queryFn: () => fetchBatchEntries(factoryId, (batchNo ?? "").trim()),
    enabled: Boolean(product),
  });

  const thisQty = typeof qty === "number" && !Number.isNaN(qty) ? qty : 0;
  const previousQty = useMemo(
    () =>
      batchEntries
        .filter((e) => e.process_id === processId)
        .reduce((sum, e) => sum + Number(e.qty ?? 0), 0),
    [batchEntries, processId],
  );
  const runningTotal = previousQty + thisQty;

  /**
   * The Shift target and Progress columns, computed the way this sheet
   * computes them for a filed row.
   *
   * Shift target is the entry own target_qty: speed times how long it ran,
   * what this shift was expected to make — not the batch order quantity,
   * which is what the log form puts in its batch panel. A row being typed has
   * to show the same number in that column that it will show once it is
   * filed, or the sheet says two different things about one entry either side
   * of pressing the button. Progress is then the same arithmetic progressPct
   * uses on the rows above it, capped the same way.
   */
  const progress =
    derivedTarget && runningTotal
      ? Math.min(100, Math.round((runningTotal / derivedTarget) * 100))
      : null;

  const overTolerance = activeStage
    ? stageIsOverTolerance(activeStage, thisQty)
    : false;
  /**
   * Whether the plan has anything to say about this entry.
   *
   * A stage with no target has no denominator and no ceiling, so the card
   * would draw a bar over nothing — and such a batch cannot be issued anyway
   * (`issue_job`), so the row would already be refused for a plainer reason.
   */
  const showStage = Boolean(activeStage && activeStage.target_qty);

  /**
   * Did it actually run below target?
   *
   * The same test the log form applies before it offers the reason at all: a
   * dropdown that is always on screen is one an operator learns to skip, and
   * the schema only requires an answer when the run was slow. Both numbers,
   * both real, and a target above zero — an unfilled speed is not a fast run.
   */
  const isSlow =
    typeof targetSpeed === "number" &&
    typeof actualSpeed === "number" &&
    !Number.isNaN(targetSpeed) &&
    !Number.isNaN(actualSpeed) &&
    targetSpeed > 0 &&
    actualSpeed < targetSpeed;

  /**
   * How wide the two clocks open — the same rule the shift log applies.
   *
   * An operator gets the shift this sheet is for and nothing else: the row is
   * being added to a named shift, so a time outside it is a slip rather than a
   * choice. Manager and up keep the full day, because correcting somebody
   * else's shift is the job this sheet exists for.
   */
  const clockWindow = useMemo(() => {
    if (canManage || !shiftTimes) return null;
    const clock = shiftTimes[shift];
    if (!clock?.startTime || !clock?.endTime) return null;
    return {
      from: clock.startTime,
      to: clock.endTime,
      note: `${shift === "morning" ? "Morning" : "Afternoon"} shift · ${clock.startTime} – ${clock.endTime}`,
    };
  }, [canManage, shiftTimes, shift]);

  const needsOperators = operatorsRequired(
    (category as ProcessCategory) ?? "production",
  );
  const chosen = (operators ?? [])
    .map((o) => o?.name ?? "")
    .filter((n) => n.trim());

  /* ── The write ──────────────────────────────────────────────────────── */

  const submit = useMutation({
    // `date`, not today: the row belongs to the sheet it was added to.
    mutationFn: (values: LogEntryParsed) =>
      createLogEntry(values, userId, date, product?.id ?? null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: shiftReportKeys.entries(factoryId, date, shift),
        }),
        queryClient.invalidateQueries({ queryKey: logKeys.factory(factoryId) }),
        queryClient.invalidateQueries({
          queryKey: ["shift_log_batch", factoryId],
        }),
        // The same three triggers the log form invalidates for: an entry can
        // move a pipeline card, raise an action, and change a stage's total.
        queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        }),
        queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
        queryClient.invalidateQueries({
          queryKey: batchStageKeys.all(factoryId),
        }),
      ]);
      toast.success(`Logged — ${unit.name}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Everything the schema is still waiting for, one line per field.
   *
   * Keyed by the field, never by the message. Two fields on this row carry the
   * *same* wording — Start and End both fail with "Enter a time as HH:MM." —
   * and keying a list by its text gives React two children with one key, which
   * it reports as an error and the dev overlay throws in front of the form.
   *
   * The field is also what makes the line useful: two identical sentences
   * stacked on top of each other name neither of the boxes to go and fill in.
   */
  const problems = Object.entries(errors)
    .map(([field, error]) => ({
      field,
      label: FIELD_LABELS[field] ?? null,
      message: (error as { message?: string })?.message,
    }))
    .filter((p) => Boolean(p.message));

  function save() {
    void handleSubmit(
      (values) => submit.mutateAsync(values).catch(() => {}),
      // A silent no-op is the worst failure a form like this can have: a cell
      // whose error has nowhere to render would leave the button dead with
      // nothing on screen to read.
      () => toast.error("Some fields still need filling in."),
    )();
  }

  return (
    <>
      {/* ── The row ─────────────────────────────────────────────────────
          One control per column, all of them one line tall, so the row reads
          as a row. Anything that needed a second control stacked under the
          first — the quantity's unit, the action flag, the speed unit — is in
          the strip below instead: two-storey cells made the row twice as tall
          as the ones around it and left every single-control cell floating in
          the middle of its own white space. */}
      <tr className="border-t-2 border-brand bg-brand-tint/50">
        <Cell className="print:hidden">
          <span className="grid size-5 place-items-center rounded-md bg-brand text-white">
            <Plus className="size-3" aria-hidden />
          </span>
        </Cell>

        {/* Room. Fixed — the row was added to this one. */}
        <Cell>
          <Static className="truncate font-semibold text-ink-2">
            {unit.name}
          </Static>
        </Cell>

        {/* Activity. Everything else on the row takes its shape from this. */}
        <Cell>
          <Controller
            name="processId"
            control={control}
            render={({ field }) => (
              <SelectField
                ariaLabel="Activity"
                value={field.value ?? ""}
                onChange={field.onChange}
                ariaInvalid={Boolean(errors.processId)}
                placeholder="Activity…"
                searchPlaceholder="Activity name…"
                emptyMessage="No activity matches that."
                options={activeProcesses.map((p) => ({
                  value: p.id,
                  label: p.name,
                  meta: p.category as string,
                }))}
                className={SELECT}
              />
            )}
          />
        </Cell>

        {/* Equipment — machine activities only, exactly as in the log form. */}
        <Cell>
          {hasMachine ? (
            <input
              {...register("equipmentNo")}
              placeholder="EQ383"
              autoComplete="off"
              title={equipment ? equipment.name : undefined}
              className={cn(
                INPUT,
                "font-mono",
                (equipmentNo ?? "").trim() &&
                  !equipment &&
                  "border-danger-line",
              )}
            />
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Run time is derived from the two clocks in the strip below. */}
        <Cell>
          {duration > 0 ? (
            <Static className="justify-end font-mono">
              {formatMinutes(duration)}
            </Static>
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Product and code are the batch's, read back from the register
            rather than retyped — the auto-fill panel the log form shows,
            landed in the columns that already name those values. */}
        <Cell>
          {product ? (
            <Static className="truncate" title={product.name}>
              {product.name}
            </Static>
          ) : (
            <Blank />
          )}
        </Cell>
        <Cell>
          {product?.code ? (
            <Static className="truncate font-mono">{product.code}</Static>
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Batch. The cell everything above and below is resolved from. */}
        <Cell>
          <input
            {...register("batchNo")}
            placeholder="46004"
            autoComplete="off"
            className={cn(
              INPUT,
              "font-mono",
              batchBlock && "border-warn-line bg-warn-tint",
              product && !batchBlock && "border-teal-line",
            )}
          />
        </Cell>

        <Cell>
          {isDowntime ? (
            <Blank />
          ) : (
            <input
              type="number"
              step="any"
              min={0}
              {...register("qty", { valueAsNumber: true })}
              placeholder="0"
              className={cn(
                INPUT,
                "text-right font-mono",
                (errors.qty || overTolerance) && "border-danger-line",
              )}
            />
          )}
        </Cell>

        <Cell>
          {product ? (
            <Static className="justify-end font-mono">
              {runningTotal.toLocaleString()}
            </Static>
          ) : (
            <Blank />
          )}
        </Cell>
        <Cell>
          {derivedTarget !== null ? (
            <Static className="justify-end font-mono">
              {derivedTarget.toLocaleString()}
            </Static>
          ) : (
            <Blank />
          )}
        </Cell>
        <Cell>
          {progress !== null ? (
            <Static className="font-mono">{progress}%</Static>
          ) : (
            <Blank />
          )}
        </Cell>

        <Cell>
          {isProduction ? (
            <input
              type="number"
              step="any"
              min={0}
              {...register("qtyRejected", { valueAsNumber: true })}
              placeholder="0"
              className={cn(INPUT, "text-right font-mono")}
            />
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Operators. A list, not a value — so the cell holds the count and
            opens the same picker the log form uses, rather than losing the
            second and third person to a control one name wide. */}
        <Cell>
          {needsOperators ? (
            <Popover.Root open={operatorsOpen} onOpenChange={setOperatorsOpen}>
              <Popover.Trigger
                className={cn(
                  INPUT,
                  "flex items-center gap-1 text-left",
                  chosen.length === 0 && "text-placeholder",
                  errors.operators && "border-danger-line",
                )}
              >
                <Users className="size-3 shrink-0 text-ink-5" aria-hidden />
                <span className="truncate">
                  {chosen.length === 0
                    ? "Add…"
                    : chosen.length === 1
                      ? chosen[0]
                      : `${chosen.length} people`}
                </span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  sideOffset={6}
                  align="start"
                  className="z-50"
                >
                  <Popover.Popup className="w-72 rounded-xl border border-line bg-surface p-3 shadow-lift">
                    <div className="space-y-2.5">
                      {operatorFields.map((row, i) => (
                        <OperatorPicker
                          key={row.id}
                          control={control}
                          name={`operators.${i}.name`}
                          label={`Operator ${i + 1}`}
                          employees={employees}
                          shift={shift}
                          exclude={chosen.filter(
                            (n) => n !== operators?.[i]?.name,
                          )}
                          action={
                            i > 0 ? (
                              <button
                                type="button"
                                onClick={() => remove(i)}
                                className="text-[10px] font-semibold text-ink-5 hover:text-danger-deep"
                              >
                                Remove
                              </button>
                            ) : undefined
                          }
                        />
                      ))}
                      {operatorFields.length < MAX_OPERATORS && (
                        <button
                          type="button"
                          onClick={() => append({ name: "" })}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand"
                        >
                          <Plus className="size-3" /> Add operator
                        </button>
                      )}
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          ) : (
            <Blank />
          )}
        </Cell>

        <Cell>
          <input
            {...register("comment")}
            placeholder="Comment"
            className={INPUT}
          />
        </Cell>

        <Cell>
          {hasMachine ? (
            <input
              type="number"
              step="any"
              min={0}
              {...register("actualSpeed", { valueAsNumber: true })}
              placeholder="980"
              className={cn(INPUT, "text-right font-mono")}
            />
          ) : (
            <Blank />
          )}
        </Cell>
        <Cell>
          {hasMachine ? (
            <input
              type="number"
              step="any"
              min={0}
              {...register("targetSpeed", { valueAsNumber: true })}
              placeholder="1200"
              className={cn(INPUT, "text-right font-mono")}
            />
          ) : (
            <Blank />
          )}
        </Cell>
      </tr>

      {/* ── The strip ───────────────────────────────────────────────────
          Everything the row has no column for: the two clocks the run time is
          derived from, and the pickers that qualify a value rather than being
          one. Each is labelled, because down here they have no heading above
          them to say what they are. */}
      <tr className="border-b-2 border-brand bg-brand-tint/50">
        <td className="print:hidden" />
        <td colSpan={16} className="px-3 pt-0.5 pb-2.5">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <StripField label="Start">
              <Controller
                name="startTime"
                control={control}
                render={({ field }) => (
                  <TimeField
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    ariaLabel="Activity start"
                    ariaInvalid={Boolean(errors.startTime)}
                    from={clockWindow?.from}
                    to={clockWindow?.to}
                    windowNote={clockWindow?.note}
                    className="h-8 w-28 text-[11px]"
                  />
                )}
              />
            </StripField>
            <StripField label="End">
              <Controller
                name="endTime"
                control={control}
                render={({ field }) => (
                  <TimeField
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    ariaLabel="Activity end"
                    ariaInvalid={Boolean(errors.endTime)}
                    from={clockWindow?.from}
                    to={clockWindow?.to}
                    windowNote={clockWindow?.note}
                    className="h-8 w-28 text-[11px]"
                  />
                )}
              />
            </StripField>

            {/* Asked only where the answer isn't already known: this batch
                runs the selected activity more than once, and without saying
                which, all of them would pool into one total. */}
            {mustPickStage && (
              <StripField label="Stage">
                <Controller
                  name="batchStageId"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      ariaLabel="Stage / work order"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      ariaInvalid={Boolean(errors.batchStageId)}
                      options={stageChoices.map((s) => ({
                        value: s.id,
                        label: stageName(s),
                      }))}
                      className="h-8 w-48 text-[11px]"
                    />
                  )}
                />
              </StripField>
            )}

            {/* A preparatory room hands over "3 drums", not "3". */}
            {isPreparatory && (
              <StripField label="Counted in">
                <Controller
                  name="qtyUnit"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      ariaLabel="Quantity unit"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      ariaInvalid={Boolean(errors.qtyUnit)}
                      placeholder="unit"
                      options={QTY_UNITS.map((u) => ({ value: u, label: u }))}
                      className="h-8 w-32 text-[11px]"
                    />
                  )}
                />
              </StripField>
            )}

            {hasMachine && (
              <StripField label="Speed unit">
                <div className="flex gap-1.5">
                  <Controller
                    name="speedType"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        ariaLabel="Speed unit"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={SPEED_TYPES.map((t) => ({
                          value: t.value,
                          label: t.label,
                        }))}
                        className="h-8 w-36 text-[11px]"
                      />
                    )}
                  />
                  {/* RPM and Batches already carry their own period, so the
                      rate choice would be meaningless for them. */}
                  {speedTypeTakesRate(speedType ?? "") && (
                    <Controller
                      name="speedRate"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          ariaLabel="Per minute or per hour"
                          value={field.value ?? "hr"}
                          onChange={field.onChange}
                          options={[
                            { value: "min", label: "/ min" },
                            { value: "hr", label: "/ hr" },
                          ]}
                          className="h-8 w-24 text-[11px]"
                        />
                      )}
                    />
                  )}
                </div>
              </StripField>
            )}

            {/* Only when the run was slow, and then it is required — this is
                what the Pareto chart in OEE & Downtime is built from, and an
                unexplained slow run is a gap in that analysis later. */}
            {isSlow && (
              <StripField label="Slow reason — required" tone="warn">
                <Controller
                  name="slowReason"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      ariaLabel="Reason it ran slow"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      clearable
                      placeholder="Select reason…"
                      options={SLOW_REASONS.map((r) => ({
                        value: r,
                        label: r,
                      }))}
                      className={cn(
                        "h-8 w-44 text-[11px]",
                        errors.slowReason && "border-danger-line",
                      )}
                    />
                  )}
                />
              </StripField>
            )}

            {/* The flag is what raises an issue, so it cannot be the one field
                the sheet quietly drops. */}
            {!isDowntime && (
              <StripField label="Flag">
                <Controller
                  name="actionFlag"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      ariaLabel="Action flag"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      clearable
                      clearLabel="No flag"
                      placeholder="No flag"
                      options={ACTION_FLAGS.map((f) => ({
                        value: f,
                        label: ACTION_FLAG_LABELS[f] ?? f,
                      }))}
                      className="h-8 w-40 text-[11px]"
                    />
                  )}
                />
              </StripField>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onDone}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink-4 transition hover:text-ink"
              >
                <X className="size-3" /> Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isSubmitting}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-[11px] font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:opacity-70"
              >
                {isSubmitting && <Loader2 className="size-3 animate-spin" />}
                {isSubmitting ? "Logging…" : "Log entry"}
              </button>
            </div>
          </div>

          {/* What the entry has earned being told, in the order the database
              would say it: the batch gate first, then the stage it resolved
              to and what that stage is planned for, then whatever the schema
              is still waiting for. */}
          {(batchBlock || showStage || problems.length > 0) && (
            <div className="mt-2 space-y-1.5 border-t border-brand-line pt-2">
              {batchBlock && <Note tone="warn">{batchBlock}</Note>}

              {/* The denominator the quantity is being typed against: what
                  this stage is planned for, how much of it is already logged,
                  and the ceiling past which this entry would be refused. The
                  same card the shift log shows, from the same file — a second
                  copy would be a second opinion about what a stage may take. */}
              {showStage && activeStage && (
                <div className="max-w-md">
                  <StageProgress stage={activeStage} pending={thisQty} />
                </div>
              )}

              {problems.map((problem) => (
                <Note key={problem.field} tone="danger">
                  {problem.label && (
                    <strong className="font-semibold">{problem.label}: </strong>
                  )}
                  {problem.message}
                </Note>
              ))}
            </div>
          )}
        </td>
      </tr>
    </>
  );
}

/* ── The row's own furniture ─────────────────────────────────────────── */

/**
 * Every control in a cell.
 *
 * One height for all of them, and one height for the read-only values beside
 * them — that is what makes a row of seventeen mixed cells read as a line
 * rather than as seventeen separate boxes at seventeen different offsets.
 */
const INPUT =
  "h-8 w-full rounded-md border border-line bg-surface px-2 text-[11px] text-ink shadow-[0_1px_1px_rgb(20_22_43/0.03)] outline-none transition placeholder:text-placeholder hover:border-ink-6 focus:border-brand focus:ring-2 focus:ring-brand/15";

/** The same, for the combobox, which brings its own border and background. */
const SELECT = "h-8 w-full rounded-md px-2 text-[11px]";

function Cell({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  /** The full value, for a cell narrow enough to clip it. */
  title?: string;
}) {
  return (
    <td title={title} className={cn("px-1 py-2 align-top", className)}>
      {children}
    </td>
  );
}

/**
 * A value the row shows but nobody types — the run time, the product the
 * batch resolved to, the running total.
 *
 * Boxed to the same height as an input and centred in it, so it sits on the
 * same line as the cells either side rather than floating against the top of
 * a taller neighbour.
 */
function Static({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("flex h-8 items-center text-[11px] text-ink-2", className)}
    >
      {children}
    </span>
  );
}

/**
 * A cell this activity does not have.
 *
 * A dash, not an empty box: an input the category has switched off must not
 * look like one nobody has filled in yet. Held at the control's own height so
 * switching to downtime does not make the row jump.
 */
function Blank() {
  return (
    <span className="flex h-8 items-center justify-center text-ink-6">—</span>
  );
}

/**
 * What to call each field when its error is reported in the strip.
 *
 * The strip is away from the cell that failed, so a bare "Enter a time as
 * HH:MM." leaves the reader hunting. Only the fields whose column heading is
 * not already the answer are listed; anything absent falls back to its message
 * alone, which is correct for a field named in its own wording.
 */
const FIELD_LABELS: Record<string, string> = {
  processId: "Activity",
  startTime: "Start",
  endTime: "End",
  batchNo: "Batch",
  batchStageId: "Stage",
  qty: "Shift qty",
  qtyUnit: "Counted in",
  qtyRejected: "Rejected",
  equipmentNo: "EQ no.",
  targetSpeed: "Target speed",
  actualSpeed: "Speed",
  slowReason: "Slow reason",
  operators: "Operators",
  comment: "Comment",
};

/**
 * A labelled control in the strip.
 *
 * The strip's controls have no column heading above them, so each carries its
 * own — set in the same small caps as the table's headings, for the same
 * reason.
 */
function StripField({
  label,
  tone,
  children,
}: {
  label: string;
  /** Amber for a control the entry cannot be filed without. */
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span
        className={cn(
          "text-[9px] font-bold tracking-[0.06em] uppercase",
          tone === "warn" ? "text-warn-deep" : "text-ink-5",
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug font-medium",
        tone === "warn" ? "text-warn-ink" : "text-danger-deep",
      )}
    >
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
