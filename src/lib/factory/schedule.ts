import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import { addDays, formatDay } from "@/lib/factory/dates";

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

/* ── The calendar ────────────────────────────────────────────────────────── */

/** Whole days from `a` to `b` (`YYYY-MM-DD`), negative when `b` is earlier. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/** The Monday on or before a day — the calendar's weeks start on Monday. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mon 0 … Sun 6
  return addDays(day, -weekday);
}

/** The days a stage holds its room, both ends inclusive. */
export interface StageSpan {
  start: string;
  end: string;
}

/**
 * Which days a stage occupies its room, or null when it has no day to be drawn
 * on.
 *
 * From the planned date to the estimated finish — a single day when there is
 * no estimate, or when the estimate is earlier than the start (0040 leaves
 * that to the form, so a stale row can still hold one). A **running** stage is
 * on the machine now whatever the plan says: undated, it is drawn today, and
 * past its estimate it stretches to today, because the room is not free until
 * somebody signs the stage off.
 */
export function stageSpan(stage: BatchStage, today: string): StageSpan | null {
  const running = stage.status === "in_progress";
  const start = stage.planned_date?.slice(0, 10) ?? (running ? today : null);
  if (!start) return null;

  const estimate = stage.est_finish_date?.slice(0, 10);
  let end = estimate && estimate >= start ? estimate : start;
  if (running && end < today) end = today;
  return { start, end };
}

/** Two or more stages planned into one room over the same run of days. */
export interface RoomConflict {
  unitId: string;
  unitName: string;
  from: string;
  to: string;
  entries: ScheduledStage[];
}

/**
 * How far ahead clashes are looked for. A typo'd estimate in 2062 would
 * otherwise have the scan walk thirteen thousand days.
 */
const CONFLICT_HORIZON_DAYS = 366;

/**
 * Every room double-booked from today on, a clash per run of days.
 *
 * A room runs one stage a day — the rule `seed-stage-dates.mjs` schedules by —
 * so two stages covering the same day in the same room is a clash. Days with
 * the same stages clashing are merged into one, so a four-day overlap of two
 * batches reads as one conflict and not four.
 *
 * Only from today: a clash on a day already gone cannot be planned away, and
 * the shift log, not the plan, says what that room actually did.
 */
export function findRoomConflicts(
  lanes: RoomLane[],
  today: string,
): RoomConflict[] {
  const horizon = addDays(today, CONFLICT_HORIZON_DAYS);
  const conflicts: RoomConflict[] = [];

  for (const lane of lanes) {
    const spans = lane.stages
      .map((entry) => ({ entry, span: stageSpan(entry.stage, today) }))
      .filter(
        (s): s is { entry: ScheduledStage; span: StageSpan } =>
          s.span !== null && s.span.end >= today && s.span.start <= horizon,
      );
    if (spans.length < 2) continue;

    let first = spans[0].span.start < today ? today : spans[0].span.start;
    let last = spans[0].span.end;
    for (const { span } of spans) {
      if (span.start < first) first = span.start < today ? today : span.start;
      if (span.end > last) last = span.end;
    }
    if (last > horizon) last = horizon;

    let open: RoomConflict | null = null;
    let openKey = "";
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const here = spans.filter((s) => s.span.start <= day && s.span.end >= day);
      const key =
        here.length > 1
          ? here
              .map((s) => s.entry.stage.id)
              .sort()
              .join("|")
          : "";

      if (open && key === openKey) {
        open.to = day;
        continue;
      }
      if (open) conflicts.push(open);
      open = key
        ? {
            unitId: lane.unitId,
            unitName: lane.unitName,
            from: day,
            to: day,
            entries: here.map((s) => s.entry),
          }
        : null;
      openKey = key;
    }
    if (open) conflicts.push(open);
  }

  return conflicts.sort(
    (a, b) =>
      compareDate(a.from, b.from) || byName.compare(a.unitName, b.unitName),
  );
}

/** Room names in reading order — "Room 4" before "Room 10". */
export function compareRoomNames(a: string, b: string): number {
  return byName.compare(a, b);
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
