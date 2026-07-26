-- FactoryOS · Admin → Shift times
-- When each shift runs and where its breaks fall. The shift log pre-fills
-- activity start/end from these, and shift duration (minus breaks) is the
-- denominator for OEE availability — so this is configuration, not display.
--
-- One row per shift per factory. 'both' is a person's rotation pattern, never
-- a shift that runs, so it is excluded here.

create table if not exists public.factory_shift_times (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references public.factories (id) on delete cascade,
  slot           public.shift_slot not null,
  start_time     time not null,
  end_time       time not null,
  break1_start   time,
  break1_minutes smallint not null default 30,
  break2_start   time,
  break2_minutes smallint not null default 30,
  updated_at     timestamptz not null default now(),
  constraint factory_shift_times_slot_runs check (slot <> 'both'),
  constraint factory_shift_times_break1_range check (break1_minutes between 0 and 120),
  constraint factory_shift_times_break2_range check (break2_minutes between 0 and 120)
);

create unique index if not exists factory_shift_times_factory_slot_key
  on public.factory_shift_times (factory_id, slot);

-- ── Row-level security ───────────────────────────────────────────────────
-- Same split as the other setup tables: the whole tenant reads (the shift log
-- needs the times), admins and managers write.
alter table public.factory_shift_times enable row level security;

drop policy if exists "factory_shift_times_member_read" on public.factory_shift_times;
create policy "factory_shift_times_member_read"
  on public.factory_shift_times for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_shift_times_manage" on public.factory_shift_times;
create policy "factory_shift_times_manage"
  on public.factory_shift_times for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
