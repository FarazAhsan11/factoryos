-- FactoryOS · Shift log → any number of operators
--
-- `operator_1` / `operator_2` hard-coded a ceiling of two people into the
-- schema. A packing line run by four, or a changeover with a technician
-- alongside the pair, had nowhere to record the rest — and every one of those
-- names is what Actions and handovers follow up on. Two text columns become
-- one `text[]`.
--
-- Order matters here. The view selects the columns being dropped, and
-- `create or replace view` may only *append* columns — it cannot drop or
-- reorder them — so the view has to go first and be rebuilt at the end. The
-- rebuild is the whole of 0012's view, reproduced with the operator columns
-- swapped, because a view cannot be patched in place.

-- ── 1. The column ────────────────────────────────────────────────────────
drop view if exists public.shift_log_entries_expanded;

alter table public.shift_log_entries
  add column if not exists operators text[] not null default '{}';

-- Backfill.
--
-- `shift_log_amend_guard` has to come off for the duration. It treats *any*
-- update as an amendment: it raises unless the row carries an `amend_note`,
-- and stamps `amended_at` / `amended_by` when it doesn't. Neither is right
-- here — this migration reshapes storage, it does not correct what anyone
-- recorded, and every migrated entry would otherwise be marked as amended by
-- whoever happened to run the SQL. It goes straight back on afterwards.
--
-- Wrapped in a guard on `operator_1` still existing so the migration can be
-- re-run: without it, a second pass fails parsing a column it just dropped.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'shift_log_entries'
      and column_name  = 'operator_1'
  ) then
    alter table public.shift_log_entries disable trigger shift_log_amend_guard;

    -- The `where` drops the nulls of a one-operator entry and any empty
    -- string an earlier form cut may have stored.
    update public.shift_log_entries
    set operators = coalesce(
      (
        select array_agg(name)
        from unnest(array[operator_1, operator_2]) as name
        where name is not null and btrim(name) <> ''
      ),
      '{}'::text[]
    )
    where cardinality(operators) = 0
      and (operator_1 is not null or operator_2 is not null);

    alter table public.shift_log_entries enable trigger shift_log_amend_guard;
  end if;
end $$;

alter table public.shift_log_entries
  drop column if exists operator_1,
  drop column if exists operator_2;

-- The client writes this array directly under RLS, so the only server-side
-- bound on it is here. The form asks for at least one and the array cannot be
-- null, but historical rows may legitimately have none — hence a ceiling
-- only, not a floor.
alter table public.shift_log_entries
  drop constraint if exists shift_log_entries_operators_bounded;
alter table public.shift_log_entries
  add constraint shift_log_entries_operators_bounded
  check (cardinality(operators) <= 20);

comment on column public.shift_log_entries.operators is
  'Names of everyone who ran the activity, in the order entered. Names, not ids: a shift record must keep saying who was there even after an account is renamed or removed, and cover staff never have one.';

-- ── 2. The read model, rebuilt ───────────────────────────────────────────
-- Unchanged from 0012 except for the operator columns; see that file for why
-- this is a view at all and why `security_invoker` is load-bearing.
create or replace view public.shift_log_entries_expanded
with (security_invoker = true) as
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
  e.qty_rejected,
  e.speed_unit,
  e.target_speed,
  e.actual_speed,
  e.slow_reason,
  e.operators,
  -- The array flattened to text, because PostgREST's `ilike` — which is what
  -- the table's free-text `or=(…)` filter is built from — has nothing to say
  -- about a text[]. It doubles as the sort key: ordering by the array itself
  -- compares element by element, which is *nearly* alphabetical but reads as
  -- arbitrary the moment two entries share a first operator.
  array_to_string(e.operators, ' / ') as operators_text,
  e.comment,
  e.action_flag,
  e.created_at,
  e.amended_at,
  e.amend_note,

  u.name          as unit_name,
  p.name          as process_name,
  p.has_machine   as has_machine,
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

  e.logged_by
from public.shift_log_entries e
  left join public.factory_units    u  on u.id  = e.unit_id
  left join public.factory_processes p  on p.id  = e.process_id
  left join public.factory_products  pr on pr.id = e.product_id;

comment on view public.shift_log_entries_expanded is
  'Read model for the shift-log data table: joined names + running accumulative total. RLS is inherited from shift_log_entries via security_invoker.';

grant select on public.shift_log_entries_expanded to authenticated;

-- ── 3. Aggregates ────────────────────────────────────────────────────────
-- Identical to 0012 apart from the search expression, which now reads the
-- flattened operator text instead of the two dropped columns.
create or replace function public.shift_log_stats(
  p_factory_id uuid,
  p_from       date default null,
  p_to         date default null,
  p_shift      text default null,
  p_unit_id    uuid default null,
  p_process_id uuid default null,
  p_flag       text default null,
  p_search     text default null
)
returns table (
  entry_count    bigint,
  total_qty      numeric,
  total_rejected numeric,
  total_minutes  bigint
)
language sql
stable
as $$
  select
    count(*)::bigint,
    coalesce(sum(v.qty), 0),
    coalesce(sum(v.qty_rejected), 0),
    coalesce(sum(v.duration_minutes), 0)::bigint
  from public.shift_log_entries_expanded v
  where v.factory_id = p_factory_id
    and (p_from       is null or v.log_date   >= p_from)
    and (p_to         is null or v.log_date   <= p_to)
    and (p_shift      is null or v.shift::text = p_shift)
    and (p_unit_id    is null or v.unit_id     = p_unit_id)
    and (p_process_id is null or v.process_id  = p_process_id)
    and (
      p_flag is null
      or (p_flag = 'flagged' and v.action_flag is not null)
      or (p_flag <> 'flagged' and v.action_flag = p_flag)
    )
    and (
      p_search is null
      or btrim(p_search) = ''
      or concat_ws(' ',
           v.batch_no, v.product_name, v.product_code, v.unit_name,
           v.process_name, v.operators_text, v.comment,
           v.equipment_no, v.slow_reason, v.action_flag
         ) ilike '%' || btrim(p_search) || '%'
    );
$$;

grant execute on function public.shift_log_stats(
  uuid, date, date, text, uuid, uuid, text, text
) to authenticated;
