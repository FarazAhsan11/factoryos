-- FactoryOS · Admin → Shift times → Holidays
-- The days a factory is closed, picked by an admin and drawn as tinted columns
-- on Pipeline → Room schedule. Advisory, like a stage's room and dates:
-- nothing refuses a stage planned onto a holiday, because plants do work
-- through them. The table only says which days to mark.
--
-- One row per factory per day, with an optional name ("Diwali"). A run of days
-- is several rows — the app writes them — so the Board reads one shape and a
-- single day can be removed from the middle of a break without splitting a
-- range. A `date`, not a timestamptz, for the reason `batch_stages.planned_date`
-- is one: this plant plans in days.

create table if not exists public.factory_holidays (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references public.factories (id) on delete cascade,
  holiday_date date not null,
  label        text,
  created_at   timestamptz not null default now(),
  constraint factory_holidays_label_len check (label is null or char_length(label) <= 60)
);

create unique index if not exists factory_holidays_factory_day_key
  on public.factory_holidays (factory_id, holiday_date);

-- ── Row-level security ───────────────────────────────────────────────────
-- Same split as the other setup tables: the whole tenant reads (the Schedule
-- draws them for everyone), admins and managers write.
alter table public.factory_holidays enable row level security;

drop policy if exists "factory_holidays_member_read" on public.factory_holidays;
create policy "factory_holidays_member_read"
  on public.factory_holidays for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_holidays_manage" on public.factory_holidays;
create policy "factory_holidays_manage"
  on public.factory_holidays for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
