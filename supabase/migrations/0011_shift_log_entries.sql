-- FactoryOS · Shift log → Log entry
-- The first operational table: one row per activity an operator logs during a
-- shift. Everything downstream (OEE, Pareto, batch history, handover) is read
-- back out of this table, so the columns follow the prototype's entry form.
--
-- Two shapes share one table. A process flagged `has_machine` carries speed
-- data (target/actual + a reason when it runs slow); a manual process carries
-- none. Splitting them into two tables would double every later query for no
-- gain — the machine columns are simply null for manual work.
--
-- Entries are AUDIT-PROTECTED: there is no delete policy at all. A mistake is
-- corrected with an amendment (amend_note + amended_by + amended_at), which
-- keeps the original row and its history intact.

create table if not exists public.shift_log_entries (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references public.factories (id) on delete cascade,

  -- ── Where & when ──────────────────────────────────────────────────────
  -- restrict, not cascade: a unit or process with shift history must be
  -- retired (active = false), never deleted out from under its entries.
  unit_id          uuid not null references public.factory_units (id) on delete restrict,
  process_id       uuid not null references public.factory_processes (id) on delete restrict,
  log_date         date not null default current_date,
  shift            public.shift_slot not null,
  start_time       time,
  end_time         time,
  -- Derived from start/end in the form (wrapping past midnight), stored so
  -- reports never have to redo the arithmetic.
  duration_minutes integer not null default 0,
  equipment_no     text,

  -- ── Batch ─────────────────────────────────────────────────────────────
  -- batch_no is kept as text alongside the FK: the catalogue row may later be
  -- deleted, but what was written on the shift record must not change.
  batch_no         text,
  product_id       uuid references public.factory_products (id) on delete set null,

  -- ── Output ────────────────────────────────────────────────────────────
  target_qty       numeric(14, 2) not null default 0,
  qty              numeric(14, 2) not null default 0,
  qty_rejected     numeric(14, 2) not null default 0,

  -- ── Speed (machine processes only; null for manual work) ─────────────
  speed_unit       text,
  target_speed     numeric(12, 2),
  actual_speed     numeric(12, 2),
  -- Required by the form when actual < target; this is what feeds the Pareto
  -- chart in OEE & Downtime.
  slow_reason      text,

  -- ── People & notes ────────────────────────────────────────────────────
  operator_1       text,
  operator_2       text,
  comment          text,
  -- Set when the operator flags the entry; the Actions module turns it into
  -- an action item.
  action_flag      text,

  -- ── Audit ─────────────────────────────────────────────────────────────
  logged_by        uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  amended_at       timestamptz,
  amended_by       uuid references public.profiles (id) on delete set null,
  amend_note       text,

  constraint shift_log_entries_shift_running check (shift <> 'both'),
  constraint shift_log_entries_duration_positive check (duration_minutes >= 0),
  constraint shift_log_entries_qty_positive check (
    target_qty >= 0 and qty >= 0 and qty_rejected >= 0
  ),
  constraint shift_log_entries_speed_positive check (
    (target_speed is null or target_speed >= 0)
    and (actual_speed is null or actual_speed >= 0)
  ),
  constraint shift_log_entries_action_flag_known check (
    action_flag is null
    or action_flag in ('Quality', 'Maintenance', 'Safety', 'Process')
  )
);

-- The activity feed reads one factory's newest entries, usually for one date.
create index if not exists shift_log_entries_factory_date_idx
  on public.shift_log_entries (factory_id, log_date desc, created_at desc);
-- Batch history: "everything ever logged against batch 46004".
create index if not exists shift_log_entries_factory_batch_idx
  on public.shift_log_entries (factory_id, lower(batch_no));
-- Per-unit timelines and OEE roll-ups.
create index if not exists shift_log_entries_unit_idx
  on public.shift_log_entries (unit_id, log_date desc);

-- ── Row-level security ───────────────────────────────────────────────────
-- Read: the whole tenant. Insert: any member, for their own factory, stamped
-- with their own id. Update: the author or a manager, and only to amend.
-- Delete: nobody — omitting the policy is the enforcement.
alter table public.shift_log_entries enable row level security;

drop policy if exists "shift_log_member_read" on public.shift_log_entries;
create policy "shift_log_member_read"
  on public.shift_log_entries for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "shift_log_member_insert" on public.shift_log_entries;
create policy "shift_log_member_insert"
  on public.shift_log_entries for insert
  with check (
    (public.is_super_admin() or factory_id = public.current_factory_id())
    and logged_by = auth.uid()
  );

drop policy if exists "shift_log_amend" on public.shift_log_entries;
create policy "shift_log_amend"
  on public.shift_log_entries for update
  using (
    logged_by = auth.uid()
    or public.can_manage_factory(factory_id)
  )
  with check (
    logged_by = auth.uid()
    or public.can_manage_factory(factory_id)
  );

-- An amendment must say what changed and who changed it. Enforced in the
-- database so no future caller can quietly rewrite a shift record.
create or replace function public.shift_log_amend_guard()
returns trigger
language plpgsql
as $$
begin
  -- The row genuinely changed (not just a no-op write).
  if new is distinct from old then
    if coalesce(btrim(new.amend_note), '') = '' then
      raise exception 'An amendment needs a note explaining the correction.';
    end if;
    new.amended_at := now();
    new.amended_by := coalesce(new.amended_by, auth.uid());
  end if;

  -- Provenance is immutable, whatever the caller sends.
  new.factory_id := old.factory_id;
  new.logged_by  := old.logged_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists shift_log_amend_guard on public.shift_log_entries;
create trigger shift_log_amend_guard
  before update on public.shift_log_entries
  for each row execute function public.shift_log_amend_guard();
