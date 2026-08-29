-- FactoryOS · Stage planning — a batch is a route, not a number
--
-- Until now a batch was one quantity and one plant-wide "Final" process, and
-- completion meant "that one process has produced enough". That cannot say
-- what a batch actually is:
--
--   46000  Paracetamol Tablet
--     1  Dispensing      500 kg
--     2  Compression     210,000 tablets
--     3  Coating         210,000 tablets
--     4  Packing         1,000 bottles      ← completes the order
--
-- Four stages, four targets, three different units. The old flag knew none of
-- it, and the shift log could only ever show a running total with nothing to
-- measure it against.
--
-- ── The rule this implements ─────────────────────────────────────────────
--
-- **Every stage that produces output must be planned, with a target, before
-- the batch can run.** "Produces output" is not a new idea to classify — it is
-- `factory_processes.category <> 'downtime'` from migration 0030. Downtime is
-- never planned: it is logged when it happens, against any batch, always.
--
-- ── The four decisions this encodes ──────────────────────────────────────
--
--   1. The plan lives on the batch, planned per batch, exactly as the
--      prototype does it. There is no reusable route on the product yet.
--   2. **The last stage in the plan is the final one**, derived from position
--      rather than tagged by hand. Signing it off completes the order.
--   3. Issuing a batch for production is refused until every planned stage has
--      a target; the shift log then refuses *producing* entries against a
--      batch that has not been issued, and always accepts downtime.
--   4. The plan stays editable — targets change, stages are added — but a
--      target may never be cleared once issued, and a stage with entries
--      logged against it can no longer be removed.
--
-- This retires `factory_processes.is_final_stage` (migration 0016) entirely.

-- ── 1. The plan ──────────────────────────────────────────────────────────

create table if not exists public.batch_stages (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references public.factories (id) on delete cascade,
  -- The plan belongs to the run, not the catalogue entry: cascade, because a
  -- job removed from the board takes its unstarted plan with it.
  job_id          uuid not null references public.pipeline_jobs (id) on delete cascade,
  process_id      uuid not null references public.factory_processes (id) on delete restrict,

  sequence_order  integer not null default 1,

  -- Tells two runs of the same process apart. The prototype refuses a repeated
  -- stage outright, which makes "Packing 30's / 60's / 120's under one batch"
  -- inexpressible; a label is the smallest thing that fixes that.
  label           text,
  -- The same distinction where a plant uses work orders instead — 46000A,
  -- 46000B — rather than labels or child batch numbers.
  work_order      text,

  target_qty      numeric(14, 2),
  target_unit     text not null default 'units',
  -- Units of bulk per container on a packing stage, for the same reason the
  -- job carries one: it is the only bulk ↔ finished-goods conversion there is.
  pack_size       numeric(10, 2),

  -- Maintained from the shift log by `batch_stage_accumulate`. Never written
  -- by a client, the way `pipeline_jobs.status` never is.
  accumulated_qty numeric(14, 2) not null default 0,

  status          text not null default 'pending',
  -- Derived from position by `batch_stages_final_sync`. Never set by hand.
  is_final        boolean not null default false,

  started_at      timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references public.profiles (id) on delete set null,
  yield_pct       numeric(7, 2),
  yield_acceptable boolean,
  yield_notes     text,

  -- Yield is accumulated ÷ target, so a quietly lowered target turns a 70% run
  -- into a 100% one on a handover sheet. What it was stays with the row.
  previous_target_qty numeric(14, 2),
  target_changed_at   timestamptz,
  target_changed_by   uuid references public.profiles (id) on delete set null,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint batch_stages_status_known
    check (status in ('pending', 'in_progress', 'complete')),
  constraint batch_stages_target_positive
    check (target_qty is null or target_qty > 0),
  constraint batch_stages_pack_size_positive
    check (pack_size is null or pack_size > 0)
);

-- One row per process per batch, unless they are told apart by a label. This
-- is the prototype's no-duplicate-stage rule, relaxed exactly enough for
-- "Packing 30's" and "Packing 60's" to coexist.
create unique index if not exists batch_stages_job_process_label_key
  on public.batch_stages (
    job_id, process_id, coalesce(lower(btrim(label)), '')
  );

-- Exactly one final stage per batch. The invariant behind decision 2.
create unique index if not exists batch_stages_one_final
  on public.batch_stages (job_id)
  where is_final;

create index if not exists batch_stages_job_idx
  on public.batch_stages (job_id, sequence_order);
create index if not exists batch_stages_factory_idx
  on public.batch_stages (factory_id);

comment on table public.batch_stages is
  'The planned route of one batch: one row per producing stage, with the target it owes. The last row is the final stage and completes the order when signed off.';

-- ── Row-level security ───────────────────────────────────────────────────
-- Read: the whole tenant — an operator has to see what the batch is for.
-- Write: managers plan, supervisors sign off. The two triggers below write as
-- owner, so an operator logging an entry still moves a stage's accumulated
-- total without being able to touch the row.
alter table public.batch_stages enable row level security;

drop policy if exists "batch_stages_member_read" on public.batch_stages;
create policy "batch_stages_member_read"
  on public.batch_stages for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "batch_stages_manage" on public.batch_stages;
create policy "batch_stages_manage"
  on public.batch_stages for all
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

-- ── 2. A planned stage is a producing stage ──────────────────────────────

/**
 * Refuses a downtime process in a plan, and stamps who added the row.
 *
 * A cross-table rule, so a `check` cannot express it. Downtime is time lost —
 * a break, a breakdown, waiting on materials. It produces nothing, so it has
 * no target, so planning one would create a stage that can never complete and
 * would sit in the plan blocking the batch for ever.
 */
create or replace function public.batch_stages_validate()
returns trigger
language plpgsql
as $$
declare
  cat text;
begin
  select category into cat
  from public.factory_processes
  where id = new.process_id;

  if cat = 'downtime' then
    raise exception
      'Downtime is logged, not planned — a plan holds only stages that produce something.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    -- Append by default, so a caller that does not care about order still gets
    -- a sane one and the final tag lands on the row it just added.
    if new.sequence_order is null or new.sequence_order < 1 then
      select coalesce(max(sequence_order), 0) + 1 into new.sequence_order
      from public.batch_stages where job_id = new.job_id;
    end if;
  end if;

  -- Keep what the target was, whenever it changes. Not an audit trail for its
  -- own sake: yield is accumulated ÷ target, and without the old number a
  -- lowered target silently rewrites a stage's performance.
  if tg_op = 'UPDATE' and new.target_qty is distinct from old.target_qty then
    new.previous_target_qty := old.target_qty;
    new.target_changed_at   := now();
    new.target_changed_by   := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists batch_stages_validate on public.batch_stages;
create trigger batch_stages_validate
  before insert or update on public.batch_stages
  for each row execute function public.batch_stages_validate();

-- ── 3. The last stage is the final one ───────────────────────────────────

/**
 * Recomputes which row of a plan carries `is_final`.
 *
 * Derived from position — greatest `sequence_order`, ties broken by insertion
 * order — rather than tagged by hand, so it cannot disagree with the plan on
 * screen. Add a stage after the last one and the tag moves itself; remove the
 * last one and it moves back.
 *
 * `pg_trigger_depth()` is the recursion guard: the update below fires this
 * same trigger at depth 2, where it returns immediately. The `where` clause
 * touches only rows whose value actually changes, so the usual case writes
 * nothing at all.
 */
create or replace function public.batch_stages_final_sync()
returns trigger
language plpgsql
as $$
declare
  target_job uuid;
  winner     uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  target_job := coalesce(new.job_id, old.job_id);

  select id into winner
  from public.batch_stages
  where job_id = target_job
  order by sequence_order desc, created_at desc
  limit 1;

  update public.batch_stages
  set is_final = (id = winner)
  where job_id = target_job
    and is_final <> (id = winner);

  return null;
end;
$$;

drop trigger if exists batch_stages_final on public.batch_stages;
create trigger batch_stages_final
  after insert or delete or update of sequence_order on public.batch_stages
  for each row execute function public.batch_stages_final_sync();

-- ── 4. What a stage transition costs ─────────────────────────────────────

/**
 * The gate on a stage's status, in the database rather than the dialog —
 * the same bargain as `actions_stage_transition` (0027) and
 * `maintenance_stage_transition` (0029).
 *
 *   pending → in_progress   activating it, or the first entry logged against it
 *   in_progress → complete  signing it off: costs a yield answer, and standing
 *
 * Forward only. A stage that has been signed off is a statement someone made
 * about a batch, and un-signing it is not an edit — it is a different claim,
 * which belongs in an amendment to the entries underneath it.
 */
create or replace function public.batch_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    -- Not a transition. A target may still be corrected — but never emptied:
    -- that would put an unplanned producing stage on a running batch, straight
    -- back through the gate that was closed when the batch was issued.
    if old.target_qty is not null and new.target_qty is null then
      raise exception
        'A stage target can be corrected, not removed — the batch was issued against it.'
        using errcode = 'check_violation';
    end if;
    if old.status = 'complete'
       and new.target_qty is distinct from old.target_qty then
      raise exception
        'This stage has been signed off — its target is part of that record.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'complete' then
    raise exception 'This stage has already been signed off.'
      using errcode = 'check_violation';
  end if;

  if old.status = 'pending' and new.status = 'in_progress' then
    new.started_at := coalesce(new.started_at, now());
    return new;
  end if;

  if old.status = 'in_progress' and new.status = 'complete' then
    if not public.can_review_factory(new.factory_id) then
      raise exception 'Only a supervisor or above can sign off a stage.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.yield_acceptable is null then
      raise exception 'Say whether the yield is acceptable before signing off.'
        using errcode = 'check_violation';
    end if;
    new.completed_at := now();
    new.completed_by := coalesce(new.completed_by, auth.uid());
    -- Recorded, not asked for: it is arithmetic over two numbers already on
    -- the row, and a typed yield is a number that can disagree with them.
    new.yield_pct := case
      when new.target_qty is null or new.target_qty = 0 then null
      else round(new.accumulated_qty / new.target_qty * 100, 2)
    end;
    return new;
  end if;

  raise exception 'A stage goes pending → in progress → complete, one step at a time.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists batch_stages_transition on public.batch_stages;
create trigger batch_stages_transition
  before update on public.batch_stages
  for each row execute function public.batch_stage_transition();

/**
 * A stage with work logged against it is no longer only a plan — it is the
 * heading over a set of audit-protected rows, and removing it would orphan
 * them. The prototype expresses this as "only a pending stage may be removed";
 * this is the same rule asked of the data rather than of the status.
 */
create or replace function public.batch_stages_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.shift_log_entries where batch_stage_id = old.id
  ) then
    raise exception
      'Entries have been logged against this stage — it can no longer be removed.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists batch_stages_delete_guard on public.batch_stages;
create trigger batch_stages_delete_guard
  before delete on public.batch_stages
  for each row execute function public.batch_stages_guard_delete();

-- ── 5. The entry points at a stage ───────────────────────────────────────

alter table public.shift_log_entries
  add column if not exists batch_stage_id uuid
    references public.batch_stages (id) on delete restrict;

create index if not exists shift_log_entries_stage_idx
  on public.shift_log_entries (batch_stage_id)
  where batch_stage_id is not null;

comment on column public.shift_log_entries.batch_stage_id is
  'Which planned stage this entry counts towards. Resolved automatically when the batch has exactly one stage for the entry''s process; named explicitly when it has several (three packing runs, or three work orders). Always null on downtime.';

-- ── 6. Issuing a batch for production ────────────────────────────────────

alter table public.pipeline_jobs
  add column if not exists issued_at timestamptz,
  add column if not exists issued_by uuid references public.profiles (id) on delete set null;

comment on column public.pipeline_jobs.issued_at is
  'When this batch was released to the floor. Until it is set, the shift log refuses producing entries against it — downtime is always allowed. Set by issue_job(), which requires every planned stage to carry a target.';

/**
 * Releases a batch to the floor.
 *
 * The gate the whole migration exists for: refused unless the batch has a plan
 * and every stage in it carries a target. Deliberately a function rather than
 * a column the client sets, because "the plan is complete" is a statement
 * about other rows, and a client that checks it is a client that can be wrong
 * about it.
 *
 * Idempotent — issuing an issued batch is a no-op, not an error, so two
 * planners clicking at once do not race.
 */
create or replace function public.issue_job(p_job uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  job     public.pipeline_jobs%rowtype;
  missing text;
  total   integer;
begin
  select * into job from public.pipeline_jobs where id = p_job;
  if not found then
    raise exception 'That batch is not on the board.' using errcode = 'no_data_found';
  end if;

  if not public.can_manage_factory(job.factory_id) then
    raise exception 'Only a manager or admin can issue a batch for production.'
      using errcode = '42501';
  end if;

  if job.issued_at is not null then
    return job.issued_at;
  end if;

  select count(*) into total from public.batch_stages where job_id = p_job;
  if total = 0 then
    raise exception
      'Plan this batch''s stages before issuing it — every stage that produces something needs a target.'
      using errcode = 'check_violation';
  end if;

  select string_agg(p.name, ', ' order by s.sequence_order) into missing
  from public.batch_stages s
    join public.factory_processes p on p.id = s.process_id
  where s.job_id = p_job
    and (s.target_qty is null or s.target_qty <= 0);

  if missing is not null then
    raise exception 'These stages still need a target: %.', missing
      using errcode = 'check_violation';
  end if;

  update public.pipeline_jobs
  set issued_at = now(), issued_by = auth.uid()
  where id = p_job;

  return now();
end;
$$;

revoke all on function public.issue_job(uuid) from public;
grant execute on function public.issue_job(uuid) to authenticated;

-- ── 7. The shift log's side of the gate ──────────────────────────────────

/**
 * Decides which planned stage an entry belongs to, and refuses the ones that
 * belong to no plan.
 *
 * Four outcomes, in order:
 *
 *   downtime            always allowed, stage forced null. A room must be able
 *                       to account for its time whatever the paperwork says.
 *   no batch, or a
 *   batch with no job   allowed unchanged — a plant not using the pipeline
 *                       logs exactly as it did before this migration.
 *   job not issued      refused, naming the batch.
 *   producing entry     resolved to its stage: exactly one match is filled in
 *                       silently, none is refused, several ask which.
 *
 * The full gate applies on INSERT only. On UPDATE it validates a stage that
 * was explicitly changed and otherwise keeps its hands off, so amendments and
 * overrun clearances on rows written before this migration still work.
 */
create or replace function public.shift_log_stage_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat     text;
  job     public.pipeline_jobs%rowtype;
  matches integer;
  picked  uuid;
  names   text;
begin
  select category into cat
  from public.factory_processes where id = new.process_id;

  if cat = 'downtime' then
    new.batch_stage_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.batch_stage_id is not distinct from old.batch_stage_id then
    return new;
  end if;

  if new.product_id is null then
    new.batch_stage_id := null;
    return new;
  end if;

  select * into job from public.pipeline_jobs where product_id = new.product_id;
  if not found then
    new.batch_stage_id := null;
    return new;
  end if;

  if job.issued_at is null then
    raise exception
      'Batch % has not been issued for production yet — plan its stages and issue it first.',
      coalesce(new.batch_no, '')
      using errcode = 'check_violation';
  end if;

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

  select count(*) into matches
  from public.batch_stages
  where job_id = job.id and process_id = new.process_id;

  if matches = 0 then
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

-- Named to sort after `shift_log_amend_guard`, so an amendment settles its
-- provenance before this looks at the row.
drop trigger if exists shift_log_stage_guard on public.shift_log_entries;
create trigger shift_log_stage_guard
  before insert or update on public.shift_log_entries
  for each row execute function public.shift_log_stage_guard();

-- ── 8. A stage counts what was logged against it ─────────────────────────

/**
 * Keeps `accumulated_qty` equal to what the shift log holds for this stage —
 * good units, so rejects are subtracted, matching the prototype.
 *
 * Recomputed rather than incremented, because an amendment can change a
 * quantity or move an entry to a different stage, and an increment cannot be
 * un-applied from a row it no longer describes. Both the old and new stage are
 * recomputed on a move.
 *
 * A pending stage that receives its first entry starts: work has begun whether
 * or not anybody pressed a button, and the board should say so.
 */
create or replace function public.batch_stage_accumulate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s uuid;
begin
  foreach s in array array_remove(array[
    new.batch_stage_id,
    case when tg_op = 'UPDATE'
           and old.batch_stage_id is distinct from new.batch_stage_id
         then old.batch_stage_id end
  ], null)
  loop
    update public.batch_stages b
    set accumulated_qty = greatest(0, coalesce((
          select sum(coalesce(e.qty, 0) - coalesce(e.qty_rejected, 0))
          from public.shift_log_entries e
          where e.batch_stage_id = b.id
        ), 0)),
        status     = case when b.status = 'pending' then 'in_progress' else b.status end,
        started_at = case when b.status = 'pending' then now() else b.started_at end
    where b.id = s;
  end loop;

  return null;
end;
$$;

drop trigger if exists shift_log_stage_accumulate on public.shift_log_entries;
create trigger shift_log_stage_accumulate
  after insert or update on public.shift_log_entries
  for each row execute function public.batch_stage_accumulate();

-- The accumulation trigger writes `status`, which the transition trigger
-- guards. pending → in_progress is a legal move, so it passes; but the
-- transition trigger runs as the caller and this one as owner, and the update
-- above is the owner's. Nothing to relax.

-- ── 9. Completion moves to the plan ──────────────────────────────────────

/**
 * Signing off the last stage finishes the batch.
 *
 * Replaces the completion arm of `pipeline_sync_from_log` (0016), which
 * compared one plant-wide process's output against the product's required
 * quantity. That flag could not describe a batch whose stages have their own
 * targets, and could not express a batch whose last stage is one of three
 * packing runs.
 */
create or replace function public.batch_stage_completes_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_final and new.status = 'complete' then
    update public.pipeline_jobs
    set status      = 'finished',
        finished_at = coalesce(finished_at, now())
    where id = new.job_id
      and status <> 'finished';
  end if;
  return null;
end;
$$;

drop trigger if exists batch_stages_complete_job on public.batch_stages;
create trigger batch_stages_complete_job
  after update of status on public.batch_stages
  for each row execute function public.batch_stage_completes_job();

/**
 * The board's remaining moves, with completion removed.
 *
 * Everything else is unchanged from 0016: the first entry starts a job, a
 * flagged entry holds it, a clean entry releases it. Only the quantity-based
 * finish is gone — the plan owns that now.
 */
create or replace function public.pipeline_sync_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job  public.pipeline_jobs%rowtype;
  next public.pipeline_status;
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

  next := job.status;

  if next = 'planned' then
    next := 'production';
  end if;

  if new.action_flag is not null then
    next := 'hold';
  elsif next = 'hold' then
    next := 'production';
  end if;

  update public.pipeline_jobs
  set
    status      = next,
    unit_id     = new.unit_id,
    hold_reason = case when next = 'hold' then new.action_flag else null end,
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

-- ── 10. Pointing an entry at a stage is not an amendment ─────────────────
--
-- `shift_log_amend_guard` (0011, extended in 0023) demands a note for any
-- change to a filed entry, which is exactly right for a correction and wrong
-- for this: resolving which planned stage an entry already belonged to changes
-- nothing about what happened on the floor. Without this the backfill below
-- cannot run at all — every row would be refused for having no amend note.
--
-- Recognised the same way 0023 recognises an overrun clearance: rebuild the
-- incoming row with `batch_stage_id` put back, and if that is identical to the
-- old row then the stage was the only thing that changed. No note is demanded,
-- and `amended_at` is deliberately left alone — nothing was corrected.
--
-- An amendment that *also* moves an entry to a different packing run is still
-- an amendment and still costs a note; `batch_stage_id` is not forced back the
-- way the overrun columns are, because re-pointing an entry at the right run
-- is a legitimate thing to correct.

create or replace function public.shift_log_amend_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  probe          public.shift_log_entries%rowtype;
  clearance_only boolean;
  stage_only     boolean;
begin
  -- Overrun clearance, unchanged from 0023.
  probe := new;
  probe.overrun_note       := old.overrun_note;
  probe.overrun_cleared_by := old.overrun_cleared_by;
  probe.overrun_cleared_at := old.overrun_cleared_at;

  clearance_only :=
    (new is distinct from old) and (probe is not distinct from old);

  if clearance_only then
    if not public.can_manage_factory(new.factory_id) then
      raise exception 'Only a manager or admin can clear an overproduction flag.'
        using errcode = 'insufficient_privilege';
    end if;

    if coalesce(btrim(new.overrun_note), '') = '' then
      new.overrun_note       := null;
      new.overrun_cleared_by := null;
      new.overrun_cleared_at := null;
    else
      new.overrun_cleared_by := auth.uid();
      new.overrun_cleared_at := now();
    end if;

    new.factory_id := old.factory_id;
    new.logged_by  := old.logged_by;
    new.created_at := old.created_at;
    return new;
  end if;

  -- Stage resolution (0033). Nothing about the shift changed.
  probe := new;
  probe.batch_stage_id := old.batch_stage_id;

  stage_only :=
    (new is distinct from old) and (probe is not distinct from old);

  if stage_only then
    new.factory_id := old.factory_id;
    new.logged_by  := old.logged_by;
    new.created_at := old.created_at;
    return new;
  end if;

  -- An ordinary amendment, exactly as before.
  if new is distinct from old then
    if coalesce(btrim(new.amend_note), '') = '' then
      raise exception 'An amendment needs a note explaining the correction.';
    end if;
    new.amended_at := now();
    new.amended_by := coalesce(new.amended_by, auth.uid());
  end if;

  new.overrun_note       := old.overrun_note;
  new.overrun_cleared_by := old.overrun_cleared_by;
  new.overrun_cleared_at := old.overrun_cleared_at;

  new.factory_id := old.factory_id;
  new.logged_by  := old.logged_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

-- ── 11. Backfill, before the old flag goes ───────────────────────────────
--
-- Every job already on a board is running under the old rules. It gets a plan
-- reconstructed from what has actually been logged — the prototype's
-- `getOrCreateStageRecord`, applied once to history — and is marked issued so
-- nothing in flight stops accepting entries.
--
-- Targets are left null on purpose. Nobody can honestly say what a batch that
-- ran last month was aiming for at each stage, and inventing one would put a
-- yield percentage against a number nobody set. They show accumulated totals
-- and no progress bar until someone fills one in.

insert into public.batch_stages (
  factory_id, job_id, process_id, sequence_order, accumulated_qty, status, started_at
)
select
  j.factory_id,
  j.id,
  e.process_id,
  row_number() over (partition by j.id order by min(e.created_at)),
  greatest(0, sum(coalesce(e.qty, 0) - coalesce(e.qty_rejected, 0))),
  'in_progress',
  min(e.created_at)
from public.pipeline_jobs j
  join public.shift_log_entries e on e.product_id = j.product_id
  join public.factory_processes p on p.id = e.process_id
where p.category <> 'downtime'
  and not exists (select 1 from public.batch_stages b where b.job_id = j.id)
group by j.factory_id, j.id, e.process_id
on conflict do nothing;

-- Issued *before* the entries are pointed at their stages, and the order is
-- load-bearing: `shift_log_stage_guard` refuses a producing entry on a batch
-- that has not been issued, and it fires on this backfill like any other
-- write. Reversed, every historical row would be rejected by the gate that is
-- meant to protect the ones written from now on.
update public.pipeline_jobs
set issued_at = coalesce(issued_at, now())
where issued_at is null;

-- Point the historical entries at the stages just reconstructed, so their
-- running totals and overrun flags read per stage like everything after them.
update public.shift_log_entries e
set batch_stage_id = b.id
from public.pipeline_jobs j
  join public.batch_stages b on b.job_id = j.id
where e.product_id = j.product_id
  and b.process_id = e.process_id
  and e.batch_stage_id is null;

-- ── 12. The plant-wide Final flag retires ────────────────────────────────

drop trigger if exists factory_processes_single_final on public.factory_processes;
drop function if exists public.clear_other_final_stages();
drop index if exists public.factory_processes_one_final;

alter table public.factory_processes
  drop constraint if exists factory_processes_final_produces_output;

-- Dropped last, after both views below stop reading it.
-- (The column is removed at the end of this file.)

-- ── 13. The read models ──────────────────────────────────────────────────

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

  -- What the plan's last stage has made. The batch's completion, by decision 2.
  coalesce((
    select b.accumulated_qty
    from public.batch_stages b
    where b.job_id = j.id and b.is_final
  ), 0) as produced_qty,

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
  (
    select b.target_qty from public.batch_stages b
    where b.job_id = j.id and b.is_final
  ) as final_target_qty
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

grant select on public.pipeline_jobs_expanded to authenticated;

-- The shift log's read model, now measuring per *stage* rather than per
-- (batch, process). The two are the same thing whenever a batch runs an
-- activity once, and different exactly where it matters: three packing runs
-- under one batch number no longer pool into a single meaningless total.

drop view if exists public.shift_log_entries_expanded;

create view public.shift_log_entries_expanded
with (security_invoker = true) as
with base as (
  select
    e.id,
    e.factory_id,
    e.unit_id,
    e.process_id,
    e.product_id,
    e.batch_stage_id,
    e.log_date,
    e.shift,
    e.start_time,
    e.end_time,
    e.duration_minutes,
    e.equipment_no,
    e.batch_no,
    e.target_qty,
    e.qty,
    e.qty_unit,
    e.qty_rejected,
    e.speed_unit,
    e.target_speed,
    e.actual_speed,
    e.slow_reason,
    e.operators,
    array_to_string(e.operators, ' / ') as operators_text,
    e.comment,
    e.action_flag,
    e.created_at,
    e.amended_at,
    e.amend_note,

    u.name          as unit_name,
    p.name          as process_name,
    p.has_machine   as has_machine,
    p.category      as process_category,
    pr.name         as product_name,
    pr.code         as product_code,

    -- What the stage this entry belongs to is called, when the batch runs the
    -- activity more than once. Null on the ordinary single-run stage, where
    -- the process name already says everything.
    bs.label        as stage_label,
    bs.work_order   as stage_work_order,
    bs.sequence_order as stage_sequence,
    bs.status       as stage_status,
    bs.is_final     as stage_is_final,

    -- Per stage where there is one, per (batch, activity) where there is not.
    -- The fallback keeps every row written before 0033 reading exactly as it
    -- did, including on a plant that never puts a batch on the board.
    case
      when e.batch_no is null or btrim(e.batch_no) = '' then null
      else sum(e.qty) over (
        partition by
          e.factory_id,
          coalesce(
            e.batch_stage_id::text,
            lower(btrim(e.batch_no)) || ':' || e.process_id::text
          )
        order by e.log_date, e.created_at
        rows between unbounded preceding and current row
      )
    end as accumulative,

    e.logged_by,

    -- The target this entry is measured against: its stage's, where the batch
    -- has a plan, and the work order's where it does not. A stage target is
    -- the sharper of the two — Compression overrunning its own 210,000 is a
    -- different fact from the batch overrunning its 540,000.
    coalesce(nullif(bs.target_qty, 0), nullif(pr.required_qty, 0)) as required_qty,
    coalesce(j.overage_pct, 0) as overage_pct,

    e.overrun_note,
    e.overrun_cleared_at,
    e.overrun_cleared_by,
    cb.full_name as overrun_cleared_by_name
  from public.shift_log_entries e
    left join public.factory_units     u  on u.id  = e.unit_id
    left join public.factory_processes p  on p.id  = e.process_id
    left join public.factory_products  pr on pr.id = e.product_id
    left join public.batch_stages      bs on bs.id = e.batch_stage_id
    left join public.pipeline_jobs     j  on j.product_id = e.product_id
    left join public.profiles          cb on cb.id = e.overrun_cleared_by
),
bounded as (
  select
    base.*,
    (
      case
        when base.required_qty is not null
        then floor(base.required_qty * (1 + base.overage_pct / 100.0))
      end
    ) as allowed_qty
  from base
)
select
  bounded.*,
  (
    bounded.allowed_qty is not null
    and bounded.accumulative is not null
    and bounded.accumulative > bounded.allowed_qty
  ) as is_overrun,
  (
    case
      when bounded.allowed_qty is not null
       and bounded.accumulative is not null
       and bounded.accumulative > bounded.allowed_qty
      then bounded.accumulative - bounded.allowed_qty
    end
  ) as overrun_qty,
  (
    bounded.allowed_qty is not null
    and bounded.accumulative is not null
    and bounded.accumulative > bounded.allowed_qty
    and bounded.overrun_note is null
  ) as needs_overrun_note
from bounded;

grant select on public.shift_log_entries_expanded to authenticated;

-- ── 14. The old flag, finally ────────────────────────────────────────────
-- Nothing reads it now: both views above were rebuilt without it, and the
-- completion trigger that depended on it was replaced in section 9.

alter table public.factory_processes
  drop column if exists is_final_stage;
