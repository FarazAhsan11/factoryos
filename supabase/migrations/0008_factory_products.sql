-- FactoryOS · Admin → Products
-- The batch catalogue: one row per batch / work order, carrying its own code,
-- product name and required quantity — the same shape as the prototype, where
-- typing a batch number in the shift log auto-fills these details.
--
-- `batch_no` is therefore the join key every later module looks up by, and it
-- is unique per tenant (case-insensitively), not globally.

create table if not exists public.factory_products (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references public.factories (id) on delete cascade,
  batch_no     text not null,
  code         text,
  name         text not null,
  -- Defaults to the batch number when the factory doesn't track them apart.
  work_order   text,
  -- Numeric, not integer: mixing/blending batches are counted in kg or drums
  -- (2.85 of 5), while packing lines count units (231,453 of 540,000).
  required_qty numeric(14, 2) not null default 0,
  -- Retire a finished batch instead of deleting it once it has shift history.
  active       boolean not null default true,
  created_at   timestamptz not null default now(),  
  constraint factory_products_batch_not_blank check (length(btrim(batch_no)) > 0),
  constraint factory_products_name_not_blank  check (length(btrim(name)) > 0),
  constraint factory_products_qty_positive    check (required_qty >= 0)
);

create unique index if not exists factory_products_factory_batch_key
  on public.factory_products (factory_id, lower(batch_no));
create index if not exists factory_products_factory_id_idx
  on public.factory_products (factory_id);
-- Backs the catalogue search (code / name), which scans within one tenant.
create index if not exists factory_products_factory_code_idx
  on public.factory_products (factory_id, lower(code));

-- ── Row-level security ───────────────────────────────────────────────────
-- Same split as units and processes: the whole tenant can read the catalogue
-- (the shift log needs it), admins and managers can change it.
alter table public.factory_products enable row level security;

drop policy if exists "factory_products_member_read" on public.factory_products;
create policy "factory_products_member_read"
  on public.factory_products for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_products_manage" on public.factory_products;
create policy "factory_products_manage"
  on public.factory_products for all
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));
