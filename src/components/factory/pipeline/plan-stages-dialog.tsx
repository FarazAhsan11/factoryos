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
  Loader2,
  Play,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  STAGE_UNITS,
  stageSchema,
  type StageParsed,
  type StageValues,
} from "@/app/factory/[slug]/pipeline/schemas";
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
import { pipelineKeys, type PipelineJob } from "@/lib/factory/pipeline-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";
const MONO = "font-mono tracking-tight";
const LABEL = "text-[10px] font-semibold tracking-[0.03em] text-ink-5 uppercase";

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Pipeline → Plan stages.
 *
 * The route one batch will run, and the gate that lets it run at all. Every
 * stage that produces something is planned here with a target; the batch is
 * then **issued**, and only then does the shift log accept producing entries
 * against it (migration 0033). Downtime is never planned and never blocked.
 *
 * Two things on screen are derived and never typed. The **last stage carries
 * "Completes the order"** — reorder the plan and the badge moves — and each
 * stage's accumulated total comes from the shift log, so progress is a fact
 * about logged work rather than a second number to keep up to date.
 */
export function PlanStagesDialog({
  job,
  factoryId,
  canManage,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that batch. */
  job: PipelineJob | null;
  factoryId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [signOff, setSignOff] = useState<BatchStage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");

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
      target,
      unitId,
      parallel,
    }: {
      id: string;
      target: number;
      unitId: string | null;
      parallel: boolean;
    }) =>
      updateBatchStage(id, {
        target_qty: target,
        unit_id: unitId,
        can_run_parallel: parallel,
        // `tolerance_pct` is deliberately not written here. The tolerance is
        // decided once, on the batch, and every stage inherits it — a plan
        // whose stages each carry their own ceiling is a plan nobody can read
        // off the card. The column stays (null = inherit) for a plant that
        // pins one stage by hand in SQL; the app never sets it.
      }),
    onSuccess: async () => {
      setEditing(null);
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

  /** The room being picked in the inline edit row, alongside the target. */
  const [editRoom, setEditRoom] = useState<string>("");
  /**
   * Whether the stage being edited may overlap the one before it.
   *
   * Editable after the fact, not only when the stage is added: a plan is
   * rewritten as a batch is scheduled, and the one route out of a wrong answer
   * used to be deleting the stage and re-adding it — impossible once anything
   * has been logged against it (`batch_stages_guard_delete`).
   */
  const [editParallel, setEditParallel] = useState(false);

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
      setEditing(null);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const missing = stagesWithoutTarget(stages);
  const issued = Boolean(job?.issued_at);

  return (
    <>
      <Dialog
        open={job !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            onClose();
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
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
              or raise the required quantity in Admin &amp; Settings → Products
              if the order really is larger.
            </p>
          )}

          <div className="scrollbar-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
            {isPending ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-5">
                <Loader2 className="size-4 animate-spin" />
                Loading the plan…
              </p>
            ) : stages.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-sm text-ink-5">
                No stages planned yet.
                <br />
                Add the first one below — Dispensing, Compression, Packing.
              </p>
            ) : (
              stages.map((stage, i) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  index={i}
                  canStart={stageIsNext(stages, i)}
                  canManage={canManage}
                  editing={editing === stage.id}
                  editQty={editQty}
                  onEditQty={setEditQty}
                  rooms={rooms}
                  editRoom={editRoom}
                  onEditRoom={setEditRoom}
                  editParallel={editParallel}
                  onEditParallel={setEditParallel}
                  onBeginEdit={() => {
                    setEditing(stage.id);
                    setEditQty(stage.target_qty ? String(stage.target_qty) : "");
                    setEditRoom(stage.unit_id ?? "");
                    setEditParallel(stage.can_run_parallel);
                  }}
                  onCancelEdit={() => setEditing(null)}
                  onSaveEdit={() => {
                    const value = Number(editQty);
                    if (!value || value <= 0) {
                      toast.error("Enter a target above zero.");
                      return;
                    }
                    patch.mutate({
                      id: stage.id,
                      target: value,
                      unitId: editRoom || null,
                      parallel: editParallel,
                    });
                  }}
                  onMoveUp={
                    i > 0
                      ? () => move.mutate({ a: stage, b: stages[i - 1] })
                      : undefined
                  }
                  onMoveDown={
                    i < stages.length - 1
                      ? () => move.mutate({ a: stage, b: stages[i + 1] })
                      : undefined
                  }
                  onStart={() => start.mutate(stage)}
                  onSignOff={() => setSignOff(stage)}
                  onRemove={() => remove.mutate(stage)}
                />
              ))
            )}

            {canManage && (
              <AddStageForm
                processes={plannable}
                rooms={rooms}
                onAdd={async (values) => {
                  await add.mutateAsync(values);
                }}
              />
            )}
          </div>

          {canManage && !issued && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3.5">
              <p className="text-[11px] text-ink-5">
                Issuing releases the batch to the floor.
              </p>
              <button
                type="button"
                onClick={() => issue.mutate()}
                disabled={
                  issue.isPending || stages.length === 0 || missing.length > 0
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

function StageRow({
  stage,
  index,
  canStart,
  canManage,
  editing,
  editQty,
  onEditQty,
  rooms,
  editRoom,
  onEditRoom,
  editParallel,
  onEditParallel,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onMoveUp,
  onMoveDown,
  onStart,
  onSignOff,
  onRemove,
}: {
  stage: BatchStage;
  index: number;
  canStart: boolean;
  canManage: boolean;
  editing: boolean;
  editQty: string;
  onEditQty: (v: string) => void;
  rooms: { id: string; name: string }[];
  editRoom: string;
  onEditRoom: (v: string) => void;
  editParallel: boolean;
  onEditParallel: (v: boolean) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
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

  return (
    <section
      className={cn(
        "rounded-xl border bg-surface p-3.5",
        done ? "border-teal-line/60" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-sunken-2 font-mono text-[11px] font-bold text-ink-4">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
              <Icon className={cn("size-3.5 shrink-0", style.tone)} aria-hidden />
              {stageName(stage)}
              {/* Derived from position, so it moves when the plan is
                  reordered. Named for what it does rather than "Final",
                  which said nothing about the consequence. */}
              {stage.is_final && (
                <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand-deep ring-1 ring-brand-line">
                  Completes the order
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-5">
              {stage.unit_name ?? "No room"}
              {" · "}
              {style.label}
              {stage.target_qty
                ? ` · target ${fmt(stage.target_qty)} ${stage.target_unit}`
                : " · no target set"}
              {/* The ceiling, not the percentage: "up to 21 kg" is the number
                  an operator is actually held to, and "+5%" makes them do the
                  arithmetic the log already did. The percentage comes along
                  only to say where the ceiling came from. */}
              {ceiling !== null && stage.effective_tolerance_pct > 0
                ? ` · accepts up to ${fmt(ceiling)} (+${stage.effective_tolerance_pct}%${
                    stage.tolerance_pct === null ? "" : ", this stage"
                  })`
                : ""}
              {stage.pack_size ? ` · ${fmt(stage.pack_size)} per pack` : ""}
              {stage.can_run_parallel ? " · runs in parallel" : ""}
            </p>
          </div>
        </div>

        {canManage && !done && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton onClick={onMoveUp} label="Move earlier">
              <ArrowUp className="size-3.5" />
            </IconButton>
            <IconButton onClick={onMoveDown} label="Move later">
              <ArrowDown className="size-3.5" />
            </IconButton>
            {/* Only while nothing has been logged against it: past that the
                stage is the heading over audit-protected rows, and the
                database refuses the delete anyway. */}
            {!started && (
              <IconButton onClick={onRemove} label="Remove stage" danger>
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </div>
        )}
      </div>

      {pct !== null && (
        <div className="mt-2.5 space-y-1">
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
          <p className="font-mono text-[10.5px] tabular-nums text-ink-4">
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
            <p className="text-[11px] font-medium text-danger-deep">
              Past the {fmt(ceiling)} {stage.target_unit} this stage accepts.
              Entries already filed stay; raise this target, or the
              batch&rsquo;s tolerance, to make the plan agree with them.
            </p>
          )}
        </div>
      )}

      {done && (
        <p className="mt-2 text-[11px] text-teal-deep">
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
        <p className="mt-1.5 text-[11px] text-warn-ink">
          Target changed from {fmt(stage.previous_target_qty)}.
        </p>
      )}

      {canManage && !done && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <input
                autoFocus
                type="number"
                step="any"
                min={0}
                value={editQty}
                onChange={(e) => onEditQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                placeholder="e.g. 210000"
                className={cn(FIELD, MONO, "w-32")}
              />
              <SelectField
                ariaLabel="Assigned room"
                value={editRoom}
                onChange={onEditRoom}
                clearable
                clearLabel="No room"
                placeholder="No room"
                options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                className="w-40"
              />
              {/* Meaningless on the first stage, which has nothing before
                  it to overlap and is startable regardless. */}
              {index > 0 && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-4">
                  <input
                    type="checkbox"
                    checked={editParallel}
                    onChange={(e) => onEditParallel(e.target.checked)}
                    className="size-3.5 accent-[var(--color-brand)]"
                  />
                  Can run in parallel with the stage before it
                </label>
              )}
              <SmallButton onClick={onSaveEdit} primary>
                Save
              </SmallButton>
              <SmallButton onClick={onCancelEdit}>Cancel</SmallButton>
            </>
          ) : (
            <>
              <SmallButton onClick={onBeginEdit}>
                {stage.target_qty ? "Edit stage" : "Set target & room"}
              </SmallButton>
              {stage.status === "pending" && canStart && (
                <SmallButton onClick={onStart}>
                  <Play className="size-3" />
                  Start
                </SmallButton>
              )}
              {stage.status === "in_progress" && (
                <SmallButton onClick={onSignOff} primary>
                  <CheckCircle2 className="size-3" />
                  Sign off
                </SmallButton>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The add-stage form at the foot of the plan. */
function AddStageForm({
  processes,
  rooms,
  onAdd,
}: {
  processes: { id: string; name: string; category: string | null }[];
  rooms: { id: string; name: string }[];
  onAdd: (values: StageParsed) => Promise<void>;
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
      canRunParallel: false,
      targetQty: undefined,
      targetUnit: "units",
      label: "",
      workOrder: "",
      packSize: undefined,
    },
  });

  const firstError =
    errors.processId?.message ??
    errors.targetUnit?.message ??
    errors.targetQty?.message ??
    errors.label?.message;

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onAdd(values);
        reset();
      })}
      className="rounded-xl border border-dashed border-line-strong bg-sunken p-3.5"
    >
      <p className="mb-2.5 text-[10px] font-bold tracking-[0.05em] text-ink-4 uppercase">
        Add the next stage
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="st-process" className={LABEL}>
            Activity
          </label>
          <Controller
            name="processId"
            control={control}
            render={({ field }) => (
              <SelectField
                id="st-process"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ariaInvalid={Boolean(errors.processId)}
                searchPlaceholder="Activity name…"
                emptyMessage="No activity matches that."
                options={processes.map((proc) => ({
                  value: proc.id,
                  label: proc.name,
                  meta: proc.category ?? undefined,
                }))}
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="st-room" className={LABEL}>
            Assigned room
          </label>
          <Controller
            name="unitId"
            control={control}
            render={({ field }) => (
              <SelectField
                id="st-room"
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
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="st-target" className={LABEL}>
            Target
          </label>
          <input
            id="st-target"
            type="number"
            step="any"
            min={0}
            placeholder="e.g. 210000"
            className={cn(FIELD, MONO)}
            {...register("targetQty", { valueAsNumber: true })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="st-unit" className={LABEL}>
            Unit
          </label>
          <Controller
            name="targetUnit"
            control={control}
            render={({ field }) => (
              <SelectField
                id="st-unit"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                options={STAGE_UNITS.map((u) => ({ value: u, label: u }))}
              />
            )}
          />
        </div>
      </div>

      {/* Only needed when the batch runs the same activity more than once —
          three packing runs under one number. Left blank on the ordinary
          stage, where the activity name already says everything. */}
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="st-label" className={LABEL}>
            Label
          </label>
          <input
            id="st-label"
            placeholder="e.g. 30's"
            className={FIELD}
            {...register("label")}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="st-wo" className={LABEL}>
            Work order
          </label>
          <input
            id="st-wo"
            placeholder="e.g. 46000D"
            className={cn(FIELD, MONO)}
            {...register("workOrder")}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="st-pack" className={LABEL}>
            Pack size
          </label>
          <input
            id="st-pack"
            type="number"
            step="any"
            min={0}
            placeholder="e.g. 30"
            className={cn(FIELD, MONO)}
            {...register("packSize", { valueAsNumber: true })}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add
          </button>
        </div>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[11px] text-ink-3">
        <input
          type="checkbox"
          className="size-3.5 cursor-pointer rounded border-ink-6 accent-brand"
          {...register("canRunParallel")}
        />
        Can run in parallel with the stage before it
      </label>

      <p className="mt-2 text-[10.5px] text-ink-5">
        Label or work order only where the batch runs this activity more than
        once — Packing 30&rsquo;s, 60&rsquo;s, 120&rsquo;s. The stage added
        last completes the order.
      </p>

      {firstError && (
        <p role="alert" className="mt-2 text-[11px] text-danger-deep">
          {firstError}
        </p>
      )}
    </form>
  );
}

function IconButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick?: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-7 place-items-center rounded-lg text-ink-5 transition disabled:opacity-25",
        danger
          ? "hover:bg-danger-soft hover:text-danger-deep"
          : "hover:bg-sunken-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition",
        primary
          ? "bg-brand text-white hover:brightness-[1.06]"
          : "border border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
