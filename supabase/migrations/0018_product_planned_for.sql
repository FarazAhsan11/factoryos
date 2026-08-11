-- FactoryOS · Scheduled planning
--
-- The second way onto the pipeline board. Until now a batch reached Planned
-- exactly one way: a manager opened New job and ticked it. That works for the
-- batch you are starting today and not at all for the schedule a planner
-- already holds — next Tuesday's run is known on Friday, and re-entering it by
-- hand on Tuesday morning is the step that gets forgotten.
--
-- So the catalogue carries the date, and the board picks it up on the day.
--
--   · `factory_products.planned_for` — the day this batch is due to start.
--     Optional: a batch with no date is still added by hand, exactly as now.
--   · `promote_scheduled_jobs()` — creates the jobs for every batch whose date
--     has arrived, and is called when the Pipeline page loads.
--
-- ── Why promotion happens on read, not on a schedule ─────────────────────
--
-- Postgres has no scheduler of its own, and this codebase has deliberately
-- avoided background workers (see migration 0017 on why overdue is computed).
-- But a pipeline job is a row — it cannot be derived on read the way
-- `is_overdue` is, because the trigger in 0016 has to be able to *update* it.
-- Something must actually insert it.
--
-- The promotion function is therefore called when someone opens the board.
-- Nobody sees the Planned column without loading that page, so a job created
-- the moment before the render is indistinguishable from one a cron job
-- created at midnight — and this needs no extension enabled, no fixed UTC
-- hour, and nothing to monitor. It is a set-based insert over one tenant's
-- catalogue, so the cost is a single statement per page load.
--
-- The condition is `planned_for <= current_date`, not `= current_date`. A
-- factory that shuts for the weekend comes back on Monday to *all* of the
-- dates it missed, rather than silently losing Saturday's schedule because
-- nobody was logged in to observe it.

-- ── 1. The date ──────────────────────────────────────────────────────────

alter table public.factory_products
  add column if not exists planned_for date;

comment on column public.factory_products.planned_for is
  'The day this batch is scheduled to start. On or after that date it is added to the pipeline as Planned by promote_scheduled_jobs(). Null means it is only ever added by hand from New job. Kept after promotion as the record of what was scheduled.';

-- Backs the promotion scan: one tenant, dated rows only. A catalogue is mostly
-- undated, so the partial index stays small.
create index if not exists factory_products_planned_for_idx
  on public.factory_products (factory_id, planned_for)
  where planned_for is not null;

-- ── 2. What the date is allowed to be ────────────────────────────────────

/**
 * Refuses a schedule that has already happened, and freezes the date once the
 * batch is on the board.
 *
 * A trigger rather than a check constraint, for two reasons. A `check` may not
 * call `current_date` — it is not immutable, and Postgres re-evaluates
 * constraints on rows it rewrites, so a table rewrite years later would start
 * failing on rows that were perfectly valid when written. And the rule is not
 * about the value in isolation: yesterday's date is illegal to *set* and
 * entirely legal to *keep*, which only a trigger comparing old to new can say.
 *
 * The floor is `current_date - 1`, not `current_date`. `current_date` is the
 * database's date, which on Supabase is UTC, while the person picking the date
 * is looking at their own calendar. For a factory far enough east of UTC their
 * genuine "today" is already UTC's tomorrow, and far enough west it is still
 * UTC's yesterday — a one-day floor accepts an honest local today at every
 * offset. The client validates against the browser's local date, which is the
 * one the planner actually means; this is the backstop against a date typed
 * last month, not a second opinion on the timezone.
 */
create or replace function public.factory_products_guard_planned_for()
returns trigger
language plpgsql
as $$
begin
  -- Unchanged on an update — editing a quantity must not re-validate a date
  -- that was legal when it was set and has since gone by.
  if tg_op = 'UPDATE' and new.planned_for is not distinct from old.planned_for then
    return new;
  end if;

  -- Once the batch is on the board the schedule has already been acted on.
  -- Moving the date would change nothing about the card that exists — and
  -- clearing it must not be mistaken for a way to take the job back off the
  -- board, which is what Remove on a Planned card is for.
  if tg_op = 'UPDATE' and exists (
    select 1 from public.pipeline_jobs where product_id = new.id
  ) then
    raise exception
      'Batch % is already on the pipeline board — its planned date can no longer be changed.',
      new.batch_no
      using errcode = 'check_violation';
  end if;

  if new.planned_for is not null and new.planned_for < current_date - 1 then
    raise exception
      'A planned date cannot be in the past (got %).', new.planned_for
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists factory_products_planned_for_guard on public.factory_products;
create trigger factory_products_planned_for_guard
  before insert or update on public.factory_products
  for each row execute function public.factory_products_guard_planned_for();

-- ── 3. The promotion ─────────────────────────────────────────────────────

/**
 * Creates pipeline jobs for every scheduled batch whose date has arrived.
 *
 * Returns how many were added, so the board can say so out loud rather than
 * having cards appear from nowhere.
 *
 * SECURITY DEFINER because it is called by whoever opens the Pipeline, and
 * that is usually an operator — `pipeline_jobs_manage` is managers-only. The
 * tenant check below is what keeps that narrow: the function will only ever
 * act on the caller's own factory, and it decides what to insert entirely
 * from stored rows. No caller can name a product, a status or a date.
 *
 * `on conflict do nothing` against the one-job-per-batch index makes it
 * idempotent and safe to call concurrently — two supervisors opening the board
 * at 6am get one job between them, not a duplicate and an error.
 *
 * `created_by` is left null deliberately: nobody created these. Stamping the
 * person who happened to open the page would put a name against a decision
 * they did not make.
 */
create or replace function public.promote_scheduled_jobs(p_factory_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  added integer;
begin
  if not (
    public.is_super_admin() or p_factory_id = public.current_factory_id()
  ) then
    raise exception 'Not your factory.' using errcode = '42501';
  end if;

  insert into public.pipeline_jobs (factory_id, product_id, status)
  select p.factory_id, p.id, 'planned'
  from public.factory_products p
  where p.factory_id = p_factory_id
    and p.planned_for is not null
    and p.planned_for <= current_date
    -- A retired batch is not run again, so a date left on it from before is
    -- history, not a schedule.
    and p.active
  on conflict (product_id) do nothing;

  get diagnostics added = row_count;
  return added;
end;
$$;

comment on function public.promote_scheduled_jobs(uuid) is
  'Adds a Planned pipeline job for every active batch whose planned_for date has arrived and that has no job yet. Idempotent. Called when the Pipeline board loads.';

revoke all on function public.promote_scheduled_jobs(uuid) from public;
grant execute on function public.promote_scheduled_jobs(uuid) to authenticated;
