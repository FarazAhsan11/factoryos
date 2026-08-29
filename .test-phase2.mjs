/**
 * Stage planning, end to end, against the live database.
 *
 * Two clients on purpose:
 *   svc  service role — seeds and cleans up, bypasses RLS.
 *   usr  a real signed-in session — every write that must pass a gate goes
 *        through here, so the policies and triggers are actually exercised
 *        rather than bypassed.
 *
 * All test data is tagged and removed in `finally`, including on failure.
 */
import { createClient } from "@supabase/supabase-js";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const usr = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

const TAG = "ZZS" + Date.now().toString().slice(-7);
let pass = 0,
  fail = 0;
const products = [], jobs = [], entries = [], stages = [];

const ok = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`))
    : (fail++, console.log(`  FAIL  ${n}${d ? "  -> " + d : ""}`));
};
const eq = (n, got, want) =>
  ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

async function refused(name, promise, expect) {
  const { error } = await promise;
  if (!error) return ok(name, false, "was ACCEPTED but should have been refused");
  ok(name, error.message.includes(expect), `wrong error: ${error.message}`);
}
async function accepted(name, promise) {
  const { error } = await promise;
  ok(name, !error, error?.message);
  return !error;
}

const section = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

try {
  /* ── sign in ─────────────────────────────────────────────────────────── */
  const { data: auth, error: authErr } = await usr.auth.signInWithPassword({
    email: process.env.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD,
  });
  if (authErr) throw new Error(`sign in: ${authErr.message}`);
  const ME = auth.user.id;

  /* ── context ─────────────────────────────────────────────────────────── */
  const { data: facs } = await svc.from("factories").select("id, name");
  let F = null, ctx = null;
  for (const f of facs) {
    const [u, prod, prep, down] = await Promise.all([
      svc.from("factory_units").select("id").eq("factory_id", f.id).limit(1).maybeSingle(),
      svc.from("factory_processes").select("id, name").eq("factory_id", f.id).eq("category", "production").limit(1).maybeSingle(),
      svc.from("factory_processes").select("id, name").eq("factory_id", f.id).eq("category", "preparatory").limit(1).maybeSingle(),
      svc.from("factory_processes").select("id, name").eq("factory_id", f.id).eq("category", "downtime").limit(1).maybeSingle(),
    ]);
    if (u.data && prod.data && prep.data && down.data) {
      F = f.id;
      ctx = { unit: u.data, prod: prod.data, prep: prep.data, down: down.data };
      console.log(`factory: ${f.name}\nsigned in as: ${process.env.SEED_SUPER_ADMIN_EMAIL}`);
      break;
    }
  }
  if (!F) throw new Error("no factory has a unit + production, preparatory and downtime processes");

  const product = async (suffix, qty) => {
    const { data, error } = await svc.from("factory_products")
      .insert({ factory_id: F, batch_no: `${TAG}-${suffix}`, name: `Test ${suffix}`, required_qty: qty })
      .select("id").single();
    if (error) throw new Error(`seed product: ${error.message}`);
    products.push(data.id);
    return data.id;
  };
  const job = async (productId, patch = {}) => {
    const { data, error } = await svc.from("pipeline_jobs")
      .insert({ factory_id: F, product_id: productId, ...patch }).select("id").single();
    if (error) throw new Error(`seed job: ${error.message}`);
    jobs.push(data.id);
    return data.id;
  };
  const stage = async (jobId, processId, patch = {}) => {
    const { data, error } = await usr.from("batch_stages")
      .insert({ factory_id: F, job_id: jobId, process_id: processId, ...patch })
      .select("id, sequence_order, is_final").single();
    if (error) throw new Error(`seed stage: ${error.message}`);
    stages.push(data.id);
    return data;
  };
  const plan = async (jobId) =>
    (await svc.from("batch_stages")
      .select("id, sequence_order, is_final, status, target_qty, accumulated_qty, yield_pct, label, previous_target_qty")
      .eq("job_id", jobId).order("sequence_order")).data;
  const entry = async (client, productId, batchNo, processId, patch = {}) => {
    const res = await client.from("shift_log_entries").insert({
      factory_id: F, unit_id: ctx.unit.id, process_id: processId, product_id: productId,
      log_date: "2020-01-02", shift: "morning", start_time: "06:00", end_time: "07:00",
      duration_minutes: 60, batch_no: batchNo, operators: [], logged_by: ME, ...patch,
    }).select("id, batch_stage_id").single();
    if (res.data) entries.push(res.data.id);
    return res;
  };

  /* ── A. schema state after the migration ─────────────────────────────── */
  section("A. schema state");
  const bs = await svc.from("batch_stages").select("id").limit(1);
  ok("batch_stages exists", !bs.error, bs.error?.message);
  const oldFlag = await svc.from("factory_processes").select("is_final_stage").limit(1);
  ok("factory_processes.is_final_stage is dropped", Boolean(oldFlag.error), "column still present");
  const { count: unissued } = await svc.from("pipeline_jobs")
    .select("*", { count: "exact", head: true }).is("issued_at", null);
  eq("every pre-existing job was marked issued", unissued, 0);
  const { count: backfilled } = await svc.from("batch_stages").select("*", { count: "exact", head: true });
  ok("stages were reconstructed from history", backfilled > 0, `got ${backfilled}`);

  /* ── B. app select lists still resolve ───────────────────────────────── */
  section("B. regression — live select lists");
  const lists = [
    ["pipeline board", "pipeline_jobs_expanded",
      "id, product_id, status, unit_id, hold_reason, planned_at, started_at, held_at, finished_at, batch_no, product_code, product_name, required_qty, unit_name, produced_qty, flagged_count, batch_type, parent_job_id, bulk_unit, pack_size, pack_unit, bulk_qty_received, market, overage_pct, priority, due_date, notes, parent_batch_no, parent_product_name, child_count, allocated_qty, bulk_consumed, issued_at, stage_count, stages_complete, stages_without_target, final_target_qty"],
    ["data table", "shift_log_entries_expanded",
      "id, unit_name, process_name, product_name, product_code, batch_no, batch_stage_id, stage_label, stage_work_order, accumulative, required_qty, allowed_qty, overage_pct, is_overrun, overrun_qty, needs_overrun_note, process_category, qty_unit"],
    ["shift log feed", "shift_log_entries", "id, batch_stage_id, qty, qty_rejected, operators"],
    ["plan stages", "batch_stages",
      "id, job_id, process_id, sequence_order, label, work_order, target_qty, target_unit, pack_size, accumulated_qty, status, is_final, started_at, completed_at, yield_pct, yield_acceptable, yield_notes, previous_target_qty, created_at, process:factory_processes ( name, category ), completed_by_profile:profiles!batch_stages_completed_by_fkey ( full_name )"],
  ];
  for (const [label, table, cols] of lists) {
    const { error } = await svc.from(table).select(cols).limit(1);
    ok(label, !error, error?.message);
  }

  /* ── C. the plan, and which stage is final ───────────────────────────── */
  section("C. the plan — is_final follows position");
  const pA = await product("A", 210000);
  const jA = await job(pA);
  const s1 = await stage(jA, ctx.prep.id, { target_unit: "kg" });
  const s2 = await stage(jA, ctx.prod.id, { target_unit: "tablets" });
  let p = await plan(jA);
  eq("stages append in order", p.map((x) => x.sequence_order), [1, 2]);
  eq("only the last is final", p.map((x) => x.is_final), [false, true]);

  const s3 = await stage(jA, ctx.prod.id, { label: "Packing", target_unit: "bottles" });
  p = await plan(jA);
  eq("adding a stage moves the final tag to it", p.map((x) => x.is_final), [false, false, true]);

  await usr.from("batch_stages").update({ sequence_order: 3 }).eq("id", s2.id);
  await usr.from("batch_stages").update({ sequence_order: 2 }).eq("id", s3.id);
  p = await plan(jA);
  eq("reordering moves it back", p.map((x) => [x.sequence_order, x.is_final]),
     [[1, false], [2, false], [3, true]]);
  ok("the final stage is the one now last", p[2].id === s2.id);

  await refused("downtime cannot be planned",
    usr.from("batch_stages").insert({ factory_id: F, job_id: jA, process_id: ctx.down.id }),
    "Downtime is logged, not planned");

  /* ── D. the issue gate ───────────────────────────────────────────────── */
  section("D. the issue gate");
  const pEmpty = await product("EMPTY", 100);
  const jEmpty = await job(pEmpty);
  await refused("a batch with no plan cannot be issued",
    usr.rpc("issue_job", { p_job: jEmpty }), "Plan this batch's stages");

  await refused("a plan with missing targets cannot be issued",
    usr.rpc("issue_job", { p_job: jA }), "still need a target");

  for (const [id, qty] of [[s1.id, 500], [s3.id, 1000], [s2.id, 210000]]) {
    await usr.from("batch_stages").update({ target_qty: qty }).eq("id", id);
  }
  await accepted("with every target set, it issues", usr.rpc("issue_job", { p_job: jA }));
  await accepted("issuing twice is a no-op, not an error", usr.rpc("issue_job", { p_job: jA }));

  /* ── E. the shift log's side of the gate ─────────────────────────────── */
  section("E. shift log — what an unissued batch accepts");
  await refused("a producing entry on an unissued batch is refused",
    entry(usr, pEmpty, `${TAG}-EMPTY`, ctx.prod.id, { qty: 10, qty_rejected: 0 }),
    "has not been issued for production");
  await accepted("downtime on the same batch is always allowed",
    entry(usr, pEmpty, `${TAG}-EMPTY`, ctx.down.id));

  section("F. stage resolution");
  const e1 = await entry(usr, pA, `${TAG}-A`, ctx.prep.id, { qty: 200, qty_rejected: 0, qty_unit: "kg" });
  ok("a single matching stage resolves itself", e1.data?.batch_stage_id === s1.id,
     `got ${e1.data?.batch_stage_id}`);

  // Two stages share the production process on this batch (s2 and s3).
  await refused("an activity the batch runs twice must say which",
    entry(usr, pA, `${TAG}-A`, ctx.prod.id, { qty: 5, qty_rejected: 0 }),
    "runs this activity more than once");
  const e2 = await entry(usr, pA, `${TAG}-A`, ctx.prod.id,
    { qty: 5, qty_rejected: 0, batch_stage_id: s3.id });
  ok("naming the stage is accepted", e2.data?.batch_stage_id === s3.id, e2.error?.message);

  // A batch that IS issued, but whose plan has no row for the activity being
  // logged — the case that proves the refusal is about the plan, not the gate.
  const pNo = await product("NOPLAN", 100);
  const jNo = await job(pNo);
  await stage(jNo, ctx.prep.id, { target_qty: 50, target_unit: "kg" });
  await accepted("a one-stage plan issues", usr.rpc("issue_job", { p_job: jNo }));
  await refused("an activity absent from the plan is refused",
    entry(usr, pNo, `${TAG}-NOPLAN`, ctx.prod.id, { qty: 1, qty_rejected: 0 }),
    "not in batch");

  /* ── G. accumulation ─────────────────────────────────────────────────── */
  section("G. accumulation from the shift log");
  await entry(usr, pA, `${TAG}-A`, ctx.prep.id, { qty: 100, qty_rejected: 20, qty_unit: "kg" });
  p = await plan(jA);
  const dispensing = p.find((x) => x.id === s1.id);
  eq("good units only — rejects subtracted", Number(dispensing.accumulated_qty), 280);
  eq("the first entry started the stage", dispensing.status, "in_progress");

  const packing = p.find((x) => x.id === s3.id);
  eq("the other stage counts only its own entries", Number(packing.accumulated_qty), 5);

  /* ── H. accumulative partitions per stage ────────────────────────────── */
  section("H. two runs of one activity no longer pool");
  const { data: rows } = await svc.from("shift_log_entries_expanded")
    .select("id, batch_stage_id, accumulative")
    .eq("batch_no", `${TAG}-A`).eq("process_id", ctx.prod.id);
  eq("the packing entry counts alone, not with the other production stage",
     rows.map((r) => Number(r.accumulative)), [5]);

  /* ── I. sign-off ─────────────────────────────────────────────────────── */
  section("I. sign-off");
  await refused("sign-off needs a yield answer",
    usr.from("batch_stages").update({ status: "complete" }).eq("id", s1.id),
    "whether the yield is acceptable");
  await refused("a stage cannot skip straight from pending to complete",
    usr.from("batch_stages").update({ status: "complete", yield_acceptable: true }).eq("id", s2.id),
    "one step at a time");
  await accepted("an in-progress stage signs off",
    usr.from("batch_stages").update({ status: "complete", yield_acceptable: true, yield_notes: "ok" }).eq("id", s1.id));
  p = await plan(jA);
  eq("yield is computed, not typed", Number(p.find((x) => x.id === s1.id).yield_pct), 56);
  // The one that matters: rewriting the yield answer after the fact. A no-op
  // re-send of the same row is harmless and stays allowed.
  await refused("a signed-off yield answer cannot be rewritten",
    usr.from("batch_stages").update({ yield_acceptable: false }).eq("id", s1.id),
    "cannot be rewritten");
  await refused("nor can the sign-off note",
    usr.from("batch_stages").update({ yield_notes: "actually it was bad" }).eq("id", s1.id),
    "cannot be rewritten");
  await accepted("re-sending the unchanged row is a harmless no-op",
    usr.from("batch_stages").update({ status: "complete", yield_acceptable: true }).eq("id", s1.id));

  /* ── J. plan edits ───────────────────────────────────────────────────── */
  section("J. the plan stays editable, within limits");
  await refused("a target cannot be cleared once set",
    usr.from("batch_stages").update({ target_qty: null }).eq("id", s2.id),
    "corrected, not removed");
  await accepted("a target can be corrected",
    usr.from("batch_stages").update({ target_qty: 200000 }).eq("id", s2.id));
  p = await plan(jA);
  eq("what it was is kept", Number(p.find((x) => x.id === s2.id).previous_target_qty), 210000);
  await refused("a signed-off stage's target is locked",
    usr.from("batch_stages").update({ target_qty: 999 }).eq("id", s1.id),
    "signed off");
  await refused("a stage with entries cannot be removed",
    usr.from("batch_stages").delete().eq("id", s1.id),
    "can no longer be removed");

  /* ── K. completion ───────────────────────────────────────────────────── */
  section("K. the last stage completes the order");
  const before = (await svc.from("pipeline_jobs").select("status").eq("id", jA).single()).data;
  ok("still running before the final sign-off", before.status !== "finished", before.status);
  await usr.from("batch_stages").update({ status: "in_progress" }).eq("id", s2.id);
  await accepted("the final stage signs off",
    usr.from("batch_stages").update({ status: "complete", yield_acceptable: true }).eq("id", s2.id));
  const after = (await svc.from("pipeline_jobs_expanded")
    .select("status, finished_at, produced_qty, stages_complete, stage_count").eq("id", jA).single()).data;
  eq("the batch is finished", after.status, "finished");
  ok("finished_at was stamped", Boolean(after.finished_at));
  eq("produced_qty reads the final stage", Number(after.produced_qty), 0);
  eq("stages_complete counts", Number(after.stages_complete), 2);
} catch (e) {
  fail++;
  console.log(`\n  ERROR  ${e.message}`);
} finally {
  console.log("\n-- cleanup --------------------------------------------");
  const r1 = await svc.from("shift_log_entries").delete().in("id", entries);
  const r2 = await svc.from("batch_stages").delete().in("id", stages);
  const r3 = await svc.from("pipeline_jobs").delete().in("id", jobs);
  const r4 = await svc.from("factory_products").delete().in("id", products);
  const left = await svc.from("factory_products").select("batch_no").like("batch_no", `${TAG}%`);
  console.log(
    `entries ${r1.error ? "ERR " + r1.error.message : "cleared"} | stages ${r2.error ? "ERR " + r2.error.message : "cleared"} | jobs ${r3.error ? "ERR " + r3.error.message : "cleared"} | products ${r4.error ? "ERR " + r4.error.message : "cleared"}`,
  );
  console.log(`residue: ${left.data?.length ?? "?"} rows`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
