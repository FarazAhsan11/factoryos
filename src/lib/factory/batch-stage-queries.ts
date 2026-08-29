import type {
  StageSignOffParsed,
  StageValues,
} from "@/app/factory/[slug]/pipeline/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Pipeline → Plan stages. The planned route of one batch (migration 0033).
 *
 * Browser-direct under RLS like the rest of the tenant data, with two things
 * deliberately absent from every write below: `accumulated_qty` and
 * `is_final`. Both are derived — the first from the shift log by
 * `batch_stage_accumulate`, the second from position by
 * `batch_stages_final_sync` — and a client that could set either would be a
 * second, competing source of truth for a number the whole module reads.
 *
 * Sign-off is a write too, but the standing it needs (`can_review_factory`)
 * and the evidence it costs are enforced by `batch_stage_transition`, not
 * here. This layer is only allowed to *ask*.
 */

export type StageStatus = "pending" | "in_progress" | "complete";

export interface BatchStage {
  id: string;
  job_id: string;
  process_id: string;
  sequence_order: number;
  /** Tells two runs of one process apart — "30's", "60's". */
  label: string | null;
  /** The same distinction where a plant uses work orders instead. */
  work_order: string | null;
  /** The room this stage is planned to run in. Advisory — the log may differ. */
  unit_id: string | null;
  unit_name: string | null;
  /** May start before the stage before it is complete. */
  can_run_parallel: boolean;
  target_qty: number | null;
  target_unit: string;
  pack_size: number | null;
  /** Good units logged against this stage — rejects already subtracted. */
  accumulated_qty: number;
  status: StageStatus;
  /** Derived from position: the last stage completes the order. */
  is_final: boolean;
  started_at: string | null;
  completed_at: string | null;
  yield_pct: number | null;
  yield_acceptable: boolean | null;
  yield_notes: string | null;
  previous_target_qty: number | null;
  created_at: string;
  /** Resolved in the view, so the plan names its stages without a second cache. */
  process_name: string | null;
  process_category: string | null;
  completed_by_name: string | null;
}

/**
 * Read through `batch_stages_expanded` (migration 0035) rather than the table:
 * the plan needs the process, room and signer by *name*, and three embedded
 * joins per row is what the view exists to spare every caller.
 */
const COLUMNS = `
  id, job_id, process_id, unit_id, sequence_order, label, work_order,
  target_qty, target_unit, pack_size, accumulated_qty, status, is_final,
  can_run_parallel, started_at, completed_at, yield_pct, yield_acceptable,
  yield_notes, previous_target_qty, created_at,
  process_name, process_category, unit_name, completed_by_name
`;

export const batchStageKeys = {
  /** Prefix covering every batch's plan — invalidate after a cross-job change. */
  all: (factoryId: string) => ["batch_stages", factoryId] as const,
  job: (factoryId: string, jobId: string) =>
    ["batch_stages", factoryId, jobId] as const,
};

export async function fetchBatchStages(jobId: string): Promise<BatchStage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("batch_stages_expanded")
    .select(COLUMNS)
    .eq("job_id", jobId)
    .order("sequence_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BatchStage[];
}

/**
 * Every stage of every batch in one tenant, for the places that need to know
 * a plan exists without opening it — the Kanban card's stage strip, and the
 * shift log deciding whether to show its stage picker.
 */
export async function fetchFactoryStages(
  factoryId: string,
): Promise<BatchStage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("batch_stages_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("sequence_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BatchStage[];
}

/** Turns the database's guards into something a planner can act on. */
function toMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "That activity is already in this batch's plan. Give the second run a label — 30's, 60's — or a work order to tell them apart.";
  }
  return error.message;
}

export async function createBatchStage(
  factoryId: string,
  jobId: string,
  values: StageValues,
): Promise<BatchStage> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("batch_stages")
    .insert({
      factory_id: factoryId,
      job_id: jobId,
      process_id: values.processId,
      unit_id: values.unitId || null,
      can_run_parallel: values.canRunParallel ?? false,
      label: values.label?.trim() || null,
      work_order: values.workOrder?.trim() || null,
      target_qty: values.targetQty ?? null,
      target_unit: values.targetUnit,
      pack_size: values.packSize ?? null,
      // Left unset so the database appends it — `batch_stages_validate` puts
      // the row at the end, which is also what makes it the new final stage.
    })
    .select("id")
    .single();

  if (error) throw new Error(toMessage(error));
  // Read back through the view, so the caller gets the resolved names the
  // insert cannot return.
  const { data: row } = await supabase
    .from("batch_stages_expanded")
    .select(COLUMNS)
    .eq("id", data.id)
    .single();
  return row as unknown as BatchStage;
}

/**
 * Row-level edits from the plan.
 *
 * The target is the one worth naming: it stays editable after the batch is
 * issued — a plan is a plan — but `batch_stage_transition` refuses to let it
 * be *cleared*, which would put an unplanned producing stage on a running
 * batch, and refuses any change once the stage is signed off.
 */
export async function updateBatchStage(
  id: string,
  patch: Partial<
    Pick<
      BatchStage,
      | "label"
      | "work_order"
      | "target_qty"
      | "target_unit"
      | "pack_size"
      | "unit_id"
      | "can_run_parallel"
    >
  >,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("batch_stages").update(patch).eq("id", id);
  if (error) throw new Error(toMessage(error));
}

/**
 * Moves one stage up or down the plan.
 *
 * Two writes rather than one, because the two rows swap positions and there is
 * no single statement that says so. Not a transaction: the worst a failure
 * between them can do is leave two stages sharing a position, which the plan
 * renders in insertion order and the next move corrects. A batch's route is
 * not the place to add a Server Action for.
 *
 * Order matters more than it looks: the last row carries `is_final`, so
 * reordering the tail moves which stage completes the order.
 */
export async function swapStageOrder(
  a: BatchStage,
  b: BatchStage,
): Promise<void> {
  const supabase = createClient();
  // Two updates, not an upsert. An upsert is an insert with a conflict clause,
  // so PostgREST sends every row as a candidate insert — and a row carrying
  // only an id and a position has no `job_id` or `process_id` to insert with.
  // It fails or silently does nothing depending on the shape, which is exactly
  // what it did: the reorder buttons moved nothing.
  const first = await supabase
    .from("batch_stages")
    .update({ sequence_order: b.sequence_order })
    .eq("id", a.id);
  if (first.error) throw new Error(first.error.message);

  const second = await supabase
    .from("batch_stages")
    .update({ sequence_order: a.sequence_order })
    .eq("id", b.id);
  if (second.error) throw new Error(second.error.message);
}

export async function deleteBatchStage(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("batch_stages").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Starts a stage by hand, before anything has been logged against it. */
export async function activateStage(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("batch_stages")
    .update({ status: "in_progress" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Signs a stage off.
 *
 * `yield_pct` is not sent: the trigger computes it from the two numbers
 * already on the row. A typed yield is a third number that can disagree with
 * them, and it is the one that would end up on a handover sheet.
 */
export async function signOffStage(
  id: string,
  values: StageSignOffParsed,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("batch_stages")
    .update({
      status: "complete",
      yield_acceptable: values.yieldAcceptable,
      yield_notes: values.notes?.trim() || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Releases a batch to the floor.
 *
 * Through the `issue_job` RPC, not a column update: "every stage has a target"
 * is a statement about other rows, and a client that checks it is a client
 * that can be wrong about it. Returns the moment it was issued.
 */
export async function issueJob(jobId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("issue_job", { p_job: jobId });
  if (error) throw new Error(error.message);
  return data as string;
}

/* ── Derived reads ──────────────────────────────────────────────────────── */

/** How far through a stage is, or null when it has no target to measure by. */
export function stageProgress(stage: BatchStage): number | null {
  const target = Number(stage.target_qty ?? 0);
  if (!target) return null;
  return Math.round((Number(stage.accumulated_qty ?? 0) / target) * 100);
}

/**
 * What to call a stage when its batch runs the same activity more than once.
 *
 * Falls back to the process name, which is the right answer for the ordinary
 * single-run stage — "Compression" needs no disambiguating.
 */
export function stageName(stage: BatchStage): string {
  const base = stage.process_name ?? "Stage";
  const suffix = stage.label?.trim() || stage.work_order?.trim();
  return suffix ? `${base} — ${suffix}` : base;
}

/**
 * Can this stage be started?
 *
 * The first stage always; any later one once the stage before it is complete,
 * or whenever it is marked as able to run in parallel — three packing runs off
 * one bulk start together, and labelling overlaps the packing feeding it.
 *
 * Advisory only. The database does not enforce an order, because a plant that
 * genuinely runs two stages side by side should not have to lie about its plan
 * to log the second one; this decides what the dialog offers, not what the log
 * accepts.
 */
export function stageIsNext(stages: BatchStage[], index: number): boolean {
  if (index === 0) return true;
  if (stages[index]?.can_run_parallel) return true;
  return stages[index - 1]?.status === "complete";
}

/** What still stands between a plan and being issued. */
export function stagesWithoutTarget(stages: BatchStage[]): BatchStage[] {
  return stages.filter((s) => !s.target_qty || s.target_qty <= 0);
}
