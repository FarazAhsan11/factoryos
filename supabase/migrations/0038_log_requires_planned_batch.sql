-- FactoryOS · A producing entry needs a planned batch — closing the two ways round the gate
--
-- Stage planning (0033) put a gate in front of the shift log: a producing
-- entry is refused unless its batch has been issued, and refused again unless
-- the activity is in that batch's plan. What it did not do was make the gate
-- unavoidable. `shift_log_stage_guard` reached those two refusals only after
-- two early returns:
--
--   product_id is null       accepted, stage forced null
--   no pipeline_jobs row     accepted, stage forced null
--
-- So the enforcement ran backwards. A batch someone had planned, targeted and
-- issued was held to every rule; a batch nobody had ever put on the board went
-- straight through, and so did a batch number that matched nothing in the
-- product register at all. The entry landed with `batch_stage_id` null, which
-- means it counted towards no stage's `accumulated_qty`, could never complete
-- anything, was never measured against a tolerance (0037) — and, because the
-- shift log has no delete policy, could not afterwards be attached to the plan
-- it should have been part of.
--
-- Those two returns were a deliberate accommodation, written so that "a plant
-- not using the pipeline logs exactly as it did before this migration". That
-- accommodation is withdrawn here. The pipeline is how this plant plans work;
-- an entry against a batch that is not on the board is not a plant working
-- differently, it is production nobody planned.
--
-- ── The gate after this migration ────────────────────────────────────────
--
-- For an entry whose activity is `preparatory` or `production`:
--
--   1. the batch number must resolve to a product in the register
--   2. that product must have a card on the pipeline board
--   3. that card must be issued for production
--   4. the activity must be a stage in that batch's plan
--
-- A producing entry must name a batch. Downtime need not — but if it does,
-- rules 1 and 2 apply to it too. See below.
--
-- 3 and 4 already existed; 1 and 2 are new, and 3 and 4 are now reachable for
-- every producing entry rather than only for batches that happened to have a
-- card. Each failure names which rule it is and what to do about it.
--
-- `downtime` is the softer road, and deliberately so. It needs no batch at 
-- all — a compressor that fails between batches, a power cut, a room cleaning
-- down: there is nothing to name, and refusing the entry would only lose the
-- record of time the plant actually lost. But a number that *is* typed has to
-- mean something, so rules 1 and 2 apply to it; an off-board batch cannot
-- legally be running under this migration, so downtime booked against one is a
-- typo or time charged to work nobody planned, and either way it puts a batch
-- number on the handover sheet that nobody can look up.
--
-- Rules 3 and 4 never apply to downtime: setup and changeover delays are real
-- downtime that happens *before* a batch is issued, and no downtime activity
-- is plannable at all (the plan dialog filters the category out), so either
-- would make downtime unloggable rather than accurate. Downtime always stores
-- a null stage.
--
-- ── The entries that already got through ─────────────────────────────────
--
-- Section 2 deletes them. This is the one place in the codebase that deletes
-- from `shift_log_entries`, and it is scoped to precisely the set the new gate
-- refuses at rules 1 and 2: a producing entry, with no stage, whose batch has
-- no product or no card. It is not a general amnesty on null-staged rows —
-- entries filed before 0033 against batches that *are* on the board keep their
-- null stage and are left alone, because those are history rather than holes.

-- ── 1. The gate ──────────────────────────────────────────────────────────

/**
 * Resolves a producing entry to its planned stage, or refuses it.
 *
 * Replaces the 0033 version. Same four resolution outcomes for a batch that is
 * on the board; the two early returns that let an unplanned batch skip them
 * are now refusals. Downtime keeps its own softer road — never a stage, never
 * held to the plan or to issue, and free to name no batch at all — but a batch
 * number it does name must be real and on the board, because a number that
 * cannot be looked up is worse on a handover sheet than no number.
 *
 * The full gate applies on INSERT, and on any UPDATE that moves the stage or
 * the batch. Otherwise it keeps its hands off — an amendment to a comment, an
 * overrun clearance (0023), and every row written before stage planning
 * existed have to keep working, and re-running the gate on them would refuse
 * an amendment for a rule that did not exist when the entry was filed.
 *
 * The batch is part of that test, not just the stage. `updateLogEntry` writes
 * `product_id` along with everything else, so an amendment can move an entry
 * to a different batch while leaving `batch_stage_id` untouched — which, on
 * the 0033 test, slipped through and left the entry counting towards a stage
 * belonging to a batch it is no longer part of.
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

  -- Downtime never belongs to a stage, whatever else is true of it.
  if cat = 'downtime' then
    new.batch_stage_id := null;

    -- An amendment that leaves the batch where it was is not this trigger's
    -- business — a correction to the reason or the end time on a row filed
    -- before this migration must not be refused for a rule that came after it.
    if tg_op = 'UPDATE'
       and new.product_id is not distinct from old.product_id
       and new.batch_no   is not distinct from old.batch_no then
      return new;
    end if;

    -- No batch named: the ordinary case, and there is nothing to check.
    if btrim(coalesce(new.batch_no, '')) = '' and new.product_id is null then
      return new;
    end if;

    -- A batch *was* named, so it has to be one. Rules 1 and 2 only: an
    -- unissued batch can still lose time to setup, and no downtime activity
    -- appears in any plan.
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

  -- Rule 1. No batch, or a batch number that matches nothing in the register.
  -- `product_id` is resolved from the typed number by the form; null means it
  -- found no row, which is a typo or a batch that was never created.
  if new.product_id is null then
    raise exception
      'Enter a batch number that exists in the product register — % matches none. Only downtime can be logged without a batch.',
      coalesce(nullif(btrim(new.batch_no), ''), '(blank)')
      using errcode = 'check_violation';
  end if;

  -- Rule 2. In the register, but never put on the board. Nothing plans it,
  -- nothing tracks it, and an entry against it would answer to no target.
  select * into job from public.pipeline_jobs where product_id = new.product_id;
  if not found then
    raise exception
      'Batch % is not on the production board — a manager adds it on the Pipeline, plans its stages and issues it before work can be logged against it.',
      coalesce(new.batch_no, '')
      using errcode = 'check_violation';
  end if;

  -- Rule 3. On the board, not yet released to the floor.
  if job.issued_at is null then
    raise exception
      'Batch % has not been issued for production yet — plan its stages and issue it first.',
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

  -- Rule 4, resolved: exactly one match is filled in silently, none is
  -- refused, several ask which.
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

-- Unchanged from 0033, restated so the trigger and its function are read
-- together. Named to sort after `shift_log_amend_guard`, so an amendment
-- settles its provenance before this looks at the row, and before
-- `shift_log_stage_tolerance` (0037), which reads the stage this resolves.
drop trigger if exists shift_log_stage_guard on public.shift_log_entries;
create trigger shift_log_stage_guard
  before insert or update on public.shift_log_entries
  for each row execute function public.shift_log_stage_guard();

-- ── 2. Removing the entries that came through the hole ───────────────────

/**
 * The only delete against `shift_log_entries` in the codebase.
 *
 * These rows are not history. A producing entry with no stage, against a batch
 * with no card, records work that answers to no plan and no target: it is
 * absent from every stage total, from the batch's progress, from completion
 * and from the tolerance check, and it cannot be repaired by an amendment
 * because there is no stage to attach it to. Leaving them would mean the
 * numbers on the board and the numbers in the log disagree permanently.
 *
 * `actions.shift_log_entry_id` is `on delete set null`, so an issue raised by
 * one of these keeps its text and loses only the link to a row that no longer
 * exists. Nothing else references the table.
 *
 * Downtime is *not* swept up, even where it names a batch the new gate would
 * now refuse, or none at all. That row records time a room actually lost,
 * which is true whatever is wrong with the batch number beside it, and an
 * amendment can put the right number on it. Deleting real lost time to tidy up
 * a reference would be the worse trade.
 *
 * Scoped tightly on purpose — see the header. Run as the migration's owner,
 * which is how it gets past the absent delete policy; no delete policy is
 * added, so the application still cannot delete an entry.
 */
do $$
declare
  removed integer;
begin
  with doomed as (
    delete from public.shift_log_entries e
    using public.factory_processes p
    where p.id = e.process_id
      and p.category is distinct from 'downtime'
      and e.batch_stage_id is null
      and (
        e.product_id is null
        or not exists (
          select 1 from public.pipeline_jobs j where j.product_id = e.product_id
        )
      )
    returning e.id
  )
  select count(*) into removed from doomed;

  raise notice 'Removed % unplanned producing entr%.', removed,
    case when removed = 1 then 'y' else 'ies' end;
end $$;
