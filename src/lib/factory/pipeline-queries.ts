import { createClient } from "@/lib/supabase/client";

/**
 * Pipeline → Kanban. Reads the `pipeline_jobs_expanded` view (migration
 * 0016), which carries the batch's identity, the room it is in and how much
 * the final stage has produced.
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
  /** Produced at the stage tagged `is_final_stage`, never summed across all. */
  produced_qty: number;
  flagged_count: number;
}

const COLUMNS = `
  id, product_id, status, unit_id, hold_reason,
  planned_at, started_at, held_at, finished_at,
  batch_no, product_code, product_name, required_qty,
  unit_name, produced_qty, flagged_count
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
    is_final_stage: boolean;
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
       process:factory_processes ( name, has_output, is_final_stage ),
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
  isFinal: boolean;
}

/**
 * Per-stage totals, for the stages that produce something.
 *
 * This is the breakdown the card's single percentage can't show. The bar
 * tracks the final stage alone — deliberately, since every stage logs roughly
 * the same batch quantity and adding them up would treble it — but "0%" while
 * 5,000 have been encapsulated reads as broken until you can see where the
 * work actually is. Non-producing stages (Manning, Set Up) are excluded:
 * they store null quantities and would show as a row of dashes.
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
      isFinal: entry.process.is_final_stage,
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
