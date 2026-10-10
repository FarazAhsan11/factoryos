"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Cog,
  Flag,
  Loader2,
  Play,
  Plus,
  Rocket,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  STAGE_UNITS,
  stageEditSchema,
  stageSchema,
  type StageParsed,
  type StageUnit,
  type StageValues,
} from "@/app/factory/[slug]/pipeline/schemas";
import {
  CONTROL,
  Cell,
  ColumnHeads,
  HEAD,
  INPUT,
  ROW_COLS,
  ROW_COLS_WO,
  RoutePills,
} from "@/components/factory/pipeline/stage-table-parts";
import { StageSignOffDialog } from "@/components/factory/pipeline/stage-signoff-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activateStage,
  batchStageKeys,
  createBatchStage,
  deleteBatchStage,
  fetchBatchStages,
  issueJob,
  stageIsNext,
  stageName,
  stageCeiling,
  stageProgress,
  stagesWithoutTarget,
  swapStageOrder,
  updateBatchStage,
  type BatchStage,
  plannedOverOrder,
} from "@/lib/factory/batch-stage-queries";
import { SelectField } from "@/components/ui/select-field";
import { DateField } from "@/components/ui/date-picker";
import { formatReportDate } from "@/lib/factory/shift-report-queries";
import { pipelineKeys, type PipelineJob } from "@/lib/factory/pipeline-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const MONO = "font-mono tracking-tight";

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** What a row holds while it is being edited — strings, as the fields are. */
interface RowDraft {
  unitId: string;
  plannedDate: string;
  estFinishDate: string;
  targetQty: string;
  targetUnit: StageUnit;
  workOrder: string;
  label: string;
  canRunParallel: boolean;
}

function asUnit(unit: string | null | undefined): StageUnit {
  return (STAGE_UNITS as readonly string[]).includes(unit ?? "")
    ? (unit as StageUnit)
    : "units";
}

/** A stage as the row's fields hold it — what "unchanged" is measured against. */
function draftOf(stage: BatchStage): RowDraft {
  return {
    unitId: stage.unit_id ?? "",
    plannedDate: stage.planned_date ?? "",
    estFinishDate: stage.est_finish_date ?? "",
    targetQty: stage.target_qty ? String(stage.target_qty) : "",
    targetUnit: asUnit(stage.target_unit),
    workOrder: stage.work_order ?? "",
    label: stage.label ?? "",
    canRunParallel: stage.can_run_parallel,
  };
}

function changedKeys(draft: RowDraft, stage: BatchStage): (keyof RowDraft)[] {
  const base = draftOf(stage);
  return (Object.keys(draft) as (keyof RowDraft)[]).filter(
    (key) => draft[key] !== base[key],
  );
}

/**
 * Pipeline → Plan stages.
 *
 * The route one batch will run, and the gate that lets it run at all. Every
 * stage that produces something is planned here with a target; the batch is
 * then **issued**, and only then does the shift log accept producing entries
 * against it (migration 0033). Downtime is never planned and never blocked.
 *
 * Drawn the way New batch draws a plan — the route as pills, then one editable
 * line per stage under a single header row — so the two read as one screen
 * rather than a form and its after-the-fact cousin. The difference is that
 * these rows are saved ones: a row is edited in place and kept with **Save**
 * (dates and room are often changed together, and the finish must not be
 * checked against a start that is half-edited), and the batch cannot be issued
 * while a row holds unsaved changes, since issuing reads what is stored.
 *
 * Two things on screen are derived and never typed. The **last stage carries
 * the flag, "Completes the order"** — reorder the plan and it moves — and each
 * stage's accumulated total comes from the shift log, so progress is a fact
 * about logged work rather than a second number to keep up to date.
 */
export function PlanStagesDialog({
  job,
  factoryId,
  canManage,
  showWorkOrder = false,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that batch. */
  job: PipelineJob | null;
  factoryId: string;
  canManage: boolean;
  /** Admin → Company tracks a work order per stage (0043). */
  showWorkOrder?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [signOff, setSignOff] = useState<BatchStage | null>(null);
  /** Rows with edits not yet saved, by stage id. */
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  /** What saving a row said was wrong with it, by stage id. */
  const [rowErrors, setRowErrors] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState(false);

  const { data: stages = [], isPending } = useQuery({
    queryKey: batchStageKeys.job(factoryId, job?.id ?? ""),
    queryFn: () => fetchBatchStages(job!.id),
    enabled: Boolean(job),
  });

  const { data: processList = [] } = useQuery({
    queryKey: setupKeys.all("factory_processes", factoryId),
    queryFn: () => fetchSetupItems("factory_processes", factoryId),
  });
  const { data: unitList = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });
  const rooms = useMemo(() => unitList.filter((u) => u.active), [unitList]);

  /**
   * Only stages that produce something. Downtime is logged when it happens,
   * against any batch — planning one would create a row that can never reach
   * a target and would sit in the plan blocking the batch for ever. The
   * database refuses it too; offering it here would be a control that fails.
   */
  const plannable = useMemo(
    () => processList.filter((p) => p.active && p.category !== "downtime"),
    [processList],
  );

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: batchStageKeys.job(factoryId, job?.id ?? ""),
      }),
      // The plan decides completion and what the card's strip shows, so the
      // board is stale the moment a stage changes.
      queryClient.invalidateQueries({ queryKey: pipelineKeys.all(factoryId) }),
    ]);
  }

  const add = useMutation({
    mutationFn: (values: StageParsed) =>
      createBatchStage(factoryId, job!.id, values),
    onSuccess: async (stage) => {
      await refresh();
      toast.success(`${stageName(stage)} added to the plan.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Parameters<typeof updateBatchStage>[1];
    }) => updateBatchStage(id, values),
    onSuccess: async (_d, { id }) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setRowErrors((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Does this plan set out to make more than was ordered?
   *
   * Said here because here is the only place the two numbers meet. Warned,
   * never blocked — a plant does sometimes plan extra on purpose, and the
   * declared overage is already subtracted before anything is said.
   */
  const overOrder = useMemo(
    () => plannedOverOrder(stages, job?.required_qty, job?.overage_pct),
    [stages, job?.required_qty, job?.overage_pct],
  );

  const move = useMutation({
    mutationFn: ({ a, b }: { a: BatchStage; b: BatchStage }) =>
      swapStageOrder(a, b),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (stage: BatchStage) => deleteBatchStage(stage.id),
    onSuccess: async (_d, stage) => {
      await refresh();
      toast.success(`${stageName(stage)} removed from the plan.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const start = useMutation({
    mutationFn: (stage: BatchStage) => activateStage(stage.id),
    onSuccess: async (_d, stage) => {
      await refresh();
      toast.success(`${stageName(stage)} started — operators can log against it.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: () => issueJob(job!.id),
    onSuccess: async () => {
      // Read the number before closing — `job` is gone once the parent clears it.
      const batchNo = job?.batch_no;
      await refresh();
      toast.success(`Batch ${batchNo} issued for production.`);
      // Issuing is the last thing anyone does on this dialog: the plan is
      // fixed, the batch is on the floor, and leaving the form open invites
      // an edit that the issued gate will only refuse.
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function close() {
    setDrafts({});
    setRowErrors({});
    setAdding(false);
    onClose();
  }

  /** The row as it is on screen: its unsaved edits, else what is stored. */
  const valueOf = (stage: BatchStage) => drafts[stage.id] ?? draftOf(stage);
  const dirty = stages.filter((s) => {
    const draft = drafts[s.id];
    return draft ? changedKeys(draft, s).length > 0 : false;
  });

  function edit<K extends keyof RowDraft>(
    stage: BatchStage,
    key: K,
    value: RowDraft[K],
  ) {
    setDrafts((current) => ({
      ...current,
      [stage.id]: { ...(current[stage.id] ?? draftOf(stage)), [key]: value },
    }));
    setRowErrors((current) => {
      if (!current[stage.id]) return current;
      const next = { ...current };
      delete next[stage.id];
      return next;
    });
  }

  function discard(stage: BatchStage) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[stage.id];
      return next;
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[stage.id];
      return next;
    });
  }

  /**
   * Checks one row against the same rules as the schedule's stage edit, then
   * writes only what changed — so saving a room never touches a label, whose
   * uniqueness is the database's to enforce.
   */
  async function save(stage: BatchStage) {
    const draft = drafts[stage.id];
    if (!draft) return;
    const keys = changedKeys(draft, stage);
    if (keys.length === 0) return;

    const base = draftOf(stage);
    const target = draft.targetQty.trim() === "" ? undefined : Number(draft.targetQty);
    const problems: string[] = [];
    // A planned target is not cleared by emptying the field — that would read
    // as "no target" and quietly un-plan the stage.
    if (base.targetQty !== "" && draft.targetQty.trim() === "") {
      problems.push("Enter a target above zero.");
    }
    const parsed = stageEditSchema.safeParse({
      unitId: draft.unitId,
      plannedDate: draft.plannedDate,
      estFinishDate: draft.estFinishDate,
      canRunParallel: draft.canRunParallel,
      targetQty: target,
      targetUnit: draft.targetUnit,
      label: draft.label,
      workOrder: draft.workOrder,
    });
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((i) => i.message));
    }
    if (problems.length > 0 || !parsed.success) {
      setRowErrors((current) => ({ ...current, [stage.id]: problems }));
      return;
    }

    const v = parsed.data;
    const values: Parameters<typeof updateBatchStage>[1] = {};
    if (keys.includes("unitId")) values.unit_id = v.unitId || null;
    if (keys.includes("plannedDate")) values.planned_date = v.plannedDate || null;
    if (keys.includes("estFinishDate"))
      values.est_finish_date = v.estFinishDate || null;
    if (keys.includes("targetQty")) values.target_qty = v.targetQty ?? null;
    if (keys.includes("targetUnit")) values.target_unit = v.targetUnit;
    if (keys.includes("workOrder")) values.work_order = v.workOrder?.trim() || null;
    if (keys.includes("label")) values.label = v.label?.trim() || null;
    if (keys.includes("canRunParallel"))
      values.can_run_parallel = v.canRunParallel ?? false;
    // `tolerance_pct` is deliberately never written here. The tolerance is
    // decided once, on the batch, and every stage inherits it — a plan whose
    // stages each carry their own ceiling is a plan nobody can read off the
    // card. The column stays (null = inherit) for a plant that pins one stage
    // by hand in SQL; the app never sets it.
    await patch.mutateAsync({ id: stage.id, values }).catch(() => undefined);
  }

  async function saveAll() {
    for (const stage of dirty) await save(stage);
  }

  const missing = stagesWithoutTarget(stages);
  const issued = Boolean(job?.issued_at);
  const saving = patch.isPending;
  /** Which activities run twice — those rows get a label field. */
  const repeated = new Set(
    stages
      .map((s) => s.process_id)
      .filter((id, i, all) => all.indexOf(id) !== i),
  );

  return (
    <>
      <Dialog
        open={job !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[min(62rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="text-ink">
              Plan stages — {job?.batch_no}
            </DialogTitle>
            <DialogDescription className="break-words">
              {job?.product_name}
              {job?.required_qty ? ` · ${fmt(job.required_qty)} required` : ""}
            </DialogDescription>
          </DialogHeader>

          {/* The gate, said before it is hit rather than as a refusal. */}
          <div
            className={cn(
              "mx-5 mt-4 shrink-0 rounded-xl border px-3.5 py-3 text-xs",
              issued
                ? "border-teal-line bg-teal-soft text-teal-deep"
                : "border-warn-line bg-warn-tint text-warn-ink",
            )}
          >
            {issued ? (
              <p>
                <strong className="font-semibold">Issued for production.</strong>{" "}
                Operators can log against this batch. The plan stays editable —
                targets can be corrected, stages added — but a target can no
                longer be cleared.
              </p>
            ) : (
              <p>
                <strong className="font-semibold">Not issued yet.</strong>{" "}
                {stages.length === 0
                  ? "Add every stage that produces something, give each a target, then issue the batch."
                  : missing.length > 0
                    ? `${missing.length} stage${missing.length === 1 ? " still needs" : "s still need"} a target: ${missing.map(stageName).join(", ")}.`
                    : "Every stage has a target — this batch is ready to issue."}{" "}
                Producing entries are refused until it is; downtime is always
                allowed.
              </p>
            )}
          </div>

          {/* The plan aims past the order. Not a refusal: the number that
              matters is on screen, and whoever set it can decide whether the
              order quantity is stale or a target is wrong. */}
          {overOrder && overOrder.over > 0 && (
            <p className="mx-5 mt-2.5 shrink-0 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
              <strong className="font-semibold">
                This plan makes {fmt(overOrder.planned)} against an order of{" "}
                {fmt(Number(job?.required_qty ?? 0))}
                {Number(job?.overage_pct ?? 0) > 0
                  ? ` (+${job?.overage_pct}% = ${fmt(overOrder.allowed)} allowed)`
                  : ""}
                .
              </strong>{" "}
              {fmt(overOrder.over)} more than permitted. Correct a stage target,
              or raise the required quantity in Products
              if the order really is larger.
            </p>
          )}

          <div className="scrollbar-slim @container min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {isPending ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-5">
                <Loader2 className="size-4 animate-spin" />
                Loading the plan…
              </p>
            ) : (
              <>
                {stages.length > 0 && (
                  <RoutePills
                    steps={stages.map((stage) => ({
                      key: stage.id,
                      name: stage.process_name ?? "Stage",
                      runLabel:
                        stage.label?.trim() || stage.work_order?.trim() || undefined,
                      error: Boolean(rowErrors[stage.id]),
                    }))}
                  />
                )}

                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  {stages.length > 0 && (
                    <ColumnHeads
                      showWorkOrder={showWorkOrder}
                      trailing="w-8"
                    />
                  )}

                  {stages.length === 0 && !canManage && (
                    <p className="px-4 py-10 text-center text-sm text-ink-5">
                      No stages planned yet.
                    </p>
                  )}

                  <ol className="divide-y divide-line-soft">
                    {stages.map((stage, index) => (
                      <StageRow
                        key={stage.id}
                        stage={stage}
                        index={index}
                        isLast={index === stages.length - 1}
                        value={valueOf(stage)}
                        isDirty={dirty.some((d) => d.id === stage.id)}
                        problems={rowErrors[stage.id]}
                        canStart={stageIsNext(stages, index)}
                        canManage={canManage}
                        showWorkOrder={showWorkOrder}
                        needsLabel={
                          repeated.has(stage.process_id) ||
                          Boolean(valueOf(stage).label.trim())
                        }
                        rooms={rooms}
                        busy={saving}
                        onEdit={(key, value) => edit(stage, key, value)}
                        onSave={() => save(stage)}
                        onDiscard={() => discard(stage)}
                        onMoveUp={
                          index > 0
                            ? () => move.mutate({ a: stage, b: stages[index - 1] })
                            : undefined
                        }
                        onMoveDown={
                          index < stages.length - 1
                            ? () => move.mutate({ a: stage, b: stages[index + 1] })
                            : undefined
                        }
                        onStart={() => start.mutate(stage)}
                        onSignOff={() => setSignOff(stage)}
                        onRemove={() => remove.mutate(stage)}
                      />
                    ))}
                  </ol>

                  {canManage &&
                    (adding || stages.length === 0 ? (
                      <AddStageRow
                        processes={plannable}
                        rooms={rooms}
                        showWorkOrder={showWorkOrder}
                        first={stages.length === 0}
                        onAdd={async (values) => {
                          await add.mutateAsync(values);
                          setAdding(false);
                        }}
                        onCancel={
                          stages.length > 0 ? () => setAdding(false) : undefined
                        }
                      />
                    ) : (
                      <div className="border-t border-line-soft bg-sunken/60 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setAdding(true)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-ink-4 transition hover:bg-brand-tint hover:text-brand"
                        >
                          <Plus className="size-3.5" aria-hidden />
                          Add stage
                        </button>
                      </div>
                    ))}
                </div>

                <p className="text-[0.6875rem] text-ink-5">
                  Label or work order only where the batch runs an activity more
                  than once — Packing 30&rsquo;s, 60&rsquo;s, 120&rsquo;s. The
                  last stage completes the order. Room and dates are the
                  plan&rsquo;s intent — the shift log records where and when the
                  work actually happened, and does not have to agree.
                </p>
              </>
            )}
          </div>

          {canManage && (dirty.length > 0 || !issued) && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3.5">
              <p
                className={cn(
                  "text-[0.6875rem]",
                  dirty.length > 0 ? "font-medium text-warn-ink" : "text-ink-5",
                )}
              >
                {dirty.length > 0
                  ? `${dirty.length} stage${dirty.length === 1 ? " has" : "s have"} unsaved changes${issued ? "." : " — save before issuing."}`
                  : "Issuing releases the batch to the floor."}
              </p>
              <div className="flex items-center gap-2">
                {dirty.length > 0 && (
                  <button
                    type="button"
                    onClick={saveAll}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-2 transition hover:border-brand hover:text-brand disabled:opacity-60"
                  >
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    Save {dirty.length > 1 ? `all ${dirty.length} changes` : "changes"}
                  </button>
                )}
                {!issued && (
                  <button
                    type="button"
                    onClick={() => issue.mutate()}
                    disabled={
                      issue.isPending ||
                      stages.length === 0 ||
                      missing.length > 0 ||
                      dirty.length > 0
                    }
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                  >
                    {issue.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Rocket className="size-4" />
                    )}
                    Issue for production
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <StageSignOffDialog
        stage={signOff}
        onDone={async () => {
          setSignOff(null);
          await refresh();
        }}
        onClose={() => setSignOff(null)}
      />
    </>
  );
}

const STATUS_STYLE = {
  pending: { icon: Circle, tone: "text-ink-5", label: "Pending" },
  in_progress: { icon: Cog, tone: "text-brand", label: "In progress" },
  complete: { icon: CheckCircle2, tone: "text-teal", label: "Complete" },
} as const;

/**
 * One saved stage as an editable line — the same columns as New batch, with a
 * second line for what only a saved stage has: where it stands, its progress
 * against the target, and the things that can be done to it (start, sign off).
 */
function StageRow({
  stage,
  index,
  isLast,
  value,
  isDirty,
  problems,
  canStart,
  canManage,
  showWorkOrder,
  needsLabel,
  rooms,
  busy,
  onEdit,
  onSave,
  onDiscard,
  onMoveUp,
  onMoveDown,
  onStart,
  onSignOff,
  onRemove,
}: {
  stage: BatchStage;
  index: number;
  isLast: boolean;
  value: RowDraft;
  isDirty: boolean;
  problems?: string[];
  canStart: boolean;
  canManage: boolean;
  showWorkOrder: boolean;
  needsLabel: boolean;
  rooms: { id: string; name: string }[];
  busy: boolean;
  onEdit: <K extends keyof RowDraft>(key: K, value: RowDraft[K]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onStart: () => void;
  onSignOff: () => void;
  onRemove: () => void;
}) {
  const style = STATUS_STYLE[stage.status];
  const Icon = style.icon;
  const pct = stageProgress(stage);
  const ceiling = stageCeiling(stage);
  /**
   * Past what the shift log will accept against this stage.
   *
   * Not reachable by logging — the entry that would do it is refused — so
   * seeing this means the plan was tightened under entries already filed.
   * Which is exactly when it has to be visible: the bar would otherwise read
   * a contented 106%.
   */
  const over = stage.is_over_tolerance;
  const done = stage.status === "complete";
  const started = Boolean(stage.started_at) || Number(stage.accumulated_qty) > 0;
  const editable = canManage && !done;
  const id = `ps-${stage.id}`;

  return (
    <li
      className={cn(
        "flex gap-2.5 px-3 py-2.5",
        problems && problems.length > 0 && "bg-danger-soft/40",
        isDirty && !problems?.length && "bg-warn-tint/50",
        done && "bg-teal-soft/30",
      )}
    >
      {/* Position and order. The flag marks the stage that completes the
          order — derived from position, so it moves when the plan is
          reordered. */}
      <div className="flex shrink-0 flex-col items-center gap-1 pt-5 @3xl:h-9 @3xl:flex-row @3xl:gap-0.5 @3xl:pt-0">
        <span
          title={isLast ? "Completes the order" : `Stage ${index + 1}`}
          className={cn(
            "grid size-6 place-items-center rounded-md font-mono text-[0.6875rem] font-bold",
            isLast ? "bg-teal-soft text-teal-deep" : "bg-sunken-2 text-ink-4",
          )}
        >
          {isLast ? <Flag className="size-3" /> : index + 1}
        </span>
        {editable ? (
          <>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              aria-label="Move earlier"
              className="grid size-5 place-items-center rounded text-ink-5 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-25"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              aria-label="Move later"
              className="grid size-5 place-items-center rounded text-ink-5 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-25"
            >
              <ArrowDown className="size-3" />
            </button>
          </>
        ) : (
          <span className="w-[2.625rem] shrink-0" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div
          className={cn(
            "grid grid-cols-2 gap-2",
            showWorkOrder ? ROW_COLS_WO : ROW_COLS,
          )}
        >
          <Cell label="Activity" wide>
            <div
              title={stageName(stage)}
              className="flex h-9 items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 text-[0.8125rem] font-medium text-ink-2"
            >
              <Icon className={cn("size-3.5 shrink-0", style.tone)} aria-hidden />
              <span className="truncate">{stage.process_name ?? "Stage"}</span>
            </div>
          </Cell>
          <Cell label="Room" wide>
            <SelectField
              id={`${id}-room`}
              ariaLabel="Assigned room"
              value={value.unitId}
              onChange={(v) => onEdit("unitId", v)}
              disabled={!editable}
              clearable
              clearLabel="Not assigned"
              placeholder="Not assigned"
              className={CONTROL}
              options={rooms.map((r) => ({ value: r.id, label: r.name }))}
            />
          </Cell>
          {showWorkOrder && (
            <Cell label="Work order" wide>
              <input
                id={`${id}-wo`}
                value={value.workOrder}
                onChange={(e) => onEdit("workOrder", e.target.value)}
                placeholder="—"
                autoComplete="off"
                disabled={!editable}
                className={cn(INPUT, MONO)}
              />
            </Cell>
          )}
          <Cell label="Start">
            <DateField
              id={`${id}-start`}
              ariaLabel="Planned start"
              value={value.plannedDate}
              onChange={(v) => onEdit("plannedDate", v)}
              disabled={!editable}
              placeholder="—"
              className={CONTROL}
            />
          </Cell>
          <Cell label="End">
            <DateField
              id={`${id}-end`}
              ariaLabel="Estimated finish"
              value={value.estFinishDate}
              onChange={(v) => onEdit("estFinishDate", v)}
              disabled={!editable}
              ariaInvalid={Boolean(problems?.length)}
              placeholder="—"
              className={CONTROL}
            />
          </Cell>
          <Cell label="Target">
            <input
              id={`${id}-target`}
              type="number"
              step="any"
              min={0}
              value={value.targetQty}
              onChange={(e) => onEdit("targetQty", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isDirty) {
                  e.preventDefault();
                  onSave();
                }
              }}
              placeholder="—"
              disabled={!editable}
              className={cn(INPUT, MONO)}
            />
          </Cell>
          <Cell label="Unit">
            <SelectField
              id={`${id}-unit`}
              ariaLabel="Target unit"
              value={value.targetUnit}
              onChange={(v) => onEdit("targetUnit", asUnit(v))}
              disabled={!editable}
              searchable={false}
              className={CONTROL}
              options={STAGE_UNITS.map((u) => ({ value: u, label: u }))}
            />
          </Cell>
        </div>

        {/* The occasional answers, and what can be done to a saved stage. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {needsLabel && (
            <span className="flex items-center gap-2">
              <label htmlFor={`${id}-label`} className={HEAD}>
                Run label
              </label>
              <input
                id={`${id}-label`}
                value={value.label}
                onChange={(e) => onEdit("label", e.target.value)}
                placeholder="e.g. 30's"
                disabled={!editable}
                className={cn(INPUT, "h-8 w-36")}
              />
            </span>
          )}
          {index > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-[0.6875rem] text-ink-4">
              <input
                type="checkbox"
                checked={value.canRunParallel}
                onChange={(e) => onEdit("canRunParallel", e.target.checked)}
                disabled={!editable}
                className="size-3.5 accent-[var(--color-brand)]"
              />
              Can start before the previous stage finishes
            </label>
          )}

          <span className="text-[0.6875rem] text-ink-5">
            {style.label}
            {stage.planned_date && stage.is_behind_plan && (
              <span className="font-semibold text-warn-ink">
                {" "}
                · behind plan since {formatReportDate(stage.planned_date)}
              </span>
            )}
            {ceiling !== null && stage.effective_tolerance_pct > 0
              ? ` · accepts up to ${fmt(ceiling)} (+${stage.effective_tolerance_pct}%${
                  stage.tolerance_pct === null ? "" : ", this stage"
                })`
              : ""}
            {stage.pack_size ? ` · ${fmt(stage.pack_size)} per pack` : ""}
          </span>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            {canManage && stage.status === "pending" && canStart && !isDirty && (
              <SmallButton onClick={onStart}>
                <Play className="size-3" />
                Start
              </SmallButton>
            )}
            {canManage && stage.status === "in_progress" && !isDirty && (
              <SmallButton onClick={onSignOff} primary>
                <CheckCircle2 className="size-3" />
                Sign off
              </SmallButton>
            )}
            {isDirty && (
              <>
                <SmallButton onClick={onSave} primary disabled={busy}>
                  Save
                </SmallButton>
                <SmallButton onClick={onDiscard} disabled={busy}>
                  Discard
                </SmallButton>
              </>
            )}
          </span>
        </div>

        {pct !== null && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, pct)}%`,
                  background: over
                    ? "var(--color-danger)"
                    : pct >= 100
                      ? "var(--color-teal)"
                      : "var(--color-brand)",
                }}
              />
            </div>
            <p className="font-mono text-[0.6562rem] tabular-nums text-ink-4">
              {fmt(stage.accumulated_qty)} / {fmt(stage.target_qty)}{" "}
              {stage.target_unit}
              <span
                className="ml-1 font-semibold"
                style={{
                  color: over
                    ? "var(--color-danger)"
                    : pct >= 100
                      ? "var(--color-teal)"
                      : "var(--color-brand)",
                }}
              >
                {pct}%
              </span>
            </p>
            {over && ceiling !== null && (
              <p className="text-[0.6875rem] font-medium text-danger-deep">
                Past the {fmt(ceiling)} {stage.target_unit} this stage accepts.
                Entries already filed stay; raise this target, or the
                batch&rsquo;s tolerance, to make the plan agree with them.
              </p>
            )}
          </div>
        )}

        {done && (
          <p className="text-[0.6875rem] text-teal-deep">
            Signed off
            {stage.completed_by_name ? ` by ${stage.completed_by_name}` : ""}
            {stage.yield_pct !== null ? ` · yield ${stage.yield_pct}%` : ""}
            {stage.yield_acceptable === false ? " · yield not accepted" : ""}
            {stage.yield_notes ? ` · ${stage.yield_notes}` : ""}
          </p>
        )}

        {/* The target was changed after the fact. Shown because yield is
            accumulated ÷ target, and a lowered target flatters it. */}
        {stage.previous_target_qty !== null && (
          <p className="text-[0.6875rem] text-warn-ink">
            Target changed from {fmt(stage.previous_target_qty)}.
          </p>
        )}

        {problems && problems.length > 0 && (
          <p role="alert" className="text-[0.6875rem] text-danger-deep">
            {problems.join(" · ")}
          </p>
        )}
      </div>

      {/* Only while nothing has been logged against it: past that the stage
          is the heading over audit-protected rows, and the database refuses
          the delete anyway. */}
      {editable && !started ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove stage ${index + 1}`}
          className="mt-5 grid size-8 shrink-0 place-items-center rounded-lg text-ink-6 transition hover:bg-danger-soft hover:text-danger-deep @3xl:mt-0.5"
        >
          <X className="size-4" />
        </button>
      ) : (
        <span className="size-8 shrink-0" aria-hidden />
      )}
    </li>
  );
}

/**
 * A new stage, written as one more line of the table — the same columns —
 * and appended to the end of the plan, where it becomes the stage that
 * completes the order.
 */
function AddStageRow({
  processes,
  rooms,
  showWorkOrder,
  first,
  onAdd,
  onCancel,
}: {
  processes: { id: string; name: string; category: string | null }[];
  rooms: { id: string; name: string }[];
  /** Only a company tracking work orders per stage is asked for one. */
  showWorkOrder: boolean;
  /** The plan is empty — the row is the whole of it, so it is not dismissable. */
  first: boolean;
  onAdd: (values: StageParsed) => Promise<void>;
  onCancel?: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StageValues, unknown, StageParsed>({
    resolver: zodResolver(stageSchema),
    defaultValues: {
      processId: "",
      unitId: "",
      plannedDate: "",
      estFinishDate: "",
      canRunParallel: false,
      targetQty: undefined,
      targetUnit: "units",
      label: "",
      workOrder: "",
      packSize: undefined,
    },
  });
  const [dateError, setDateError] = useState<string | null>(null);

  const firstError =
    dateError ??
    errors.processId?.message ??
    errors.plannedDate?.message ??
    errors.targetUnit?.message ??
    errors.targetQty?.message ??
    errors.label?.message;

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        // Checked here, not by the database — see `stageEditSchema`.
        if (
          values.plannedDate &&
          values.estFinishDate &&
          values.estFinishDate < values.plannedDate
        ) {
          setDateError("The finish is before the start.");
          return;
        }
        setDateError(null);
        await onAdd(values);
        reset();
      })}
      className={cn(
        "bg-sunken/60 px-3 py-3",
        !first && "border-t border-line-soft",
      )}
    >
      <p className="mb-2 flex items-center gap-1.5 text-[0.625rem] font-bold tracking-[0.05em] text-ink-4 uppercase">
        <Plus className="size-3" aria-hidden />
        {first ? "Add the first stage" : "Add the next stage"}
      </p>

      <div className="flex gap-2.5">
        <span className="hidden w-[68px] shrink-0 @3xl:block" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            className={cn(
              "grid grid-cols-2 gap-2",
              showWorkOrder ? ROW_COLS_WO : ROW_COLS,
            )}
          >
            <Cell label="Activity" wide>
              <Controller
                name="processId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="ps-add-process"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ariaInvalid={Boolean(errors.processId)}
                    placeholder="Pick the activity…"
                    searchPlaceholder="Activity name…"
                    emptyMessage="No activity matches that."
                    className={CONTROL}
                    options={processes.map((proc) => ({
                      value: proc.id,
                      label: proc.name,
                      meta: proc.category ?? undefined,
                    }))}
                  />
                )}
              />
            </Cell>
            <Cell label="Room" wide>
              <Controller
                name="unitId"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="ps-add-room"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    clearable
                    clearLabel="Not assigned"
                    placeholder="Not assigned"
                    className={CONTROL}
                    options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                  />
                )}
              />
            </Cell>
            {showWorkOrder && (
              <Cell label="Work order" wide>
                <input
                  id="ps-add-wo"
                  placeholder="e.g. 46000D"
                  autoComplete="off"
                  className={cn(INPUT, MONO)}
                  {...register("workOrder")}
                />
              </Cell>
            )}
            <Cell label="Start">
              <Controller
                name="plannedDate"
                control={control}
                render={({ field }) => (
                  <DateField
                    id="ps-add-start"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    ariaInvalid={Boolean(errors.plannedDate)}
                    placeholder="—"
                    className={CONTROL}
                  />
                )}
              />
            </Cell>
            <Cell label="End">
              <Controller
                name="estFinishDate"
                control={control}
                render={({ field }) => (
                  <DateField
                    id="ps-add-end"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    ariaInvalid={Boolean(dateError)}
                    placeholder="—"
                    className={CONTROL}
                  />
                )}
              />
            </Cell>
            <Cell label="Target">
              <input
                id="ps-add-target"
                type="number"
                step="any"
                min={0}
                placeholder="—"
                aria-invalid={Boolean(errors.targetQty) || undefined}
                className={cn(INPUT, MONO)}
                {...register("targetQty", { valueAsNumber: true })}
              />
            </Cell>
            <Cell label="Unit">
              <Controller
                name="targetUnit"
                control={control}
                render={({ field }) => (
                  <SelectField
                    id="ps-add-unit"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    searchable={false}
                    className={CONTROL}
                    options={STAGE_UNITS.map((u) => ({ value: u, label: u }))}
                  />
                )}
              />
            </Cell>
          </div>

          {/* Only needed when the batch runs the same activity more than once
              — three packing runs under one number. Left blank on the
              ordinary stage, where the activity name says everything. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <label htmlFor="ps-add-label" className={HEAD}>
                Run label
              </label>
              <input
                id="ps-add-label"
                placeholder="e.g. 30's"
                className={cn(INPUT, "h-8 w-36")}
                {...register("label")}
              />
            </span>
            <span className="flex items-center gap-2">
              <label htmlFor="ps-add-pack" className={HEAD}>
                Pack size
              </label>
              <input
                id="ps-add-pack"
                type="number"
                step="any"
                min={0}
                placeholder="e.g. 30"
                className={cn(INPUT, MONO, "h-8 w-28")}
                {...register("packSize", { valueAsNumber: true })}
              />
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-[0.6875rem] text-ink-4">
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--color-brand)]"
                {...register("canRunParallel")}
              />
              Can start before the previous stage finishes
            </label>
          </div>

          {firstError && (
            <p role="alert" className="text-[0.6875rem] text-danger-deep">
              {firstError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 @3xl:w-auto">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-xs font-semibold text-ink-4 transition hover:bg-sunken-2 hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function SmallButton({
  onClick,
  primary,
  disabled,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition disabled:opacity-60",
        primary
          ? "bg-brand text-white hover:brightness-[1.06]"
          : "border border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
