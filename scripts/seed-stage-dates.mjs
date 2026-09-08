// Seeds `batch_stages.planned_date` (migration 0039) — and, where a stage has
// none, `batch_stages.unit_id` — for one factory, under one rule:
// **a room runs one stage a day**.
//
// The date column landed empty on every plan already on the board, which
// leaves the Room schedule and Gantt tabs with nothing to draw. This fills it
// with a schedule that is actually feasible rather than with a date per row:
// no room is ever asked to run two stages on the same day, a batch's stages
// keep their plan order, and work that has already been signed off is dated in
// the past where it belongs.
//
// Run:  node --env-file=.env.local scripts/seed-stage-dates.mjs <factory-slug>
//       node --env-file=.env.local scripts/seed-stage-dates.mjs gpg-laboratories --dry-run
//       node --env-file=.env.local scripts/seed-stage-dates.mjs gpg-laboratories --force
//       node --env-file=.env.local scripts/seed-stage-dates.mjs gpg-laboratories --from 2026-09-15
//
//   --dry-run   print the schedule, write nothing
//   --force     re-date stages that already have a planned date (default: only
//               fill the empty ones, and treat the dates already there as
//               booked so the new ones schedule around them). Never re-rooms a
//               stage — a room somebody chose is a decision, not a gap.
//   --no-rooms  leave roomless stages roomless (they still get a date)
//   --from      the day forward scheduling starts from (default: today).
//               Only moves work still to come; signed-off stages are dated by
//               their sign-off regardless.
//
// Idempotent: run it twice and the second run has nothing to fill.
//
// Reads from env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-only key — never expose to the browser)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const assignRooms = !args.includes("--no-rooms");
const fromArg = (() => {
  const i = args.indexOf("--from");
  return i >= 0 ? args[i + 1] : undefined;
})();

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: node --env-file=.env.local scripts/seed-stage-dates.mjs <slug>"
  );
  process.exit(1);
}
if (!slug) {
  console.error(
    "Usage: node --env-file=.env.local scripts/seed-stage-dates.mjs <factory-slug> " +
      "[--dry-run] [--force] [--no-rooms] [--from YYYY-MM-DD]"
  );
  process.exit(1);
}
if (fromArg && !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
  console.error(`--from wants YYYY-MM-DD, got "${fromArg}".`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ── Dates ───────────────────────────────────────────────────────────────
   Local-time component arithmetic, never `toISOString()` — parsing
   "2026-09-08" as UTC lands on the 7th for anyone west of Greenwich, and a
   schedule off by a day is worse than no schedule. Same rule the app's
   date-picker follows. */

const toKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const fromKey = (key) => {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (key, n) => {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

/** Today, which is a different question from where the forward pass starts. */
const TODAY = toKey(new Date());

/* ── The room diary ──────────────────────────────────────────────────────
   One room, one stage, one day. Held as a set of "roomId|date" keys, with a
   per-room count beside it so an unassigned stage can be put in the quietest
   room rather than piled onto the first one that happens to be free. */

const booked = new Set();
const load = new Map();
const slotKey = (unitId, date) => `${unitId}|${date}`;

/** The first free day for this room at or after (or before) `from`. */
function firstFreeDay(unitId, from, step = 1) {
  if (!unitId) return from;
  let day = from;
  // A room has ~365 days in a year and a demo factory has a few dozen stages;
  // the guard is only here so a bug cannot spin.
  for (let i = 0; i < 400; i++) {
    if (!booked.has(slotKey(unitId, day))) return day;
    day = addDays(day, step);
  }
  throw new Error(`No free day for room ${unitId} within 400 days of ${from}.`);
}

function claim(unitId, date) {
  if (!unitId) return;
  booked.add(slotKey(unitId, date));
  load.set(unitId, (load.get(unitId) ?? 0) + 1);
}

/* ── Ordering ────────────────────────────────────────────────────────────
   Which batch gets first call on a room. Running batches before planned ones
   — they are already on a machine — then priority, then the earliest due
   date, with undated batches last because a batch nobody has committed to a
   date for is the one to move. Batch number breaks the tie, so two runs of
   this script produce the same schedule. */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { production: 0, on_hold: 1, planned: 2, finished: 3 };

function compareJobs(a, b) {
  const s = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (s) return s;
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p) return p;
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return String(a.batch_no ?? "").localeCompare(String(b.batch_no ?? ""));
}

async function main() {
  const { data: factory, error: fErr } = await admin
    .from("factories")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!factory) throw new Error(`No factory with slug "${slug}".`);

  const base = fromArg ?? TODAY;
  console.log(`Scheduling stages for "${factory.name}" (${factory.slug})`);
  console.log(`  Forward pass starts ${base}${fromArg ? "" : " (today)"}.`);

  const [
    { data: jobs, error: jErr },
    { data: stages, error: sErr },
    { data: units },
    { data: procs },
    { data: logRooms },
  ] = await Promise.all([
    admin
      .from("pipeline_jobs_expanded")
      .select("id, batch_no, status, priority, due_date")
      .eq("factory_id", factory.id),
    admin
      .from("batch_stages")
      .select(
        "id, job_id, process_id, unit_id, sequence_order, label, status, can_run_parallel, planned_date, completed_at"
      )
      .eq("factory_id", factory.id)
      .order("sequence_order", { ascending: true })
      .order("created_at", { ascending: true }),
    admin
      .from("factory_units")
      .select("id, name, active, sort_order")
      .eq("factory_id", factory.id),
    admin
      .from("factory_processes")
      .select("id, name")
      .eq("factory_id", factory.id),
    // Where this factory has actually run each activity. The strongest
    // evidence there is for which room an unplanned stage belongs in — better
    // than any guess from the process name, because it is this plant's answer.
    admin
      .from("shift_log_entries")
      .select("process_id, unit_id")
      .eq("factory_id", factory.id)
      .not("unit_id", "is", null),
  ]);
  if (jErr) throw jErr;
  if (sErr) {
    if (sErr.code === "42703") {
      throw new Error(
        "batch_stages.planned_date is missing — apply migration 0039 in the Supabase SQL Editor first."
      );
    }
    throw sErr;
  }
  if (!stages?.length) {
    console.log("  No planned stages in this factory — nothing to schedule.");
    return;
  }

  const roomName = Object.fromEntries((units ?? []).map((u) => [u.id, u.name]));
  const procName = Object.fromEntries((procs ?? []).map((p) => [p.id, p.name]));
  const jobById = Object.fromEntries((jobs ?? []).map((j) => [j.id, j]));
  const label = (s) =>
    `${procName[s.process_id] ?? "Stage"}${s.label ? ` — ${s.label}` : ""}`;

  /* ── Which room does this activity belong in? ─────────────────────────
     Answered from the factory's own record rather than invented: every room
     this activity has been planned in, and every room it has been *logged*
     in, counted. Mixing has happened in Rooms 5, 7, 12 and 26 here, so a
     Mixing stage nobody roomed goes to one of those before it goes anywhere
     else. Rooms with no such history are the fallback, quietest first, so a
     brand-new activity spreads across the plant instead of stacking up in
     whichever room sorts first. */

  const activeRooms = (units ?? [])
    .filter((u) => u.active)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const evidence = new Map(); // processId → Map(unitId → times seen)
  const note = (processId, unitId) => {
    if (!processId || !unitId || !roomName[unitId]) return;
    if (!evidence.has(processId)) evidence.set(processId, new Map());
    const seen = evidence.get(processId);
    seen.set(unitId, (seen.get(unitId) ?? 0) + 1);
  };
  for (const s of stages) note(s.process_id, s.unit_id);
  for (const e of logRooms ?? []) note(e.process_id, e.unit_id);

  const knownRooms = new Map(); // processId → [unitId] by how often it is used
  function candidateRooms(processId) {
    if (!knownRooms.has(processId)) {
      const seen = evidence.get(processId) ?? new Map();
      knownRooms.set(
        processId,
        [...seen.entries()]
          .filter(([id]) => activeRooms.some((u) => u.id === id))
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => id)
      );
    }
    const known = knownRooms.get(processId);
    const rest = activeRooms
      .map((u) => u.id)
      .filter((id) => !known.includes(id))
      .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));
    return [...known, ...rest];
  }

  /**
   * Where and when this stage goes: its own room if it has one, otherwise the
   * candidate room whose first free day sits closest to `from`.
   *
   * Room and day are picked together because they constrain each other — take
   * the room first and the day can slide a week for no reason, take the day
   * first and there may be no free room on it.
   */
  function place(stage, from, step = 1) {
    if (stage.unit_id) {
      return {
        unitId: stage.unit_id,
        day: firstFreeDay(stage.unit_id, from, step),
        picked: false,
      };
    }
    if (!assignRooms) return { unitId: null, day: from, picked: false };

    let best = null;
    for (const unitId of candidateRooms(stage.process_id)) {
      const day = firstFreeDay(unitId, from, step);
      const closer = !best || (step > 0 ? day < best.day : day > best.day);
      if (closer) best = { unitId, day, picked: true };
      // Nothing can beat the day we asked for.
      if (day === from) break;
    }
    return best ?? { unitId: null, day: from, picked: false };
  }

  const byJob = new Map();
  for (const s of stages) {
    if (!byJob.has(s.job_id)) byJob.set(s.job_id, []);
    byJob.get(s.job_id).push(s);
  }

  /** stage id → the date it ends up on. Only the ones we actually write. */
  const assigned = new Map();
  /** stage id → the room this script chose for it. Never an existing one. */
  const rooms = new Map();
  const roomOf = (s) => rooms.get(s.id) ?? s.unit_id;

  // ── Pass 0: what is already booked ────────────────────────────────────
  // Dates already on rows are the schedule of record unless --force says
  // otherwise. Reading them into the diary first is what makes a second run
  // schedule *around* the first rather than on top of it.
  if (!force) {
    for (const s of stages) if (s.planned_date) claim(s.unit_id, s.planned_date);
  }

  const needsDate = (s) => force || !s.planned_date;

  // ── Pass 1: the stages that already happened ──────────────────────────
  //
  // A signed-off stage is dated by its sign-off, not by the scheduler. Two
  // consequences, and both are the point of running this pass first:
  //
  //   · it lands in the **past**, where completed work belongs — a finished
  //     batch planned for next Thursday reads as a contradiction on the board;
  //   · `--from` does not move it. That flag schedules what is still to come.
  //
  // The date it wants is `completed_at`. Where that is missing the stage still
  // must not land in the future, so the fallback counts back from *today* and
  // never from `base` — with `--from` a week out, `base - 1` is itself a week
  // away, and a stage somebody has already signed off would be planned for it.
  //
  // Collisions walk backwards: the work is done, so the only thing left to
  // move is which day the plan claims it was meant to run.
  for (const s of stages) {
    if (!needsDate(s) || s.status !== "complete") continue;
    const want = s.completed_at
      ? toKey(new Date(s.completed_at))
      : addDays(TODAY, -1);
    const { unitId, day, picked } = place(s, want, -1);
    claim(unitId, day);
    assigned.set(s.id, day);
    if (picked) rooms.set(s.id, unitId);
  }

  // ── Pass 2: everything still to run ───────────────────────────────────
  //
  // Per batch, in plan order, one day per stage — the cursor only holds still
  // for a stage that may run in parallel with the one before it, or for two
  // stages the board says are *both* in progress, which is a plant genuinely
  // running them side by side. Then the room diary decides: from the cursor
  // day, forward to the first day that room is free.
  const order = [...byJob.keys()].sort((a, b) =>
    compareJobs(jobById[a] ?? {}, jobById[b] ?? {})
  );

  for (const jobId of order) {
    const rows = byJob.get(jobId);
    let cursor = base;
    let previous = null;

    for (const s of rows) {
      if (s.status === "complete") {
        // Dated by pass 1, and deliberately *not* left as the cursor's
        // predecessor: a stage whose forerunner is already signed off can
        // start today, and treating it as "the day after Mixing" would push
        // every remaining stage of a half-run batch one day into the future
        // for no reason anybody could point at.
        previous = null;
        continue;
      }
      if (!needsDate(s)) {
        cursor = s.planned_date > cursor ? s.planned_date : cursor;
        previous = s;
        continue;
      }

      const sameDayAsPrevious =
        previous !== null &&
        (s.can_run_parallel ||
          (s.status === "in_progress" && previous.status === "in_progress"));

      if (previous !== null && !sameDayAsPrevious) cursor = addDays(cursor, 1);

      const { unitId, day, picked } = place(s, cursor, 1);
      claim(unitId, day);
      assigned.set(s.id, day);
      if (picked) rooms.set(s.id, unitId);
      cursor = day;
      previous = s;
    }
  }

  // ── The schedule, said before it is written ───────────────────────────
  const stillRoomless = stages.filter((s) => !roomOf(s)).length;

  console.log(
    `\n  ${assigned.size} of ${stages.length} stages dated` +
      (rooms.size ? `, ${rooms.size} given a room` : "") +
      "."
  );
  if (stillRoomless) {
    console.log(
      `  ${stillRoomless} still have no room` +
        (assignRooms
          ? " — no active room was available."
          : " (--no-rooms), so nothing reserves a day for them.")
    );
  }

  for (const jobId of order) {
    const job = jobById[jobId] ?? {};
    console.log(`\n  ${job.batch_no ?? jobId} [${job.status ?? "?"}]`);
    for (const s of byJob.get(jobId)) {
      const day = assigned.get(s.id) ?? s.planned_date;
      const mark = assigned.has(s.id) ? " " : "·";
      const room = (roomName[roomOf(s)] ?? "No room") + (rooms.has(s.id) ? "*" : "");
      console.log(
        `   ${mark} ${String(s.sequence_order).padEnd(2)} ${day ?? "—"}  ` +
          `${room.padEnd(10)} ${label(s)} (${s.status})`
      );
    }
  }
  if (rooms.size) console.log("\n  * room assigned by this run.");

  // ── The invariants, checked rather than assumed ───────────────────────
  const seen = new Map();
  for (const s of stages) {
    const day = assigned.get(s.id) ?? s.planned_date;
    const room = roomOf(s);
    if (!day || !room) continue;
    const key = slotKey(room, day);
    if (seen.has(key)) {
      throw new Error(
        `Double-booked: ${roomName[room]} on ${day} holds both ` +
          `"${label(seen.get(key))}" and "${label(s)}". Nothing was written.`
      );
    }
    seen.set(key, s);
  }

  const future = stages.filter(
    (s) => s.status === "complete" && (assigned.get(s.id) ?? s.planned_date) > TODAY
  );
  if (future.length) {
    throw new Error(
      `${future.length} signed-off stage(s) would be dated in the future ` +
        `(${label(future[0])} on ${assigned.get(future[0].id)}). Nothing was written.`
    );
  }

  console.log(
    `\n  ✓ No room runs two stages on one day (${seen.size} room-days booked).` +
      "\n  ✓ Every signed-off stage is dated on or before today."
  );

  if (!assigned.size && !rooms.size) {
    console.log(
      "\n  Nothing to write — every stage already has a date. Use --force to re-date."
    );
    return;
  }
  if (dryRun) {
    console.log("\n  --dry-run: nothing written.");
    return;
  }

  // One update per stage rather than an upsert: an upsert is an insert with a
  // conflict clause, so PostgREST sends every row as a candidate insert — and
  // a row carrying only an id and a date has no job_id or process_id to insert
  // with. The same trap `swapStageOrder` documents.
  const touched = new Set([...assigned.keys(), ...rooms.keys()]);
  let written = 0;
  for (const id of touched) {
    const patch = {};
    if (assigned.has(id)) patch.planned_date = assigned.get(id);
    if (rooms.has(id)) patch.unit_id = rooms.get(id);
    const { error } = await admin.from("batch_stages").update(patch).eq("id", id);
    if (error) throw new Error(`${id}: ${error.message}`);
    written++;
  }

  console.log(
    `\n✓ ${written} stages updated — open /factory/${factory.slug}/pipeline to see the plans.`
  );
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
