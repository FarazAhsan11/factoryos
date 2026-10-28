-- FactoryOS · Resources → Workforce
--
-- The people who do the work, kept apart from the people who sign in.
--
-- Until now the shift 4log's operator picker read `profiles` — every name on it
-- was an account. That made a login the price of being named on a shift
-- record, when most of a floor never opens the app: an operator on line 3 is
-- written down by their supervisor, not by themselves. So the two lists split:
--
--   · `profiles` (Configuration → Users) — who can sign in, with what access.
--   · `factory_workers` (this table, Resources → Workforce) — who performs and
--     is assigned work: shift-log operators, a maintenance job's assignee, an
--     issue's investigator, a deviation's owners.
--
-- A record that names a worker stores the *name*, not this row's id, for the
-- reason the shift log always has: it must keep saying who ran the machine
-- after the person is renamed or leaves. Which is also why deleting a worker
-- is safe — nothing references the row.
--
-- `role` is free text ("Operator", "Team leader", "Fitter"), as the prototype's
-- "Role / position" was: the trades on a floor differ plant to plant, and this
-- is a description of the job, not an access level — that is `profiles.role`.
--
-- `full_name` is unique per tenant, case-insensitively: the pickers key their
-- options by name, and two "Ali Khan"s would be one option that means two
-- people. A plant with two adds an initial or a number, as its floor already
-- does out loud.

create table if not exists public.factory_workers (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references public.factories (id) on delete cascade,
  full_name     text not null,
  -- Optional: a plant mid-setup may not have its departments in yet, and a
  -- department removed later should leave its people unassigned, not block.
  department_id uuid references public.factory_departments (id) on delete set null,
  -- Same enum as `profiles.default_shift`: morning, afternoon, or both
  -- (labelled Rotating). The operator picker lists a shift's own people first.
  shift         public.shift_slot not null default 'morning',
  role          text not null default 'Operator',
  created_at    timestamptz not null default now(),

  constraint factory_workers_name_not_blank check (length(btrim(full_name)) > 0),
  constraint factory_workers_name_length check (length(full_name) <= 80),
  constraint factory_workers_role_not_blank check (length(btrim(role)) > 0),
  constraint factory_workers_role_length check (length(role) <= 60)
);

create unique index if not exists factory_workers_factory_name_key
  on public.factory_workers (factory_id, lower(btrim(full_name)));
create index if not exists factory_workers_factory_id_idx
  on public.factory_workers (factory_id);

-- ── Department belongs to the same factory ──────────────────────────────
-- A foreign key checks the row exists, not whose it is — and a key check does
-- not pass through RLS, so without this a client could point a worker at
-- another tenant's department.
create or replace function public.factory_workers_department_guard()
returns trigger
language plpgsql
as $$
begin
  if new.department_id is not null and not exists (
    select 1
      from public.factory_departments d
     where d.id = new.department_id
       and d.factory_id = new.factory_id
  ) then
    raise exception 'That department does not belong to this factory.'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists factory_workers_department_guard on public.factory_workers;
create trigger factory_workers_department_guard
  before insert or update of department_id, factory_id on public.factory_workers
  for each row execute function public.factory_workers_department_guard();

-- ── Row-level security ───────────────────────────────────────────────────
-- The equipment register's split: the whole tenant reads (every operator
-- files shift entries and needs the picker), managers and admins change it.
alter table public.factory_workers enable row level security;

drop policy if exists "factory_workers_member_read" on public.factory_workers;
create policy "factory_workers_member_read"
  on public.factory_workers for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_workers_manage" on public.factory_workers;
create policy "factory_workers_manage"
  on public.factory_workers for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
