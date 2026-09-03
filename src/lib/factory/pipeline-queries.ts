import type {
  BatchType,
  EditBatchParsed,
  NewBatchParsed,
  Priority,
} from "@/app/factory/[slug]/pipeline/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Pipeline → Kanban. Reads the `pipeline_jobs_expanded` view (migrations
 * 0016 and 0031), which carries the batch's identity, the room it is in, how
 * much the final stage has produced, and — since batch families — its type,
 * its bulk parent and the family allocation numbers.
 *
 * Reads and the insert go browser-direct under RLS, same as the setup lists.
 * Note what is **not** here: nothing writes `status`. The board moves itself
 * from the shift log through the `shift_log_pipeline_sync` trigger, so a
 * status update from the client would be a second, competing source of truth
 * for the same fact.
 */

export type PipelineStatus = "planned" | "production" | "hold" | "finished";

export interface PipelineJob {
  id: string;
  product_id: string;
  status: PipelineStatus;
  unit_id: string | null;
  /** The action flag that stopped it — null unless the status is `hold`. */
  hold_reason: string | null;
  planned_at: string;
  started_at: string | null;
  held_at: string | null;
  finished_at: string | null;

  batch_no: string;
  product_code: string | null;
  product_name: string;
  required_qty: number;

  unit_name: string | null;
  /** What the plan's last stage has made — the batch's completion (0033). */
  produced_qty: number;
  flagged_count: number;

  /* ── Batch families (0031) ─────────────────────────────────────────── */
  batch_type: BatchType;
  /** The manufacturing job whose bulk this packing run draws from. */
  parent_job_id: string | null;
  bulk_unit: string | null;
  /** Units of bulk per container — 30, 60, 120. */
  pack_size: number | null;
  pack_unit: string | null;
  bulk_qty_received: number | null;
  market: string | null;
  overage_pct: number;
  /**
   * How far past a planned stage's target the shift log will accept before it
   * refuses the entry (migration 0037). Inherited by every stage in the plan
   * that has not overridden it.
   *
   * Not `overage_pct` under another name: that is extra this batch means to
   * make, measured against the whole work order, and it raises a flag. This is
   * a bound on what may be *recorded* against one stage, and it blocks.
   */
  tolerance_pct: number;
  priority: Priority;
  due_date: string | null;
  notes: string | null;

  /** Resolved in the view, so a card never cross-references the board. */
  parent_batch_no: string | null;
  parent_product_name: string | null;
  child_count: number;
  /**
   * What this parent's packing children add up to, in bulk units. Null when
   * it has none — "not a parent" and "nothing allocated" are different facts,
   * and only the second draws an allocation bar.
   */
  allocated_qty: number | null;
  /** Bulk this packing run has drawn down. Null on anything but packing. */
  bulk_consumed: number | null;

  /* ── Stage planning (0033) ─────────────────────────────────────────── */
  /**
   * When the batch was released to the floor. Null means the shift log will
   * refuse producing entries against it — downtime is always accepted.
   */
  issued_at: string | null;
  stage_count: number;
  stages_complete: number;
  /** What still stands between this plan and being issued. */
  stages_without_target: number;
  final_target_qty: number | null;
}

const COLUMNS = `
  id, product_id, status, unit_id, hold_reason,
  planned_at, started_at, held_at, finished_at,
  batch_no, product_code, product_name, required_qty,
  unit_name, produced_qty, flagged_count,
  batch_type, parent_job_id, bulk_unit, pack_size, pack_unit,
  bulk_qty_received, market, overage_pct, tolerance_pct, priority, due_date, notes,
  parent_batch_no, parent_product_name, child_count,
  allocated_qty, bulk_consumed,
  issued_at, stage_count, stages_complete, stages_without_target,
  final_target_qty
`;

export const pipelineKeys = {
  all: (factoryId: string) => ["pipeline_jobs", factoryId] as const,
};

/** The four columns, in board order. */
export const PIPELINE_COLUMNS: {
  status: PipelineStatus;
  label: string;
  accent: string;
  tint: string;
}[] = [
  {
    status: "planned",
    label: "Planned",
    accent: "var(--color-violet)",
    tint: "var(--color-violet-soft)",
  },
  {
    status: "production",
    label: "In production",
    accent: "var(--color-brand)",
    tint: "var(--color-brand-soft)",
  },
  {
    status: "hold",
    label: "On hold",
    accent: "var(--color-warn-deep)",
    tint: "var(--color-warn-tint)",
  },
  {
    status: "finished",
    label: "Finished",
    accent: "var(--color-teal)",
    tint: "var(--color-teal-soft)",
  },
];

/**
 * Adds the jobs for every scheduled batch whose date has arrived, and says how
 * many that was.
 *
 * The second way onto the board, beside the New job modal: a batch given a
 * `planned_for` date in Admin → Products joins Planned on that day without
 * anyone re-entering it. Called immediately before the board is read, because
 * a job is a row and cannot be derived on read the way a status can — see
 * migration 0018 for why this stands in for a scheduler.
 *
 * Idempotent, so calling it on every page load is not a mistake: the insert
 * skips any batch that already has a job.
 */
export async function promoteScheduledJobs(factoryId: string): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("promote_scheduled_jobs", {
    p_factory_id: factoryId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function fetchPipelineJobs(
  factoryId: string,
): Promise<PipelineJob[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pipeline_jobs_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    // Oldest first within a column: the job that has been waiting longest sits
    // at the top, which is the one a supervisor should look at first.
    .order("planned_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PipelineJob[];
}

/**
 * Adds jobs for the chosen batches, all landing in Planned.
 *
 * A single insert, so twenty ticked boxes are one round-trip. The unique index
 * on `product_id` is the backstop: the modal only offers batches with no job,
 * but two planners ticking the same batch at once would otherwise both win.
 */
export async function createPipelineJobs(
  factoryId: string,
  productIds: string[],
  createdBy: string,
): Promise<number> {
  if (productIds.length === 0) return 0;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("pipeline_jobs")
    .insert(
      productIds.map((product_id) => ({
        factory_id: factoryId,
        product_id,
        created_by: createdBy,
      })),
    )
    .select("id");

  if (error) {
    throw new Error(
      // 23505 = the one-job-per-batch unique index.
      error.code === "23505"
        ? "One of those batches already has a job on the board. Close and reopen this window to refresh the list."
        : error.message,
    );
  }
  return data?.length ?? 0;
}

/**
 * Adds one batch to the board, with everything the pipeline knows about it.
 *
 * The second way on beside `createPipelineJobs`, and the one the New batch
 * dialog uses. The difference is not the batch — both start from a catalogue
 * row — but the detail: the type, the bulk parent, the pack size, the market.
 * `createPipelineJobs` is the bulk path and takes none of it.
 *
 * A plain insert under RLS, like every other tenant write here. Nothing in it
 * needs elevated rights: `pipeline_jobs_manage` already restricts this to
 * managers, and the family rules are enforced by the `pipeline_jobs_family`
 * trigger (migration 0031), which no client can talk its way past.
 */
export async function createBatchJob(
  values: NewBatchParsed,
  createdBy: string,
): Promise<string> {
  const supabase = createClient();
  const packing = values.batchType === "packing";
  const manufacturing = values.batchType === "manufacturing";

  const { data, error } = await supabase
    .from("pipeline_jobs")
    .insert({
      factory_id: values.factoryId,
      product_id: values.productId,
      created_by: createdBy,
      batch_type: values.batchType,
      priority: values.priority,
      due_date: values.dueDate || null,
      notes: values.notes || null,
      // The type-specific columns are sent only for the type that owns them.
      // A combined batch carrying a pack size would draw a bulk-consumption
      // panel in the shift log for bulk nobody allocated.
      parent_job_id: packing ? (values.parentJobId ?? null) : null,
      pack_size: packing ? (values.packSize ?? null) : null,
      pack_unit: packing ? (values.packUnit ?? null) : null,
      bulk_qty_received: packing ? (values.bulkQtyReceived ?? null) : null,
      market: packing ? (values.market || null) : null,
      bulk_unit: manufacturing ? (values.bulkUnit ?? null) : null,
      // Anything that manufactures may declare one; a packing run may not, and
      // `pipeline_jobs_overage_belongs` (0032) refuses it if this ever slips.
      overage_pct: packing ? 0 : (values.overagePct ?? 0),
      // Unlike overage, every batch type carries one: a packing stage has a
      // target like any other, and 600 bottles against a 500-bottle run is the
      // same mistake as 26 kg against a 20 kg mix.
      tolerance_pct: values.tolerancePct ?? 0,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      // 23505 = the one-job-per-batch unique index. The raw message names an
      // index nobody outside the migration has heard of.
      error.code === "23505"
        ? "That batch is already on the board."
        : error.message,
    );
  }
  return data.id as string;
}

/**
 * Changes what the pipeline knows about a batch already on the board.
 *
 * The path every batch written before migration 0031 needs: they were
 * backfilled as `combined`, which is what they were, and without this there is
 * no way to say that one of them is actually bulk with packing runs to come.
 *
 * The batch itself is not editable — no `product_id`. Which catalogue row a
 * card is for is the thing every logged entry resolves through, and changing
 * it would quietly re-point the meaning of work already recorded.
 *
 * The family rules are not re-checked here. `pipeline_jobs_family_guard`
 * (0031) owns them and sees the whole picture — including the one this form
 * cannot, that a manufacturing batch with packing children may not be re-typed
 * out from under them.
 */
export async function updateBatchJob(
  jobId: string,
  values: EditBatchParsed,
): Promise<void> {
  const supabase = createClient();
  const packing = values.batchType === "packing";
  const manufacturing = values.batchType === "manufacturing";

  const { error } = await supabase
    .from("pipeline_jobs")
    .update({
      batch_type: values.batchType,
      priority: values.priority,
      due_date: values.dueDate || null,
      notes: values.notes || null,
      // Cleared when the type no longer owns them, so a batch switched from
      // packing to combined stops claiming a parent's bulk.
      parent_job_id: packing ? (values.parentJobId ?? null) : null,
      pack_size: packing ? (values.packSize ?? null) : null,
      pack_unit: packing ? (values.packUnit ?? null) : null,
      bulk_qty_received: packing ? (values.bulkQtyReceived ?? null) : null,
      market: packing ? values.market || null : null,
      bulk_unit: manufacturing ? (values.bulkUnit ?? null) : null,
      overage_pct: packing ? 0 : (values.overagePct ?? 0),
      tolerance_pct: values.tolerancePct ?? 0,
    })
    .eq("id", jobId);

  if (error) throw new Error(error.message);
}

/**
 * Removes a job from the board.
 *
 * Only ever offered on a Planned card. Once work has been logged the job is
 * the visible half of an audit-protected record, and deleting the card while
 * the entries stay would make the board and the log disagree about whether a
 * batch was ever run.
 */
export async function deletePipelineJob(jobId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("pipeline_jobs")
    .delete()
    .eq("id", jobId);
  if (error) throw new Error(error.message);
}

/* ── Job detail ──────────────────────────────────────────────────────────
   Everything logged against one batch, for the card's detail dialog. Read
   raw and aggregated in the browser rather than through another view: a
   batch has tens of entries, not thousands, and the three tabs slice the
   same rows three ways — one fetch answers all of them. */

export interface JobEntry {
  id: string;
  log_date: string;
  shift: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  qty: number | null;
  qty_rejected: number | null;
  action_flag: string | null;
  comment: string | null;
  amend_note: string | null;
  operators: string[];
  process: {
    name: string;
    has_output: boolean;
  } | null;
  unit: { name: string } | null;
}

export async function fetchJobEntries(productId: string): Promise<JobEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries")
    .select(
      `id, log_date, shift, start_time, end_time, duration_minutes,
       qty, qty_rejected, action_flag, comment, amend_note, operators,
       process:factory_processes ( name, has_output ),
       unit:factory_units ( name )`,
    )
    .eq("product_id", productId)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as JobEntry[];
}

export interface ProcessTotal {
  name: string;
  qty: number;
  rejected: number;
  entries: number;
  minutes: number;
}

/**
 * Per-stage totals, for the stages that produce something.
 *
 * What has actually been *logged*, grouped by activity — history, not a plan.
 * The Stages tab beside it is the plan, with targets and progress against
 * them; this one answers "where did the work go" for a batch whose plan was
 * reconstructed, or whose entries predate it. Non-producing stages (Manning,
 * Set Up) are excluded: they store null quantities and would show as a row of
 * dashes.
 */
export function totalsByProcess(entries: JobEntry[]): ProcessTotal[] {
  const map = new Map<string, ProcessTotal>();
  for (const entry of entries) {
    if (!entry.process?.has_output) continue;
    const name = entry.process.name;
    const row = map.get(name) ?? {
      name,
      qty: 0,
      rejected: 0,
      entries: 0,
      minutes: 0,
    };
    row.qty += Number(entry.qty ?? 0);
    row.rejected += Number(entry.qty_rejected ?? 0);
    row.minutes += Number(entry.duration_minutes ?? 0);
    row.entries += 1;
    map.set(name, row);
  }
  // Most produced first — the stage carrying the batch right now.
  return [...map.values()].sort((a, b) => b.qty - a.qty);
}

export interface RoomTotal {
  name: string;
  entries: number;
  minutes: number;
  lastDate: string;
}

/** Every room the batch has been worked in, most recently used first. */
export function totalsByRoom(entries: JobEntry[]): RoomTotal[] {
  const map = new Map<string, RoomTotal>();
  for (const entry of entries) {
    const name = entry.unit?.name;
    if (!name) continue;
    const row = map.get(name) ?? {
      name,
      entries: 0,
      minutes: 0,
      lastDate: entry.log_date,
    };
    row.entries += 1;
    row.minutes += Number(entry.duration_minutes ?? 0);
    // Entries arrive newest first, so the first sighting is the latest.
    if (entry.log_date > row.lastDate) row.lastDate = entry.log_date;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** How far through, against the required quantity. Null when no target is set. */
export function jobProgress(job: PipelineJob): number | null {
  const required = Number(job.required_qty ?? 0);
  if (!required) return null;
  return Math.min(
    100,
    Math.round((Number(job.produced_qty ?? 0) / required) * 100),
  );
}

/* ── Batch families ──────────────────────────────────────────────────────
   Grouped in the browser rather than through a second query: the board
   already holds every job for this tenant, and a family is a partition of
   that same array. Fetching it again would be a round-trip to re-learn what
   is already in the cache — and could disagree with the board mid-flight. */

export interface BatchFamily {
  parent: PipelineJob;
  /** Packing runs drawing on this parent's bulk, oldest first. */
  children: PipelineJob[];
}

/**
 * Manufacturing parents with their packing children, plus everything that
 * belongs to no family.
 *
 * Standalone covers two different things on purpose: combined batches (the
 * whole batch on one number) and packing runs whose bulk came from outside —
 * both are complete records in themselves, neither has a family to sit in.
 */
export function familiesFrom(jobs: PipelineJob[]): {
  families: BatchFamily[];
  standalone: PipelineJob[];
} {
  const onBoard = new Set(jobs.map((job) => job.id));
  /** Only children whose parent is actually on the board are nested. */
  const nested = (job: PipelineJob) =>
    Boolean(job.parent_job_id && onBoard.has(job.parent_job_id));

  const childrenOf = new Map<string, PipelineJob[]>();
  for (const job of jobs) {
    if (!nested(job)) continue;
    const list = childrenOf.get(job.parent_job_id!) ?? [];
    list.push(job);
    childrenOf.set(job.parent_job_id!, list);
  }

  return {
    families: jobs
      .filter((job) => job.batch_type === "manufacturing")
      .map((parent) => ({
        parent,
        children: childrenOf.get(parent.id) ?? [],
      })),
    // Everything with no family to sit in: combined batches, and packing runs
    // whose bulk came from outside — or whose parent has since left the board,
    // which must fall through here rather than vanish from the view.
    standalone: jobs.filter(
      (job) => job.batch_type !== "manufacturing" && !nested(job),
    ),
  };
}

export interface Allocation {
  /** Σ children (containers × pack size), in the parent's bulk units. */
  allocated: number;
  /** The parent's own required quantity — the bulk it will produce. */
  target: number;
  /**
   * What the children may actually claim: the greater of what the parent was
   * planned to make (target + declared overage) and what it has actually
   * made.
   *
   * Two readings of one question, and which is right depends on whether the
   * bulk exists yet. Before it runs, the plan is all there is — the same
   * allowance the shift log's over-production check uses (0032), so 4% means
   * one thing in both places. Once it has run, the drum holds what it holds:
   * a batch planned at 100,000 that made 120,000 has 120,000 to give away,
   * and reporting a 16,000 shortfall against bulk sitting on a pallet is the
   * kind of false alarm that teaches planners to ignore the bar.
   *
   * Never *below* the plan: a batch half way through has not lost the bulk it
   * has yet to make.
   */
  allowance: number;
  /** True when `allowance` came from real output rather than from the plan. */
  fromActual: boolean;
  /** The true percentage of the target claimed — uncapped, so it can read 120. */
  pct: number;
  /** Width for the bar, 0–100. The number to show is `pct`. */
  barPct: number;
  /** False once the children claim more bulk than the parent is allowed to give. */
  ok: boolean;
  /** How far past the allowance, or 0. The number that needs an explanation. */
  over: number;
}

/**
 * How much of a parent's bulk its packing children have claimed.
 *
 * Null when there is nothing to compare — no children, or a parent with no
 * required quantity to divide up. Both are ordinary states early in planning,
 * and drawing a 0% bar for them reads as a problem rather than as an
 * unanswered question.
 *
 * Advisory by design, matching migration 0031: being over is badged, never
 * refused. A second bulk batch already scheduled is a good reason to be.
 */
export function allocationFor(parent: PipelineJob): Allocation | null {
  const target = Number(parent.required_qty ?? 0);
  const allocated = Number(parent.allocated_qty ?? 0);
  if (!target || parent.allocated_qty === null) return null;

  // Floored for the same reason 0032 floors it: half a tablet of headroom
  // should not decide whether a planner has to account for an overrun.
  const planned = Math.floor(target * (1 + Number(parent.overage_pct ?? 0) / 100));
  const made = Number(parent.produced_qty ?? 0);
  const allowance = Math.max(planned, made);

  return {
    allocated,
    target,
    allowance,
    fromActual: made > planned,
    pct: Math.round((allocated / allowance) * 100),
    barPct: Math.min(100, Math.round((allocated / allowance) * 100)),
    ok: allocated <= allowance,
    over: Math.max(0, allocated - allowance),
  };
}

/**
 * Bulk left for this packing run: what it was given, less what its own
 * output has consumed.
 *
 * Null unless both halves are known — a run with no allocation recorded has
 * an unknown remainder, not a full one.
 */
export function bulkRemaining(job: PipelineJob): number | null {
  if (job.bulk_qty_received === null || job.bulk_consumed === null) return null;
  return Math.max(0, Number(job.bulk_qty_received) - Number(job.bulk_consumed));
}

/**
 * "bottles" → "bottle", for the `30 per bottle` phrasing.
 *
 * The pack unit is stored plural because that is how it reads everywhere else
 * — "1,000 bottles" — but "30 per bottles" is wrong in the one place the unit
 * is used distributively. A trailing "s" is the whole rule: every value in
 * `PACK_UNITS` is a regular plural.
 */
export function packUnitSingular(unit: string | null | undefined): string {
  const value = (unit ?? "container").trim();
  return value.endsWith("s") ? value.slice(0, -1) : value;
}
