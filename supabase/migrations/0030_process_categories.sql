-- FactoryOS · Processes: what KIND of stage is this?
--
-- Until now a stage carried two independent booleans — `has_machine` (0006)
-- and `has_output` (0013) — and the log form worked out its shape from the
-- pair. Four combinations exist; only three of them are things a factory
-- actually runs, and the two flags never said which of the three you meant.
-- Worse, they say nothing about *how* the output is measured: a mixing room
-- reports 3 drums, an encapsulation line reports 231,453 capsules against a
-- speed-derived target, and both were being asked for the same three
-- quantity boxes.
--
-- So the classification becomes explicit and singular. Every stage is one of:
--
--   downtime     Time lost. Room, activity, start, end, batch, comments —
--                nothing else. Nothing was produced and nobody was operating
--                anything, so no quantities, no speed, no equipment and no
--                operators are asked for.
--   preparatory  Mixing, drying, granulation, sifting. Produces something,
--                but measured in whatever the room counts in — batches, kg,
--                litres, drums — not against a machine speed. One quantity
--                and its unit, plus who ran it.
--   production   Encapsulation, compression, packing. The full form as it is
--                today: speed, a derived shift target, actual and rejected
--                quantities, equipment when the stage runs on a machine.
--
-- `has_machine` and `has_output` are NOT dropped. Every downstream consumer
-- reads them — the pipeline sync trigger (0016), the expanded view, the data
-- table — and they remain the right primitives for those questions. They stop
-- being independently editable and become *derived* from the category by the
-- trigger below, so the two can never disagree with what the operator sees.

-- ── 1. The category ──────────────────────────────────────────────────────
-- Text + check rather than an enum: the set is a product decision that may
-- gain a member, and adding an enum value is a migration that cannot run in
-- the same transaction as an update that uses it.
alter table public.factory_processes
  add column if not exists category text not null default 'production';

alter table public.factory_processes
  drop constraint if exists factory_processes_category_known;
alter table public.factory_processes
  add constraint factory_processes_category_known
  check (category in ('downtime', 'preparatory', 'production'));

comment on column public.factory_processes.category is
  'downtime | preparatory | production. Decides which shape the shift-log entry form takes, and derives has_machine / has_output.';

-- ── 2. Backfill from the flags that used to carry this ───────────────────
-- The mapping is the only one the old pair supports:
--
--   has_output = false            → downtime     (Idle, Break, Set Up, cleaning)
--   output, no machine            → preparatory  (Mixing, Sorting, Drying)
--   output + machine              → production   (Compression, Encapsulation)
--
-- A manual-but-productive stage that is really a production step — hand
-- packing, visual sorting against a target — lands in `preparatory` and is
-- moved in Admin → Processes. That is the right way round: preparatory asks
-- for strictly less, so nothing already recorded is contradicted by it.
update public.factory_processes
set category = case
  when has_output = false then 'downtime'
  when has_machine = false then 'preparatory'
  else 'production'
end;

-- ── 3. The flags become derived ──────────────────────────────────────────
-- Fires before the single-final trigger (`category` sorts before `single`),
-- which matters: a downtime stage has its final tag cleared here, so the
-- other trigger never runs for it and the "final stage produces output"
-- constraint from 0016 cannot be tripped by a re-classification.
create or replace function public.factory_process_category_sync()
returns trigger
language plpgsql
as $$
begin
  if new.category = 'downtime' then
    -- Nothing made, nothing measured, no machine to attribute time to. The
    -- last of the three is a deliberate simplification: a breakdown belongs
    -- to Maintenance, where the equipment number is the whole point, not to a
    -- shift-log row that would carry a machine and no output.
    new.has_output     := false;
    new.has_machine    := false;
    new.is_final_stage := false;
  elsif new.category = 'preparatory' then
    -- Produces something, measured in the room's own units. No speed, so no
    -- machine — the speed fields are the only thing has_machine turns on, and
    -- a preparatory stage has no target speed to run below.
    new.has_output  := true;
    new.has_machine := false;
  else
    -- Production. Output is not optional; `has_machine` stays whatever Admin
    -- set, because a production stage genuinely may be manual (hand packing
    -- against a target) and that is a real distinction the speed fields read.
    new.has_output := true;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_processes_category_sync on public.factory_processes;
create trigger factory_processes_category_sync
  before insert or update on public.factory_processes
  for each row
  execute function public.factory_process_category_sync();

-- Re-run the sync over the rows backfilled above, so a stage that was
-- `has_machine` *and* `has_output = false` (a contradiction the old pair
-- allowed) settles onto the flags its new category implies.
update public.factory_processes set category = category;

-- ── 4. The unit a preparatory stage counts in ────────────────────────────
-- Nullable, and null is the norm: a production stage measures against
-- `speed_unit` and a downtime stage measures nothing. Only a preparatory
-- entry sets it, and without it the number is meaningless — 3 of what?
alter table public.shift_log_entries
  add column if not exists qty_unit text;

alter table public.shift_log_entries
  drop constraint if exists shift_log_entries_qty_unit_known;
alter table public.shift_log_entries
  add constraint shift_log_entries_qty_unit_known
  check (
    qty_unit is null
    or qty_unit in ('batches', 'kg', 'litres', 'drums', 'containers', 'units')
  );

comment on column public.shift_log_entries.qty_unit is
  'What `qty` is counted in on a preparatory entry (drums, kg, litres…). Null on production and downtime entries, which measure against speed_unit or measure nothing.';

-- ── 5. The read model ────────────────────────────────────────────────────
-- Rebuilt to carry the stage's category and the entry's quantity unit.
-- Dropped and recreated rather than replaced, for the same reason as 0023:
-- `accumulative` is a window function and the overrun comparison has to read
-- it from an inner query, so the shape is a CTE and CREATE OR REPLACE cannot
-- add a column in the middle of one.

drop view if exists public.shift_log_entries_expanded;

create view public.shift_log_entries_expanded
with (security_invoker = true) as
with base as (
  select
    e.id,
    e.factory_id,
    e.unit_id,
    e.process_id,
    e.product_id,
    e.log_date,
    e.shift,
    e.start_time,
    e.end_time,
    e.duration_minutes,
    e.equipment_no,
    e.batch_no,
    e.target_qty,
    e.qty,
    e.qty_unit,
    e.qty_rejected,
    e.speed_unit,
    e.target_speed,
    e.actual_speed,
    e.slow_reason,
    e.operators,
    array_to_string(e.operators, ' / ') as operators_text,
    e.comment,
    e.action_flag,
    e.created_at,
    e.amended_at,
    e.amend_note,

    u.name          as unit_name,
    p.name          as process_name,
    p.has_machine   as has_machine,
    p.category      as process_category,
    pr.name         as product_name,
    pr.code         as product_code,

    case
      when e.batch_no is null or btrim(e.batch_no) = '' then null
      else sum(e.qty) over (
        partition by e.factory_id, lower(btrim(e.batch_no)), e.process_id
        order by e.log_date, e.created_at
        rows between unbounded preceding and current row
      )
    end as accumulative,

    e.logged_by,

    -- What the work order asked for. Nullable in effect: a product carrying
    -- the default 0 has no requirement to exceed, and must never look overrun.
    nullif(pr.required_qty, 0) as required_qty,
    e.overrun_note,
    e.overrun_cleared_at,
    e.overrun_cleared_by,
    cb.full_name as overrun_cleared_by_name
  from public.shift_log_entries e
    left join public.factory_units     u  on u.id  = e.unit_id
    left join public.factory_processes p  on p.id  = e.process_id
    left join public.factory_products  pr on pr.id = e.product_id
    left join public.profiles          cb on cb.id = e.overrun_cleared_by
)
select
  base.*,

  -- Past the work order, on this batch and activity.
  (
    base.required_qty is not null
    and base.accumulative is not null
    and base.accumulative > base.required_qty
  ) as is_overrun,

  -- By how much — the number the explanation has to account for.
  (
    case
      when base.required_qty is not null
       and base.accumulative is not null
       and base.accumulative > base.required_qty
      then base.accumulative - base.required_qty
    end
  ) as overrun_qty,

  -- Overrun and nobody has said why yet. This is the badge.
  (
    base.required_qty is not null
    and base.accumulative is not null
    and base.accumulative > base.required_qty
    and base.overrun_note is null
  ) as needs_overrun_note
from base;
