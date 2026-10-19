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

/** A room as the factory's setup lists it — all the schedule needs of one. */
export interface ScheduleRoom {
  id: string;
  name: string;
  active: boolean;
}

/** A room with nothing left to run — shown as Idle, not hidden. */
export function isIdle(lane: RoomLane): boolean {
  return lane.stages.length === 0;
}

/**
 * Every room the factory has, each with the work still on it in order.
 *
 * **Every active room gets a lane**, busy or not. A planner looking for a free
 * room needs to see which ones are free, and a board that lists only the busy
 * rooms cannot say so — an idle room just looked like a room that did not
 * exist. Idle lanes sort after the busy ones (`isIdle`) and views label them.
 * An *inactive* room is left out unless it still has work on it, because
 * work already planned into a room is never hidden.
 *
 * Two things are still filtered out, and each is a deliberate answer rather
 * than tidying:
 *
 *   · **Signed-off stages.** The schedule answers "what is coming", and a
 *     finished stage is history — it belongs to the batch record, which keeps
 *     it. Leaving it here would put a room's whole past at the head of its
 *     queue.
 *   · **Roomless stages.** A stage nobody has assigned a room to cannot be
 *     drawn in a room. It is not lost: `stagesWithoutRoom` counts them so the
 *     view can say so rather than quietly shrinking.
 */
export function buildRoomLanes(
  stages: BatchStage[],
  jobs: PipelineJob[],
  rooms: ScheduleRoom[],
): RoomLane[] {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const lanes = new Map<string, RoomLane>();

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  for (const room of rooms) {
    if (!room.active) continue;
    lanes.set(room.id, {
      unitId: room.id,
      unitName: room.name,
      stages: [],
      pending: 0,
      nextDate: null,
    });
  }

  for (const stage of stages) {
    if (stage.status === "complete") continue;
    if (!stage.unit_id) continue;

    let lane = lanes.get(stage.unit_id);
    if (!lane) {
      lane = {
        unitId: stage.unit_id,
        unitName:
          roomName.get(stage.unit_id) ?? stage.unit_name ?? "Unnamed room",
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
  // Busy-but-undated rooms follow, and idle rooms close the list; both tails
  // are ordered by name so they are still scannable.
  return [...lanes.values()].sort((a, b) => {
    const idle = Number(isIdle(a)) - Number(isIdle(b));
    if (idle) return idle;
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
 * that to the form, so a stale row can still hold one). Only the planned
 * window: a stage that has overrun its estimate is *not* stretched to today,
 * so a stage nobody has signed off yet does not hold a room on days the plan
 * never gave it. It is still marked behind plan / past its estimate. The one
 * allowance is a **running** stage with no planned date, which is drawn today —
 * it is on the machine now and has no other day to be drawn on.
 */
export function stageSpan(stage: BatchStage, today: string): StageSpan | null {
  const running = stage.status === "in_progress";
  const start = stage.planned_date?.slice(0, 10) ?? (running ? today : null);
  if (!start) return null;

  const estimate = stage.est_finish_date?.slice(0, 10);
  const end = estimate && estimate >= start ? estimate : start;
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
 * How far either side of today clashes are looked for. A typo'd estimate in
 * 2062 would otherwise have the scan walk thirteen thousand days.
 */
const CONFLICT_HORIZON_DAYS = 366;

/**
 * Shared days it takes before two planned stages in one room are a clash.
 *
 * The plan holds days, not hours, so a stage ending on the 18th and the next
 * starting on the 18th is a handoff — one after the other the same day — and
 * not a double booking. Two days or more cannot be a handoff.
 */
export const CLASH_MIN_DAYS = 2;

/** One stage, reduced to what the clash rule reads. */
export interface ClashItem {
  id: string;
  start: string;
  end: string;
  /** Started and not signed off — physically in the room right now. */
  running: boolean;
}

/**
 * The days two stages in one room clash over, or null when they do not.
 *
 * The one rule for the whole app — the Board's banner and chips, the
 * calendar's red days and the notice while a plan is typed all read it:
 *
 *   · two **running** stages clash on any shared day. Both are on the machine,
 *     and a room runs one stage at a time — that is not a handoff.
 *   · otherwise they clash only over `CLASH_MIN_DAYS` or more shared days.
 */
export function clashRange(
  a: Omit<ClashItem, "id">,
  b: Omit<ClashItem, "id">,
): { from: string; to: string } | null {
  const from = a.start > b.start ? a.start : b.start;
  const to = a.end < b.end ? a.end : b.end;
  if (from > to) return null;
  const shared = dayDiff(from, to) + 1;
  const needed = a.running && b.running ? 1 : CLASH_MIN_DAYS;
  return shared >= needed ? { from, to } : null;
}

/** Every pair of stages in one room that clash, with the days they clash on. */
export function clashPairs(
  items: ClashItem[],
): { a: string; b: string; from: string; to: string }[] {
  const pairs: { a: string; b: string; from: string; to: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const range = clashRange(items[i], items[j]);
      if (range) pairs.push({ a: items[i].id, b: items[j].id, ...range });
    }
  }
  return pairs;
}

/**
 * Every double-booked room, a clash per run of days.
 *
 * What counts as a clash is `clashRange`. Days with the same stages clashing
 * are merged into one, so a four-day overlap of two batches reads as one
 * conflict and not four.
 *
 * Days already gone are included. The lanes hold only stages that are not
 * signed off, so an overlap in the past is two stages still open in one room —
 * not history, and exactly what a planner has to settle by re-dating one or
 * signing it off. (The shift log, not the plan, is the record of what a room
 * did; a signed-off stage never reaches this function.)
 */
export function findRoomConflicts(
  lanes: RoomLane[],
  today: string,
): RoomConflict[] {
  const horizon = addDays(today, CONFLICT_HORIZON_DAYS);
  const floor = addDays(today, -CONFLICT_HORIZON_DAYS);
  const conflicts: RoomConflict[] = [];

  for (const lane of lanes) {
    const spans = lane.stages
      .map((entry) => ({ entry, span: stageSpan(entry.stage, today) }))
      .filter(
        (s): s is { entry: ScheduledStage; span: StageSpan } =>
          s.span !== null && s.span.end >= floor && s.span.start <= horizon,
      );
    if (spans.length < 2) continue;

    const byId = new Map(spans.map((s) => [s.entry.stage.id, s.entry]));
    const pairs = clashPairs(
      spans.map(({ entry, span }) => ({
        id: entry.stage.id,
        start: span.start,
        end: span.end,
        running: entry.stage.status === "in_progress",
      })),
    );
    if (pairs.length === 0) continue;

    let first = pairs[0].from < floor ? floor : pairs[0].from;
    let last = pairs[0].to;
    for (const p of pairs) {
      const from = p.from < floor ? floor : p.from;
      if (from < first) first = from;
      if (p.to > last) last = p.to;
    }
    if (last > horizon) last = horizon;

    let open: RoomConflict | null = null;
    let openKey = "";
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const involved = new Set<string>();
      for (const p of pairs) {
        if (p.from <= day && p.to >= day) {
          involved.add(p.a);
          involved.add(p.b);
        }
      }
      const key = involved.size > 0 ? [...involved].sort().join("|") : "";

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
            entries: [...involved]
              .map((id) => byId.get(id))
              .filter((e): e is ScheduledStage => Boolean(e)),
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

/* ── Clash check while planning ──────────────────────────────────────────── */

/**
 * A room held over a run of days — an existing stage, or a stage still being
 * typed. The same unit `findRoomConflicts` compares, in a shape a form can
 * build before anything is saved.
 */
export interface RoomSlot {
  /** A stage id for a saved stage; anything unique for a draft row. */
  key: string;
  /** The batch this belongs to — lets a dialog leave its own batch out. */
  jobId: string | null;
  unitId: string;
  start: string;
  end: string;
  /** Started and not signed off — see `clashRange`. */
  running: boolean;
  /** "46686 · Mixing" — what the notice names. */
  label: string;
}

/**
 * The room a stage being planned would hold, or null when it cannot clash yet
 * (no room, no start) or when it is wholly in the past — a day already gone
 * cannot be planned away, the same rule `findRoomConflicts` keeps.
 */
export function draftSlot(
  draft: {
    unitId?: string | null;
    plannedDate?: string | null;
    estFinishDate?: string | null;
    /** The stage is already running — only a saved stage can be. */
    running?: boolean;
  },
  today: string,
): { unitId: string; start: string; end: string; running: boolean } | null {
  const start = draft.plannedDate?.slice(0, 10);
  if (!draft.unitId || !start) return null;
  const finish = draft.estFinishDate?.slice(0, 10);
  const end = finish && finish >= start ? finish : start;
  if (end < today) return null;
  return { unitId: draft.unitId, start, end, running: draft.running ?? false };
}

/** The saved stages that still hold a room from today on, as slots. */
export function roomSlots(
  stages: BatchStage[],
  jobs: PipelineJob[],
  today: string,
): RoomSlot[] {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const slots: RoomSlot[] = [];
  for (const stage of stages) {
    if (stage.status === "complete" || !stage.unit_id) continue;
    const span = stageSpan(stage, today);
    if (!span || span.end < today) continue;
    const batchNo = jobById.get(stage.job_id)?.batch_no;
    const name = stage.process_name ?? "Stage";
    slots.push({
      key: stage.id,
      jobId: stage.job_id,
      unitId: stage.unit_id,
      start: span.start,
      end: span.end,
      running: stage.status === "in_progress",
      label: batchNo ? `${batchNo} · ${name}` : name,
    });
  }
  return slots;
}

/** The slots a plan being typed clashes with — by `clashRange`, same room. */
export function slotClashes(
  candidate: {
    unitId: string;
    start: string;
    end: string;
    running: boolean;
  } | null,
  others: RoomSlot[],
): RoomSlot[] {
  if (!candidate) return [];
  return others.filter(
    (o) => o.unitId === candidate.unitId && clashRange(candidate, o) !== null,
  );
}

/** What a stage being planned clashes with, and the next dates that are free. */
export interface SlotCheck {
  clashes: RoomSlot[];
  /**
   * The first later day the room is free for a stage of this length, and how
   * long it stays free: `end` is the last free day, or null when nothing is
   * booked in the room after that (free "onwards").
   */
  free: { start: string; end: string | null } | null;
}

/**
 * The clashes of a plan being typed, and — when there are any — where the room
 * is next free and for how long.
 *
 * The start is the first day, after the one the planner typed, that a stage
 * of this length fits without clashing ("later" because an earlier day would
 * say the plan they just made was wrong, not where it can go). The end is how
 * far that gap runs — to the next booking in the room, or none ("onwards"),
 * so the planner sees the whole opening and not just a window their stage
 * happens to fill. Free is by `clashRange` itself, so a start on the last day
 * of a booking counts when that is only a handoff. Looks a year ahead and no
 * further.
 */
export function slotCheck(
  candidate: {
    unitId: string;
    start: string;
    end: string;
    running: boolean;
  } | null,
  others: RoomSlot[],
): SlotCheck {
  const clashes = slotClashes(candidate, others);
  if (!candidate || clashes.length === 0) return { clashes, free: null };

  const length = dayDiff(candidate.start, candidate.end);
  const limit = addDays(candidate.start, CONFLICT_HORIZON_DAYS);
  for (let start = addDays(candidate.start, 1); start <= limit; start = addDays(start, 1)) {
    const probe = { ...candidate, start, end: addDays(start, length) };
    if (slotClashes(probe, others).length === 0) {
      // Stretch the window until the next booking gets in the way.
      let end = probe.end;
      while (end < limit) {
        const next = addDays(end, 1);
        if (slotClashes({ ...probe, end: next }, others).length > 0) break;
        end = next;
      }
      return {
        clashes,
        free: { start: probe.start, end: end >= limit ? null : end },
      };
    }
  }
  return { clashes, free: null };
}

/** 0 = Monday … 6 = Sunday — the order the calendar is drawn in. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/**
 * When a busy room is next free: the first working day from today that none
 * of its open stages covers, and how long that opening lasts — `until` is the
 * last free day before the next booking, or null when nothing is booked after.
 *
 * "Covers" is the stage's planned span (`stageSpan`), so this answers what a
 * planner reads off the row: Capsule Pack holds 18–23 Oct, the room is free
 * from the 24th. Closed days (`isClosed` — holidays and weekly days off) are
 * skipped for the start, since a free Sunday the plant does not work is not
 * when anything can run. Null when nothing is free within a year.
 */
export function roomFreeFrom(
  lane: RoomLane,
  today: string,
  isClosed: (day: string) => boolean = () => false,
): { from: string; until: string | null } | null {
  const spans = lane.stages
    .map((s) => stageSpan(s.stage, today))
    .filter((s): s is StageSpan => s !== null);
  const covered = (day: string) =>
    spans.some((s) => s.start <= day && s.end >= day);

  const limit = addDays(today, CONFLICT_HORIZON_DAYS);
  // A `while` over a variable declared outside it, not `for (let day …)`:
  // Turbopack's dev build mis-compiled the `for` form — with a closure in
  // the body capturing the loop variable it left `addDays` in the update
  // step un-rewritten ("addDays is not defined" at runtime).
  let day = today;
  while (day <= limit) {
    if (!covered(day) && !isClosed(day)) {
      const from = day;
      const next = spans
        .map((s) => s.start)
        .filter((start) => start > from)
        .sort()[0];
      return { from, until: next ? addDays(next, -1) : null };
    }
    day = addDays(day, 1);
  }
  return null;
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
 * Tuesday and it is late. `today` is passed in (`useRenderClock`), never read
 * here, so a component can call this in render.
 */
export function relativeDay(iso: string | null, today: string): string | null {
  if (!iso) return null;
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
