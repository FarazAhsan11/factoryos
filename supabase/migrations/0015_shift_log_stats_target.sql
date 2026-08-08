-- FactoryOS · Shift log stats → total shift target
--
-- The data table's totals moved out of a floating bar above the table and into
-- a footer row sitting under the columns it describes. That changes what the
-- aggregate has to answer: a bar can show whichever four numbers it likes, but
-- a footer cell under "Shift target" either holds that column's total or is
-- conspicuously empty beside a filled "Qty produced" next to it.
--
-- It is also the more useful of the two. Summed target against summed produced
-- is plan attainment across the filtered slice — the question a supervisor is
-- actually asking when they filter to one room and one week.
--
-- Nulls are the point, not an inconvenience. `target_qty` is null wherever no
-- target applies (an RPM-rated machine, a manual stage, a Quick entry with no
-- speed recorded), and `sum` skips them — so the total is the sum of the
-- targets that exist, never a figure inflated by counting "no target" as zero.
--
-- The signature is unchanged; only the return type grows. Postgres will not
-- let `create or replace` change a function's return type, so the old one has
-- to be dropped first — which is safe here because nothing but the browser
-- calls it, and the browser sends the same eight arguments either way.

drop function if exists public.shift_log_stats(
  uuid, date, date, text, uuid, uuid, text, text
);

create function public.shift_log_stats(
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
  entry_count      bigint,
  total_qty        numeric,
  total_target_qty numeric,
  total_rejected   numeric,
  total_minutes    bigint
)
language sql
stable
as $$
  select
    count(*)::bigint,
    coalesce(sum(v.qty), 0),
    coalesce(sum(v.target_qty), 0),
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
