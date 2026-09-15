"use client";

import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  STAGE_UNITS,
  stageEditSchema,
  type StageEditParsed,
  type StageEditValues,
} from "@/app/factory/[slug]/pipeline/schemas";
import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import {
  stageCeiling,
  stageName,
  updateBatchStage,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";
const MONO = "font-mono tracking-tight";
const LABEL = "text-[10px] font-semibold tracking-[0.03em] text-ink-5 uppercase";

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Schedule → a card, opened.
 *
 * One stage, all of it, in the form a planner working a room queue needs:
 * where it runs, when it starts, when they expect it off, what it owes, and
 * what to tell whoever reads the queue next. The plan dialog edits the same
 * row three fields at a time inline, which is right for laying out a route and
 * wrong for "Room 4, Tuesday, why".
 *
 * Two things on screen are read-only on purpose. The **activity** is what the
 * stage *is* — changing it would re-point every shift-log entry already filed
 * against it at a different process — and the **accumulated total** comes from
 * the shift log, so it is a fact about logged work rather than a field.
 */
export function StageEditDialog({
  stage,
  job,
  factoryId,
  canManage,
  showWorkOrder = false,
  onSaved,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that stage. */
  stage: BatchStage | null;
  job: PipelineJob | undefined;
  factoryId: string;
  canManage: boolean;
  /**
   * Admin → Company tracks a work order per stage (0043). Hidden otherwise —
   * but still loaded and saved back, so a number already on file survives.
   */
  showWorkOrder?: boolean;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const rooms = useMemo(() => unitList.filter((u) => u.active), [unitList]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StageEditValues, unknown, StageEditParsed>({
    resolver: zodResolver(stageEditSchema),
  });

  /**
   * Refill the form whenever a different card is opened.
   *
   * `defaultValues` is read once, when the form mounts, and this dialog is
   * mounted for the life of the Schedule — so without this the second card
   * anybody opens shows the first one's numbers.
   */
  useEffect(() => {
    if (!stage) return;
    reset({
      unitId: stage.unit_id ?? "",
      plannedDate: stage.planned_date ?? "",
      estFinishDate: stage.est_finish_date ?? "",
      canRunParallel: stage.can_run_parallel,
      targetQty: stage.target_qty ?? undefined,
      targetUnit: (stage.target_unit as StageEditValues["targetUnit"]) ?? "units",
      label: stage.label ?? "",
      workOrder: stage.work_order ?? "",
      packSize: stage.pack_size ?? undefined,
      planningNote: stage.planning_note ?? "",
    });
  }, [stage, reset]);

  const save = useMutation({
    mutationFn: (values: StageEditParsed) =>
      updateBatchStage(stage!.id, {
        unit_id: values.unitId || null,
        planned_date: values.plannedDate || null,
        est_finish_date: values.estFinishDate || null,
        can_run_parallel: values.canRunParallel ?? false,
        target_qty: values.targetQty ?? null,
        target_unit: values.targetUnit,
        label: values.label?.trim() || null,
        work_order: values.workOrder?.trim() || null,
        pack_size: values.packSize ?? null,
        planning_note: values.planningNote?.trim() || null,
        // `tolerance_pct` is not written here for the same reason the plan
        // dialog does not write it: the tolerance is decided once, on the
        // batch, and inherited. A queue that can pin one stage's ceiling is a
        // queue where the number the shift log enforces stops being readable
        // off the card.
      }),
    onSuccess: async () => {
      await onSaved();
      toast.success(`${stageName(stage!)} updated.`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const done = stage?.status === "complete";
  const ceiling = stage ? stageCeiling(stage) : null;
  // `useWatch`, not `watch()` — the latter returns a fresh function on every
  // render, which the React Compiler cannot memoize past. Same choice as
  // `kaizen-form` and `action-stage-form`.
  const plannedDate = useWatch({ control, name: "plannedDate" });

  const firstError =
    errors.targetUnit?.message ??
    errors.estFinishDate?.message ??
    errors.targetQty?.message ??
    errors.label?.message ??
    errors.planningNote?.message;

  return (
    <Dialog open={stage !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-ink">
            {stage ? stageName(stage) : "Stage"}
            {job && <BatchTypeBadge type={job.batch_type} />}
          </DialogTitle>
          <DialogDescription className="break-words">
            <span className={cn(MONO, "font-semibold text-brand")}>
              {job?.batch_no ?? "—"}
            </span>
            {job?.product_name ? ` · ${job.product_name}` : ""}
            {job?.product_code ? ` · ${job.product_code}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* What the shift log has already put against this stage. A fact, not
            a field — `batch_stage_accumulate` keeps it equal to the good units
            logged, and a box here would be a second source of truth for it. */}
        {stage && (
          <div className="shrink-0 border-b border-line bg-sunken px-5 py-3 text-xs text-ink-4">
            <span className="font-semibold text-ink-3">
              {fmt(stage.accumulated_qty)}
            </span>{" "}
            {stage.target_unit} logged
            {stage.target_qty ? ` of ${fmt(stage.target_qty)}` : ""}
            {ceiling !== null && stage.effective_tolerance_pct > 0
              ? ` · accepts up to ${fmt(ceiling)} (+${stage.effective_tolerance_pct}%)`
              : ""}
            {stage.is_final ? " · completes the order" : ""}
          </div>
        )}

        <form
          onSubmit={handleSubmit((values) => save.mutateAsync(values))}
          className="scrollbar-slim min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
        >
          {done && (
            <p className="rounded-xl border border-teal-line bg-teal-soft px-3.5 py-2.5 text-xs text-teal-deep">
              This stage has been signed off. Its target and yield are part of
              that record and the database will refuse a change to either.
            </p>
          )}
          {!canManage && (
            <p className="rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-xs text-ink-4">
              Read-only — a manager schedules stages.
            </p>
          )}

          <fieldset disabled={!canManage || done} className="space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="se-room" className={LABEL}>
                  Room
                </label>
                <Controller
                  name="unitId"
                  control={control}
                  render={({ field }) => (
                    <SelectField
                      id="se-room"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      clearable
                      clearLabel="Not assigned yet"
                      placeholder="Not assigned yet"
                      options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  )}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="se-target" className={LABEL}>
                  Target
                </label>
                <div className="flex gap-2">
                  <input
                    id="se-target"
                    type="number"
                    step="any"
                    min={0}
                    placeholder="e.g. 210000"
                    className={cn(FIELD, MONO, "flex-1")}
                    {...register("targetQty", { valueAsNumber: true })}
                  />
                  <Controller
                    name="targetUnit"
                    control={control}
                    render={({ field }) => (
                      <SelectField
                        ariaLabel="Target unit"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        options={STAGE_UNITS.map((u) => ({ value: u, label: u }))}
                        className="w-32"
                      />
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="se-planned" className={LABEL}>
                  Planned date
                </label>
                <Controller
                  name="plannedDate"
                  control={control}
                  render={({ field }) => (
                    <DateField
                      id="se-planned"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="Not scheduled"
                    />
                  )}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="se-finish" className={LABEL}>
                  Est. finish
                </label>
                <Controller
                  name="estFinishDate"
                  control={control}
                  render={({ field }) => (
                    <DateField
                      id="se-finish"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      // Not enforced, only suggested: the picker opening on the
                      // start date is a hint, and a planner who needs to say
                      // otherwise is refused by the schema, where the message
                      // can name both fields.
                      min={plannedDate || undefined}
                      placeholder="No estimate"
                    />
                  )}
                />
              </div>
            </div>

            <div
              className={cn(
                "grid gap-2.5",
                showWorkOrder ? "sm:grid-cols-3" : "sm:grid-cols-2",
              )}
            >
              <div className="space-y-1">
                <label htmlFor="se-label" className={LABEL}>
                  Label
                </label>
                <input
                  id="se-label"
                  placeholder="e.g. 30's"
                  className={FIELD}
                  {...register("label")}
                />
              </div>
              {showWorkOrder && (
                <div className="space-y-1">
                  <label htmlFor="se-wo" className={LABEL}>
                    Work order
                  </label>
                  <input
                    id="se-wo"
                    placeholder="e.g. 46000D"
                    className={cn(FIELD, MONO)}
                    {...register("workOrder")}
                  />
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="se-pack" className={LABEL}>
                  Pack size
                </label>
                <input
                  id="se-pack"
                  type="number"
                  step="any"
                  min={0}
                  placeholder="e.g. 30"
                  className={cn(FIELD, MONO)}
                  {...register("packSize", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="se-note" className={LABEL}>
                Planning comment
              </label>
              <textarea
                id="se-note"
                rows={2}
                placeholder="Waiting on the 60's tooling…"
                className={cn(FIELD, "h-auto py-2 leading-relaxed")}
                {...register("planningNote")}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-3">
              <input
                type="checkbox"
                className="size-3.5 cursor-pointer rounded border-ink-6 accent-brand"
                {...register("canRunParallel")}
              />
              Can run in parallel with the stage before it
            </label>
          </fieldset>

          {firstError && (
            <p role="alert" className="text-[11px] text-danger-deep">
              {firstError}
            </p>
          )}
        </form>

        {canManage && !done && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-3 transition hover:border-ink-6 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit((values) => save.mutateAsync(values))}
              disabled={isSubmitting || save.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {isSubmitting || save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Save stage
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
