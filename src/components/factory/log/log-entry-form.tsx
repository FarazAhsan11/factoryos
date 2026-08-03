"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_FLAGS,
  ACTION_FLAG_LABELS,
  SLOW_REASONS,
  SPEED_TYPES,
  logEntrySchema,
  speedTypeTakesRate,
  type LogEntryParsed,
  type LogEntryValues,
} from "@/app/factory/[slug]/log/schemas";
import { BatchAutofill } from "@/components/factory/log/batch-autofill";
import {
  CONTROL,
  Field,
  FieldRow,
  MONO,
  SectionTitle,
} from "@/components/factory/log/log-fields";
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import { ShiftBanner } from "@/components/factory/log/shift-banner";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  clockNow,
  fetchShiftTimes,
  resolveCurrentShift,
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
 * One form, two shapes. The activity the operator picks carries the
 * `has_machine` flag set in Admin → Processes: a machine activity also asks
 * for equipment and speed (and demands a reason when it runs below target,
 * because that's what the OEE Pareto is built from); a manual activity asks
 * for none of it and stores nulls, so "not applicable" stays distinguishable
 * from "stopped".
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
    [unitList]
  );
  const activeProcesses = useMemo(
    () => processList.filter((p) => p.active),
    [processList]
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
      hasMachine: false,
      hasOutput: true,
    },
  });

  const [
    processId,
    batchNo,
    startTime,
    endTime,
    shift,
    hasMachine,
    hasOutput,
    speedType,
    qty,
    operator1,
    operator2,
  ] = useWatch({
    control,
    name: [
      "processId",
      "batchNo",
      "startTime",
      "endTime",
      "shift",
      "hasMachine",
      "hasOutput",
      "speedType",
      "qty",
      "operator1",
      "operator2",
    ],
  });

  // The activity decides which halves of the form exist, so its flags are
  // mirrored into the form values — that's what the schema's cross-field rules
  // read. The two are independent: Sorting produces output with no machine,
  // Idle does neither.
  useEffect(() => {
    const flags = activeProcesses.find((p) => p.id === processId)?.flags;
    setValue("hasMachine", Boolean(flags?.machine));
    // Default to "produces output" for an activity selected before the lists
    // load, so the quantity fields don't flicker away and back.
    setValue("hasOutput", flags ? Boolean(flags.output) : true);
  }, [processId, activeProcesses, setValue]);

  // Once the factory's clock arrives, default to the shift that's running and
  // start the entry at the shift start — the operator usually just adjusts it.
  useEffect(() => {
    if (!shiftTimes) return;
    const current = resolveCurrentShift(shiftTimes);
    setValue("shift", current);
    if (!getValues("startTime")) {
      setValue("startTime", shiftTimes[current].startTime);
    }
  }, [shiftTimes, setValue, getValues]);

  const product = useMemo(() => {
    const term = (batchNo ?? "").trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, batchNo]);

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
    [batchEntries, processId]
  );
  const thisQty = typeof qty === "number" && !Number.isNaN(qty) ? qty : 0;
  const runningTotal = previousQty + thisQty;

  const duration =
    startTime && endTime ? durationMinutes(startTime, endTime) : 0;

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
      toast.success(
        `Logged — ${entry.unit?.name ?? ""} · ${entry.process?.name ?? ""}` +
          (entry.duration_minutes
            ? ` · ${formatMinutes(entry.duration_minutes)}`
            : "")
      );

      // Keep unit + activity: an operator stays in one room for a whole shift,
      // and the next entry starts where this one ended.
      const keep = getValues();
      reset({
        factoryId,
        unitId: keep.unitId,
        processId: keep.processId,
        hasMachine: keep.hasMachine,
        hasOutput: keep.hasOutput,
        shift: keep.shift,
        startTime: keep.endTime,
        endTime: "",
        speedType: keep.speedType,
        speedRate: keep.speedRate,
        targetSpeed: keep.targetSpeed,
        // The same pair usually works the whole shift, so they carry over too.
        operator1: keep.operator1,
        operator2: keep.operator2,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setupMissing = activeUnits.length === 0 || activeProcesses.length === 0;

  if (setupMissing) {
    return (
      <div className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
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
              : "Some details are missing — check the highlighted fields."
          );
        }
      )}
      className="rounded-2xl border border-[#E6EAF1] bg-white"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F6] px-5 py-4">
        <h2 className="text-sm font-semibold text-[#0F1B34]">New entry</h2>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[10px] font-semibold text-[#047857]">
            <ShieldCheck className="size-3" />
            Audit-protected
          </span>
          <button
            type="button"
            onClick={() => toggleQuick()}
            title="Quick mode: fewer fields for routine hourly entries"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
              quick
                ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                : "border-[#E6EAF1] text-[#64748B] hover:text-[#0F1B34]"
            )}
          >
            <Zap className="size-3" />
            {quick ? "Quick on" : "Quick"}
          </button>
        </div>
      </header>

      <div className="space-y-4 p-5">
        {/* ── Where & when ─────────────────────────────────────────── */}
        <section>
          <SectionTitle>Where &amp; when</SectionTitle>
          <FieldRow cols={2}>
            <Field
              label={units.singular}
              htmlFor="log-unit"
              error={errors.unitId?.message}
            >
              <select id="log-unit" className={CONTROL} {...register("unitId")}>
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
                className={CONTROL}
                {...register("processId")}
              >
                <option value="">Select…</option>
                {activeProcesses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.flags.machine ? " · machine" : ""}
                    {p.flags.output ? "" : " · no output"}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRow>
        </section>

        {shiftTimes && (
          <ShiftBanner
            shift={shift as RunningShift}
            clock={shiftTimes[shift as RunningShift]}
            onSwitch={(next) => {
              setValue("shift", next);
              setValue("startTime", shiftTimes[next].startTime);
            }}
          />
        )}

        <FieldRow>
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
                "flex items-center font-semibold text-[#2563EB]"
              )}
            >
              {duration ? formatMinutes(duration) : "—"}
            </output>
          </Field>
        </FieldRow>

        {/* Equipment belongs to machine activities — a manual stage has none. */}
        {hasMachine && !quick && (
          <Field
            label="Equipment no."
            optional
            htmlFor="log-equipment"
            error={errors.equipmentNo?.message}
          >
            <input
              id="log-equipment"
              className={cn(CONTROL, MONO)}
              placeholder="e.g. EQ383, EQ112…"
              {...register("equipmentNo")}
            />
          </Field>
        )}

        {/* ── Batch ────────────────────────────────────────────────── */}
        <section className="space-y-2.5">
          <SectionTitle hint="→ auto-fills product details">Batch</SectionTitle>
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

        {/* ── Output — only for activities that produce something ───── */}
        {hasOutput ? (
        <section>
          <SectionTitle>Output</SectionTitle>
          <FieldRow>
            <Field
              label="Target qty"
              note="(this entry)"
              htmlFor="log-target-qty"
              error={errors.targetQty?.message}
            >
              <input
                id="log-target-qty"
                type="number"
                step="any"
                min={0}
                className={cn(CONTROL, MONO)}
                placeholder="e.g. 270000"
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
        ) : (
          // Not an omission — a stated fact. A break or an idle period stores
          // null quantities, never 0, so it can't drag an output average.
          <p className="rounded-xl border border-dashed border-[#CBD5E1] px-3.5 py-2.5 text-xs text-[#94A3B8]">
            This activity doesn&rsquo;t produce output, so no quantities are
            recorded — only the time it consumed.
          </p>
        )}

        {/* ── Speed — machine activities only ──────────────────────── */}
        {hasMachine && !quick && (
          <section>
            <SectionTitle hint="→ feeds Performance OEE">Speed</SectionTitle>
            <FieldRow>
              <Field label="Speed unit" htmlFor="log-speed-type">
                <div className="flex gap-1.5">
                  <select
                    id="log-speed-type"
                    className={cn(CONTROL, "flex-1")}
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
              <select className={CONTROL} {...register("slowReason")}>
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
            because nothing downstream can reconstruct that from the row. */}
        <section>
          <SectionTitle>Operators</SectionTitle>
          {/* The pickers render even with an empty roster: "Not on the list…"
              opens a free-text name, so a factory mid-setup can still file a
              shift instead of hitting a required field it has no way to fill. */}
          {employees.length === 0 && (
            <p className="mb-2 rounded-xl border border-dashed border-[#CBD5E1] px-3.5 py-3 text-xs text-[#94A3B8]">
              No one on the roster yet — add people in Admin &amp; Settings →
              Employees and they&rsquo;ll appear here. Until then, use
              &ldquo;Not on the list…&rdquo; to type a name.
            </p>
          )}
          <FieldRow cols={2}>
            <OperatorPicker
              control={control}
              name="operator1"
              label="Operator 1"
              employees={employees}
              shift={shift as RunningShift}
              exclude={operator2}
            />
            <OperatorPicker
              control={control}
              name="operator2"
              label="Operator 2"
              optional
              employees={employees}
              shift={shift as RunningShift}
              exclude={operator1}
            />
          </FieldRow>
        </section>

        {/* ── Notes ────────────────────────────────────────────────── */}
        {!quick && (
          <>
            <section className="space-y-3">
              <SectionTitle>Notes</SectionTitle>
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
              <Field
                label="Flag for action?"
                note="(creates an action item)"
                htmlFor="log-flag"
                error={errors.actionFlag?.message}
              >
                <select
                  id="log-flag"
                  className={CONTROL}
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
            </section>
          </>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Logging…" : "Log entry"}
        </button>
        <p className="text-center text-[11px] text-[#94A3B8]">
          Entries are audit-protected. Corrections are amendments, not deletes.
        </p>
      </div>
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
  control: ReturnType<typeof useForm<LogEntryValues, unknown, LogEntryParsed>>["control"];
  setValue: ReturnType<
    typeof useForm<LogEntryValues, unknown, LogEntryParsed>
  >["setValue"];
}) {
  const rate = useWatch({ control, name: "speedRate" }) ?? "hr";
  return (
    <div
      role="group"
      aria-label="Speed rate"
      className="flex shrink-0 overflow-hidden rounded-xl border border-[#E6EAF1]"
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
              ? "bg-[#EFF6FF] text-[#1D4ED8]"
              : "text-[#94A3B8] hover:text-[#0F1B34]"
          )}
        >
          /{option}
        </button>
      ))}
    </div>
  );
}

function NowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Set to now"
      className="h-11 shrink-0 rounded-xl border border-[#E6EAF1] px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB]"
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
  control: ReturnType<typeof useForm<LogEntryValues, unknown, LogEntryParsed>>["control"];
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
    <div className="mt-3 space-y-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
      <Field
        label="⚠ Reason for running below target speed"
        note="(required)"
        error={error}
      >
        {children}
      </Field>
      <p className="text-[11px] text-[#92400E]">
        This is what the Pareto chart in OEE &amp; Downtime is built from —
        an unexplained slow run is a gap in the analysis later.
      </p>
    </div>
  );
}
