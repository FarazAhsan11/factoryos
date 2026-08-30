-- FactoryOS · The finish is the final *group*, not the final row
--
-- 0033 defined a batch's completion as its `is_final` stage: the last row of
-- the plan, signed off. That is right for a plan that runs single file, and
-- wrong the moment the tail runs in parallel — three packing runs off one
-- bulk (0035's `can_run_parallel`), where the three together *are* the finish.
--
-- Two consequences, both seen on real data:
--
--   * `produced_qty` read the last run alone, so a batch with 200 bottles
--     packed on its 30's run reported `0 of 2,150` on the card and in the
--     shift log. Progress that has plainly been made, shown as none.
--
--   * `batch_stage_completes_job` fired on that one row, so signing off the
--     120's run moved the card to Finished while the 30's run stood at 400 of
--     1,000. The board declared an order complete with 600 bottles unpacked —
--     a wrong fact, not a wrong label.
--
-- The fix is one definition, used by both: the **final group** is the last
-- stage plus every stage contiguously before it marked as able to run in
-- parallel. `can_run_parallel` on a stage means "may run alongside the one
-- before it", so the walk is: take the last row, and keep taking the row above
-- while the row you just took carries the flag.
--
-- On a single-file plan the group is one stage and both rules collapse to
-- exactly what 0033 did. No columns are added and no data changes.

-- ── 1. The final group ───────────────────────────────────────────────────

/**
 * The stages that together finish this batch.
 *
 * Walks up from the last stage while the flag holds. `stable`, so the planner
 * may call it once per row rather than once per reference, and left as
 * security invoker on purpose: it reads `batch_stages`, which is already
 * behind RLS, and a caller who cannot see a batch's plan must not learn its
 * shape through this.
 */
create or replace function public.batch_final_group(p_job uuid)
returns table (stage_id uuid)
language sql
stable
as $$
  with recursive ordered as (
    select
      b.id,
      b.can_run_parallel,
      row_number() over (
        order by b.sequence_order desc, b.created_at desc
      ) as rn
    from public.batch_stages b
    where b.job_id = p_job
  ),
  walk as (
    select o.id, o.can_run_parallel, o.rn
    from ordered o
    where o.rn = 1

    union all

    select o.id, o.can_run_parallel, o.rn
    from ordered o
      join walk w on o.rn = w.rn + 1
    where w.can_run_parallel
  )
  select walk.id from walk;
$$;

comment on function public.batch_final_group(uuid) is
  'The stages that together complete a batch: the last one, plus any contiguous stages before it marked can_run_parallel. One row for a single-file plan.';

/**
 * The group's accumulated output and its target, as plain scalars.
 *
 * The view reads these rather than joining `batch_final_group` inside a
 * correlated subquery: a set-returning function in a sub-select's FROM that
 * depends on the outer row is legal but easy to get subtly wrong, and a
 * scalar call in the select list is the same answer with none of the doubt.
 */
create or replace function public.batch_final_group_made(p_job uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(b.accumulated_qty), 0)
  from public.batch_stages b
  where b.id in (select stage_id from public.batch_final_group(p_job));
$$;

create or replace function public.batch_final_group_target(p_job uuid)
returns numeric
language sql
stable
as $$
  select sum(b.target_qty)
  from public.batch_stages b
  where b.id in (select stage_id from public.batch_final_group(p_job));
$$;

-- ── 2. The batch finishes when the whole group is signed off ─────────────

/**
 * Replaces 0033's version, which fired on `is_final` alone.
 *
 * Signing off one run of a parallel tail no longer finishes the order. The
 * last sign-off in the group does — whichever of them that turns out to be,
 * since parallel runs finish in whatever order the floor finishes them.
 */
create or replace function public.batch_stage_completes_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_group boolean;
  pending  integer;
begin
  if new.status <> 'complete' then
    return null;
  end if;

  select exists (
    select 1 from public.batch_final_group(new.job_id) g
    where g.stage_id = new.id
  ) into in_group;

  if not in_group then
    return null;
  end if;

  select count(*) into pending
  from public.batch_stages b
  where b.id in (select stage_id from public.batch_final_group(new.job_id))
    and b.status <> 'complete';

  if pending = 0 then
    update public.pipeline_jobs
    set status      = 'finished',
        finished_at = coalesce(finished_at, now())
    where id = new.job_id
      and status <> 'finished';
  end if;

  return null;
end;
$$;

-- The trigger itself is unchanged from 0033; restated so this file stands
-- alone if the two are ever applied out of order.
drop trigger if exists batch_stages_complete_job on public.batch_stages;
create trigger batch_stages_complete_job
  after update of status on public.batch_stages
  for each row execute function public.batch_stage_completes_job();

-- ── 3. The card and the shift log read the group too ─────────────────────
--
-- Rebuilt verbatim from 0033 but for `produced_qty` and `final_target_qty`.
-- The column list and its order are unchanged, which is what lets this be a
-- `create or replace` rather than a drop and recreate that would take every
-- dependent view with it.

create or replace view public.pipeline_jobs_expanded
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

  -- What the plan's final group has made — the last stage, plus any run
  -- alongside it. On a single-file plan that is the last stage alone, exactly
  -- as 0033 had it; on three packing runs off one bulk it is their sum, which
  -- is the only reading under which 200 bottles of the 30's run is progress.
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

  -- ── Appended by 0033 ──────────────────────────────────────────────────
  j.issued_at,
  (
    select count(*) from public.batch_stages b where b.job_id = j.id
  ) as stage_count,
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and b.status = 'complete'
  ) as stages_complete,
  -- What still stands between this batch and being issued.
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and coalesce(b.target_qty, 0) <= 0
  ) as stages_without_target,
  -- The group's target, for the same reason: the order is not finished until
  -- every run in it is, so what it is measured against is their sum.
  -- Cast back to the column's declared type: 0033's version read
  -- `batch_stages.target_qty` directly, so the view column is numeric(14,2),
  -- and `create or replace view` may not widen it to bare numeric.
  public.batch_final_group_target(j.id)::numeric(14, 2) as final_target_qty
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

grant select on public.pipeline_jobs_expanded to authenticated;
