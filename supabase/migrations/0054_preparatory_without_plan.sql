-- FactoryOS · Preparatory work can be logged before the batch is planned
--
-- Since 0038 a `preparatory` entry (dispensing, mixing, granulation, drying)
-- answered to the full four-rule gate exactly as a `production` entry did:
--
--   1. the batch number must resolve to a product in the register
--   2. that product must have a card on the pipeline board
--   3. that card must be issued for production
--   4. the activity must be a stage in that batch's plan
--
-- That made the floor wait on the planner for work that routinely starts
-- first: the bulk is dispensed and mixed while the plan for the batch is still
-- being drawn up, and a room that has done the mixing could not record it.
-- So rules 3 and 4 now apply to `production` only:
--
--   production    1, 2, 3, 4 — unchanged
--   preparatory   1 and 2 — it still names a real batch on the board, and the
--                 quantity it records belongs to that batch
--   downtime      1 and 2, and only when it names a batch — unchanged (0038)
--
-- An open quarantine NCR still refuses preparatory work (0044): that is QA
-- holding the batch, not the plan being unfinished.
--
-- ── Which stage a preparatory entry counts towards ───────────────────────
--
-- Once the batch is issued, the guard resolves the stage as it always did —
-- the one stage in the plan for this activity is filled in, several ask which,
-- and a stage named explicitly must belong to the batch and the activity. What
-- changes is that *no* match is no longer a refusal: the entry is filed
-- against the batch with a null stage.
--
-- Before the batch is issued, a preparatory entry never takes a stage, even
-- one already drawn on the plan. Attaching it would move that stage to
-- `in_progress` (`batch_stage_accumulate`) and start counting it against its
-- target and tolerance while the plan is still being edited — the plan would
-- be running before anyone released it. So mixing logged before issue is on
-- the batch's record and the shift report, but not in the stage's progress
-- bar. A null-staged preparatory entry is therefore a normal row now, not the
-- hole 0038 swept away; that clean-up does not run again.
--
-- ── The card stays in Planning until it is issued ─────────────────────────
--
-- `pipeline_sync_from_log` (0044) moved a `planned` card to `production` on
-- *any* entry. Until now only downtime could reach an un-issued card, so the
-- slip was rare — but with preparatory work allowed there, the first mixing
-- entry would have shown the batch as In production while every production
-- entry against it was still being refused for not being issued. A card now
-- leaves `planned` for `production` only once it is issued, and a hold lifted
-- on an un-issued card returns it to `planned`. Issuing is what releases a
-- batch to production; the log no longer does it by accident.

-- ── 1. The gate ──────────────────────────────────────────────────────────

/**
 * Resolves a producing entry to its planned stage, or refuses it.
 *
 * Replaces the 0038 version. Downtime is untouched. A production entry meets
 * the same four rules in the same order with the same messages. A preparatory
 * entry meets rules 1 and 2, then takes a stage only if the batch is issued
 * and the plan has one for its activity.
 *
 * The early return on an UPDATE that moves neither the stage nor the batch is
 * kept, for 0038's reason: an amendment must not be refused for a rule that did
 * not exist when the entry was filed.
 */
create or replace function public.shift_log_stage_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat           text;
  job           public.pipeline_jobs%rowtype;
  matches       integer;
  picked        uuid;
  names         text;
  plan_required boolean;
begin
  select category into cat
  from public.factory_processes where id = new.process_id;

  -- Downtime never belongs to a stage, whatever else is true of it.
  if cat = 'downtime' then
    new.batch_stage_id := null;

    if tg_op = 'UPDATE'
       and new.product_id is not distinct from old.product_id
       and new.batch_no   is not distinct from old.batch_no then
      return new;
    end if;

    if btrim(coalesce(new.batch_no, '')) = '' and new.product_id is null then
      return new;
    end if;

    if new.product_id is null then
      raise exception
        'No batch % in the product register. Leave the batch number blank for downtime that belongs to no batch, or enter one that exists.',
        coalesce(nullif(btrim(new.batch_no), ''), '(blank)')
        using errcode = 'check_violation';
    end if;

    if not exists (
      select 1 from public.pipeline_jobs j where j.product_id = new.product_id
    ) then
      raise exception
        'Batch % is not on the production board, so time cannot be charged to it. Leave the batch number blank, or have the batch added on the Pipeline.',
        coalesce(new.batch_no, '')
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.batch_stage_id is not distinct from old.batch_stage_id
     and new.product_id     is not distinct from old.product_id then
    return new;
  end if;

  -- Production, and anything not known to be preparatory, needs the plan.
  plan_required := cat is distinct from 'preparatory';

  -- Rule 1. No batch, or a batch number that matches nothing in the register.
  if new.product_id is null then
    raise exception
      'Enter a batch number that exists in the product register — % matches none. Only downtime can be logged without a batch.',
      coalesce(nullif(btrim(new.batch_no), ''), '(blank)')
      using errcode = 'check_violation';
  end if;

  -- Rule 2. In the register, but never put on the board.
  select * into job from public.pipeline_jobs where product_id = new.product_id;
  if not found then
    if plan_required then
      raise exception
        'Batch % is not on the production board — a manager adds it on the Pipeline, plans its stages and issues it before production can be logged against it.',
        coalesce(new.batch_no, '')
        using errcode = 'check_violation';
    end if;
    raise exception
      'Batch % is not on the production board — a manager adds it on the Pipeline before preparatory work can be logged against it.',
      coalesce(new.batch_no, '')
      using errcode = 'check_violation';
  end if;

  -- Rule 3. On the board, not yet released to the floor. Preparatory work may
  -- go ahead, but takes no stage until the plan is released (see header).
  if job.issued_at is null then
    if not plan_required then
      new.batch_stage_id := null;
      return new;
    end if;
    raise exception
      'Batch % has not been issued for production yet — plan its stages and issue it first. Downtime and preparatory work can be logged against it now.',
      coalesce(new.batch_no, '')
      using errcode = 'check_violation';
  end if;

  -- Rule 4, said explicitly: the entry named a stage, so check it is one of
  -- this batch's and runs this activity.
  if new.batch_stage_id is not null then
    if not exists (
      select 1 from public.batch_stages
      where id = new.batch_stage_id
        and job_id = job.id
        and process_id = new.process_id
    ) then
      raise exception 'That stage does not belong to this batch and activity.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Rule 4, resolved: exactly one match is filled in silently and several ask
  -- which. None is a refusal for production; preparatory work outside the
  -- plan is filed against the batch with no stage.
  select count(*) into matches
  from public.batch_stages
  where job_id = job.id and process_id = new.process_id;

  if matches = 0 then
    if not plan_required then
      return new;
    end if;
    raise exception
      'This activity is not in batch %''s plan — add it to the plan first.',
      coalesce(new.batch_no, '')
      using errcode = 'check_violation';
  end if;

  if matches > 1 then
    select string_agg(
      coalesce(nullif(btrim(s.label), ''), s.work_order, 'stage ' || s.sequence_order),
      ', ' order by s.sequence_order
    ) into names
    from public.batch_stages s
    where s.job_id = job.id and s.process_id = new.process_id;

    raise exception
      'Batch % runs this activity more than once — say which: %.',
      coalesce(new.batch_no, ''), names
      using errcode = 'check_violation';
  end if;

  select id into picked
  from public.batch_stages
  where job_id = job.id and process_id = new.process_id;

  new.batch_stage_id := picked;
  return new;
end;
$$;

-- The trigger itself is unchanged since 0033; `create or replace function`
-- keeps it bound.

-- ── 2. The card follows the issue, not the first entry ───────────────────

/**
 * Moves the batch's card from what the shift log records. Replaces the 0044
 * version; the only changes are the two marked below — a `planned` card is
 * promoted to `production` only once it is issued, and a hold lifted on an
 * un-issued card puts it back to `planned`. Everything else, including
 * 0044's quarantine and downtime rules, is as it was.
 */
create or replace function public.pipeline_sync_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job         public.pipeline_jobs%rowtype;
  next        public.pipeline_status;
  cat         text;
  quarantined boolean;
begin
  if new.product_id is null then
    return null;
  end if;

  select * into job
  from public.pipeline_jobs
  where product_id = new.product_id;

  if not found or job.status = 'finished' then
    return null;
  end if;

  select category into cat
  from public.factory_processes where id = new.process_id;

  quarantined := public.batch_quarantine_no(new.product_id) is not null;

  next := job.status;

  -- Changed: only an issued batch is in production. Preparatory work and
  -- downtime logged against one still being planned leave it in Planning.
  if next = 'planned' and job.issued_at is not null then
    next := 'production';
  end if;

  if new.action_flag is not null then
    next := 'hold';
  elsif next = 'hold' and cat is distinct from 'downtime' then
    -- Changed: a hold lifted before issue goes back to where the card was.
    if job.issued_at is null then
      next := 'planned';
    else
      next := 'production';
    end if;
  end if;

  if quarantined then
    next := 'hold';
  end if;

  update public.pipeline_jobs
  set
    status      = next,
    unit_id     = new.unit_id,
    -- A hold kept by a downtime entry keeps the reason it already had.
    hold_reason = case
                    when next <> 'hold' then null
                    when quarantined then 'Quality'
                    else coalesce(new.action_flag, job.hold_reason)
                  end,
    started_at  = case
                    when job.started_at is null and next <> 'planned'
                    then now() else job.started_at
                  end,
    held_at     = case
                    when next = 'hold' and job.status <> 'hold'
                    then now() else job.held_at
                  end
  where id = job.id;

  return null;
end;
$$;
