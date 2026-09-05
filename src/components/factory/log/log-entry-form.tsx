"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Boxes,
  Cog,
  Gauge,
  TriangleAlert,
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
  SectionTitle,
} from "@/components/factory/log/log-fields";
import { OperatorPicker } from "@/components/factory/log/operator-picker";
import { StageProgress } from "@/components/factory/log/stage-progress";
import { TimeField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import { employeeKeys, fetchEmployees } from "@/lib/factory/employee-queries";
import {
  equipmentKeys,
  fetchEquipment,
  findEquipment,
} from "@/lib/factory/equipment-queries";
import { actionKeys } from "@/lib/factory/action-queries";
import {
  batchStageKeys,
  fetchFactoryStages,
  stageName,
} from "@/lib/factory/batch-stage-queries";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
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
  draftHasContent,
  readLogDraft,
  writeLogDraft,
} from "@/lib/factory/log-draft";
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
  canManage,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
  /**
   * Manager and up. Only used to decide how wide the clocks open: everyone
   * files the same entry, and nothing here is a permission — RLS is.
   */
  canManage: boolean;
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
  const { data: products = [], isPending: productsPending } = useQuery({
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
  // The board, for the batch panel's family context — what kind of batch this
  // is, whose bulk it draws on, and how much of it is left. Same cache key the
  // Pipeline page uses, so arriving from there costs nothing.
  const { data: pipelineJobs = [], isPending: jobsPending } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  // Every batch's plan. Needed for two things: the target this entry is
  // measured against, and — where a batch runs one activity several times —
  // asking which of them this entry belongs to.
  const { data: allStages = [], isPending: stagesPending } = useQuery({
    queryKey: batchStageKeys.all(factoryId),
    queryFn: () => fetchFactoryStages(factoryId),
  });

  const activeUnits = useMemo(
    () => unitList.filter((u) => u.active),
    [unitList],
  );
  const activeProcesses = useMemo(
    () => processList.filter((p) => p.active),
    [processList],
  );
  /**
   * The activity list, split under a heading per category — the prototype's
   * grouped stage dropdown. With forty-odd stages on a real factory a flat
   * list is unreadable, and the heading tells the operator which shape the
   * form is about to take *before* they pick, not after.
   *
   * Grouped in `PROCESS_CATEGORIES` order (downtime → preparatory →
   * production) rather than alphabetically, and empty groups are dropped so a
   * factory that has no preparatory stages never shows a bare heading.
   */
  const processGroups = useMemo(
    () =>
      PROCESS_CATEGORIES.map((c) => ({
        label: c.label,
        items: activeProcesses.filter((p) => p.category === c.value),
      })).filter((g) => g.items.length > 0),
    [activeProcesses],
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
   * Restore whatever was typed last time, once, before anything else runs.
   *
   * A layout effect rather than an effect: this replaces every value in the
   * form, and doing it after paint would show the operator an empty form that
   * fills itself in a frame later. `reset` with `keepDefaultValues` so a later
   * clear still returns to the real defaults, not to the restored draft.
   */
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const draft = readLogDraft(factoryId, userId);
    if (!draft || !draftHasContent(draft)) return;

    reset({ ...getValues(), ...draft, factoryId }, { keepDefaultValues: true });
  }, [factoryId, userId, reset, getValues]);

  /**
   * Save what's on screen, on a timer.
   *
   * Polling `getValues()` rather than subscribing with `watch()`: the latter
   * returns a fresh function on every render, which makes the React Compiler
   * skip memoizing this whole component — an expensive trade for a form this
   * long, to save a draft nobody is waiting on. Snapshotting also catches the
   * changes a subscription would miss anyway: `setValue` from the Now buttons,
   * the batch and equipment autofills, and the derived target.
   *
   * The write is skipped when nothing changed, so an idle form sitting open
   * all shift costs one JSON.stringify every two seconds and no storage
   * traffic at all.
   *
   * What is passed here is not what gets stored: `writeLogDraft` drops the
   * quantity produced, which belongs to the hour being filed and to no later
   * one. Passing the whole form and letting the draft decide keeps that rule
   * in one place rather than at every call site.
   */
  const lastSaved = useRef<string>("");
  useEffect(() => {
    const save = () => {
      const values = getValues();
      const encoded = JSON.stringify(values);
      if (encoded === lastSaved.current) return;
      lastSaved.current = encoded;
      writeLogDraft(factoryId, userId, values);
    };

    const timer = setInterval(save, 2000);
    // A tablet being put down, or the tab being closed, is exactly when the
    // draft matters most and is also the one moment the interval may not get
    // to run again. `pagehide` fires where `beforeunload` is unreliable on
    // mobile Safari.
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
      save();
    };
  }, [getValues, factoryId, userId]);

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
  /**
   * Whether the equipment number is asked for at all — machine activities
   * only, and not in Quick mode. Named because it now decides a column in the
   * Batch section rather than a section of its own.
   */
  const showEquipment = hasMachine && !quickOn;

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

  // The batch's card. Null is a refusal, not an ordinary state: since 0038 a
  // producing entry against a batch with no card is rejected by the database.
  const job = useMemo(
    () =>
      product
        ? (pipelineJobs.find((j) => j.product_id === product.id) ?? null)
        : null,
    [pipelineJobs, product],
  );

  /**
   * The planned stages this batch has for the selected activity.
   *
   * Usually one, and then nothing is asked: the database resolves it. Several
   * means the batch runs this activity more than once — Packing 30's, 60's and
   * 120's — and the operator has to say which, or all three would pool into a
   * single total that describes none of them.
   */
  const stageChoices = useMemo(() => {
    if (!job || !processId) return [];
    return allStages.filter(
      (s) => s.job_id === job.id && s.process_id === processId,
    );
  }, [allStages, job, processId]);

  const mustPickStage = stageChoices.length > 1;
  /** The stage this entry will count towards, once it is known. */
  const activeStage = useMemo(() => {
    if (stageChoices.length === 1) return stageChoices[0];
    return stageChoices.find((s) => s.id === batchStageId) ?? null;
  }, [stageChoices, batchStageId]);

  /**
   * Why the database will refuse this entry, when it will.
   *
   * The four rules of `shift_log_stage_guard` (0033, tightened in 0038), in
   * the order it applies them: the batch number must name a product, that
   * product must be on the board, the card must be issued, and the activity
   * must be in the plan. Said here so the operator learns it while filling the
   * form in rather than from a submit that fails after everything is typed.
   *
   * The button stays enabled regardless. This is a courtesy reading of a
   * cached board, and a batch issued a moment ago on somebody else's screen
   * must not be un-loggable here because a query has not refetched — the
   * database is the authority on all four.
   */
  const batchBlock = useMemo(() => {
    // Say nothing until the registers this reads have arrived; every check
    // below would otherwise read an empty list as a missing batch.
    if (productsPending || jobsPending) return null;

    const typed = (batchNo ?? "").trim();

    // Downtime answers to rules 1 and 2, and only when it names a batch —
    // time is lost between batches as often as during one. Not to 3 or 4:
    // time lost to a setup delay belongs to a batch that is on the board and
    // not yet issued, and no downtime activity appears in any plan, so either
    // would refuse every downtime entry there is.
    if (category === "downtime") {
      if (!typed) return null;
      if (!product) {
        return {
          head: `No batch ${typed} in the product register.`,
          body: "Check the number, or have it added under Resources → Products.",
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
        body: "Check the number, or have it added under Resources → Products.",
      };
    }
    if (!job) {
      return {
        head: `Batch ${typed} isn't on the production board.`,
        body: "A manager adds it on the Pipeline, plans its stages and issues it before work can be logged against it.",
      };
    }
    if (!job.issued_at) {
      return {
        head: `Batch ${typed} isn't issued for production yet.`,
        body: "A manager plans its stages on the Pipeline and issues it. You can still log downtime against it.",
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

  /**
   * Whether to draw the resolved-batch card.
   *
   * Drawn when the batch resolved, and otherwise only when nothing is being
   * refused — which leaves exactly one unresolved case still showing it: a
   * downtime entry with the batch left blank, where the card's neutral "type
   * a batch number" hint is the right thing to say. Its other unresolved
   * states are the same facts `batchBlock` states below it, in the colour of
   * a problem and with the fix attached; printing both left the operator
   * reading one sentence twice in two voices.
   */
  const showBatchCard = Boolean(product) || !batchBlock;

  // Clear a stage picked under a different activity — it would be validated
  // against a control no longer on screen, and refused by the guard.
  useEffect(() => {
    if (batchStageId && !stageChoices.some((s) => s.id === batchStageId)) {
      setValue("batchStageId", "");
    }
  }, [stageChoices, batchStageId, setValue]);

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
  /**
   * How wide the two clocks open.
   *
   * An operator logs the shift they are on, so the picker offers that shift
   * and nothing else — the 03:00 that turns a 40-minute run into a nine-hour
   * one is a slip nobody catches until the OEE figures are wrong, and the
   * cheapest place to stop it is a list it is not on. Manager and up keep the
   * full day: they correct other people's shifts, and a handover filed at
   * 23:58 for the shift that ended at 23:00 is theirs to enter.
   *
   * It narrows the control, never the schema. The window is a factory setting
   * that changes, and a rule enforced here that the database does not know
   * about would refuse entries nobody could explain.
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

  /**
   * Whether "Now" is a legal answer.
   *
   * The button beside each picker writes the wall clock straight into the
   * field, so leaving it live while the picker refuses the same value would
   * be a way round the window sitting right next to it.
   */
  const nowAllowed = useMemo(() => {
    if (!clockWindow) return true;
    const at = clockNow();
    const mins = (t: string) =>
      Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const [a, b, n] = [mins(clockWindow.from), mins(clockWindow.to), mins(at)];
    return a > b ? n >= a || n <= b : n >= a && n <= b;
  }, [clockWindow]);

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
      // And the entry moved its stage's accumulated total, by the same route:
      // `batch_stage_accumulate` recomputes it in the database, so the only
      // thing to do here is stop trusting the copy we already have. Without
      // this the stage progress bar on this very form stays where it was —
      // the number is right in the database and stale on screen, which is the
      // worst of both.
      await queryClient.invalidateQueries({
        queryKey: batchStageKeys.all(factoryId),
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
      const carried: Partial<LogEntryValues> = {
        factoryId,
        unitId: keep.unitId,
        processId: keep.processId,
        category: keep.category,
        hasMachine: keep.hasMachine,
        shift: keep.shift,
        startTime: keep.endTime,
        endTime: "",
        // The room stays on the same batch and the same machine across a run
        // of entries, and re-typing a six-digit batch number every hour is
        // how the wrong one gets typed.
        batchNo: keep.batchNo,
        // The stage carries over with the batch and activity: a run of entries
        // against Packing 30's is all the same stage, and re-picking it every
        // hour is how the wrong one gets picked.
        batchStageId: keep.batchStageId,
        equipmentNo: keep.equipmentNo,
        qtyUnit: keep.qtyUnit,
        speedType: keep.speedType,
        speedRate: keep.speedRate,
        targetSpeed: keep.targetSpeed,
        // The same people usually work the whole shift, so the whole list
        // carries over — including however many rows were added for it.
        operators: keep.operators,

        /* ── Cleared, and cleared *explicitly* ───────────────────────
           These describe the hour that was just filed: a carried-over
           231,453 the operator does not notice is a wrong entry that looks
           like a right one, and it cannot be deleted afterwards — only
           amended.

           Named with `null` rather than left out, which is the whole point.
           Omitting a key does NOT clear its input: `reset()` empties
           `_fields`, every input re-registers, and `updateValidAndValue`
           takes the branch for an undefined value — which *reads the DOM
           into form state* instead of writing form state to the DOM. The
           element is never remounted, so it still shows what was typed, and
           RHF then adopts that number straight back. A field given `null`
           takes the other branch and the input is set to "".

           `null` and not "": these are `valueAsNumber` inputs, and RHF maps
           "" to NaN but null back to null — which `optionalQty` already
           accepts and folds to undefined. Nothing here can reach the
           database as a 0.

           Only the inputs registered with `register` need this. The
           Controller-driven ones (action flag, slow reason) render from form
           state and clear on their own. */
        targetQty: null,
        qty: null,
        qtyRejected: null,
        actualSpeed: null,
        comment: "",
        actionFlag: "",
        slowReason: "",
      };
      reset(carried);

      // The filed entry is no longer a draft. Replacing it with what carried
      // over (rather than deleting it) means a reload right after logging
      // still opens on the room, batch and crew, exactly as the form does.
      writeLogDraft(factoryId, userId, carried);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setupMissing = activeUnits.length === 0 || activeProcesses.length === 0;

  if (setupMissing) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-12 text-center text-sm text-ink-5">
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
        /* `mutateAsync`, so `formState.isSubmitting` stays
                 true for the round trip — and `.catch`, because the promise it
                 rejects with is one `onError` has already reported. Left
                 uncaught it surfaces a second time as an unhandled rejection,
                 which in dev is the full-screen Next.js error overlay. The
                 database refusing an entry is an ordinary answer here — an
                 unissued batch, a stage over its tolerance — not a crash. */
        (values) => submit.mutateAsync(values).catch(() => {}),
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
      className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface px-5 py-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand-line text-brand">
            <Plus className="size-4" />
          </span>
          New entry
        </h2>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[10px] font-semibold text-teal-deep ring-1 ring-teal-line/70">
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
                  ? "border-brand bg-brand-soft text-brand-deep shadow-[0_0_0_3px_rgba(79,70,229,0.10)]"
                  : "border-line bg-surface text-ink-4 hover:border-ink-6 hover:text-ink",
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
          <FieldRow cols={2}>
            <Field
              label={units.singular}
              htmlFor="log-unit"
              error={errors.unitId?.message}
            >
              <Controller
                name="unitId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="log-unit"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.unitId)}
                    searchPlaceholder={`${units.singular} name…`}
                    emptyMessage={`No ${units.singular.toLowerCase()} matches that.`}
                    options={activeUnits.map((u) => ({
                      value: u.id,
                      label: u.name,
                    }))}
                  />
                )}
              />
            </Field>
            <Field
              label="Activity / stage"
              htmlFor="log-process"
              error={errors.processId?.message}
            >
              {/* Name only under a category heading. The machine / output
                  flags stay out of it — they are configuration, not something
                  the operator picks between, and the form already shows their
                  effect by revealing or hiding Speed and Output the moment a
                  stage is selected. */}
              <Controller
                name="processId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="log-process"
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
                      })),
                    }))}
                  />
                )}
              />
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
                <Controller
                  name="startTime"
                  control={control}
                  render={({ field }) => (
                    <TimeField
                      id="log-start"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      from={clockWindow?.from}
                      to={clockWindow?.to}
                      windowNote={clockWindow?.note}
                      className="h-11 flex-1"
                    />
                  )}
                />
                <NowButton
                  disabled={!nowAllowed}
                  onClick={() => setValue("startTime", clockNow())}
                />
              </div>
            </Field>
            <Field
              label="Activity end"
              htmlFor="log-end"
              error={errors.endTime?.message}
            >
              <div className="flex gap-1.5">
                <Controller
                  name="endTime"
                  control={control}
                  render={({ field }) => (
                    <TimeField
                      id="log-end"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      from={clockWindow?.from}
                      to={clockWindow?.to}
                      windowNote={clockWindow?.note}
                      className="h-11 flex-1"
                    />
                  )}
                />
                <NowButton
                  disabled={!nowAllowed}
                  onClick={() => setValue("endTime", clockNow())}
                />
              </div>
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
        </section>

        {/* ── Batch & equipment ─────────────────────────────────────
            One section, because both are the same job: type a number, the
            register hands back what it means. They were two stacked cards
            holding one short field each, which cost a scroll to answer two
            questions an operator answers in the same breath.

            Equipment belongs to machine activities only — a manual stage has
            none, and neither preparatory nor downtime is ever one — so the
            row is one column wide as often as two. */}
        <section className={cn(SECTION, "space-y-3")}>
          <SectionTitle
            icon={Package}
            hint={
              showEquipment
                ? "→ auto-fills product & machine"
                : "→ auto-fills product details"
            }
          >
            {showEquipment ? "Batch & equipment" : "Batch"}
          </SectionTitle>

          <FieldRow cols={2}>
            <Field
              label="Batch number"
              optional={isDowntime}
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
            {showEquipment && (
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
                  autoComplete="off"
                  {...register("equipmentNo")}
                />
              </Field>
            )}
          </FieldRow>

          {/* What the two numbers resolved to, laid out under the fields they
              answer for: the machine beside the batch, not a scroll below it.
              The machine chip is one line and the batch card is many, so they
              are top-aligned rather than stretched — a half-empty column is
              better than a chip inflated to match a card. */}
          <div
            className={cn(
              "grid items-start gap-3",
              showEquipment && "sm:grid-cols-2",
            )}
          >
            {/* Only once the batch resolves. Its unresolved states — nothing
                typed, nothing matched — are exactly what the refusal note
                below now says, at greater length and in the colour of a
                problem; printing both left the operator reading the same
                sentence twice in two voices. */}
            {showBatchCard && (
              <BatchAutofill
                query={(batchNo ?? "").trim()}
                product={product}
                runningTotal={runningTotal}
                job={job}
              />
            )}
            {/* Resolved out of Admin → Equipment: the operator types the
                number off the machine, the register supplies the name. Held
                in its own column even when the batch card isn't drawn, so the
                machine never slides under the batch field. */}
            {showEquipment && (
              <div className={cn(!showBatchCard && "sm:col-start-2")}>
                <EquipmentAutofill
                  query={(equipmentNo ?? "").trim()}
                  equipment={equipment}
                />
              </div>
            )}
          </div>

          {/* The entry will be refused, and why. One note for all four rules
              of the gate — they are answered in order, so only ever one can
              be the reason, and four separate panels would read as four
              separate problems. Given its own line under both columns: it is
              about the entry, not about either field. */}
          {batchBlock && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-3">
              <span
                aria-hidden
                className="mt-px grid size-5 shrink-0 place-items-center rounded-md bg-warn-line/50 text-warn-ink"
              >
                <TriangleAlert className="size-3" />
              </span>
              <span className="min-w-0 text-xs leading-relaxed text-warn-ink">
                <strong className="block font-semibold">
                  {batchBlock.head}
                </strong>
                <span className="text-warn-ink/85">{batchBlock.body}</span>
              </span>
            </div>
          )}

          {/* Asked only where the answer isn't already known: this batch runs
              the selected activity more than once — three packing runs, or
              three work orders — and without saying which, all of them would
              pool into a single total that describes none of them. */}
          {mustPickStage && (
            <Field
              label="Stage / work order"
              note="this batch runs this activity more than once"
              htmlFor="log-stage"
              error={errors.batchStageId?.message}
            >
              <Controller
                name="batchStageId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="log-stage"
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

          {/* The denominator the log has never had. Once a batch is planned,
              the running total means something: 231,453 of 312,500, not
              231,453 of nothing. */}
          {activeStage && activeStage.target_qty && (
            <StageProgress stage={activeStage} pending={thisQty} />
          )}
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
                <Controller
                  name="qtyUnit"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      id="log-qty-unit"
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

            {product && (
              <p className="mt-2 text-[11px] text-ink-4">
                Accumulative for this batch &amp; activity:{" "}
                <span className="font-mono font-semibold text-teal">
                  {runningTotal.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </p>
            )}
          </section>
        )}

        {isDowntime && (
          // Not an omission — a stated fact. A break, a breakdown or an idle
          // period stores null quantities, never 0, so it can't drag an
          // output average.
          <p className="flex items-start gap-2 rounded-2xl border border-dashed border-ink-6 bg-sunken px-4 py-3 text-xs text-ink-4">
            <Cog className="mt-px size-3.5 shrink-0 text-ink-5" aria-hidden />
            <span>
              <strong className="font-semibold text-ink-2">Downtime</strong> —
              no quantities, speed or operators are recorded, only the time it
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
                  <Controller
                    name="speedType"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="log-speed-type"
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
            </SlowReason>
          </section>
        )}

        {/* ── Output — after Speed on purpose ──────────────────────
            The shift target is speed × duration: it is *derived* from the card
            above, and reading a target before the numbers it comes from is
            what made "Set a target speed" look like an error rather than an
            instruction. Fill the speed in, and the target is already there
            when the eye arrives. */}
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
                    "cursor-default border-brand-line bg-brand-tint font-semibold text-brand shadow-none focus:border-brand-line focus:bg-brand-tint focus:ring-0",
                  )}
                  placeholder="Set a target speed"
                  {...register("targetQty", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Actual qty produced"
                htmlFor="log-qty"
                error={errors.qty?.message}
                note={qty === 0 ? "zero — nothing will be counted" : undefined}
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
              <p className="mt-2 text-[11px] text-ink-4">
                Accumulative for this batch &amp; activity:{" "}
                <span className="font-mono font-semibold text-teal">
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
              <p className="mb-2.5 rounded-xl border border-dashed border-ink-6 bg-surface px-3.5 py-3 text-xs text-ink-4">
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
                        className="text-[11px] font-semibold text-ink-5 transition hover:text-danger-deep"
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
                  <Controller
                    name="actionFlag"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        id="log-flag"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ariaInvalid={Boolean(errors.actionFlag)}
                        // "Routine" is the answer for most entries, not an
                        // unfilled field — so it stays a named row.
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
          </>
        )}
      </div>

      {/* Pinned: the button belongs to the form, not to the bottom of the
          scroll. The note sits beside the button rather than under it, so the
          footer costs one row of height instead of two — every pixel it does
          not take is a pixel the scrolling body gets. The button is sized to
          its text: a full-width bar reads as a page action, and this one acts
          on the card it sits in. It still goes full width on a phone, where
          there is no second column to share the row with. */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft bg-gradient-to-b from-surface to-sunken px-4 py-3 sm:px-5">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-5">
          <ShieldCheck className="size-3 shrink-0" aria-hidden />
          Corrections are amendments, not deletes.
        </p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-7 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.995] disabled:pointer-events-none disabled:opacity-70 sm:w-auto"
        >
          {isSubmitting && <Loader2 className="size-4 animate-spin" />}
          {isSubmitting ? "Logging…" : "Log entry"}
        </button>
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
      className="flex shrink-0 overflow-hidden rounded-xl border border-line bg-surface"
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
              ? "bg-brand text-white"
              : "text-ink-5 hover:bg-sunken hover:text-ink",
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
    className: "bg-sunken-2 text-ink-3 ring-line",
  },
  preparatory: {
    summary: "batch & output",
    className: "bg-warn-soft text-warn-ink ring-warn-line",
  },
  production: {
    summary: "full record",
    className: "bg-brand-soft text-brand-deep ring-brand-line",
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

function NowButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  /** The clock is outside the window this field is held to. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "The clock is outside your shift" : "Set to now"}
      className="h-11 shrink-0 rounded-xl border border-brand-line bg-brand-tint px-3 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand-soft active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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
    <div className="mt-3 space-y-2 rounded-xl border border-warn-line bg-warn-tint p-3.5 shadow-[0_1px_2px_rgba(180,83,9,0.06)]">
      <Field
        label="⚠ Reason for running below target speed"
        note="(required)"
        error={error}
      >
        {children}
      </Field>
      <p className="text-[11px] text-warn-ink">
        This is what the Pareto chart in OEE &amp; Downtime is built from — an
        unexplained slow run is a gap in the analysis later.
      </p>
    </div>
  );
}
