-- FactoryOS · Cleaning after a stage
--
-- A room is not free the moment a batch comes off it. Before the next product
-- goes in, the room is cleaned — a **full clean** (FC) between products or at
-- the end of a campaign, or a lighter **provisional clean** (PC) between runs
-- of the same product. A planner reading the Gantt timeline needs to see that
-- block at the end of a stage, or the room looks ready hours before it is.
--
-- So a stage now says whether it needs a clean after it, which kind, and for
-- how many hours. Asked in the stage dialog (Pipeline → Gantt timeline / Room
-- schedule) and drawn as an FC / PC segment at the end of the stage's bar.
--
-- ── Shape ────────────────────────────────────────────────────────────────
--
--   clean_type   'full' | 'provisional', or null — no clean planned.
--   clean_hours  how long the clean takes, in hours, or null.
--
-- Both or neither: a duration with no kind of clean says nothing, and a kind
-- with no duration cannot be drawn. The form requires both when a clean is
-- asked for; the check is the trust boundary.
--
-- Advisory, like `unit_id`, `planned_date` and `est_finish_date`: nothing
-- gates on it, and the shift log is still what records the clean that was
-- actually done.

alter table public.batch_stages
  add column if not exists clean_type text,
  add column if not exists clean_hours numeric(6, 2);

alter table public.batch_stages
  drop constraint if exists batch_stages_clean_type_check;
alter table public.batch_stages
  add constraint batch_stages_clean_type_check
  check (clean_type is null or clean_type in ('full', 'provisional'));

-- A week is the longest clean anyone plans; past that it is a typo.
alter table public.batch_stages
  drop constraint if exists batch_stages_clean_hours_range;
alter table public.batch_stages
  add constraint batch_stages_clean_hours_range
  check (clean_hours is null or (clean_hours > 0 and clean_hours <= 168));

alter table public.batch_stages
  drop constraint if exists batch_stages_clean_both_or_neither;
alter table public.batch_stages
  add constraint batch_stages_clean_both_or_neither
  check ((clean_type is null) = (clean_hours is null));

comment on column public.batch_stages.clean_type is
  'The clean the room needs after this stage (0052): ''full'' (FC) or ''provisional'' (PC). Null when none is planned. Advisory.';
comment on column public.batch_stages.clean_hours is
  'How long that clean takes, in hours (0052). Set exactly when clean_type is.';

-- ── The read model ───────────────────────────────────────────────────────
--
-- Identical to 0049 with the two columns appended at the end, because
-- `create or replace view` may not insert a column mid-list.

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
  (
    s.planned_date is not null
    and s.status <> 'complete'
    and s.planned_date < current_date
  ) as is_behind_plan,

  s.est_finish_date,
  s.planning_note,
  (
    s.est_finish_date is not null
    and s.status <> 'complete'
    and s.est_finish_date < current_date
  ) as is_overrunning,

  s.signed_off_by_name,

  s.clean_type,
  s.clean_hours
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved, the tolerance the shift log enforces against each one (0037), the day the stage is planned to run and whether that day has passed (0039), the planner''s estimated finish and queue note, with whether that estimate has passed (0040), the name the signer gave at sign-off (0049), and since 0052 the clean planned after the stage. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;
