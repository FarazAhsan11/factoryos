-- FactoryOS · Step 2: factory onboarding wizard
-- A factory is "onboarded" once its admin completes the first-run wizard:
-- confirms the site name and names its production units. Until then the
-- dashboard shows the wizard instead.

alter table public.factories
  -- Singular + plural label for production units ("Room"/"Rooms", "Line"/"Lines").
  -- Every operational module reads these instead of hardcoding "room".
  add column if not exists unit_label        text,
  add column if not exists unit_label_plural text,
  -- Whether the admin asked for the sample pharma dataset at setup time.
  -- (Dropped again in 0004 — the wizard no longer offers it.)
  add column if not exists sample_data       boolean not null default false,
  -- Null = onboarding not started/finished. Set when the wizard completes.
  add column if not exists onboarded_at      timestamptz;

create index if not exists factories_onboarded_at_idx
  on public.factories (onboarded_at);

-- Factory admins need to write their own factory row to finish onboarding.
-- (Members already have read access via "factories_member_read".)
drop policy if exists "factories_admin_update_own" on public.factories;
create policy "factories_admin_update_own"
  on public.factories for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.factory_id = public.factories.id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and p.factory_id = public.factories.id
    )
  );
