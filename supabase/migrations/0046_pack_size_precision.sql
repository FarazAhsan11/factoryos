-- FactoryOS · Pack size to six decimal places
--
-- `pipeline_jobs.pack_size` is the units of bulk in one container — the one
-- conversion between a bulk batch and the finished lots drawing on it. 0031
-- declared it `numeric(10, 2)`, which is fine for "60 tablets per bottle" and
-- wrong for anything counted by weight or volume: a 25 g tube against bulk in
-- kg is 0.025, and two decimals stored it as 0.03. Forty thousand tubes then
-- claimed 1,200 kg of a 1,000 kg batch, and the family bar reported an
-- over-allocation that existed only in the rounding.
--
-- `numeric(14, 6)` holds a 25 g fill in kg (0.025), a 5 ml sachet in litres
-- (0.005) and a 0.5 mg dose in grams (0.0005) exactly, and still takes the
-- whole-number pack sizes every existing row has. Widening a numeric never
-- changes a value already stored, so no row moves.
--
-- A column's type cannot change under a view that selects it, or under a
-- trigger whose `update of` list names it, so both are dropped and put back
-- exactly as they stand: the view as 0044 left it, the trigger as 0031 made it.

begin;

drop view if exists public.pipeline_jobs_expanded;
drop trigger if exists pipeline_jobs_family on public.pipeline_jobs;

alter table public.pipeline_jobs
  alter column pack_size type numeric(14, 6);

create trigger pipeline_jobs_family
  before insert or update of parent_job_id, batch_type, pack_size, factory_id
  on public.pipeline_jobs
  for each row execute function public.pipeline_jobs_family_guard();

-- Identical to 0044's definition — same columns, same order.
create view public.pipeline_jobs_expanded
with (security_invoker = true) as
select
  j.id,
  j.factory_id,
  j.product_id,
  j.status,
  j.unit_id,
  j.hold_reason,
  j.planned_at,
  j.started_at,
  j.held_at,
  j.finished_at,
  j.created_at,

  pr.batch_no,
  pr.code         as product_code,
  pr.name         as product_name,
  pr.required_qty,

  u.name          as unit_name,

  public.batch_final_group_made(j.id) as produced_qty,

  (
    select count(*)
    from public.shift_log_entries e
    where e.product_id = j.product_id
      and e.action_flag is not null
  ) as flagged_count,

  j.batch_type,
  j.parent_job_id,
  j.bulk_unit,
  j.pack_size,
  j.pack_unit,
  j.bulk_qty_received,
  j.market,
  j.overage_pct,
  j.priority,
  j.due_date,
  j.notes,
  j.rework_source_id,

  parent_pr.batch_no   as parent_batch_no,
  parent_pr.name       as parent_product_name,

  (
    select count(*)
    from public.pipeline_jobs c
    where c.parent_job_id = j.id
  ) as child_count,

  (
    select sum(cpr.required_qty * c.pack_size)
    from public.pipeline_jobs c
      join public.factory_products cpr on cpr.id = c.product_id
    where c.parent_job_id = j.id
      and c.pack_size is not null
  ) as allocated_qty,

  case
    when j.batch_type = 'packing' and j.pack_size is not null then coalesce((
      select sum(e.qty) * j.pack_size
      from public.shift_log_entries e
      where e.product_id = j.product_id
    ), 0)
  end as bulk_consumed,

  j.issued_at,
  (
    select count(*) from public.batch_stages b where b.job_id = j.id
  ) as stage_count,
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and b.status = 'complete'
  ) as stages_complete,
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and coalesce(b.target_qty, 0) <= 0
  ) as stages_without_target,
  public.batch_final_group_target(j.id)::numeric(14, 2) as final_target_qty,

  -- ── Appended by 0037 ──────────────────────────────────────────────────
  j.tolerance_pct,

  -- ── Appended by 0044 ──────────────────────────────────────────────────
  public.batch_quarantine_no(j.product_id) as quarantine_no
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

comment on view public.pipeline_jobs_expanded is
  'Read model for the Pipeline board: the job, its batch, room, progress, family allocation, stage-plan counts, tolerance and quarantine.';

grant select on public.pipeline_jobs_expanded to authenticated;

commit;
