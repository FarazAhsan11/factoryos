-- FactoryOS · Pipeline → Kanban
--
-- One row per batch being worked, and the board is those rows grouped by
-- status. The whole point is that **nobody drags a card**: status is derived
-- from the shift log, which is the only place work is actually recorded.
--
--   planned    a job was added from the New Job modal, nothing logged yet
--   production any entry has been logged against the batch
--   hold       the latest entry flagged an issue
--   finished   the final stage has produced the required quantity
--
-- The transitions live in a trigger on `shift_log_entries`, not in the
-- browser, for three reasons that matter here more than anywhere else:
--
--   · The log is audit-protected and permanent. A client that dies between
--     "insert the entry" and "update the job" would leave the board
--     permanently disagreeing with the record it is supposed to describe.
--   · Amendments. Correcting an entry that raised a Safety flag has to
--     release the hold; client-side code written today never re-runs over a
--     row amended tomorrow, and a trigger does.
--   · Any future caller — an import, a Server Action, a seed script — gets
--     the same behaviour without knowing it exists.

-- ── 1. Which stage means "the batch is done" ─────────────────────────────
--
-- A batch passes through several producing stages and each logs roughly the
-- full quantity: dispensed 540,000, encapsulated 540,000, packed 540,000.
-- Summing them finishes a job at a quarter of the real work; taking the
-- largest finishes it when the *first* stage does. Neither is the truth.
--
-- So exactly one process per factory carries the flag, and its output is the
-- batch's output. Everything else is work in progress.
alter table public.factory_processes
  add column if not exists is_final_stage boolean not null default false;

comment on column public.factory_processes.is_final_stage is
  'The one stage whose output IS the finished batch (usually the last pack or label step). Drives pipeline completion and the batch progress bar. At most one per factory.';

-- The invariant. A partial unique index on factory_id alone: at most one row
-- per factory may have the flag set, and the second is refused outright.
create unique index if not exists factory_processes_one_final
  on public.factory_processes (factory_id)
  where is_final_stage;

-- The final stage is measured by what it produced, and a `has_output = false`
-- process stores null quantities by design (migration 0013). Tagging one would
-- leave every job stuck at 0 produced, for ever, with nothing on screen
-- explaining why — so it is refused instead of silently never completing.
alter table public.factory_processes
  drop constraint if exists factory_processes_final_produces_output;
alter table public.factory_processes
  add constraint factory_processes_final_produces_output
  check (not is_final_stage or has_output);

/**
 * Ticking "Final" on a process clears it from whichever process held it.
 *
 * In the database rather than the UI so the swap is atomic. Done as two
 * client writes — clear the old, set the new — a failure between them leaves
 * the factory with *no* final stage, which silently disables completion for
 * every job on the board. Here the caller makes one write and the invariant
 * cannot be observed broken, including by two admins tagging different
 * processes at the same moment.
 */
create or replace function public.clear_other_final_stages()
returns trigger
language plpgsql
as $$
begin
  update public.factory_processes
  set is_final_stage = false
  where factory_id = new.factory_id
    and id <> new.id
    and is_final_stage;
  return new;
end;
$$;

drop trigger if exists factory_processes_single_final on public.factory_processes;
create trigger factory_processes_single_final
  before insert or update of is_final_stage on public.factory_processes
  for each row
  when (new.is_final_stage)
  execute function public.clear_other_final_stages();

-- ── 2. The jobs ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_status') then
    create type public.pipeline_status as enum (
      'planned', 'production', 'hold', 'finished'
    );
  end if;
end $$;

create table if not exists public.pipeline_jobs (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories (id) on delete cascade,

  -- The batch. `restrict`, not cascade: a product with a job on the board is
  -- retired, never deleted out from under it.
  product_id  uuid not null references public.factory_products (id) on delete restrict,

  status      public.pipeline_status not null default 'planned',

  -- Where the batch is right now, learned from the shift log rather than
  -- asked for: every entry names a unit, so the card can say which room
  -- without anyone maintaining it. Null until the first entry.
  unit_id     uuid references public.factory_units (id) on delete set null,

  -- The action flag that caused the current hold, so the card can say *why*
  -- it stopped rather than only that it did. Cleared on release.
  hold_reason text,

  -- The journey, for lead-time reporting later. Each is stamped once, when
  -- the job first reaches that state.
  planned_at  timestamptz not null default now(),
  started_at  timestamptz,
  held_at     timestamptz,
  finished_at timestamptz,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint pipeline_jobs_hold_reason_known check (
    hold_reason is null
    or hold_reason in ('Quality', 'Maintenance', 'Safety', 'Process')
  )
);

-- One job per batch. A batch number already identifies exactly one run —
-- `factory_products` is unique on (factory_id, lower(batch_no)) — so a second
-- card for the same batch could only ever be a mistake.
create unique index if not exists pipeline_jobs_product_key
  on public.pipeline_jobs (product_id);

-- The board reads one factory's jobs, grouped by status.
create index if not exists pipeline_jobs_factory_status_idx
  on public.pipeline_jobs (factory_id, status);

-- ── Row-level security ───────────────────────────────────────────────────
-- Read: the whole tenant — the board is for everyone. Write: managers, who
-- plan the work. The status trigger below writes as its owner, so an operator
-- logging an entry still moves the card without being able to touch it
-- directly.
alter table public.pipeline_jobs enable row level security;

drop policy if exists "pipeline_jobs_member_read" on public.pipeline_jobs;
create policy "pipeline_jobs_member_read"
  on public.pipeline_jobs for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "pipeline_jobs_manage" on public.pipeline_jobs;
create policy "pipeline_jobs_manage"
  on public.pipeline_jobs for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

-- ── 3. The board moves itself ────────────────────────────────────────────

/**
 * Re-evaluates the job for the batch this entry belongs to.
 *
 * Runs on insert *and* update: an amendment that removes a flag has to
 * release the hold it caused, and one that corrects a quantity has to be able
 * to complete the job.
 *
 * SECURITY DEFINER because the person logging an entry is usually an operator
 * and the write policy above is managers-only. The job must move regardless of
 * who logged the work — but only ever through this function, which is why the
 * policy stays narrow.
 *
 * A finished job is left alone. Completion is the end of the board's interest
 * in a batch, and a late correction should not resurrect a card that everyone
 * has stopped looking at.
 */
create or replace function public.pipeline_sync_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job        public.pipeline_jobs%rowtype;
  next       public.pipeline_status;
  produced   numeric;
  required   numeric;
  has_final  boolean;
begin
  -- Entries that never matched a batch in the catalogue have no job to move.
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

  -- Any entry means work has started on this batch — including Set Up,
  -- Manning and the other non-producing stages. Somebody is on it, which is
  -- exactly what the Planned column stops being true about.
  if next = 'planned' then
    next := 'production';
  end if;

  -- A flagged entry holds the batch. Checked after the start rule so an issue
  -- raised during set-up lands the card in On Hold rather than Planned.
  if new.action_flag is not null then
    next := 'hold';
  elsif next = 'hold' then
    -- A clean entry releases it.
    next := 'production';
  end if;

  -- Completion, measured only at the stage tagged `is_final_stage`. A held
  -- job cannot finish: an unresolved issue outranks a quantity.
  if next = 'production' then
    select exists (
      select 1 from public.factory_processes
      where factory_id = new.factory_id and is_final_stage
    ) into has_final;

    if has_final then
      select coalesce(sum(e.qty), 0) into produced
      from public.shift_log_entries e
      join public.factory_processes p on p.id = e.process_id
      where e.product_id = new.product_id
        and p.is_final_stage;

      select p.required_qty into required
      from public.factory_products p
      where p.id = new.product_id;

      if coalesce(required, 0) > 0 and produced >= required then
        next := 'finished';
      end if;
    end if;
  end if;

  update public.pipeline_jobs
  set
    status      = next,
    -- Where the batch is now, not where it started: the card should say which
    -- room to walk to.
    unit_id     = new.unit_id,
    hold_reason = case when next = 'hold' then new.action_flag else null end,
    -- Stamped on first arrival only, so the timings stay the real ones. A job
    -- that bounces production → hold → production keeps its original start.
    started_at  = case
                    when job.started_at is null and next <> 'planned'
                    then now() else job.started_at
                  end,
    held_at     = case
                    when next = 'hold' and job.status <> 'hold'
                    then now() else job.held_at
                  end,
    finished_at = case
                    when next = 'finished' then now() else job.finished_at
                  end
  where id = job.id;

  return null;
end;
$$;

drop trigger if exists shift_log_pipeline_sync on public.shift_log_entries;
create trigger shift_log_pipeline_sync
  after insert or update on public.shift_log_entries
  for each row execute function public.pipeline_sync_from_log();

-- ── 4. The board's read model ────────────────────────────────────────────
-- Everything a card shows, in one row: the batch's identity, where it is, and
-- how far through it is. `security_invoker` so it inherits the policies above
-- rather than running as its owner and leaking every tenant's board.
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

  -- What the tagged final stage has produced for this batch. Null-safe: a
  -- factory with no final stage tagged yet gets 0 and no job completes,
  -- which the Pipeline page says out loud rather than quietly stalling.
  coalesce((
    select sum(e.qty)
    from public.shift_log_entries e
      join public.factory_processes p on p.id = e.process_id
    where e.product_id = j.product_id
      and p.is_final_stage
  ), 0) as produced_qty,

  -- How many entries on this batch have ever raised a flag, for the card's
  -- warning count. Deliberately "ever", not "open" — there is no resolution
  -- to read yet, and it will mean "open" only once Actions is built.
  (
    select count(*)
    from public.shift_log_entries e
    where e.product_id = j.product_id
      and e.action_flag is not null
  ) as flagged_count
from public.pipeline_jobs j
  left join public.factory_products pr on pr.id = j.product_id
  left join public.factory_units    u  on u.id  = j.unit_id;

comment on view public.pipeline_jobs_expanded is
  'Read model for the pipeline Kanban: a job plus its batch identity, current room, and quantity produced at the final stage. RLS inherited from pipeline_jobs via security_invoker.';

grant select on public.pipeline_jobs_expanded to authenticated;
