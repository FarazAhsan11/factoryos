-- FactoryOS · Maintenance requests — raising one
--
-- The floor's way of saying "this machine needs a fitter". Deliberately only
-- the *raising* half: a request is created, numbered and listed, and nothing
-- here assigns it, works it or verifies it. Those states are coming, so the
-- status column exists with the whole vocabulary in it — but no code moves a
-- request past `reported` yet, and none of the columns that would record the
-- work are invented ahead of knowing what they need to hold.
--
-- Two departures from the prototype, both asked for:
--
--  · **Department, not issue type.** The prototype asks what kind of fault it
--    is (mechanical / electrical / pneumatic…). What a supervisor actually
--    needs to record is *who is needed* — and which trades a factory has is a
--    property of that factory, not a list this application can guess. So it is
--    a per-tenant setup list, managed in Admin like rooms and processes.
--
--  · **The batch is typed, not picked.** Same as the shift log: the operator
--    knows the batch number off the paperwork, and a dropdown of every open
--    batch is slower to use and stops working the moment the batch isn't on
--    the pipeline board.

-- ── 1. Departments ───────────────────────────────────────────────────────
-- The same shape as `factory_units` and `factory_processes`, so the generic
-- `SetupListManager` drives it with no new component.

create table if not exists public.factory_departments (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories (id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),

  constraint factory_departments_name_not_blank check (length(btrim(name)) > 0)
);

-- One "Electrical" per factory, however it was capitalised on the day.
create unique index if not exists factory_departments_name_key
  on public.factory_departments (factory_id, lower(btrim(name)));

alter table public.factory_departments enable row level security;

-- Read for the whole tenant (the request form needs the list), write for
-- managers — the same split every other setup list uses.
drop policy if exists "departments_member_read" on public.factory_departments;
create policy "departments_member_read"
  on public.factory_departments for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "departments_manage_all" on public.factory_departments;
create policy "departments_manage_all"
  on public.factory_departments for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

-- ── 2. Per-factory reference numbers ─────────────────────────────────────

/**
 * A counter per factory per kind of document, so a request can be called
 * "MR-2026-014" on the floor rather than by a uuid nobody can read out.
 *
 * A table rather than `max(number) + 1` at insert time, because that pattern
 * hands the same number to two people who submit at once and then fails one of
 * them on the unique index. `update … returning` takes a row lock, so the
 * second caller waits and gets 15.
 *
 * Keyed by kind as well as factory because CAPA numbers will want exactly this
 * and should not each grow their own counter.
 */
create table if not exists public.factory_counters (
  factory_id uuid not null references public.factories (id) on delete cascade,
  kind       text not null,
  year       smallint not null,
  next_value integer not null default 1,
  primary key (factory_id, kind, year)
);

alter table public.factory_counters enable row level security;
-- No policy at all: this table is only ever touched by the definer function
-- below, which bypasses RLS. Nothing in the browser has business reading it.

create or replace function public.next_document_number(
  p_factory uuid,
  p_kind    text,
  p_prefix  text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yr  smallint := extract(year from now())::smallint;
  seq integer;
begin
  -- Make sure the row exists, then bump it. Two statements rather than one
  -- clever upsert because the `update` is where the row lock is taken, and
  -- that lock is the entire point: a second caller blocks here and comes out
  -- with the next number instead of a duplicate.
  insert into public.factory_counters (factory_id, kind, year, next_value)
  values (p_factory, p_kind, yr, 1)
  on conflict (factory_id, kind, year) do nothing;

  update public.factory_counters
     set next_value = next_value + 1
   where factory_id = p_factory
     and kind = p_kind
     and year = yr
  returning next_value - 1 into seq;

  return p_prefix || '-' || yr::text || '-' || lpad(seq::text, 3, '0');
end;
$$;

-- ── 3. Vocabulary ────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'maintenance_priority') then
    create type public.maintenance_priority as enum (
      'urgent',   -- stop production
      'routine',  -- next available
      'planned'   -- scheduled
    );
  end if;

  -- The full journey, declared now so the states arrive without a type swap.
  -- Only `reported` is reachable today.
  if not exists (select 1 from pg_type where typname = 'maintenance_status') then
    create type public.maintenance_status as enum (
      'reported', 'assigned', 'in_progress', 'completed', 'verified'
    );
  end if;
end $$;

-- ── 4. The request ───────────────────────────────────────────────────────

create table if not exists public.maintenance_requests (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories (id) on delete cascade,

  -- "MR-2026-014". Stamped by the trigger below, never sent by the client.
  request_no  text not null,

  equipment_no text not null,

  -- `restrict` for the same reason as the shift log: a room with history is
  -- retired, not deleted. Nullable — a facility fault belongs to no room.
  unit_id       uuid references public.factory_units (id) on delete restrict,
  department_id uuid references public.factory_departments (id) on delete restrict,

  priority    public.maintenance_priority not null default 'routine',
  status      public.maintenance_status not null default 'reported',
  description text not null,

  -- Typed, and kept as text rather than only a product id. The batch on the
  -- paperwork is what someone will search for later, and a fault can be raised
  -- against a batch that was never added to the catalogue. `product_id` is the
  -- resolution when there is one, not a requirement.
  batch_no   text,
  product_id uuid references public.factory_products (id) on delete set null,

  -- Free text, and the same reasoning as the shift log's operators: the fitter
  -- who takes this may be a contractor with no login at all.
  reported_by text,
  assigned_to text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint maintenance_equipment_not_blank check (length(btrim(equipment_no)) > 0),
  constraint maintenance_description_len check (length(btrim(description)) >= 10)
);

create unique index if not exists maintenance_requests_no_key
  on public.maintenance_requests (factory_id, request_no);

-- The list reads one factory's requests, newest first, urgent ones filtered.
create index if not exists maintenance_requests_factory_idx
  on public.maintenance_requests (factory_id, created_at desc);

alter table public.maintenance_requests enable row level security;

-- Read and raise for the whole tenant: the person who finds a broken machine
-- is whoever was standing next to it. Which roles reach the page at all is a
-- navigation concern, not a data one.
drop policy if exists "maintenance_member_read" on public.maintenance_requests;
create policy "maintenance_member_read"
  on public.maintenance_requests for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "maintenance_member_insert" on public.maintenance_requests;
create policy "maintenance_member_insert"
  on public.maintenance_requests for insert
  with check (
    (public.is_super_admin() or factory_id = public.current_factory_id())
    and created_by = auth.uid()
  );

-- Update and delete are deliberately manager-only *and* unused for now: no
-- code moves a request yet, and a raised request is a record rather than
-- clutter. The policies exist so the workflow has something to build on.
drop policy if exists "maintenance_manage_update" on public.maintenance_requests;
create policy "maintenance_manage_update"
  on public.maintenance_requests for update
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

drop policy if exists "maintenance_manage_delete" on public.maintenance_requests;
create policy "maintenance_manage_delete"
  on public.maintenance_requests for delete
  using (public.can_manage_factory(factory_id));

/**
 * Stamps the request number.
 *
 * In a trigger so the number cannot be chosen, skipped or duplicated by a
 * client, and so it is allocated inside the same transaction as the row it
 * belongs to — a number handed out first and then abandoned by a failed insert
 * leaves a permanent gap in a sequence people read as "one went missing".
 */
create or replace function public.maintenance_stamp_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(new.request_no), '') = '' then
    new.request_no := public.next_document_number(new.factory_id, 'MR', 'MR');
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_number on public.maintenance_requests;
create trigger maintenance_number
  before insert on public.maintenance_requests
  for each row execute function public.maintenance_stamp_number();

-- ── 5. The read model ────────────────────────────────────────────────────
-- Names flattened on, so the list renders from one row without cross-
-- referencing three caches.

create or replace view public.maintenance_requests_expanded
with (security_invoker = true) as
select
  m.id,
  m.factory_id,
  m.request_no,
  m.equipment_no,
  m.unit_id,
  m.department_id,
  m.priority,
  m.status,
  m.description,
  m.batch_no,
  m.product_id,
  m.reported_by,
  m.assigned_to,
  m.created_at,
  m.created_by,

  u.name  as unit_name,
  d.name  as department_name,
  pr.name as product_name,
  pr.code as product_code
from public.maintenance_requests m
  left join public.factory_units       u  on u.id  = m.unit_id
  left join public.factory_departments d  on d.id  = m.department_id
  left join public.factory_products    pr on pr.id = m.product_id;

comment on view public.maintenance_requests_expanded is
  'Read model for Maintenance. Raising only — nothing yet moves a request past `reported`.';

grant select on public.maintenance_requests_expanded to authenticated;
