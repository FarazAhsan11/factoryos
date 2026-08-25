-- FactoryOS · Admin → Equipment
--
-- The machine register: one row per physical asset, carrying the number
-- painted on it and the name people call it by. Same job the batch catalogue
-- does for `batch_no` — the shift log asks for an equipment number, and the
-- name is read back out of here rather than retyped into every entry.
--
-- Two columns, not one, because they answer different questions and are
-- typed by different people: the operator knows "EQ383" off the machine, the
-- report reader needs "Bosch GKF 1500 Encapsulator" to know what that was.
--
-- `equipment_no` is the join key, unique per tenant (case-insensitively) the
-- way `factory_products.batch_no` is — EQ383 in one factory has nothing to do
-- with EQ383 in the next.

create table if not exists public.factory_equipment (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references public.factories (id) on delete cascade,
  equipment_no text not null,
  name         text not null,
  -- Retire a decommissioned machine instead of deleting it: shift entries
  -- reference it by number, and history has to keep resolving.
  active       boolean not null default true,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),

  constraint factory_equipment_no_not_blank
    check (length(btrim(equipment_no)) > 0),
  constraint factory_equipment_name_not_blank
    check (length(btrim(name)) > 0)
);

-- One EQ383 per factory, however it was capitalised on the day.
create unique index if not exists factory_equipment_factory_no_key
  on public.factory_equipment (factory_id, lower(btrim(equipment_no)));
create index if not exists factory_equipment_factory_id_idx
  on public.factory_equipment (factory_id);

-- ── Row-level security ───────────────────────────────────────────────────
-- The same split every setup list uses: the whole tenant reads it (the shift
-- log and the maintenance form both need to resolve a number), managers and
-- admins change it.
alter table public.factory_equipment enable row level security;

drop policy if exists "factory_equipment_member_read" on public.factory_equipment;
create policy "factory_equipment_member_read"
  on public.factory_equipment for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_equipment_manage" on public.factory_equipment;
create policy "factory_equipment_manage"
  on public.factory_equipment for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
