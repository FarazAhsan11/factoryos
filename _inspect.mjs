import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: f } = await admin.from("factories").select("id,slug,name").eq("slug", "gpg-laboratories").maybeSingle();
console.log("factory:", f);

const { data: jobs, error: je } = await admin
  .from("pipeline_jobs_expanded")
  .select("id, batch_no, status, priority, due_date, batch_type, issued_at, created_at")
  .eq("factory_id", f.id)
  .order("created_at");
if (je) throw je;
console.log("\njobs:", jobs.length);

const { data: stages, error: se } = await admin
  .from("batch_stages")
  .select("id, job_id, sequence_order, label, status, unit_id, can_run_parallel, planned_date, completed_at, process_id")
  .eq("factory_id", f.id)
  .order("job_id").order("sequence_order");
if (se) { console.log("STAGE READ ERROR:", se.message); process.exit(1); }

const { data: units } = await admin.from("factory_units").select("id,name").eq("factory_id", f.id);
const { data: procs } = await admin.from("factory_processes").select("id,name").eq("factory_id", f.id);
const un = Object.fromEntries(units.map(u => [u.id, u.name]));
const pn = Object.fromEntries(procs.map(p => [p.id, p.name]));
const jn = Object.fromEntries(jobs.map(j => [j.id, j]));

console.log("\nstages:", stages.length);
let cur = null;
for (const s of stages) {
  if (s.job_id !== cur) { cur = s.job_id; const j = jn[s.job_id]; console.log(`\n${j.batch_no} [${j.status}] due=${j.due_date} prio=${j.priority} issued=${j.issued_at ? "y":"n"}`); }
  console.log(`   ${s.sequence_order}. ${pn[s.process_id]}${s.label ? " — "+s.label : ""} · room=${s.unit_id ? un[s.unit_id] : "NONE"} · ${s.status} · par=${s.can_run_parallel} · planned=${s.planned_date} · done=${s.completed_at?.slice(0,10) ?? "-"}`);
}
