import { stageName, type BatchStage } from "@/lib/factory/batch-stage-queries";
import type { FactoryAction } from "@/lib/factory/action-queries";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import type { SetupItem } from "@/lib/factory/setup-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Floor status — every room, and what it is doing on one calendar day.
 *
 * A day, not a shift: the board opens empty at midnight and fills as the
 * floor logs, which is how a supervisor walking in at 6am wants to read it —
 * nothing yet means nothing yet. Earlier days are the same question asked of
 * the past.
 *
 * Reads `shift_log_entries_expanded` rather than the table, for one column:
 * `accumulative`, the stage's running total *as of each entry*. That is what
 * lets a past day's card say how far through the stage the room was when it
 * logged, rather than how far it is now.
 *
 * Everything else — which entry is a room's latest, its stage, its batch's
 * open issues — is derived here over lists other screens already cache.
 */

export interface FloorEntry {
  id: string;
  unit_id: string;
  unit_name: string | null;
  process_id: string;
  process_name: string | null;
  /** downtime | preparatory | production (0030). */
  process_category: string | null;
  log_date: string;
  shift: string;
  start_time: string | null;
  end_time: string | null;
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  batch_stage_id: string | null;
  qty: number | null;
  qty_unit: string | null;
  qty_rejected: number | null;
  /** The stage's running total up to and including this entry. */
  accumulative: number | null;
  /** The stage's target, or the work order where the batch has no plan. */
  required_qty: number | null;
  action_flag: string | null;
  comment: string | null;
  operators: string[];
  created_at: string;
}

const COLUMNS = `
  id, unit_id, unit_name, process_id, process_name, process_category,
  log_date, shift, start_time, end_time,
  batch_no, product_id, product_name, product_code, batch_stage_id,
  qty, qty_unit, qty_rejected, accumulative, required_qty,
  action_flag, comment, operators, created_at
`;

export const floorKeys = {
  /**
   * Under the shift log's own prefix, so filing an entry — which invalidates
   * `logKeys.factory` — refreshes the floor without the form knowing it exists.
   */
  day: (factoryId: string, date: string) =>
    ["shift_log_entries", factoryId, date, "floor"] as const,
  /**
   * The board's jobs under a key of their own. The pipeline page's read of
   * `pipelineKeys.all` promotes scheduled batches as a side effect, and a
   * plain read cached under that key would let the board skip it. Still under
   * the same prefix, so every invalidation of the board reaches this too.
   */
  jobs: (factoryId: string) => ["pipeline_jobs", factoryId, "floor"] as const,
};

export async function fetchFloorEntries(
  factoryId: string,
  date: string,
): Promise<FloorEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shift_log_entries_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .eq("log_date", date)
    // Newest first, so a room's latest entry is the first one met.
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FloorEntry[];
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

export interface FloorProgress {
  stageName: string;
  made: number;
  target: number;
  unit: string;
  /** Uncapped — a stage past its target reads 104%, not 100%. */
  pct: number;
  over: boolean;
}

export interface FloorRoom {
  unitId: string;
  name: string;
  /** What was logged in this room that day, newest first. */
  entries: FloorEntry[];
  /** The room's latest entry — what the card is about. Null when idle. */
  latest: FloorEntry | null;
  /**
   * The latest *producing* entry, when the latest is downtime: the stage the
   * room was running before it stopped, so a cleaning break does not hide how
   * far through Compression it had got.
   */
  lastRun: FloorEntry | null;
  /** Progress of the stage `latest` (or `lastRun`) counts towards. */
  progress: FloorProgress | null;
  job: PipelineJob | null;
  /** Open issues against the batch on the card — not just this room's. */
  openIssues: number;
}

export const isDowntime = (entry: FloorEntry | null) =>
  entry?.process_category === "downtime";

const batchKey = (batchNo: string | null | undefined) =>
  batchNo?.trim().toLowerCase() || null;

/**
 * How far through its stage an entry's room was.
 *
 * `live` is the viewer looking at today: the card then reads the stage's own
 * `accumulated_qty`, which is what the batch tab of the dialog shows — two
 * numbers for one stage on one screen would be the first thing anyone
 * noticed. On an earlier day it reads the entry's `accumulative`, the total
 * as it stood when that entry was filed.
 */
function progressFor(
  entry: FloorEntry,
  stage: BatchStage | undefined,
  live: boolean,
): FloorProgress | null {
  const target = Number(stage?.target_qty ?? entry.required_qty ?? 0);
  if (!target) return null;

  const made = Number(
    live && stage ? stage.accumulated_qty : (entry.accumulative ?? 0),
  );
  return {
    stageName: stage ? stageName(stage) : (entry.process_name ?? "Stage"),
    made,
    target,
    unit: stage?.target_unit ?? entry.qty_unit ?? "",
    pct: Math.round((made / target) * 100),
    over: live && stage ? stage.is_over_tolerance : false,
  };
}

/**
 * Every room in the factory, in room order, each with its day.
 *
 * Idle rooms are kept — "is anything running in 7?" is answered by the empty
 * card — and so is any room that logged that day but has since been
 * deactivated, because its work still happened.
 */
export function buildFloorRooms({
  units,
  entries,
  stages,
  jobs,
  actions,
  live,
}: {
  units: SetupItem[];
  entries: FloorEntry[];
  stages: BatchStage[];
  jobs: PipelineJob[];
  actions: FactoryAction[];
  live: boolean;
}): FloorRoom[] {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const jobByProduct = new Map(jobs.map((j) => [j.product_id, j]));
  const jobByBatch = new Map(jobs.map((j) => [batchKey(j.batch_no), j]));

  const issuesByBatch = new Map<string, number>();
  for (const action of actions) {
    const key = batchKey(action.batch_no);
    if (!key || action.closed_at) continue;
    issuesByBatch.set(key, (issuesByBatch.get(key) ?? 0) + 1);
  }

  const byUnit = new Map<string, FloorEntry[]>();
  for (const entry of entries) {
    const list = byUnit.get(entry.unit_id);
    if (list) list.push(entry);
    else byUnit.set(entry.unit_id, [entry]);
  }

  const rooms = new Map(
    units.filter((u) => u.active).map((u) => [u.id, u.name]),
  );
  for (const entry of entries) {
    if (!rooms.has(entry.unit_id)) {
      rooms.set(entry.unit_id, entry.unit_name ?? "—");
    }
  }

  return [...rooms.entries()].map(([unitId, name]) => {
    const list = byUnit.get(unitId) ?? [];
    const latest = list[0] ?? null;
    const lastRun = isDowntime(latest)
      ? (list.find((e) => !isDowntime(e)) ?? null)
      : null;
    const running = isDowntime(latest) ? lastRun : latest;

    const stage = running?.batch_stage_id
      ? stageById.get(running.batch_stage_id)
      : undefined;
    // The card's batch is the latest entry's, even a downtime one's — a
    // room stopped for a clean-down mid-batch is still that batch's room.
    const batchEntry = latest?.batch_no ? latest : running;
    const job =
      (batchEntry?.product_id && jobByProduct.get(batchEntry.product_id)) ||
      jobByBatch.get(batchKey(batchEntry?.batch_no)) ||
      null;

    return {
      unitId,
      name,
      entries: list,
      latest,
      lastRun,
      progress: running ? progressFor(running, stage, live) : null,
      job,
      openIssues: issuesByBatch.get(batchKey(batchEntry?.batch_no) ?? "") ?? 0,
    };
  });
}

/* ── A room's schedule ────────────────────────────────────────────────── */

export interface RoomScheduleItem {
  stage: BatchStage;
  job: PipelineJob | undefined;
}

export interface RoomSchedule {
  /** Planned for the day being looked at, whatever became of them. */
  onDay: RoomScheduleItem[];
  /** Planned before today and still not signed off. Only asked of today. */
  carriedOver: RoomScheduleItem[];
  /** Planned after the day, soonest first. */
  upcoming: RoomScheduleItem[];
  /** Still to run in this room, with no day set. Only asked of today. */
  unscheduled: RoomScheduleItem[];
}

/**
 * What the plan put in one room, read against one day.
 *
 * Read from `batch_stages.unit_id` / `planned_date` — the plan, not the log.
 * The log says what a room *did*; this says what it was meant to, which on a
 * past day is how a planner checks one against the other.
 */
export function roomSchedule(
  stages: BatchStage[],
  jobs: PipelineJob[],
  unitId: string,
  day: string,
  today: string,
): RoomSchedule {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const inRoom = stages
    .filter((s) => s.unit_id === unitId)
    .map((stage) => ({ stage, job: jobById.get(stage.job_id) }))
    .sort((a, b) => {
      const da = a.stage.planned_date ?? "";
      const db = b.stage.planned_date ?? "";
      if (da !== db) return da < db ? -1 : 1;
      return a.stage.sequence_order - b.stage.sequence_order;
    });

  const isToday = day === today;
  const open = (i: RoomScheduleItem) => i.stage.status !== "complete";

  return {
    onDay: inRoom.filter((i) => i.stage.planned_date === day),
    carriedOver: isToday
      ? inRoom.filter(
          (i) => i.stage.planned_date && i.stage.planned_date < day && open(i),
        )
      : [],
    upcoming: inRoom.filter(
      (i) => i.stage.planned_date && i.stage.planned_date > day,
    ),
    unscheduled: isToday
      ? inRoom.filter((i) => !i.stage.planned_date && open(i))
      : [],
  };
}

/** "14:05" from a stored "14:05:00", or null. */
export function clock(time: string | null | undefined): string | null {
  return time ? time.slice(0, 5) : null;
}

export function fmtQty(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
