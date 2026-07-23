-- FactoryOS · Step 0 foundation: auth + tenant model
-- Roles, factories (tenants), profiles (one per auth user), auto-profile
-- trigger, and row-level security.

-- ── Roles ────────────────────────────────────────────────────────────────
create type public.user_role as enum (
  'super_admin',  -- platform owner; not tied to a factory
  'admin',        -- factory owner
  'manager',
  'supervisor',
  'operator'
);

-- ── Factories (tenants) ──────────────────────────────────────────────────
create table public.factories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  created_at timestamptz not null default now()
);

-- ── Profiles (one per auth.users row) ────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.user_role not null default 'operator',
  factory_id uuid references public.factories (id) on delete set null,
  created_at timestamptz not null default now(),
  -- super admins are platform-level and never scoped to a factory
  constraint profiles_super_admin_no_factory check (
    role <> 'super_admin' or factory_id is null
  )
);

create index profiles_factory_id_idx on public.profiles (factory_id);

-- ── Auto-create a profile whenever an auth user is created ───────────────
-- Reads role / full_name / factory_id from the user's metadata so the seed
-- script (and future invite flow) can set them at creation time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, factory_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'operator'),
    (new.raw_user_meta_data ->> 'factory_id')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row-level security ───────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.factories enable row level security;

-- Runs as definer (table owner) so it bypasses RLS and avoids policy recursion.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin'
  );
$$;

-- profiles: a user can read their own row; super admins can do anything.
create policy "profiles_select_own_or_super"
  on public.profiles for select
  using (id = auth.uid() or public.is_super_admin());

create policy "profiles_super_admin_write"
  on public.profiles for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- factories: super admins full access; members can read their own factory.
create policy "factories_super_admin_all"
  on public.factories for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "factories_member_read"
  on public.factories for select
  using (
    id in (select factory_id from public.profiles where id = auth.uid())
  );
