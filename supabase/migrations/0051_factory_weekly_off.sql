-- FactoryOS · Admin → Shift times → Weekly days off
-- The weekdays a factory is always closed (every Sunday, say), alongside the
-- one-off days in `factory_holidays` (0050). Drawn as tinted columns on
-- Pipeline → Room schedule, the same as a holiday. Advisory too: nothing
-- refuses a stage planned onto one.
--
-- One row per factory per weekday that is OFF — a day with no row works. Rows
-- rather than an array column on `factories`, so it is written under the same
-- RLS as the holidays and never needs the factory row itself to be editable.
-- `weekday` counts from Monday: 0 = Monday … 6 = Sunday, the order the Room
-- schedule's calendar is drawn in (its weeks start on Monday).

create table if not exists public.factory_weekly_off (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories (id) on delete cascade,
  weekday    smallint not null,
  created_at timestamptz not null default now(),
  constraint factory_weekly_off_weekday_range check (weekday between 0 and 6)
);

create unique index if not exists factory_weekly_off_factory_day_key
  on public.factory_weekly_off (factory_id, weekday);

-- ── Row-level security ───────────────────────────────────────────────────
-- The holidays' split: the whole tenant reads, admins and managers write.
alter table public.factory_weekly_off enable row level security;

drop policy if exists "factory_weekly_off_member_read" on public.factory_weekly_off;
create policy "factory_weekly_off_member_read"
  on public.factory_weekly_off for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_weekly_off_manage" on public.factory_weekly_off;
create policy "factory_weekly_off_manage"
  on public.factory_weekly_off for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
