-- FactoryOS · The two things a room queue asks for that a plan does not
--
-- 0039 gave a stage the day it is planned to *start*. A room queue — the list
-- a planner works down when they are deciding what Room 4 does next — asks two
-- more questions of every line, and neither is answerable from anything the
-- plan already holds:
--
--   Est. finish  When does this stage come off the room? It is not
--                `planned_date` (that is when it goes on), it is not
--                `completed_at` (that is a fact, and only after the event), and
--                it is not derivable from the target — the same 210,000
--                tablets is two days on one machine and five on another. It is
--                a person's estimate, and the only place it can come from is a
--                person.
--
--   Comment      "Waiting on the 60's tooling", "QA hold expected Thursday".
--                The reason a line sits where it does in the queue. Distinct
--                from `yield_notes`, which is part of a sign-off and immutable
--                once given, and from the batch's `notes`, which belong to the
--                whole order rather than to one room-day.
--
-- ── Why est. finish is a second column and not a duration ────────────────
--
-- A duration would have to be added to `planned_date` to be read, which makes
-- every query that wants "what is on Room 4 next Tuesday" do arithmetic, and
-- makes the answer wrong the moment the start date moves without anybody
-- revisiting the estimate. Storing the date the planner actually meant keeps
-- the estimate stable when the start slips — which is the case that matters,
-- because a slipped start is exactly when somebody re-reads the queue.
--
-- ── What is deliberately not here ────────────────────────────────────────
--
-- No check that `est_finish_date >= planned_date`. It is the obvious
-- constraint and it is the wrong one: a planner who pulls a stage's start date
-- forward past a stale estimate would have the *start* refused, which is not
-- the field they were fixing. The queue draws the disagreement instead, and
-- the two are independent columns that a person reconciles.
--
-- Neither column gates anything. Issuing does not require them (0033), the
-- shift log does not read them, and a stage with both empty is a perfectly
-- legal stage — the queue is where they get filled in, batch by batch, and it
-- has to be usable before they are.

alter table public.batch_stages
  add column if not exists est_finish_date date,
  add column if not exists planning_note   text;

comment on column public.batch_stages.est_finish_date is
  'When the planner expects this stage to come off the room. An estimate, not a record: `completed_at` is what actually happened. Deliberately independent of planned_date — no constraint ties them, so a start date can be pulled forward without the estimate refusing it.';
comment on column public.batch_stages.planning_note is
  'The planner''s note on this line of the room queue — why it sits where it does. Not part of the sign-off record (that is yield_notes, immutable once given) and not the batch''s notes, which belong to the whole order.';

-- ── The read model ───────────────────────────────────────────────────────
--
-- Appended at the end, after the 0039 block, because `create or replace view`
-- may not insert a column mid-list — the same constraint that put
-- `tolerance_pct` and then `planned_date` there.

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
  ) as is_behind_plan,

  s.est_finish_date,
  s.planning_note,
  -- The estimate has passed and the stage is still on the room. Computed for
  -- the same reason `is_behind_plan` is, and separate from it because they are
  -- different failures: one says the stage never started, the other says it
  -- started and is running long.
  (
    s.est_finish_date is not null
    and s.status <> 'complete'
    and s.est_finish_date < current_date
  ) as is_overrunning
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved, the tolerance the shift log enforces against each one (0037), the day the stage is planned to run and whether that day has passed (0039), and since 0040 the planner''s estimated finish and queue note, with whether that estimate has passed. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;
