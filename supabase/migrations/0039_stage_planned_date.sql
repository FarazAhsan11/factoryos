-- FactoryOS · A planned stage runs on a day
--
-- 0035 gave a stage a room and a parallel flag, and said the room is the
-- column the Room schedule tab will read: "is Room 9 double-booked on
-- Thursday?". Half of that question was missing. A plan could say what will be
-- made, how much of it and where — and never when. So a plan of four stages
-- is an ordered list with no dates against it, and the only thing anybody can
-- schedule from is the batch's `due_date`, which is one date for the whole
-- route.
--
-- `planned_date` is that missing half: the day this stage is *meant* to run.
--
-- ── What it is not ───────────────────────────────────────────────────────
--
-- Advisory, exactly like `unit_id` beside it. The shift log does not check
-- that an entry's `log_date` matches it, and must not: a stage slips a day,
-- runs across a night shift, or gets pulled forward when a machine frees up,
-- and refusing the entry would put the plan ahead of the work. The plan says
-- when it was meant to happen; the log says when it did. Nothing here gates
-- issuing either — a plan is issued on its targets (0033), and a batch with a
-- room and a date on every stage is a better plan, not a differently legal
-- one.
--
-- A single date, not a start/end pair. A stage that genuinely spans days is
-- already expressible — that is what `can_run_parallel` and the accumulating
-- total are for — and a second column would be a second thing to keep true
-- against a run that has not happened yet.
--
-- ── Why a `date` and not a timestamptz ───────────────────────────────────
--
-- The same reason `pipeline_jobs.due_date` is one (0031) and the shift log
-- carries `log_date` + `shift` rather than a timestamp: this plant plans in
-- days and shifts, not in instants, and a timestamptz would make a planner
-- pick a time nobody means and then read it back shifted by a time zone.

alter table public.batch_stages
  add column if not exists planned_date date;

comment on column public.batch_stages.planned_date is
  'The day this stage is planned to run. Advisory in the same way as unit_id: the shift log records the date the work actually happened and does not have to agree. Null means not scheduled yet — a plan is routinely written before the days are settled.';

-- The Room schedule and Gantt tabs read one factory's stages by day, and the
-- overdue readout asks the same question narrowed to what has not finished.
create index if not exists batch_stages_planned_date_idx
  on public.batch_stages (factory_id, planned_date)
  where planned_date is not null;

-- ── The read model ───────────────────────────────────────────────────────
--
-- Appended at the end, after the 0037 tolerance block, because
-- `create or replace view` may not insert a column mid-list — the same
-- constraint that put `tolerance_pct` there.

create or replace view public.batch_stages_expanded
with (security_invoker = true) as
select
  s.id,
  s.factory_id,
  s.job_id,
  s.process_id,
  s.unit_id,
  s.sequence_order,
  s.label,
  s.work_order,
  s.target_qty,
  s.target_unit,
  s.pack_size,
  s.accumulated_qty,
  s.status,
  s.is_final,
  s.can_run_parallel,
  s.started_at,
  s.completed_at,
  s.completed_by,
  s.yield_pct,
  s.yield_acceptable,
  s.yield_notes,
  s.previous_target_qty,
  s.target_changed_at,
  s.created_at,

  p.name       as process_name,
  p.category   as process_category,
  u.name       as unit_name,
  cb.full_name as completed_by_name,
  pr.batch_no  as batch_no,

  s.tolerance_pct,
  coalesce(s.tolerance_pct, j.tolerance_pct, 0) as effective_tolerance_pct,
  public.batch_stage_allowed_qty(
    s.target_qty,
    coalesce(s.tolerance_pct, j.tolerance_pct, 0)
  ) as allowed_qty,
  (
    s.target_qty is not null
    and s.accumulated_qty > public.batch_stage_allowed_qty(
      s.target_qty,
      coalesce(s.tolerance_pct, j.tolerance_pct, 0)
    )
  ) as is_over_tolerance,

  s.planned_date,
  -- Planned for a day that has passed with the stage still unfinished.
  -- Computed, never stored, like every other clock in this application
  -- (`actions`' overdue, the maintenance response time): a stored flag would
  -- need something to run at midnight to stay true.
  (
    s.planned_date is not null
    and s.status <> 'complete'
    and s.planned_date < current_date
  ) as is_behind_plan
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved, the tolerance the shift log enforces against each one (0037), and since 0039 the day the stage is planned to run plus whether that day has passed with the stage unfinished. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;
