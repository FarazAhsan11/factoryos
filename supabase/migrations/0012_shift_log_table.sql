-- FactoryOS · Shift log → data table (Raw data)
--
-- The browsable, filterable, paginated view of everything ever logged. Two
-- objects, both read-only:
--
--   1. `shift_log_entries_expanded` — the entries with their unit/process/
--      product names flattened onto the row, plus the running `accumulative`
--      total per batch + activity.
--   2. `shift_log_stats()` — the same filters, aggregated. The stats bar has
--      to describe the whole filtered set, not the page on screen, so it
--      can't be summed from the rows the table fetched.
--
-- Why a view rather than PostgREST embeds:
--   · The free-text search runs across the *joined* names (product, room,
--     activity) as well as the entry's own columns. An embedded resource
--     can't take part in a top-level `or` filter, but a flattened column can.
--   · `accumulative` is a window function over every entry for that batch and
--     activity. It cannot be computed from one page of rows — by definition it
--     depends on rows the page doesn't contain.
--
-- SECURITY: `security_invoker = true` is load-bearing. Without it the view
-- runs as its owner and every tenant sees every factory's shift log. It needs
-- Postgres 15+ (Supabase has been on 15+ since 2023).

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
  e.operator_1,
  e.operator_2,
  e.comment,
  e.action_flag,
  e.created_at,
  e.amended_at,
  e.amend_note,

  -- Flattened so one row carries everything the table renders and searches.
  u.name          as unit_name,
  p.name          as process_name,
  p.has_machine   as has_machine,
  pr.name         as product_name,
  pr.code         as product_code,

  -- Everything logged for this batch + activity up to and including this
  -- entry, matching what the log form shows while the entry is being typed.
  -- Null for an entry with no batch: there is nothing to accumulate against.
  case
    when e.batch_no is null or btrim(e.batch_no) = '' then null
    else sum(e.qty) over (
      partition by e.factory_id, lower(btrim(e.batch_no)), e.process_id
      order by e.log_date, e.created_at
      rows between unbounded preceding and current row
    )
  end as accumulative,

  -- Last, and deliberately so: `create or replace view` may only append
  -- columns, so anything added later goes here too.
  --
  -- The data table shows its Amend button only to whoever the update policy
  -- would actually let through — the author, or a manager. Without this the
  -- UI would have to offer the button to everyone and let the write fail.
  e.logged_by
from public.shift_log_entries e
  left join public.factory_units    u  on u.id  = e.unit_id
  left join public.factory_processes p  on p.id  = e.process_id
  left join public.factory_products  pr on pr.id = e.product_id;

comment on view public.shift_log_entries_expanded is
  'Read model for the shift-log data table: joined names + running accumulative total. RLS is inherited from shift_log_entries via security_invoker.';

grant select on public.shift_log_entries_expanded to authenticated;

-- ── Aggregates ───────────────────────────────────────────────────────────
-- Deliberately NOT `security definer`: the function must read through the
-- caller's RLS, exactly like the table query it accompanies.
create or replace function public.shift_log_stats(
  p_factory_id uuid,
  p_from       date default null,
  p_to         date default null,
  p_shift      text default null,
  p_unit_id    uuid default null,
  p_process_id uuid default null,
  -- 'flagged' means any flag; a flag name means that one; null means no filter.
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
           v.process_name, v.operator_1, v.operator_2, v.comment,
           v.equipment_no, v.slow_reason, v.action_flag
         ) ilike '%' || btrim(p_search) || '%'
    );
$$;

comment on function public.shift_log_stats is
  'Totals for one filtered slice of the shift log. Same filter semantics as the data table query; runs under the caller''s RLS.';

grant execute on function public.shift_log_stats(
  uuid, date, date, text, uuid, uuid, text, text
) to authenticated;
