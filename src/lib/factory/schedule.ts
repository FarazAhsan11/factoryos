import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import { formatDay } from "@/lib/factory/dates";

/**
 * Pipeline → Schedule. The plan read the other way round.
 *
 * Every other view in this module is organised by *batch*: the Kanban card,
 * the plan dialog, the families tree. A planner standing in front of the
 * board does not have that question. Theirs is "what is Room 4 doing, and
 * what comes off it next" — which is the same rows sorted by room and by day,
 * and is the one arrangement the module could not produce.
 *
 * This is a pure derivation over data the workspace already holds — the
 * factory's stages (`fetchFactoryStages`) and its jobs (`fetchPipelineJobs`) —
 * so the Schedule costs no extra request. It is a module of its own rather
 * than a `useMemo` in the view because both views need the same lanes, and
 * two implementations of "what is next in this room" would drift.
 */

/** One stage, with the batch it belongs to already attached. */
export interface ScheduledStage {
  stage: BatchStage;
  /**
   * The batch. Optional in the type and never in practice: a stage without a
   * job cannot exist (`job_id` is `not null` with a cascade), but the join is
   * done in the client against a separately-fetched list, and a view that
   * crashes because one query resolved a beat later is not worth the
   * confidence.
   */
  job: PipelineJob | undefined;
}

/** One room, and everything still to run in it, soonest first. */
export interface RoomLane {
  unitId: string;
  unitName: string;
  stages: ScheduledStage[];
  /** Stages here that have not started — the queue behind what is running. */
  pending: number;
  /** The soonest planned date in this room, or null when nothing is dated. */
  nextDate: string | null;
}

/**
 * "Room 4" before "Room 10".
 *
 * Room names are numbers with a word in front and sometimes a letter after —
 * 17A, 17B, 21A. Plain string ordering puts Room 10 before Room 4 and reads
 * as a sorting bug to everyone who sees it, so the digits are compared as
 * digits. `Intl.Collator` with `numeric` does exactly this and does it in one
 * pass, unlike a hand-rolled split that has to guess where the number is.
 */
const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Undated stages sort last, not first.
 *
 * A null date is "nobody has scheduled this yet", which is the opposite of
 * "runs first" — and `null < "2026-09-15"` in every naive comparison, so the
 * unscheduled tail would otherwise head the queue in every room.
 */
function compareDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

/**
 * What is running comes first, whatever the calendar says.
 *
 * A stage in progress is on the machine now. If its planned date has slipped
 * behind a stage planned for tomorrow, the calendar would put tomorrow's work
 * at the head of the room — describing a room that is free when somebody is
 * standing in it.
 */
function compareStages(a: BatchStage, b: BatchStage): number {
  const running = Number(b.status === "in_progress") - Number(a.status === "in_progress");
  if (running) return running;

  const date = compareDate(a.planned_date, b.planned_date);
  if (date) return date;

  if (a.sequence_order !== b.sequence_order) {
    return a.sequence_order - b.sequence_order;
  }
  return a.created_at < b.created_at ? -1 : 1;
}

/**
 * The rooms with work still on them, each with that work in order.
 *
 * Three things are filtered out, and each is a deliberate answer rather than
 * tidying:
 *
 *   · **Signed-off stages.** The schedule answers "what is coming", and a
 *     finished stage is history — it belongs to the batch record, which keeps
 *     it. Leaving it here would put a room's whole past at the head of its
 *     queue.
 *   · **Roomless stages.** A stage nobody has assigned a room to cannot be
 *     drawn in a room. It is not lost: `stagesWithoutRoom` counts them so the
 *     view can say so rather than quietly shrinking.
 *   · **Rooms with nothing left.** A lane of dashes tells a planner nothing,
 *     and twenty-five of them buries the four rooms that matter.
 */
export function buildRoomLanes(
  stages: BatchStage[],
  jobs: PipelineJob[],
): RoomLane[] {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const lanes = new Map<string, RoomLane>();

  for (const stage of stages) {
    if (stage.status === "complete") continue;
    if (!stage.unit_id) continue;

    let lane = lanes.get(stage.unit_id);
    if (!lane) {
      lane = {
        unitId: stage.unit_id,
        unitName: stage.unit_name ?? "Unnamed room",
        stages: [],
        pending: 0,
        nextDate: null,
      };
      lanes.set(stage.unit_id, lane);
    }
    lane.stages.push({ stage, job: jobById.get(stage.job_id) });
  }

  for (const lane of lanes.values()) {
    lane.stages.sort((a, b) => compareStages(a.stage, b.stage));
    lane.pending = lane.stages.filter(
      (s) => s.stage.status === "pending",
    ).length;
    // The soonest *dated* stage, which is not necessarily the first in the
    // lane: a running stage heads the queue even when it has no date at all.
    lane.nextDate =
      lane.stages
        .map((s) => s.stage.planned_date)
        .filter((d): d is string => Boolean(d))
        .sort()[0] ?? null;
  }

  // Rooms with the nearest work first — that is the whole point of the board,
  // and it is what "the nearest coming day" means once every room is a lane.
  // Undated rooms sit at the end, ordered by name so the tail is still
  // scannable.
  return [...lanes.values()].sort((a, b) => {
    const date = compareDate(a.nextDate, b.nextDate);
    if (date) return date;
    return byName.compare(a.unitName, b.unitName);
  });
}

/**
 * Stages still to run that no room has been assigned to.
 *
 * Counted rather than dropped silently: they are exactly the rows a planner
 * has to fix before the schedule is complete, and a board that just doesn't
 * show them is a board that quietly under-reports the plant's load.
 */
export function stagesWithoutRoom(stages: BatchStage[]): BatchStage[] {
  return stages.filter((s) => s.status !== "complete" && !s.unit_id);
}

/** Local `YYYY-MM-DD` — the app never derives a day from `toISOString()`. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "15 Sep 2026", or a dash — the app's one date format (`formatDay`). */
export function formatShortDate(iso: string | null): string {
  return iso ? formatDay(iso) : "—";
}

/**
 * How a date reads against today: "Today", "Tomorrow", "3 days late".
 *
 * Days rather than a date wherever the gap is what matters — a planner
 * scanning a room does not care that it is the 15th, they care that it is
 * Tuesday and it is late.
 */
export function relativeDay(iso: string | null): string | null {
  if (!iso) return null;
  const today = todayKey();
  if (iso === today) return "Today";

  const [ay, am, ad] = iso.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = today.split("-").map(Number);
  const days = Math.round(
    (new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) /
      86_400_000,
  );

  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day late";
  return days > 0 ? `In ${days} days` : `${-days} days late`;
}
