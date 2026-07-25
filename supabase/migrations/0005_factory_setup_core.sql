-- FactoryOS · Step 3: Admin → setup core
-- The vocabulary every operational module reads: a factory's production units
-- (rooms / lines / machines…) and its process stages, plus the factory-level
-- settings surfaced on Admin → Company.

-- ── Factory settings ─────────────────────────────────────────────────────
alter table public.factories
  add column if not exists oee_target     smallint not null default 85,
  add column if not exists escalate_hours smallint not null default 24;

alter table public.factories
  drop constraint if exists factories_oee_target_range;
alter table public.factories
  add constraint factories_oee_target_range
  check (oee_target between 50 and 100);

alter table public.factories
  drop constraint if exists factories_escalate_hours_range;
alter table public.factories
  add constraint factories_escalate_hours_range
  check (escalate_hours between 1 and 48);

-- ── Production units ─────────────────────────────────────────────────────
create table if not exists public.factory_units (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories (id) on delete cascade,
  name       text not null,
  -- Soft-retire a unit instead of deleting it once it has history attached.
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- Names are unique per tenant, case-insensitively.
  constraint factory_units_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists factory_units_factory_name_key
  on public.factory_units (factory_id, lower(name));
create index if not exists factory_units_factory_id_idx
  on public.factory_units (factory_id);

-- ── Process stages ───────────────────────────────────────────────────────
create table if not exists public.factory_processes (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories (id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint factory_processes_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists factory_processes_factory_name_key
  on public.factory_processes (factory_id, lower(name));
create index if not exists factory_processes_factory_id_idx
  on public.factory_processes (factory_id);

-- ── Row-level security ───────────────────────────────────────────────────
-- Helpers keep the per-table policies readable; both are definer-rights so
-- they read profiles without tripping its own policies.
create or replace function public.current_factory_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select factory_id from public.profiles where id = auth.uid();
$$;

-- Who may change a factory's setup: its admin or a manager (mirrors the
-- prototype, where Admin & Settings is manager-only).
create or replace function public.can_manage_factory(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.factory_id = target
      and p.role in ('admin', 'manager')
  );
$$;

alter table public.factory_units     enable row level security;
alter table public.factory_processes enable row level security;

drop policy if exists "factory_units_member_read" on public.factory_units;
create policy "factory_units_member_read"
  on public.factory_units for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_units_manage" on public.factory_units;
create policy "factory_units_manage"
  on public.factory_units for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

drop policy if exists "factory_processes_member_read" on public.factory_processes;
create policy "factory_processes_member_read"
  on public.factory_processes for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_processes_manage" on public.factory_processes;
create policy "factory_processes_manage"
  on public.factory_processes for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

-- Company settings on Admin are editable by admins and managers, so widen the
-- update policy added in 0003 (which was admin-only, for onboarding).
drop policy if exists "factories_admin_update_own" on public.factories;
create policy "factories_manager_update_own"
  on public.factories for update
  using (public.can_manage_factory(id))
  with check (public.can_manage_factory(id));
