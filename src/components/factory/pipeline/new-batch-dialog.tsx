"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarDays,
  Loader2,
  Package,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import {
  BULK_UNIT_OPTIONS,
  PACK_UNITS,
  PRIORITIES,
  PRIORITY_LABELS,
  bulkNeeded,
  newBatchSchema,
  pairedLotSchema,
  STAGE_UNITS,
  stagePlanSchema,
  type BatchType,
  type NewBatchParsed,
  type NewBatchValues,
  type PairedLotParsed,
  type PairedLotValues,
  type StagePlanParsed,
  type StagePlanValues,
  type StageDraftValues,
  type StageUnit,
} from "@/app/factory/[slug]/pipeline/schemas";
import {
  StagePlanEditor,
  emptyPlan,
} from "@/components/factory/pipeline/stage-plan-editor";
import {
  createBatchStage,
  issueJob,
} from "@/lib/factory/batch-stage-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  isUntouchedPlan,
  manufacturingRoute,
  packingRoute,
} from "@/lib/factory/stage-templates";
import type {
  BatchModel,
  WorkOrderMode,
} from "@/app/factory/[slug]/admin/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { InfoTip } from "@/components/factory/pipeline/info-tip";
import {
  createBatchJob,
  deletePipelineJob,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import {
  productKeys,
  updateProduct,
  type Product,
} from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/factory/dates";

const FIELD =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";
const MONO = "font-mono tracking-tight";
/** SelectField's size, to match `FIELD` — one control height in the dialog. */
const CONTROL = "h-9 rounded-lg px-2.5 text-[13px]";
const LABEL = "text-[10.5px] font-semibold tracking-[0.03em] text-ink-4 uppercase";

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** A bulk or pack unit as a stage unit — every one of them is one — or "units". */
function asStageUnit(unit: string | null | undefined): StageUnit {
  return (STAGE_UNITS as readonly string[]).includes(unit ?? "")
    ? (unit as StageUnit)
    : "units";
}

/** "2026-09-30" → "30 Sep 2026", read as a local day so no timezone shifts it. */
const longDay = formatDay;

/**
 * Pipeline → New batch.
 *
 * The batch type is not a field among fields — it decides whether this batch
 * produces bulk, draws on someone else's, or does both under one number, and
 * each answer needs a different half-dozen questions. Which types are on
 * offer is the company's batch number model (Admin → Company, 0042): a
 * single-batch company is never asked — every batch is a Single Batch — and a
 * split-batch company raises Bulk Production, with its Finished Lot added from
 * the checkbox at the end of the form. There is no tab for the lot: the
 * checkbox asks the same questions, so a second way in only showed the same
 * data twice. (A lot is still opened directly, with its bulk chosen, by
 * `presetParentId` — "+ Lot" on the board.)
 *
 * Tolerance and overage are not asked here. Both stay optional on the batch
 * and are left blank; tolerance is set per batch in Edit batch.
 *
 * The batch itself is **picked**, never typed. Products owns the
 * batch number, product name, code, work order and required quantity, and the
 * shift log resolves entries against that same row — so a batch typed here
 * would be a second place the name can be spelt and a second number for the
 * overrun check to disagree with. This dialog asks only what the *pipeline*
 * knows: what kind of batch it is, whose bulk it draws on, how it is packed.
 *
 * `NewJobDialog` is the bulk sibling — many batches, none of this detail.
 */
export function NewBatchDialog({
  factoryId,
  userId,
  products,
  jobs,
  onCreated,
  /** Opens straight onto Packing with this parent pre-filled. */
  presetParentId,
  batchModel = "single",
  workOrderMode = "none",
  open: controlledOpen,
  onOpenChange,
  trigger = true,
}: {
  factoryId: string;
  userId: string;
  /** Products: the batches this can be raised for. */
  products: Product[];
  /** The board, for the parent picker and for hiding batches already on it. */
  jobs: PipelineJob[];
  onCreated: () => void;
  presetParentId?: string | null;
  /**
   * Admin → Company (0042). `single` asks for no type — the batch is a Single
   * Batch; `split` raises Bulk Production (the lot is the checkbox at the end).
   */
  batchModel?: BatchModel;
  /**
   * Admin → Company (0043). Only `batch` asks for a work order here; `stage`
   * asks for one per stage when the plan is made, and `none` never asks.
   */
  workOrderMode?: WorkOrderMode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False when the caller opens it itself — the families view does. */
  trigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpenRaw = onOpenChange ?? setUncontrolledOpen;
  /**
   * "Also add a finished lot from this bulk" — on Bulk Production, the lot is
   * filled in beside the bulk, both are validated together, and one submit
   * raises the pair with the lot already drawing on the bulk.
   */
  const [withLot, setWithLot] = useState(false);
  const setOpen = (next: boolean) => {
    // Belongs to one run of the dialog; the next New batch starts without it.
    if (!next) setWithLot(false);
    setOpenRaw(next);
  };
  const split = batchModel === "split";
  const perBatchWo = workOrderMode === "batch";
  const queryClient = useQueryClient();
  const defaultType: BatchType = split ? "manufacturing" : "combined";

  const {
    control,
    register,
    reset,
    setValue,
    trigger: validateBatch,
    getValues,
    formState: { errors },
    // Three generics, like `LogEntryForm`: the fields hold the *input* shape
    // while the submit handler receives what zod transformed — so "" becomes
    // undefined on the way out without the callback having to cast.
  } = useForm<NewBatchValues, unknown, NewBatchParsed>({
    resolver: zodResolver(newBatchSchema),
    defaultValues: emptyValues(factoryId),
  });

  const [
    batchType,
    productId,
    packSize,
    parentJobId,
    bulkUnit,
    packUnitWatch,
  ] = useWatch({
    control,
    name: [
      "batchType",
      "productId",
      "packSize",
      "parentJobId",
      "bulkUnit",
      "packUnit",
    ],
  });

  /** The paired finished lot — its own form, validated alongside the bulk. */
  const lotForm = useForm<PairedLotValues, unknown, PairedLotParsed>({
    resolver: zodResolver(pairedLotSchema),
    defaultValues: emptyLot(),
  });
  const lotErrors = lotForm.formState.errors;
  const [lotProductId, lotPackSize, lotPackUnit] = useWatch({
    control: lotForm.control,
    name: ["productId", "packSize", "packUnit"],
  });
  const resetLot = lotForm.reset;

  /**
   * The stage plans: one for the batch this dialog raises, one for the paired
   * lot. Their own forms, because a field array of stages is its own shape —
   * validated beside the batch, saved after it.
   */
  const plan = useForm<StagePlanValues, unknown, StagePlanParsed>({
    resolver: zodResolver(stagePlanSchema),
    defaultValues: emptyPlan(),
  });
  const lotPlan = useForm<StagePlanValues, unknown, StagePlanParsed>({
    resolver: zodResolver(stagePlanSchema),
    defaultValues: emptyPlan(),
  });
  const resetPlan = plan.reset;
  const resetLotPlan = lotPlan.reset;

  /**
   * Reset on open rather than on close, so a dialog dismissed by accident can
   * be reopened without the previous answers already gone — and so a preset
   * parent lands on a clean form every time the families view asks for one.
   */
  useEffect(() => {
    if (!open) return;
    reset({
      ...emptyValues(factoryId),
      batchType: defaultType,
      ...(presetParentId
        ? { batchType: "packing" as const, parentJobId: presetParentId }
        : {}),
    });
    resetLot(emptyLot());
    resetPlan(emptyPlan());
    resetLotPlan(emptyPlan());
  }, [
    open,
    factoryId,
    presetParentId,
    defaultType,
    reset,
    resetLot,
    resetPlan,
    resetLotPlan,
  ]);

  // The same cache keys as the plan dialog and Admin, so these are usually
  // already warm by the time New batch opens.
  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
    enabled: open,
  });
  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
    enabled: open,
  });
  /** Never downtime — see `PlanStagesDialog`; the database refuses it too. */
  const plannable = useMemo(
    () => processList.filter((p) => p.active && p.category !== "downtime"),
    [processList],
  );
  const rooms = useMemo(() => unitList.filter((u) => u.active), [unitList]);

  /** Manufacturing batches on the board are the only possible bulk sources. */
  const bulkSources = useMemo(
    () => jobs.filter((job) => job.batch_type === "manufacturing"),
    [jobs],
  );

  /**
   * The batches this dialog will offer.
   *
   * Active ones with no job yet — a batch is run once, so one already on the
   * board has nothing to add, and the unique index on `product_id` would
   * refuse it anyway. Retired batches are left out for the same reason they
   * are left out of the shift log: a date or a card on a retired batch is
   * history, not a plan.
   */
  const onBoard = useMemo(
    () => new Set(jobs.map((job) => job.product_id)),
    [jobs],
  );
  const available = useMemo(
    () => products.filter((p) => p.active && !onBoard.has(p.id)),
    [products, onBoard],
  );

  /** The catalogue row behind the picked batch — the source of every detail. */
  const picked = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );
  /** The catalogue row behind the paired finished lot. */
  const lotPicked = useMemo(
    () => products.find((p) => p.id === lotProductId) ?? null,
    [products, lotProductId],
  );

  /**
   * A plan's stages, one insert at a time and in order: `batch_stages_validate`
   * appends each row at the end, so the order they arrive in is the route —
   * and the last one to arrive is the stage that completes the order.
   */
  async function addStages(jobId: string, stagePlan: StagePlanParsed) {
    for (const stage of stagePlan.stages) {
      await createBatchStage(factoryId, jobId, stage);
    }
  }

  const create = useMutation({
    mutationFn: async ({
      values,
      stagePlan,
      lot,
    }: {
      values: NewBatchParsed;
      stagePlan: StagePlanParsed;
      lot?: { values: PairedLotParsed; plan: StagePlanParsed };
    }) => {
      /**
       * Everything this submit put on the board, newest last — what a failure
       * part way through takes back off it. Every one of them is seconds old
       * and Planned, so nothing can have been logged against it, and deleting
       * a job takes its stages with it (`on delete cascade`, 0033).
       */
      const created: string[] = [];
      try {
        // A per-batch work order lives on the batch's own row in Products —
        // the column the shift log's autofill and the batch record already
        // read — so it is written there, not onto the card as a second copy.
        // Blank falls back to the batch number, the same rule Products applies.
        if (perBatchWo && picked) {
          await updateProduct(picked.id, {
            work_order: values.workOrder?.trim() || picked.batch_no,
          });
        }
        const mainId = await createBatchJob(values, userId);
        created.push(mainId);
        await addStages(mainId, stagePlan);

        let lotId: string | null = null;
        if (lot) {
          const lotRow = products.find((p) => p.id === lot.values.productId);
          if (perBatchWo && lotRow) {
            await updateProduct(lotRow.id, {
              work_order: lot.values.workOrder?.trim() || lotRow.batch_no,
            });
          }
          lotId = await createBatchJob(
            {
              factoryId: values.factoryId,
              productId: lot.values.productId,
              batchType: "packing",
              parentJobId: mainId,
              packSize: lot.values.packSize,
              packUnit: lot.values.packUnit,
              market: lot.values.market,
              bulkQtyReceived: lot.values.bulkQtyReceived,
              // A lot fills what it is given: no bulk unit, and never an
              // overage (`pipeline_jobs_overage_belongs`, 0032).
              bulkUnit: undefined,
              overagePct: undefined,
              // One order, one urgency, one tolerance — the bulk's, not asked
              // twice. The due date is the lot's own, from its row in Products.
              priority: values.priority,
              tolerancePct: values.tolerancePct,
              dueDate: lotRow?.due_date ?? "",
              notes: "",
            },
            userId,
          );
          created.push(lotId);
          await addStages(lotId, lot.plan);
        }

        // Issued last, once every batch and stage exists, so a failure above
        // never leaves a batch on the floor that the rollback then pulls.
        if (stagePlan.issue) await issueJob(mainId);
        if (lotId && lot?.plan.issue) await issueJob(lotId);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (created.length === 0) throw new Error(message);
        try {
          for (const id of [...created].reverse()) await deletePipelineJob(id);
        } catch {
          throw new Error(
            `Only part of this was saved — check the board. ${message}`,
          );
        }
        throw new Error(`Nothing was added. ${message}`);
      }
    },
    onSuccess: (_data, { stagePlan, lot }) => {
      if (perBatchWo) {
        queryClient.invalidateQueries({ queryKey: productKeys.all(factoryId) });
      }
      const numbers = [picked?.batch_no, lot ? lotPicked?.batch_no : null]
        .filter(Boolean)
        .join(" and ");
      const issued = [stagePlan.issue, lot?.plan.issue].filter(Boolean).length;
      toast.success(
        `${lot ? "Batches" : "Batch"} ${numbers} added to the board${
          issued === 0
            ? "."
            : issued === (lot ? 2 : 1)
              ? " and issued for production."
              : " — one issued for production."
        }`,
      );
      setOpen(false);
      onCreated();
    },
    // A half-done pair still changed the board, so it is re-read either way.
    onError: (e: Error) => {
      toast.error(e.message);
      onCreated();
    },
  });

  /**
   * Loads the standard route into a plan (`stage-templates.ts`) — but only
   * while the plan holds nothing typed, so picking a unit never wipes a plan
   * someone has started filling in.
   */
  function loadRoute(target: typeof plan, stages: StageDraftValues[]) {
    if (!isUntouchedPlan(target.getValues("stages"))) return;
    target.setValue("stages", stages, { shouldDirty: true });
  }

  /**
   * Re-reads the route once a unit, the parent or the type changes. Called
   * from the change itself with the new value, since the watched values only
   * catch up on the next render.
   *
   * Bulk Production runs the manufacturing route for its bulk unit; a Single
   * Batch runs it and then the packing route for its pack unit; a Finished
   * Lot runs the packing route for its pack unit and its parent's bulk unit.
   */
  function reroute(
    changed: Partial<
      Pick<NewBatchValues, "batchType" | "bulkUnit" | "packUnit" | "parentJobId">
    >,
  ) {
    const v = { ...getValues(), ...changed };
    const kind = v.batchType ?? defaultType;
    const parentBulk = bulkSources.find((j) => j.id === v.parentJobId)?.bulk_unit;
    loadRoute(
      plan,
      kind === "manufacturing"
        ? manufacturingRoute(v.bulkUnit, plannable)
        : kind === "combined"
          ? [
              ...manufacturingRoute(v.bulkUnit, plannable),
              ...packingRoute(v.bulkUnit, v.packUnit, plannable),
            ]
          : packingRoute(parentBulk, v.packUnit, plannable),
    );
    // The paired lot packs this bulk, so its route follows the bulk unit too.
    if (withLot && "bulkUnit" in changed) {
      loadRoute(
        lotPlan,
        packingRoute(v.bulkUnit, lotForm.getValues("packUnit"), plannable),
      );
    }
  }

  /** The paired lot's route: this bulk's unit, the lot's own pack unit. */
  function rerouteLot(packUnit: string) {
    loadRoute(lotPlan, packingRoute(getValues("bulkUnit"), packUnit, plannable));
  }

  const type = (batchType ?? defaultType) as BatchType;
  const isManufacturing = type === "manufacturing";
  const isPacking = type === "packing";

  // Containers come from the catalogue, pack size from this form — the two
  // halves of "how much bulk does this run need", from the two places that
  // own them.
  const needed = isPacking
    ? bulkNeeded(
        picked?.required_qty || undefined,
        typeof packSize === "number" ? packSize : undefined,
      )
    : null;
  const parent = bulkSources.find((j) => j.id === parentJobId);

  /** The paired lot is only live on Bulk Production with a bulk picked. */
  const pairing = isManufacturing && withLot && Boolean(picked);
  const lotNeeded = pairing
    ? bulkNeeded(
        lotPicked?.required_qty || undefined,
        typeof lotPackSize === "number" ? lotPackSize : undefined,
      )
    : null;
  // What the families bar measures against (0032). A batch raised here
  // declares no overage, so it is the bulk target itself.
  const bulkAllowance = picked?.required_qty
    ? Math.floor(picked.required_qty)
    : null;

  const busy = create.isPending;

  /**
   * Validates every part the dialog is about to save — the batch, its plan,
   * and when paired the lot and the lot's plan — all at once, so every error
   * in every part shows on the same submit, and writes nothing until they all
   * pass.
   */
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checks = await Promise.all([
      validateBatch(),
      plan.trigger(),
      ...(pairing ? [lotForm.trigger(), lotPlan.trigger()] : []),
    ]);
    if (!checks.every(Boolean)) {
      toast.error("Some fields need attention — they're marked in red.");
      return;
    }
    // Parsed again for the transformed output ("" → undefined and the rest);
    // the checks above have already proved it parses.
    await create
      .mutateAsync({
        values: newBatchSchema.parse(getValues()),
        stagePlan: stagePlanSchema.parse(plan.getValues()),
        lot: pairing
          ? {
              values: pairedLotSchema.parse(lotForm.getValues()),
              plan: stagePlanSchema.parse(lotPlan.getValues()),
            }
          : undefined,
      })
      .catch(() => undefined);
  }

  /** What a new stage row counts in: the batch's own unit, where it has one. */
  const mainUnitWord = isPacking ? packUnitWatch : bulkUnit || packUnitWatch;
  const mainUnit = asStageUnit(mainUnitWord);
  const lotUnit = asStageUnit(lotPackUnit);
  const mainOrder = picked?.required_qty
    ? `${fmt(picked.required_qty)}${mainUnitWord ? ` ${mainUnitWord}` : ""}`
    : null;
  const lotOrder = lotPicked?.required_qty
    ? `${fmt(lotPicked.required_qty)}${lotPackUnit ? ` ${lotPackUnit}` : ""}`
    : null;

  return (
    <>
      {trigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
        >
          <Plus className="size-4" />
          New batch
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[min(62rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1 border-b border-line bg-surface px-5 pt-4 pr-12 pb-3">
            <DialogTitle className="text-[15px] text-ink">New batch</DialogTitle>
            <DialogDescription className="text-xs">
              It lands in Planned and moves itself as entries are logged
              against it.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scrollbar-slim @container min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3.5">
              {/* ── The batch ──────────────────────────────────────────────
                  Everything that is *this batch's* and not the type's: which
                  one, how urgent, and — for a bulk batch, whose only own field
                  is the unit — what its bulk is counted in. Then what the
                  catalogue already knows about it, read back as a strip. */}
              <section className="space-y-3 rounded-xl border border-line bg-surface p-3.5">
                <div
                  className={cn(
                    "grid gap-3",
                    isManufacturing ? "@3xl:grid-cols-4" : "@3xl:grid-cols-3",
                  )}
                >
                  <Field
                    label="Batch"
                    htmlFor="nb-product"
                    error={errors.productId?.message}
                    className="@3xl:col-span-2"
                  >
                    <Controller
                      name="productId"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          className={CONTROL}
                          id="nb-product"
                          value={field.value ?? ""}
                          onChange={(id) => {
                            field.onChange(id);
                            // The card's due date is the order's (0041), read
                            // from Products and never typed here — so every
                            // pick replaces it, including with a blank.
                            setValue(
                              "dueDate",
                              products.find((p) => p.id === id)?.due_date ?? "",
                            );
                            // Starts as what Products already holds, so saving
                            // without touching it changes nothing.
                            setValue(
                              "workOrder",
                              products.find((p) => p.id === id)?.work_order ?? "",
                            );
                          }}
                          onBlur={field.onBlur}
                          ariaInvalid={Boolean(errors.productId)}
                          placeholder="Select a batch…"
                          // The catalogue runs to hundreds of rows, so this is
                          // the picker the search box exists for. The code and
                          // work order are searchable through `meta` even
                          // though the row shows only the number and the name.
                          searchPlaceholder="Batch number, code or product…"
                          emptyMessage="No batch matches that."
                          options={available
                            // Not the batch already chosen as the paired lot.
                            .filter((p) => !pairing || p.id !== lotProductId)
                            .map((product) => ({
                            value: product.id,
                            label: `${product.batch_no} — ${product.name}`,
                            meta: product.code || product.work_order || undefined,
                          }))}
                        />
                      )}
                    />
                  </Field>

                  <Field label="Priority" htmlFor="nb-priority">
                    <Controller
                      name="priority"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          className={CONTROL}
                          id="nb-priority"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          options={PRIORITIES.map((p) => ({
                            value: p,
                            label: PRIORITY_LABELS[p],
                          }))}
                        />
                      )}
                    />
                  </Field>

                  {isManufacturing && (
                    <Field
                      label="Bulk unit"
                      htmlFor="nb-bulk-unit"
                      error={errors.bulkUnit?.message}
                      info={
                        <>
                          This batch produces bulk that finished lots draw
                          from, and its required quantity is the bulk target
                          {picked?.required_qty ? (
                            <>
                              {" "}
                              (
                              <strong className="font-semibold text-ink-2">
                                {fmt(picked.required_qty)}
                              </strong>
                              , from the catalogue)
                            </>
                          ) : null}
                          . The bulk unit is what its finished lots are
                          measured back in.
                        </>
                      }
                    >
                      <Controller
                        name="bulkUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-bulk-unit"
                            value={field.value ?? ""}
                            onChange={(v) => {
                              field.onChange(v);
                              reroute({ bulkUnit: v as NewBatchValues["bulkUnit"] });
                            }}
                            onBlur={field.onBlur}
                            clearable
                            options={BULK_UNIT_OPTIONS}
                          />
                        )}
                      />
                    </Field>
                  )}
                </div>

                {/* Read back, never re-typed — the catalogue owns these. The
                    due date is the customer's, set in Products and only shown
                    here, so one place holds it. A work order, where the
                    company tracks one per batch (Admin → Company), is the one
                    thing here that is typed; per-stage ones are asked when the
                    plan is made. */}
                {(picked || perBatchWo) && (
                  <div
                    className={cn(
                      "grid items-end gap-3",
                      perBatchWo && "@3xl:grid-cols-4",
                    )}
                  >
                    {picked && (
                      <Summary
                        className={cn(
                          "@3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]",
                          perBatchWo && "@3xl:col-span-3",
                        )}
                      >
                        <Stat label="Product" value={picked.name} />
                        <Stat label="Code" value={picked.code || "—"} mono />
                        <Stat
                          label={
                            isPacking
                              ? "Containers to fill"
                              : isManufacturing
                                ? "Bulk target"
                                : "Required qty"
                          }
                          value={
                            picked.required_qty
                              ? fmt(picked.required_qty)
                              : "Not set"
                          }
                          mono
                        />
                        <Stat
                          label="Due date"
                          value={
                            picked.due_date
                              ? longDay(picked.due_date)
                              : "None in Products"
                          }
                          icon={CalendarDays}
                          title="Set on the batch in Products"
                        />
                      </Summary>
                    )}
                    {perBatchWo && (
                      <Field
                        label="Work order"
                        optional
                        htmlFor="nb-wo"
                        error={errors.workOrder?.message}
                        className={cn(!picked && "@3xl:col-start-4")}
                      >
                        <input
                          id="nb-wo"
                          placeholder={
                            picked ? `Same as ${picked.batch_no}` : "e.g. 46000"
                          }
                          autoComplete="off"
                          className={cn(FIELD, MONO)}
                          {...register("workOrder")}
                        />
                      </Field>
                    )}
                  </div>
                )}
                {!picked && available.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line-strong bg-sunken px-3 py-2.5 text-xs text-ink-5">
                    Every active batch is already on the board. Add more in
                    Products.
                  </p>
                )}

                {/* A packing run with no quantity contributes nothing to its
                    parent's allocation, so the family bar would silently
                    under-read. Said here, but fixed in Admin — that column is
                    the catalogue's, and editing it in two places is how the
                    two stop agreeing. */}
                {picked && !picked.required_qty && (
                  <p className="rounded-lg border border-warn-line bg-warn-tint px-3 py-2 text-[11px] text-warn-ink">
                    Batch {picked.batch_no} has no required quantity. Set it in
                    Products, or this batch shows no progress and counts as
                    nothing against its bulk.
                  </p>
                )}
              </section>

              {/* ── Single batch ───────────────────────────────────────────
                  Both halves in one row — the bulk's unit and the lot's pack
                  size, pack unit and market. Everything but a parent and the
                  bulk received: a batch that makes its own bulk draws on
                  nobody's, and the 0031 family guard refuses a parent on
                  anything but a finished lot. */}
              {type === "combined" && (
                <TypeSection
                  icon={RefreshCw}
                  title="Single batch details"
                  tone="border-teal-line bg-teal-soft"
                  info={
                    <>
                      Made and packed under one number. The ordered quantity is
                      read from the catalogue, never typed here
                      {picked?.required_qty ? (
                        <>
                          {" "}
                          (
                          <strong className="font-semibold text-ink-2">
                            {fmt(picked.required_qty)}
                          </strong>
                          ) — change it in Products.
                        </>
                      ) : picked ? (
                        <>
                          {" "}
                          — and this batch has none yet. Set one in Products, or
                          the stage plan has nothing to be measured against.
                        </>
                      ) : (
                        "."
                      )}
                    </>
                  }
                >
                  <div className="grid gap-3 @3xl:grid-cols-4">
                    <Field
                      label="Bulk unit"
                      optional
                      htmlFor="nb-bulk-unit-combined"
                      error={errors.bulkUnit?.message}
                    >
                      <Controller
                        name="bulkUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-bulk-unit-combined"
                            value={field.value ?? ""}
                            onChange={(v) => {
                              field.onChange(v);
                              reroute({ bulkUnit: v as NewBatchValues["bulkUnit"] });
                            }}
                            onBlur={field.onBlur}
                            clearable
                            options={BULK_UNIT_OPTIONS}
                          />
                        )}
                      />
                    </Field>
                    <Field
                      label="Pack size"
                      note="units per container"
                      optional
                      htmlFor="nb-pack-size-combined"
                      error={errors.packSize?.message}
                    >
                      <input
                        id="nb-pack-size-combined"
                        type="number"
                        step="any"
                        min={0}
                        placeholder="e.g. 60"
                        aria-invalid={Boolean(errors.packSize)}
                        className={cn(FIELD, MONO)}
                        {...register("packSize", { valueAsNumber: true })}
                      />
                    </Field>
                    <Field
                      label="Pack unit"
                      optional
                      htmlFor="nb-pack-unit-combined"
                      error={errors.packUnit?.message}
                    >
                      <Controller
                        name="packUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-pack-unit-combined"
                            value={field.value ?? ""}
                            onChange={(v) => {
                              field.onChange(v);
                              reroute({ packUnit: v as NewBatchValues["packUnit"] });
                            }}
                            onBlur={field.onBlur}
                            clearable
                            options={PACK_UNITS.map((unit) => ({
                              value: unit,
                              label: unit,
                            }))}
                          />
                        )}
                      />
                    </Field>
                    <Field
                      label="Market"
                      optional
                      htmlFor="nb-market-combined"
                      error={errors.market?.message}
                    >
                      <input
                        id="nb-market-combined"
                        placeholder="AU, NZ, UK…"
                        className={FIELD}
                        {...register("market")}
                      />
                    </Field>
                  </div>
                </TypeSection>
              )}

              {/* ── Packing ──────────────────────────────────────────────── */}
              {isPacking && (
                <TypeSection
                  icon={Package}
                  title="Finished lot details"
                  tone="border-brand-line bg-brand-tint"
                  info={
                    <>
                      A finished lot fills containers from a manufacturing
                      batch&rsquo;s bulk. Pack size — the units of bulk per
                      container — is the only thing that converts one into the
                      other.
                    </>
                  }
                >
                  {/* The family link is made from the *child's* side, and
                      only here — a manufacturing batch has no children to
                      point at when it is created. The other way in is
                      "Add packing batch" on a family, which opens this dialog
                      with the parent already chosen. */}
                  <div className="grid gap-3 @3xl:grid-cols-4">
                    <Field
                      label="Bulk from"
                      htmlFor="nb-parent"
                      error={errors.parentJobId?.message}
                      className="@3xl:col-span-2"
                    >
                    <Controller
                      name="parentJobId"
                      control={control}
                      render={({ field }) => (
                        <SelectField
                          className={CONTROL}
                          id="nb-parent"
                          value={field.value ?? ""}
                          onChange={(v) => {
                            field.onChange(v);
                            reroute({ parentJobId: v });
                          }}
                          onBlur={field.onBlur}
                          // Not a placeholder: drawing bulk from outside the
                          // plant is a real answer, so it stays a named row.
                          clearable
                          clearLabel="No parent — external bulk"
                          placeholder="No parent — external bulk"
                          searchPlaceholder="Batch number or product…"
                          emptyMessage="No manufacturing batch matches that."
                          options={bulkSources.map((job) => ({
                            value: job.id,
                            label: `${job.batch_no} — ${job.product_name}`,
                            meta: job.bulk_unit ?? undefined,
                          }))}
                        />
                      )}
                    />
                    </Field>
                    <Field
                      label="Pack size"
                      note="units per container"
                      htmlFor="nb-pack-size"
                      error={errors.packSize?.message}
                    >
                      <input
                        id="nb-pack-size"
                        type="number"
                        step="any"
                        min={0}
                        placeholder="e.g. 60"
                        aria-invalid={Boolean(errors.packSize)}
                        className={cn(FIELD, MONO)}
                        {...register("packSize", { valueAsNumber: true })}
                      />
                    </Field>
                    <Field
                      label="Pack unit"
                      htmlFor="nb-pack-unit"
                      error={errors.packUnit?.message}
                    >
                      <Controller
                        name="packUnit"
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-pack-unit"
                            value={field.value ?? ""}
                            onChange={(v) => {
                              field.onChange(v);
                              reroute({ packUnit: v as NewBatchValues["packUnit"] });
                            }}
                            onBlur={field.onBlur}
                            clearable
                            options={PACK_UNITS.map((unit) => ({
                              value: unit,
                              label: unit,
                            }))}
                          />
                        )}
                      />
                    </Field>
                  </div>
                  {/* An empty list looks like a broken control otherwise: the
                      only option is "external bulk" and nothing says why. */}
                  {bulkSources.length === 0 && (
                    <p className="mt-1.5 text-[11px] text-ink-5">
                      No manufacturing batches on the board yet — add one first
                      to link this run to its bulk.
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 @3xl:grid-cols-4">
                    <Field
                      label="Market"
                      optional
                      htmlFor="nb-market"
                      error={errors.market?.message}
                    >
                      <input
                        id="nb-market"
                        placeholder="AU, NZ, UK…"
                        className={FIELD}
                        {...register("market")}
                      />
                    </Field>
                    <Field
                      label="Bulk qty received"
                      note="if different"
                      optional
                      htmlFor="nb-bulk-received"
                      error={errors.bulkQtyReceived?.message}
                    >
                      <input
                        id="nb-bulk-received"
                        type="number"
                        step="any"
                        min={0}
                        placeholder={needed ? String(needed) : "e.g. 60000"}
                        className={cn(FIELD, MONO)}
                        {...register("bulkQtyReceived", { valueAsNumber: true })}
                      />
                    </Field>
                    {/* The arithmetic said out loud while it is being typed —
                        the same number the family allocation bar will show, so
                        the two can never look like different calculations. */}
                    {needed !== null && (
                      <p className="flex items-center self-end rounded-xl bg-surface px-3 text-xs text-ink-3 @3xl:col-span-2 @3xl:h-10">
                        <span className="truncate">
                          Bulk needed:{" "}
                          <strong className="font-mono font-semibold text-brand">
                            {fmt(needed)}
                          </strong>
                          {parent ? (
                            <>
                              {" "}
                              of {parent.batch_no}&rsquo;s{" "}
                              {fmt(parent.required_qty)}{" "}
                              {parent.bulk_unit ?? "units"}
                            </>
                          ) : null}
                        </span>
                      </p>
                    )}
                  </div>
                </TypeSection>
              )}

              {/* ── The plan ─────────────────────────────────────────────
                  Written here, with the batch, so a batch whose route is
                  already known goes from nothing to planned — or issued — in
                  one sitting instead of a second trip through Plan stages.
                  Left empty, it is exactly the old New batch. */}
              <StagePlanEditor
                form={plan}
                idPrefix="nb-plan"
                processes={plannable}
                rooms={rooms}
                showWorkOrder={workOrderMode === "stage"}
                defaultUnit={mainUnit}
                orderLabel={mainOrder}
                disabled={busy}
              />

              {/* ── Paired finished lot ─────────────────────────────────────
                  The bulk and the lot packed from it are usually planned
                  together. Ticked, the lot is filled in here, validated with
                  the bulk, and raised in the same submit already drawing on
                  it — no second trip through the dialog to find the bulk in
                  the parent picker. Needs a bulk picked first: there is
                  nothing to pack from until there is one. */}
              {isManufacturing && (
                <label
                  title={picked ? undefined : "Pick the bulk batch first"}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition select-none",
                    !picked
                      ? "cursor-not-allowed border-dashed border-line-strong text-ink-6"
                      : withLot
                        ? "cursor-pointer border-brand-line bg-brand-tint text-brand-deep"
                        : "cursor-pointer border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={pairing}
                    disabled={!picked || busy}
                    onChange={(e) => setWithLot(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <Package className="size-3.5" aria-hidden />
                      Also add a finished lot from this bulk
                    </span>
                    <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                      {picked
                        ? "Both batches are checked together and added in one go, the lot already drawing on this bulk."
                        : "Pick the bulk batch above first."}
                    </span>
                  </span>
                </label>
              )}

              {pairing && (
                <TypeSection
                  icon={Package}
                  title={`Finished lot from ${picked?.batch_no ?? "this bulk"}`}
                  tone="border-brand-line bg-brand-tint"
                >
                  <div className="grid gap-3 @3xl:grid-cols-4">
                    <Field
                      label="Lot batch"
                      htmlFor="nb-lot-product"
                      error={lotErrors.productId?.message}
                      className="@3xl:col-span-2"
                    >
                      <Controller
                        name="productId"
                        control={lotForm.control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-lot-product"
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            ariaInvalid={Boolean(lotErrors.productId)}
                            placeholder="Select the lot's batch…"
                            searchPlaceholder="Batch number, code or product…"
                            emptyMessage="No batch matches that."
                            options={available
                              .filter((p) => p.id !== productId)
                              .map((product) => ({
                                value: product.id,
                                label: `${product.batch_no} — ${product.name}`,
                                meta:
                                  product.code || product.work_order || undefined,
                              }))}
                          />
                        )}
                      />
                    </Field>
                    <Field
                      label="Pack size"
                      note="units per container"
                      htmlFor="nb-lot-pack-size"
                      error={lotErrors.packSize?.message}
                    >
                      <input
                        id="nb-lot-pack-size"
                        type="number"
                        step="any"
                        min={0}
                        placeholder="e.g. 60"
                        aria-invalid={Boolean(lotErrors.packSize)}
                        className={cn(FIELD, MONO)}
                        {...lotForm.register("packSize", { valueAsNumber: true })}
                      />
                    </Field>
                    <Field
                      label="Pack unit"
                      htmlFor="nb-lot-pack-unit"
                      error={lotErrors.packUnit?.message}
                    >
                      <Controller
                        name="packUnit"
                        control={lotForm.control}
                        render={({ field }) => (
                          <SelectField
                            className={CONTROL}
                            id="nb-lot-pack-unit"
                            value={field.value ?? ""}
                            onChange={(v) => {
                              field.onChange(v);
                              rerouteLot(v);
                            }}
                            onBlur={field.onBlur}
                            ariaInvalid={Boolean(lotErrors.packUnit)}
                            clearable
                            options={PACK_UNITS.map((unit) => ({
                              value: unit,
                              label: unit,
                            }))}
                          />
                        )}
                      />
                    </Field>
                  </div>

                  {lotPicked && (
                    <Summary className="mt-3 border-transparent bg-surface @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <Stat label="Product" value={lotPicked.name} />
                      <Stat
                        label="Containers to fill"
                        value={
                          lotPicked.required_qty
                            ? fmt(lotPicked.required_qty)
                            : "Not set"
                        }
                        mono
                      />
                      <Stat
                        label="Due date"
                        value={
                          lotPicked.due_date
                            ? longDay(lotPicked.due_date)
                            : "None in Products"
                        }
                        icon={CalendarDays}
                        title="Set on the batch in Products"
                      />
                    </Summary>
                  )}
                  {lotPicked && !lotPicked.required_qty && (
                    <p className="mt-2 rounded-xl border border-warn-line bg-warn-tint px-3 py-2 text-[11px] text-warn-ink">
                      Batch {lotPicked.batch_no} has no required quantity. Set
                      it in Products, or this lot counts as nothing against its
                      bulk.
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 @3xl:grid-cols-4">
                    <Field
                      label="Market"
                      optional
                      htmlFor="nb-lot-market"
                      error={lotErrors.market?.message}
                    >
                      <input
                        id="nb-lot-market"
                        placeholder="AU, NZ, UK…"
                        className={FIELD}
                        {...lotForm.register("market")}
                      />
                    </Field>
                    <Field
                      label="Bulk qty received"
                      note="if different"
                      optional
                      htmlFor="nb-lot-bulk-received"
                      error={lotErrors.bulkQtyReceived?.message}
                    >
                      <input
                        id="nb-lot-bulk-received"
                        type="number"
                        step="any"
                        min={0}
                        placeholder={lotNeeded ? String(lotNeeded) : "e.g. 60000"}
                        className={cn(FIELD, MONO)}
                        {...lotForm.register("bulkQtyReceived", {
                          valueAsNumber: true,
                        })}
                      />
                    </Field>
                    {/* Only where the company tracks one work order per batch
                        (Admin → Company) — the lot has a work order of its own,
                        just as the bulk above does. */}
                    {perBatchWo && (
                      <Field
                        label="Work order"
                        note="saved on the lot's batch"
                        optional
                        htmlFor="nb-lot-wo"
                        error={lotErrors.workOrder?.message}
                      >
                        <input
                          id="nb-lot-wo"
                          placeholder={
                            lotPicked
                              ? `Same as ${lotPicked.batch_no}`
                              : "e.g. 46001"
                          }
                          autoComplete="off"
                          className={cn(FIELD, MONO)}
                          {...lotForm.register("workOrder")}
                        />
                      </Field>
                    )}
                  </div>

                  {/* The arithmetic said out loud against the bulk beside it —
                      advisory, as in Batch families: over is badged, never
                      refused. */}
                  {lotNeeded !== null && (
                    <p
                      className={cn(
                        "mt-3 rounded-xl px-3 py-2 text-xs",
                        bulkAllowance !== null && lotNeeded > bulkAllowance
                          ? "bg-warn-tint text-warn-ink ring-1 ring-warn-line"
                          : "bg-surface text-ink-3",
                      )}
                    >
                      Bulk needed:{" "}
                      <strong className="font-mono font-semibold text-brand">
                        {fmt(lotNeeded)}
                      </strong>
                      {bulkAllowance !== null && (
                        <>
                          {" "}
                          of {picked?.batch_no}&rsquo;s {fmt(bulkAllowance)}{" "}
                          {bulkUnit || "units"}
                          {lotNeeded > bulkAllowance &&
                            ` — ${fmt(lotNeeded - bulkAllowance)} more than the bulk makes`}
                        </>
                      )}
                    </p>
                  )}

                  <p className="mt-3 text-[11px] text-ink-5">
                    Takes the bulk&rsquo;s priority; its due date is its own,
                    from Products.
                  </p>

                  {/* The lot's own route — filling, labelling, packing — on
                      a plan of its own, issued on its own tick. */}
                  <div className="mt-4 border-t border-brand-line/60 pt-4">
                    <StagePlanEditor
                      form={lotPlan}
                      idPrefix="nb-lot-plan"
                      processes={plannable}
                      rooms={rooms}
                      showWorkOrder={workOrderMode === "stage"}
                      defaultUnit={lotUnit}
                      orderLabel={lotOrder}
                      disabled={busy}
                    />
                  </div>
                </TypeSection>
              )}

              {/* Last — the one field nobody has to fill in. */}
              <Field
                label="Notes"
                optional
                htmlFor="nb-notes"
                error={errors.notes?.message}
              >
                <input
                  id="nb-notes"
                  placeholder="Materials ready, setup scheduled…"
                  className={FIELD}
                  {...register("notes")}
                />
              </Field>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="h-10 rounded-xl px-4 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {pairing ? "Add both to pipeline" : "Add to pipeline"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function emptyValues(factoryId: string): NewBatchValues {
  return {
    // "" is the unpicked state the select submits; zod refuses it, which is
    // what makes "pick a batch" an error on the control rather than a silent
    // insert of nothing.
    factoryId,
    batchType: "combined",
    productId: "",
    priority: "medium",
    dueDate: "",
    notes: "",
    bulkUnit: "",
    overagePct: undefined,
    tolerancePct: undefined,
    parentJobId: "",
    packSize: undefined,
    packUnit: "",
    bulkQtyReceived: undefined,
    market: "",
    workOrder: "",
  };
}

function emptyLot(): PairedLotValues {
  return {
    productId: "",
    packSize: undefined,
    packUnit: "",
    market: "",
    bulkQtyReceived: undefined,
    workOrder: "",
  };
}

/** The tinted block a batch type's own fields live in. */
function TypeSection({
  icon: Icon,
  title,
  tone,
  info,
  children,
}: {
  icon: typeof Package;
  title: string;
  tone: string;
  /** What the section is for — folded behind an (i) rather than printed. */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border p-3.5", tone)}>
      <p className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.04em] text-ink-2 uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
        {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
      </p>
      {children}
    </section>
  );
}

function Field({
  label,
  note,
  optional,
  info,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  note?: string;
  optional?: boolean;
  /** Folded behind an (i) beside the label. */
  info?: React.ReactNode;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    /* A full-height column with the control pushed to the bottom, so a label
       that wraps to two lines — "Pack size (units per container)" at three
       across — does not push its input a line lower than its neighbours'.
       Aligning on the label instead would only work while every label in the
       row happened to be the same length. */
    <div className={cn("flex h-full flex-col gap-1", className)}>
      <div className="flex items-center gap-1">
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
        {optional && (
          <span className="ml-1 text-[10px] font-normal normal-case text-ink-6">
            optional
          </span>
        )}
        {note && (
          <span className="ml-1 text-[10px] font-normal normal-case text-ink-6">
            ({note})
          </span>
        )}
      </label>
      {info && (
        <InfoTip label={`About ${label.toLowerCase()}`} className="size-4">
          {info}
        </InfoTip>
      )}
      </div>
      <div className="mt-auto">{children}</div>
      {error && (
        <p role="alert" className="text-[11px] text-danger-deep">
          {error}
        </p>
      )}
    </div>
  );
}

/** The read-back strip: what the catalogue already says about a batch. */
function Summary({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-brand-soft bg-brand-tint px-3.5 py-2.5",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** One figure of a `Summary`: a small label over its value. */
function Stat({
  label,
  value,
  mono,
  icon: Icon,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: typeof Package;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-[0.04em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd
        title={title ?? value}
        className={cn(
          "mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink",
          mono && "font-mono text-[12px]",
        )}
      >
        {Icon && <Icon className="size-3.5 shrink-0 text-ink-5" aria-hidden />}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}
