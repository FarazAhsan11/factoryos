-- FactoryOS · Admin → Employees
-- A factory's people ARE its users: every employee row is a profile backed by
-- an auth user. Two timestamps track how far along that account is, so the
-- console can show Not invited → Invited → Active without reading auth.users
-- from the browser.

alter table public.profiles
  add column if not exists invited_at   timestamptz,
  add column if not exists activated_at timestamptz;

-- ── Read the roster ──────────────────────────────────────────────────────
-- 0001 let a user read only their own row. Employees (and later rosters,
-- attendance, handovers) need the whole tenant, so members may read every
-- profile in their own factory. Cross-tenant reads stay impossible.
drop policy if exists "profiles_factory_read" on public.profiles;
create policy "profiles_factory_read"
  on public.profiles for select
  using (
    factory_id is not null
    and factory_id = public.current_factory_id()
  );

-- ── Activation ───────────────────────────────────────────────────────────
-- Called by /set-password once the invitee picks a password. Definer-rights
-- and argument-free: a user can only ever stamp their own row, so there is no
-- update policy on profiles to abuse.
create or replace function public.mark_profile_activated()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles
     set activated_at = coalesce(activated_at, now())
   where id = auth.uid();
$$;

-- Anyone who already signed in predates the column; treat them as active so
-- the roster doesn't show existing admins as "never activated".
update public.profiles p
   set activated_at = u.last_sign_in_at,
       invited_at   = coalesce(p.invited_at, u.created_at)
  from auth.users u
 where u.id = p.id
   and p.activated_at is null
   and u.last_sign_in_at is not null;
