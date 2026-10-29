"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Popover } from "@base-ui/react/popover";
import { Plus, RotateCcw, Users, X } from "lucide-react";

import {
  ACTION_FLAGS,
  ACTION_FLAG_LABELS,
  MAX_OPERATORS,
  QTY_UNITS,
  SLOW_REASONS,
  SPEED_TYPES,
  composeSpeedUnit,
  decomposeSpeedUnit,
  logEntrySchema,
  operatorsRequired,
  planRequired,
  targetQtyFromSpeed,
  type LogEntryParsed,
  type LogEntryValues,
  type ProcessCategory,
} from "@/app/factory/[slug]/log/schemas";
import {
  Blank,
  Cell,
  INPUT,
  Note,
  PICKER,
  RESOLVED,
  STRIP_CONTROL,
  Static,
  StripField,
  WARN,
  GRID_SPAN,
} from "@/components/factory/log/grid/grid-cells";
import type { LogRegisters } from "@/components/factory/log/grid/use-log-registers";
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import { StageProgress } from "@/components/factory/log/stage-progress";
import { TimeField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import {
  stageIsOverTolerance,
  stageName,
} from "@/lib/factory/batch-stage-queries";
import { findEquipment } from "@/lib/factory/equipment-queries";
import {
  durationMinutes,
  fetchBatchEntries,
  formatMinutes,
} from "@/lib/factory/shift-log-queries";
import {
  resolveCurrentShift,
  resolveShiftForEntry,
  type RunningShift,
} from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * What a line hands the grid so one Log all can file every line on the sheet.
 *
 * The grid holds the button and the line holds the form, so the grid asks
 * each line rather than reaching into it: is there anything here, is it
 * valid, has it been written.
 */
export interface GridRowHandle {
  unitName: string;
  /** The line's values while it holds unlogged work; null when it doesn't. */
  draft: () => Partial<LogEntryValues> | null;
  /**
   * Runs the schema. Resolves to the parsed entry, or to null with the line's
   * own errors now showing in its strip.
   */
  validate: () => Promise<LogEntryParsed | null>;
  /** The product the typed batch resolved to — what the insert links. */
  productId: () => string | null;
  /**
   * The entry is filed. The grid removes the line — the entry now shows above
   * it, locked — and this stops the line being saved as a draft meanwhile.
   */
  logged: () => void;
  /** The database refused it: say why on the line itself. */
  failed: (message: string) => void;
  /** The end clock as typed — where a line added under this one starts. */
  endTime: () => string;
}

/**
 * Shift log → Grid → one room's line.
 *
 * The same entry the form files, laid out as a spreadsheet row. It is not a
 * second way of writing an entry: it parses with `logEntrySchema` and writes
 * through `createLogEntry`, so every rule the form is held to holds here too —
 * the schema's cross-field rules, and underneath them the database's four-rule
 * batch gate (0038), automatic stage resolution (0033), the stage tolerance
 * (0037), the pipeline card move and the action a flag raises.
 *
 * A line exists because someone pressed + under its room, and it opens empty
 * but for its start clock, which the grid sets to where the room's last entry
 * ended (or leaves blank when the room has logged nothing today). The rest is
 * the form's: the shift is derived from the entry's own times, and the product
 * and the target are worked out rather than typed.
 *
 * A handful of fields only matter sometimes — which stage, when a batch runs
 * an activity twice; why a machine ran slow — and they have no column. They
 * appear in a strip under the row exactly when they are needed, together with
 * whatever the entry has earned being told.
 *
 * The line does not file itself. The grid's one Log all button does, asking
 * every line through the `GridRowHandle` it registers here.
 */
export function LogGridRow({
  factoryId,
  rowId,
  canManage,
  unit,
  registers,
  primary,
  startAt,
  restored,
  onRemove,
  onRegister,
  onPendingChange,
}: {
  factoryId: string;
  /** Unique on the sheet. */
  rowId: string;
  /** Manager and up — only decides how wide the clocks open, as on the form. */
  canManage: boolean;
  /** The room this line belongs to. Fixed: the row was drawn for it. */
  unit: { id: string; name: string };
  registers: LogRegisters;
  /**
   * The room's first open line. Names the room in full; a further line is
   * marked as a second one, so two lines for one room read as such.
   */
  primary: boolean;
  /** Where the start clock opens, "HH:MM" — or "" for blank. */
  startAt: string;
  /** What this line held before the page reloaded, if it held anything. */
  restored?: Partial<LogEntryValues>;
  onRemove: () => void;
  /** Hands the grid this line's handle on mount, and null on unmount. */
  onRegister: (rowId: string, handle: GridRowHandle | null) => void;
  /** Whether the line holds typed work that Log all would file. */
  onPendingChange: (rowId: string, pending: boolean) => void;
}) {
  const [operatorsOpen, setOperatorsOpen] = useState(false);
  /** The database's refusal from the last Log all, until the next one. */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    processes,
    processGroups,
    products,
    productsPending,
    equipment: equipmentList,
    workers,
    jobs,
    jobsPending,
    stages,
    stagesPending,
    shiftTimes,
  } = registers;

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<LogEntryValues, unknown, LogEntryParsed>({
    resolver: zodResolver(logEntrySchema),
    defaultValues: {
      factoryId,
      unitId: unit.id,
      processId: "",
      shift: "morning",
      startTime: startAt,
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
    append: addOperator,
    remove: removeOperator,
  } = useFieldArray({ control, name: "operators" });

  /**
   * Put back what this line held before a reload, once, before paint — the
   * form's draft restore, line by line. `keepDefaultValues` so Clear still
   * returns it to a blank line rather than to the restore.
   */
  const restoreDone = useRef(false);
  useLayoutEffect(() => {
    if (restoreDone.current) return;
    restoreDone.current = true;
    if (!restored) return;
    reset(
      { ...getValues(), ...restored, factoryId, unitId: unit.id },
      { keepDefaultValues: true },
    );
  }, [restored, reset, getValues, factoryId, unit.id]);

  const [
    processId,
    batchNo,
    batchStageId,
    equipmentNo,
    startTime,
    endTime,
    shift,
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
      "shift",
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

  /* ── What the activity decides ──────────────────────────────────────── */

  // Mirrored into the form values because that is what the schema's
  // cross-field rules read, and what decides which cells are live at all.
  //
  // Every derived write in this row checks the value first. `setValue` wakes
  // the row's watchers whether or not anything changed, and on a freshly
  // mounted row these effects were each forcing another full render of an
  // unchanged line — times twenty-five rooms, on every opening of the grid.
  useEffect(() => {
    const process = processes.find((p) => p.id === processId);
    const next = (process?.category as ProcessCategory) ?? "production";
    const machine = next === "production" && Boolean(process?.flags.machine);
    if (getValues("category") !== next) setValue("category", next);
    if (getValues("hasMachine") !== machine) setValue("hasMachine", machine);
  }, [processId, processes, setValue, getValues]);

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
      product ? (jobs.find((j) => j.product_id === product.id) ?? null) : null,
    [jobs, product],
  );

  const equipment = useMemo(
    () => findEquipment(equipmentList, equipmentNo),
    [equipmentList, equipmentNo],
  );

  const stageChoices = useMemo(() => {
    if (!job || !processId) return [];
    // Before issue no entry takes a stage: production is refused outright,
    // and preparatory work is filed against the batch alone (0054).
    if (!job.issued_at) return [];
    return stages.filter(
      (s) => s.job_id === job.id && s.process_id === processId,
    );
  }, [stages, job, processId]);

  const mustPickStage = stageChoices.length > 1;
  const activeStage = useMemo(() => {
    if (stageChoices.length === 1) return stageChoices[0];
    return stageChoices.find((s) => s.id === batchStageId) ?? null;
  }, [stageChoices, batchStageId]);

  // Clear a stage picked under a different activity — the guard would refuse
  // it. Not while the registers are still arriving: a stage restored after a
  // reload has no choices to match until they do, and would be wiped unseen.
  useEffect(() => {
    if (productsPending || jobsPending || stagesPending) return;
    if (batchStageId && !stageChoices.some((s) => s.id === batchStageId)) {
      setValue("batchStageId", "");
    }
  }, [
    stageChoices,
    batchStageId,
    setValue,
    productsPending,
    jobsPending,
    stagesPending,
  ]);

  /**
   * Why the database will refuse this entry, when it will — the four rules of
   * `shift_log_stage_guard`, in its order and in the form's words, so an entry
   * refused there is refused here for the same stated reason.
   */
  const batchBlock = useMemo(() => {
    if (productsPending || jobsPending) return null;
    const typed = (batchNo ?? "").trim();

    if (category === "downtime") {
      if (!typed) return null;
      if (!product) {
        return {
          head: `No batch ${typed} in the product register.`,
          body: "Check the number, or have it added under Products.",
        };
      }
      if (!job) {
        return {
          head: `Batch ${typed} isn't on the production board.`,
          body: "Leave the number blank, or have the batch added on the Pipeline before charging time to it.",
        };
      }
      return null;
    }

    if (!typed) {
      return {
        head: "This entry needs a batch number.",
        body: "It's what the work is counted against.",
      };
    }
    if (!product) {
      return {
        head: `No batch ${typed} in the product register.`,
        body: "Check the number, or have it added under Products.",
      };
    }
    const needsPlan = planRequired(category as ProcessCategory);
    if (!job) {
      return {
        head: `Batch ${typed} isn't on the production board.`,
        body: needsPlan
          ? "A manager adds it on the Pipeline, plans its stages and issues it before work can be logged against it."
          : "A manager adds it on the Pipeline before work can be logged against it.",
      };
    }
    // Checked by `shift_log_quarantine_guard` (0044), ahead of the stage rules.
    if (job.quarantine_no) {
      return {
        head: `Batch ${typed} is quarantined under ${job.quarantine_no}.`,
        body: "Preparatory and production work can't be logged against it until QA closes the NCR. You can still log downtime against it.",
      };
    }
    // Rules 3 and 4 are production's alone (0054): preparatory work starts
    // while the plan is still being drawn up.
    if (!needsPlan) return null;
    if (!job.issued_at) {
      return {
        head: `Batch ${typed} isn't issued for production yet.`,
        body: "A manager plans its stages on the Pipeline and issues it. You can still log downtime and preparatory work against it.",
      };
    }
    if (processId && !stagesPending && stageChoices.length === 0) {
      return {
        head: `This activity isn't in batch ${typed}'s plan.`,
        body: "A manager adds it to the plan on the Pipeline. Only planned stages can be logged against.",
      };
    }
    return null;
  }, [
    category,
    productsPending,
    jobsPending,
    stagesPending,
    batchNo,
    product,
    job,
    processId,
    stageChoices,
  ]);

  /* ── The figures the row works out ──────────────────────────────────── */

  const duration =
    startTime && endTime ? durationMinutes(startTime, endTime) : 0;

  // The shift is a fact about the entry's own times — whichever window holds
  // more of the activity — not about when the row was typed.
  useEffect(() => {
    if (!shiftTimes) return;
    const next =
      resolveShiftForEntry(shiftTimes, startTime ?? "", duration) ??
      resolveCurrentShift(shiftTimes);
    if (getValues("shift") !== next) setValue("shift", next);
  }, [shiftTimes, startTime, duration, setValue, getValues]);

  /**
   * How wide the two clocks open: the operator's own shift, or the whole day
   * for manager and up. It narrows the control, never the schema.
   */
  const clockWindow = useMemo(() => {
    if (canManage || !shiftTimes || !shift) return null;
    const clock = shiftTimes[shift];
    if (!clock?.startTime || !clock?.endTime) return null;
    return {
      from: clock.startTime,
      to: clock.endTime,
      note: `${shift === "morning" ? "Morning" : "Afternoon"} shift · ${clock.startTime} – ${clock.endTime}`,
    };
  }, [canManage, shiftTimes, shift]);

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
    const next = derivedTarget ?? undefined;
    if (getValues("targetQty") !== next) setValue("targetQty", next);
  }, [derivedTarget, setValue, getValues]);

  const thisQty = typeof qty === "number" && !Number.isNaN(qty) ? qty : 0;

  // Everything already logged for this batch + activity, across every shift —
  // what the Qty cell's tooltip adds this entry to.
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
  const runningTotal = previousQty + thisQty;

  const overTolerance = activeStage
    ? stageIsOverTolerance(activeStage, thisQty)
    : false;
  const showStage = Boolean(activeStage && activeStage.target_qty);

  /** Below target speed — the one case the schema demands a reason. */
  const isSlow =
    hasMachine &&
    typeof targetSpeed === "number" &&
    typeof actualSpeed === "number" &&
    !Number.isNaN(targetSpeed) &&
    !Number.isNaN(actualSpeed) &&
    targetSpeed > 0 &&
    actualSpeed < targetSpeed;

  const needsOperators = operatorsRequired(
    (category as ProcessCategory) ?? "production",
  );
  const chosen = (operators ?? [])
    .map((o) => o?.name ?? "")
    .filter((n) => n.trim());

  /**
   * Whether anyone has started on this line. An untouched room says nothing:
   * twenty-five rows each warning "this entry needs a batch number" would be
   * twenty-five warnings about rows nobody meant to fill in.
   */
  const touched = Boolean(processId) || Boolean((batchNo ?? "").trim());

  /**
   * What Log all files and the draft keeps: a line with an activity or a batch
   * in it. A filed line is removed rather than kept, and a line only ever
   * opens blank (but for its start clock), so anything in those two cells was
   * put there by someone — or restored from what they put there.
   */
  const pending = touched;
  /** `pending`, for the handle — which the grid calls outside render. */
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
    onPendingChange(rowId, pending);
    return () => onPendingChange(rowId, false);
  }, [rowId, pending, onPendingChange]);

  /* ── The write — made by the grid ───────────────────────────────────── */

  const productId = product?.id ?? null;
  const unitName = unit.name;
  useEffect(() => {
    onRegister(rowId, {
      unitName,
      // Read from the ref, not `pending`: the grid saves the draft straight
      // after a Log all, before this line has re-rendered to say it is clean.
      draft: () => (pendingRef.current ? getValues() : null),
      validate: () =>
        new Promise((resolve) => {
          setSubmitError(null);
          void handleSubmit(
            (values) => resolve(values),
            () => resolve(null),
          )();
        }),
      productId: () => productId,
      logged: () => {
        pendingRef.current = false;
      },
      failed: setSubmitError,
      endTime: () => getValues("endTime") ?? "",
    });
    return () => onRegister(rowId, null);
  }, [rowId, unitName, productId, onRegister, getValues, handleSubmit]);

  /**
   * Back to how the line opened: blank, its start clock where it started.
   *
   * Cleared fields are named with `null` rather than left out. Omitting a key
   * does NOT clear a registered input — `reset` re-registers every field and
   * one with no value *reads the DOM into form state*, so the old quantity
   * would come straight back.
   */
  function clear() {
    setSubmitError(null);
    reset({
      factoryId,
      unitId: unit.id,
      processId: "",
      category: "production",
      hasMachine: false,
      shift: shiftTimes ? resolveCurrentShift(shiftTimes) : "morning",
      startTime: startAt,
      endTime: "",
      batchNo: "",
      batchStageId: "",
      equipmentNo: "",
      qtyUnit: "",
      speedType: "RPM",
      speedRate: "hr",
      targetSpeed: null,
      operators: [{ name: "" }],
      targetQty: null,
      qty: null,
      qtyRejected: null,
      actualSpeed: null,
      comment: "",
      actionFlag: "",
      slowReason: "",
    });
  }

  /** Everything the schema is still waiting for, one line per field. */
  const problems = Object.entries(errors)
    .map(([field, error]) => ({
      field,
      label: FIELD_LABELS[field] ?? null,
      message: firstMessage(error),
    }))
    .filter((p) => Boolean(p.message));

  const showStrip =
    problems.length > 0 ||
    Boolean(submitError) ||
    (touched && (Boolean(batchBlock) || mustPickStage || isSlow || showStage));

  const speedUnitValue = composeSpeedUnit(
    speedType || "RPM",
    speedRate ?? "hr",
  );

  return (
    <>
      {/* Borders on the cells, not the row: the sheet is `border-separate`
          so its sticky header keeps its line, and a row's own border is not
          drawn in that mode. */}
      <tr className="bg-surface [&>td]:border-t">
        {/* When — both clocks in one column, as the Log history shows them.
            It opens the row, so it carries the row's spine: brand on a room's
            own line, paler on a line added to it. A border rather than an
            inset shadow, which the pickers' hover fill would paint over. */}
        <Cell
          className={cn(
            "border-l-3",
            primary ? "border-l-brand" : "border-l-brand-line",
          )}
        >
          <span className="flex h-10 items-center">
            <Controller
              name="startTime"
              control={control}
              render={({ field }) => (
                <TimeField
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  ariaLabel={`Activity start — ${unit.name}`}
                  ariaInvalid={Boolean(errors.startTime)}
                  from={clockWindow?.from}
                  to={clockWindow?.to}
                  windowNote={clockWindow?.note}
                  className={cn(PICKER, "min-w-0 flex-1 px-2.5")}
                />
              )}
            />
            <span aria-hidden className="shrink-0 text-[0.75rem] text-ink-5">
              →
            </span>
            <Controller
              name="endTime"
              control={control}
              render={({ field }) => (
                <TimeField
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  ariaLabel={`Activity end — ${unit.name}`}
                  ariaInvalid={Boolean(errors.endTime)}
                  from={clockWindow?.from}
                  to={clockWindow?.to}
                  windowNote={clockWindow?.note}
                  className={cn(PICKER, "min-w-0 flex-1 px-2.5")}
                />
              )}
            />
          </span>
        </Cell>

        {/* Run time — derived from the two clocks, never typed. */}
        <Cell>
          <Static className="justify-end font-mono font-semibold text-brand">
            {duration ? formatMinutes(duration) : "—"}
          </Static>
        </Cell>

        {/* Room. Fixed — the row was drawn for it. */}
        <Cell title={unit.name}>
          <span className="flex h-10 items-center gap-1.5 pr-1.5 pl-3.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[0.7812rem]",
                primary ? "font-semibold text-ink" : "text-ink-4",
              )}
            >
              {primary ? unit.name : `+ ${unit.name}`}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                title="Remove this row"
                aria-label={`Remove this row for ${unit.name}`}
                className="grid size-6 shrink-0 place-items-center rounded-md text-ink-5 transition hover:bg-danger-soft hover:text-danger-deep"
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        </Cell>

        {/* Activity. Everything else on the row takes its shape from this. */}
        <Cell>
          <Controller
            name="processId"
            control={control}
            render={({ field }) => (
              <SelectField
                ariaLabel={`Activity — ${unit.name}`}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ariaInvalid={Boolean(errors.processId)}
                placeholder="Select…"
                searchPlaceholder="Activity name…"
                emptyMessage="No activity matches that."
                groups={processGroups.map((g) => ({
                  label: g.label,
                  options: g.items.map((p) => ({ value: p.id, label: p.name })),
                }))}
                className={PICKER}
              />
            )}
          />
        </Cell>

        {/* Batch. The cell the product, the stage and the gate resolve from. */}
        <Cell>
          <input
            {...register("batchNo")}
            placeholder={isDowntime ? "optional" : "46004"}
            autoComplete="off"
            aria-label={`Batch number — ${unit.name}`}
            aria-invalid={Boolean(errors.batchNo) || undefined}
            className={cn(
              INPUT,
              "font-mono",
              touched && batchBlock && WARN,
              product && !batchBlock && RESOLVED,
            )}
          />
        </Cell>

        {/* What the batch number resolved to — the form's auto-fill panel,
            landed in the column that names it. */}
        <Cell>
          {product ? (
            <Static
              title={`${product.name}${product.code ? ` · ${product.code}` : ""}`}
            >
              {product.name}
              {product.code && (
                <span className="ml-1.5 font-mono text-[0.6875rem] text-ink-5">
                  {product.code}
                </span>
              )}
            </Static>
          ) : (
            <Static className="text-ink-6">—</Static>
          )}
        </Cell>

        <Cell
          title={
            product && !isDowntime
              ? `Accumulative for this batch & activity: ${runningTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : undefined
          }
        >
          {isDowntime ? (
            <Blank />
          ) : (
            <input
              type="number"
              step="any"
              min={0}
              {...register("qty", { valueAsNumber: true })}
              placeholder="0"
              aria-label={`Quantity — ${unit.name}`}
              aria-invalid={Boolean(errors.qty) || overTolerance || undefined}
              className={cn(INPUT, "text-right font-mono")}
            />
          )}
        </Cell>

        {/* A preparatory room counts in drums or kg and says which; a
            production stage counts in whatever its plan counts in. */}
        <Cell>
          {isPreparatory ? (
            <Controller
              name="qtyUnit"
              control={control}
              render={({ field }) => (
                <SelectField
                  ariaLabel={`Quantity unit — ${unit.name}`}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ariaInvalid={Boolean(errors.qtyUnit)}
                  placeholder="Unit…"
                  clearable
                  options={QTY_UNITS.map((u) => ({ value: u, label: u }))}
                  className={PICKER}
                />
              )}
            />
          ) : isProduction && activeStage?.target_unit ? (
            <Static>{activeStage.target_unit}</Static>
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Target speed × run time — arithmetic, not an opinion. */}
        <Cell>
          {isProduction ? (
            <Static
              className="justify-end font-mono"
              title={
                derivedTarget === null
                  ? "Worked out from a per-minute or per-hour target speed and the run time"
                  : undefined
              }
            >
              {derivedTarget !== null ? derivedTarget.toLocaleString() : "—"}
            </Static>
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
              aria-label={`Rejected — ${unit.name}`}
              aria-invalid={Boolean(errors.qtyRejected) || undefined}
              className={cn(INPUT, "text-right font-mono")}
            />
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Speed and equipment — machine activities only, as on the form. */}
        <Cell>
          {hasMachine ? (
            <SelectField
              ariaLabel={`Speed unit — ${unit.name}`}
              value={speedUnitValue}
              onChange={(next) => {
                const { type, rate } = decomposeSpeedUnit(next);
                setValue("speedType", type, { shouldDirty: true });
                setValue("speedRate", rate, { shouldDirty: true });
              }}
              options={SPEED_UNIT_OPTIONS}
              className={PICKER}
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
              aria-label={`Target speed — ${unit.name}`}
              aria-invalid={Boolean(errors.targetSpeed) || undefined}
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
              {...register("actualSpeed", { valueAsNumber: true })}
              placeholder="980"
              aria-label={`Actual speed — ${unit.name}`}
              aria-invalid={Boolean(errors.actualSpeed) || undefined}
              className={cn(INPUT, "text-right font-mono")}
            />
          ) : (
            <Blank />
          )}
        </Cell>

        <Cell
          title={equipment ? equipment.name : undefined}
        >
          {hasMachine ? (
            <input
              {...register("equipmentNo")}
              placeholder="EQ383"
              autoComplete="off"
              aria-label={`Equipment number — ${unit.name}`}
              aria-invalid={Boolean(errors.equipmentNo) || undefined}
              className={cn(
                INPUT,
                "font-mono",
                equipment && RESOLVED,
                (equipmentNo ?? "").trim() && !equipment && WARN,
              )}
            />
          ) : (
            <Blank />
          )}
        </Cell>

        {/* Operators. A list, not a value — the cell holds the names and
            opens the same picker the form uses. */}
        <Cell>
          {needsOperators ? (
            <Popover.Root open={operatorsOpen} onOpenChange={setOperatorsOpen}>
              <Popover.Trigger
                aria-label={`Operators — ${unit.name}`}
                aria-invalid={Boolean(errors.operators) || undefined}
                className={cn(
                  INPUT,
                  "flex items-center gap-1.5 text-left",
                  chosen.length === 0 && "text-placeholder",
                  "data-popup-open:bg-surface data-popup-open:shadow-[inset_0_0_0_2px_var(--color-brand)]",
                )}
              >
                <Users className="size-3.5 shrink-0 text-ink-5" aria-hidden />
                <span className="truncate">
                  {chosen.length === 0
                    ? "Add…"
                    : chosen.length === 1
                      ? chosen[0]
                      : `${chosen[0]} +${chosen.length - 1}`}
                </span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  sideOffset={6}
                  align="start"
                  className="z-50"
                >
                  <Popover.Popup className="w-76 rounded-xl border border-line bg-surface p-3 shadow-lift">
                    <div className="space-y-2.5">
                      {workers.length === 0 && (
                        <p className="rounded-lg bg-sunken px-2.5 py-2 text-[0.6875rem] text-ink-4">
                          No one on the workforce yet — use &ldquo;Not on the
                          list…&rdquo; to type a name.
                        </p>
                      )}
                      {operatorFields.map((row, i) => (
                        <OperatorPicker
                          key={row.id}
                          control={control}
                          name={`operators.${i}.name`}
                          label={`Operator ${i + 1}`}
                          workers={workers}
                          shift={(shift as RunningShift) ?? "morning"}
                          exclude={(operators ?? [])
                            .filter((_, j) => j !== i)
                            .map((o) => o?.name)
                            .filter((n): n is string => Boolean(n))}
                          action={
                            i > 0 ? (
                              <button
                                type="button"
                                onClick={() => removeOperator(i)}
                                className="text-[0.6875rem] font-semibold text-ink-5 transition hover:text-danger-deep"
                              >
                                Remove
                              </button>
                            ) : undefined
                          }
                        />
                      ))}
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        {operatorFields.length < MAX_OPERATORS ? (
                          <button
                            type="button"
                            onClick={() => addOperator({ name: "" })}
                            className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-brand"
                          >
                            <Plus className="size-3" /> Add operator
                          </button>
                        ) : (
                          <span />
                        )}
                        <button
                          type="button"
                          onClick={() => setOperatorsOpen(false)}
                          className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-[1.06]"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          ) : (
            <Blank />
          )}
        </Cell>

        {/* The flag raises an issue, so it cannot be the one field the grid
            quietly drops. Downtime raises none — as on the form. */}
        <Cell>
          {isDowntime ? (
            <Blank />
          ) : (
            <Controller
              name="actionFlag"
              control={control}
              render={({ field }) => (
                <SelectField
                  ariaLabel={`Flag for action — ${unit.name}`}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ariaInvalid={Boolean(errors.actionFlag)}
                  clearable
                  clearLabel="No — routine entry"
                  placeholder="No — routine"
                  options={ACTION_FLAGS.map((flag) => ({
                    value: flag,
                    label: ACTION_FLAG_LABELS[flag],
                  }))}
                  className={PICKER}
                />
              )}
            />
          )}
        </Cell>

        <Cell>
          <input
            {...register("comment")}
            placeholder="e.g. capping issue…"
            aria-label={`Comment — ${unit.name}`}
            aria-invalid={Boolean(errors.comment) || undefined}
            className={INPUT}
          />
        </Cell>

        {/* What is left to do, said on the line itself: a line typed into
            and not yet filed is marked until Log all files it, so a sheet
            half-way through a round of the floor shows which half. */}
        <Cell>
          <span className="flex h-10 items-center justify-end gap-1.5 px-2">
            {pending && (
              <span
                title="Typed but not logged yet — Log all at the bottom files it"
                className="inline-flex items-center gap-1 text-[0.625rem] font-bold tracking-[0.05em] whitespace-nowrap text-warn-deep uppercase"
              >
                <span aria-hidden className="size-1.5 rounded-full bg-warn" />
                Not logged
              </span>
            )}
            {touched && (
              <button
                type="button"
                onClick={clear}
                title="Clear this row"
                aria-label={`Clear the row for ${unit.name}`}
                className="grid size-7 shrink-0 place-items-center rounded-md text-ink-5 transition hover:bg-sunken hover:text-ink"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </span>
        </Cell>
      </tr>

      {/* ── The strip ─────────────────────────────────────────────────
          Only when the row has something to ask or to say. The controls sit
          first (a stage to choose, a slow run to explain), then the plan this
          entry counts against, then what the gate or the schema refuses. */}
      {showStrip && (
        <tr className="bg-sunken">
          <td
            colSpan={GRID_SPAN}
            className="border-t border-line-soft p-0"
          >
            {/* Pinned to the left of the scroll box so the strip stays on
                screen while the row above is scrolled sideways. */}
            <div className="sticky left-0 w-fit max-w-[min(100%,56rem)] space-y-2 px-3.5 py-2.5 pl-4 shadow-[inset_3px_0_0_0_var(--color-brand-line)]">
              {(mustPickStage || isSlow) && (
                <div className="flex flex-wrap items-center gap-2">
                  {mustPickStage && (
                    <StripField label="Stage — this batch runs it more than once">
                      <Controller
                        name="batchStageId"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            ariaLabel={`Stage / work order — ${unit.name}`}
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
                            className={cn(STRIP_CONTROL, "w-56")}
                          />
                        )}
                      />
                    </StripField>
                  )}
                  {isSlow && (
                    <StripField label="⚠ Reason below target speed" tone="warn">
                      <Controller
                        name="slowReason"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            ariaLabel={`Reason it ran slow — ${unit.name}`}
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ariaInvalid={Boolean(errors.slowReason)}
                            clearable
                            placeholder="Select reason…"
                            options={SLOW_REASONS.map((reason) => ({
                              value: reason,
                              label: reason,
                            }))}
                            className={cn(STRIP_CONTROL, "w-64")}
                          />
                        )}
                      />
                    </StripField>
                  )}
                </div>
              )}

              {touched && batchBlock && (
                <Note tone="warn">
                  <strong className="font-semibold">{batchBlock.head}</strong>{" "}
                  <span className="text-warn-ink/85">{batchBlock.body}</span>
                </Note>
              )}

              {/* The same progress card the form shows, from the same file —
                  a second copy would be a second opinion about what a stage
                  may take. */}
              {touched && showStage && activeStage && (
                <div className="max-w-md">
                  <StageProgress stage={activeStage} pending={thisQty} />
                </div>
              )}

              {submitError && (
                <Note tone="danger">
                  <strong className="font-semibold">Not logged: </strong>
                  {submitError}
                </Note>
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
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The speed unit as one choice rather than the form's two controls — a
 * dropdown and a /min–/hr toggle don't fit in one cell, and "Capsules / hr" is
 * one idea anyway. Composed and decomposed with the same helpers the stored
 * `speed_unit` column uses, so the values cannot disagree with the form's.
 */
const SPEED_UNIT_OPTIONS = SPEED_TYPES.flatMap((type) =>
  type.perTime
    ? [
        { value: `${type.value}/min`, label: `${type.label} / min` },
        { value: `${type.value}/hr`, label: `${type.label} / hr` },
      ]
    : [{ value: type.value, label: type.label }],
);

/**
 * What to call each field when its error is reported away from its cell —
 * in the strip or a toast — where a bare "Enter a time as HH:MM." leaves the
 * reader hunting for which of two clocks it means.
 */
const FIELD_LABELS: Record<string, string> = {
  processId: "Activity",
  startTime: "Start",
  endTime: "End",
  batchNo: "Batch",
  batchStageId: "Stage",
  qty: "Qty",
  qtyUnit: "Unit",
  qtyRejected: "Rejected",
  targetQty: "Target qty",
  equipmentNo: "EQ no.",
  targetSpeed: "Target speed",
  actualSpeed: "Actual speed",
  slowReason: "Slow reason",
  operators: "Operators",
  comment: "Comment",
  actionFlag: "Flag",
};

/**
 * The first message anywhere inside a field's error. The operator list nests
 * its message two levels down (`operators.0.name`), where a flat read of
 * `error.message` finds nothing and the row would fail without saying why.
 */
function firstMessage(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 3) return undefined;
  const own = (error as { message?: unknown }).message;
  if (typeof own === "string" && own) return own;
  for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
    // `ref` is the DOM element the error belongs to — walking into it would
    // wander through React's own circular bookkeeping on the node.
    if (key === "ref" || key === "types") continue;
    if (value && typeof value === "object") {
      const nested = firstMessage(value, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}
