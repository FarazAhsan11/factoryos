-- FactoryOS · A planned stage runs somewhere, and not always in single file
--
-- Two things the prototype's stage form asks for that 0033 left out, both of
-- which turn out to be load-bearing rather than decorative.
--
-- ── The room ─────────────────────────────────────────────────────────────
--
-- `addStageToCurrentBatch` collects `newStageRoom` and every stage row prints
-- it: "Room 17A · Target: 210,000". Without it a plan says what will be made
-- and never where, which is exactly the question a planner is holding the
-- board to answer — is Room 9 double-booked on Thursday? It is also the column
-- the Room schedule tab will read when it is built, and adding it later would
-- mean every plan written in the meantime has a hole in it.
--
-- Assigned, not enforced. The shift log does not check that an entry's room
-- matches the stage's: a batch genuinely moves rooms mid-run, and refusing the
-- entry would put the paperwork ahead of the work. The plan says where it was
-- *meant* to happen; the log says where it did.
--
-- ── Running in parallel ──────────────────────────────────────────────────
--
-- The prototype's `canRunParallel` gates activation:
--
--     canSignOffPrev = idx === 0 || stages[idx-1].status === 'complete'
--                      || s.canRunParallel
--
-- 0033 implemented only the first two thirds of that, so a plan was strictly
-- single file. Real plants do not run that way — three packing runs off one
-- bulk start together, and a labelling stage overlaps the packing feeding it.
-- Without the flag the only way to express that was to lie about the order,
-- which moves `is_final` and so changes which stage completes the order.

alter table public.batch_stages
  -- `set null`, not cascade: retiring a room must not delete the plan that
  -- named it. The stage still has to happen; it needs somewhere else to be.
  add column if not exists unit_id uuid
    references public.factory_units (id) on delete set null,
  add column if not exists can_run_parallel boolean not null default false;

comment on column public.batch_stages.unit_id is
  'The room this stage is planned to run in. Advisory: the shift log records where it actually ran and does not have to agree — a batch moves rooms mid-run.';
comment on column public.batch_stages.can_run_parallel is
  'True when this stage may start before the one before it is complete — three packing runs off one bulk, or labelling overlapping the packing that feeds it. Advisory in the same way: it decides what the plan offers, not what the log accepts.';

-- The Room schedule view reads one factory's stages by room, and the plan
-- dialog reads one job's. Both are covered by the existing job index plus this.
create index if not exists batch_stages_unit_idx
  on public.batch_stages (unit_id)
  where unit_id is not null;

-- ── The read model ───────────────────────────────────────────────────────
-- The plan needs the room's *name*, and joining it in the view keeps the
-- dialog from cross-referencing a second cache to render one line.

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
  pr.batch_no  as batch_no
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;
