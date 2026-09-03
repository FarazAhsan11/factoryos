-- FactoryOS · Stage tolerance — the ceiling a planned stage may not be logged past
--
-- Stage planning (0033) gave every producing stage a target: Dispensing owes
-- 500 kg, Compression owes 210,000 tablets. What it did not give anyone was a
-- *limit*. A room could log 26 kg against a 20 kg mixing stage and the form
-- would take it, the bar would read 130%, and the first person to notice would
-- be whoever reconciled the batch record days later.
--
-- A target alone cannot carry that rule, because no plant means its targets
-- exactly. Mixing 20 kg means "20 kg, near enough" — scale drift, a bag that
-- weighs 20.4, the last scoop that does not divide. The number that decides
-- whether an entry is a rounding difference or a mistake is the *tolerance*,
-- and until now it was nowhere in the schema.
--
--   allowed = target_qty × (1 + tolerance_pct / 100)
--
-- Log up to that and the entry is filed. Past it and the write is refused,
-- with the four numbers that explain why.
--
-- ── Where the number is set ──────────────────────────────────────────────
--
-- On the **batch**, once, when it is created — 5% is a property of how a plant
-- works, not of one stage — and inherited by every stage in its plan. A stage
-- that needs its own gets its own: `batch_stages.tolerance_pct` is nullable,
-- and null means "whatever the batch says". Inheritance rather than a copy
-- taken at planning time, so raising a batch's tolerance actually reaches the
-- stages nobody has overridden, instead of applying only to stages planned
-- after the change.
--
-- ── This is not `overage_pct`, and the two must not be merged ────────────
--
-- They are one word apart in English and opposite in effect:
--
--   overage_pct    (0031/0032, on the job)  How much extra this batch is
--                  deliberately *making*. Widens the threshold the shift log's
--                  over-production flag measures against, at the level of the
--                  whole work order. Raises a badge and asks for a sentence.
--                  Manufacturing and combined only — a packing run fills what
--                  it was given.
--
--   tolerance_pct  (here, on the job and on the stage)  How far past *one
--                  stage's* planned target the log will accept before it stops
--                  accepting. Refuses the write. Applies to every batch type,
--                  because a packing stage has a target like any other and 600
--                  bottles against a 500-bottle run is the same mistake.
--
-- One is an allowance on what is produced; the other is a bound on what may be
-- recorded. A plant can want 4% overage and 0% tolerance — make extra, but
-- never log a stage past what its plan says — and both numbers are needed to
-- say so.
--
-- ── Why a hard refusal, when everything else here flags and asks ─────────
--
-- The over-production flag (0023) is soft because it fires *after* a work
-- order is finished, when the material is already made and the only useful
-- thing left is an account of why. This fires while the shift is being written
-- up, when the entry can still be corrected — and the overwhelmingly likely
-- cause of "26 against a 20 kg stage" is a typo or the wrong stage picked, not
-- 6 extra kg in a drum. Refusing costs an operator ten seconds and catches it;
-- flagging files the wrong number into an audit-protected table that has no
-- delete path, where correcting it costs an amendment with a written note.
--
-- The escape hatch is deliberate and lives on the plan, not on the entry: a
-- manager raises the stage's target or its tolerance on the Pipeline, which
-- leaves `previous_target_qty` and a timestamp behind (0033). Recording more
-- than was planned is allowed; doing it without the plan admitting it is not.
--
-- Downtime is untouched, as everywhere: it carries no stage, produces nothing,
-- and is always loggable.

-- ── 1. The batch-level default ───────────────────────────────────────────

alter table public.pipeline_jobs
  add column if not exists tolerance_pct numeric(6, 2) not null default 0;

alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_tolerance_range;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_tolerance_range
  check (tolerance_pct >= 0 and tolerance_pct <= 100);

comment on column public.pipeline_jobs.tolerance_pct is
  'How far past a planned stage''s target this batch may be logged, as a percentage of that target. Inherited by every stage whose own tolerance_pct is null. Enforced as a refusal by shift_log_stage_tolerance (0037). Distinct from overage_pct: that is extra deliberately produced against the work order and raises a flag; this is a bound on what may be recorded against one stage, and it blocks the write.';

-- Default 0 is the strict reading, and it is the right default: a plant that
-- has not said what its tolerance is has not agreed to one. Existing batches
-- take it, which changes nothing for entries already filed — the trigger below
-- only ever looks at the row being written.

-- ── 2. The per-stage override ────────────────────────────────────────────

alter table public.batch_stages
  add column if not exists tolerance_pct numeric(6, 2);

alter table public.batch_stages
  drop constraint if exists batch_stages_tolerance_range;
alter table public.batch_stages
  add constraint batch_stages_tolerance_range
  check (tolerance_pct is null or (tolerance_pct >= 0 and tolerance_pct <= 100));

comment on column public.batch_stages.tolerance_pct is
  'This stage''s own tolerance, overriding the batch''s. Null — the ordinary case — inherits pipeline_jobs.tolerance_pct. Nullable rather than defaulted so that raising the batch''s tolerance reaches the stages nobody has overridden, instead of only the ones planned afterwards.';

-- ── 3. What a stage is allowed ───────────────────────────────────────────
--
-- One function, so the trigger that enforces the ceiling and the view that
-- draws it cannot drift apart on rounding.
--
-- Rounded to two decimals rather than floored, unlike the order-level
-- allowance in 0032. That one counts tablets, where half a unit of headroom is
-- meaningless; a stage target is `numeric(14,2)` and is as often kg or litres,
-- where flooring a 0.50 kg stage's 5% allowance would refuse the plan's own
-- target.

create or replace function public.batch_stage_allowed_qty(
  p_target numeric,
  p_tolerance numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_target is null then null
    else round(p_target * (1 + coalesce(p_tolerance, 0) / 100.0), 2)
  end;
$$;

comment on function public.batch_stage_allowed_qty(numeric, numeric) is
  'The most that may be logged against a stage: its target plus its tolerance. Shared by the shift-log guard and batch_stages_expanded so the number refused and the number displayed are the same one.';

-- A quantity as a person writes it: thousands separated, trailing zeros gone.
-- Exists because the refusal message below carries four numbers, and
-- "20.00 allowed, 26.00 logged" reads like machine output at the moment
-- somebody most needs to read it as a sentence.
create or replace function public.qty_text(p numeric)
returns text
language sql
immutable
as $$
  select rtrim(rtrim(trim(to_char(coalesce(p, 0), 'FM999,999,999,990.00')), '0'), '.');
$$;

comment on function public.qty_text(numeric) is
  'Formats a quantity for a message meant to be read: 1000.00 → "1,000", 20.50 → "20.5".';

-- ── 4. The refusal ───────────────────────────────────────────────────────
--
-- Named to sort after `shift_log_stage_guard`, because BEFORE row triggers
-- fire in name order and this one reads `new.batch_stage_id` — which that
-- guard is what resolves. ('t' after 'g'.)
--
-- Measured in good units, `qty - qty_rejected`, which is exactly what
-- `batch_stage_accumulate` (0033) sums into `accumulated_qty`. Any other
-- measure here would refuse an entry that the running total then disagreed
-- with.

create or replace function public.shift_log_stage_tolerance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stage   public.batch_stages%rowtype;
  tol     numeric;
  allowed numeric;
  others  numeric;
  this    numeric;
  total   numeric;
  label   text;
begin
  -- No stage: downtime, an unplanned batch, or an entry with no product.
  -- Nothing to measure against.
  if new.batch_stage_id is null then
    return new;
  end if;

  -- An update that moves none of the three inputs is not this trigger's
  -- business. That covers an amendment to a comment, and the overrun-note
  -- clearance from 0023 — neither of which should be refused by a tolerance
  -- somebody tightened after the entry was filed.
  if tg_op = 'UPDATE'
     and new.qty            is not distinct from old.qty
     and new.qty_rejected   is not distinct from old.qty_rejected
     and new.batch_stage_id is not distinct from old.batch_stage_id then
    return new;
  end if;

  select * into stage from public.batch_stages where id = new.batch_stage_id;

  -- A stage with no target has no ceiling. It also cannot be issued for
  -- production (`issue_job`), so this is reachable only on a batch being
  -- planned — where refusing an entry would say nothing useful.
  if not found or stage.target_qty is null then
    return new;
  end if;

  tol := coalesce(
    stage.tolerance_pct,
    (select j.tolerance_pct from public.pipeline_jobs j where j.id = stage.job_id),
    0
  );
  allowed := public.batch_stage_allowed_qty(stage.target_qty, tol);

  -- Everything already logged against this stage, excluding the row being
  -- written. `id` is filled by its column default before this trigger runs —
  -- the ordering 0034 turns on — so the exclusion holds on an insert as well
  -- as on an amendment.
  select coalesce(sum(coalesce(e.qty, 0) - coalesce(e.qty_rejected, 0)), 0)
    into others
  from public.shift_log_entries e
  where e.batch_stage_id = new.batch_stage_id
    and e.id <> new.id;

  this  := coalesce(new.qty, 0) - coalesce(new.qty_rejected, 0);
  total := others + this;

  if total > allowed then
    select coalesce(nullif(btrim(s.label), ''), s.work_order, p.name, 'This stage')
      into label
    from public.batch_stages s
      left join public.factory_processes p on p.id = s.process_id
    where s.id = stage.id;

    -- Every number the operator needs to decide what to do, in the order they
    -- would ask for them: what was planned, what that allows, what is already
    -- there, what this adds, and what it comes to.
    raise exception
      '% is planned for % % with a % tolerance, so % is the most that can be logged against it. % is already logged and this entry adds %, which comes to %. Correct the quantity, or have the plan changed on the Pipeline.',
      label,
      public.qty_text(stage.target_qty),
      stage.target_unit,
      public.qty_text(tol) || '%',
      public.qty_text(allowed) || ' ' || stage.target_unit,
      public.qty_text(others),
      public.qty_text(this),
      public.qty_text(total)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists shift_log_stage_tolerance on public.shift_log_entries;
create trigger shift_log_stage_tolerance
  before insert or update on public.shift_log_entries
  for each row execute function public.shift_log_stage_tolerance();

-- ── 5. The read model ────────────────────────────────────────────────────
--
-- Three columns, all derived, so that no caller recomputes the ceiling:
--
--   effective_tolerance_pct  The stage's own, or the batch's.
--   allowed_qty              The ceiling itself — target plus that.
--   is_over_tolerance        Already past it. Should be unreachable through
--                            the form, and is not unreachable in general: a
--                            tolerance or a target can be lowered under
--                            entries already filed. That is precisely when a
--                            progress bar has to say so, rather than quietly
--                            reading 106%.
--
-- `create or replace` is enough here — the columns are appended, and unlike
-- `shift_log_entries_expanded` this view is a plain select with nothing to
-- insert a column into the middle of.

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
  ) as is_over_tolerance
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved, and since 0037 the tolerance the shift log enforces against each one — the effective percentage, the resulting ceiling, and whether the stage is already past it. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;

-- ── 6. The board's read model carries the batch default ──────────────────
--
-- `pipeline_jobs_expanded` names its columns one by one, so a column added to
-- the table is invisible to it until it is named here — and the Edit batch
-- dialog has to read back the tolerance it wrote.
--
-- Appended at the end rather than set beside `overage_pct`, where it belongs
-- by meaning: `create or replace view` may add columns only after the existing
-- ones, and dropping the view to reorder would take everything that depends on
-- it with it, to move one column up a list nobody reads in order.

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
  j.tolerance_pct
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

grant select on public.pipeline_jobs_expanded to authenticated;
