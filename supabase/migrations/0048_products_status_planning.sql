-- FactoryOS · "Planning" before "Planned"
--
-- A batch added to the board is stored `planned`, but it cannot be logged
-- against until it is issued for production — until then it is still being
-- worked out (stages, targets), not planned. The board now says so: Planning
-- until `issued_at` is set, Planned once it is issued, then In production /
-- On hold / Finished as the shift log moves it (`jobStage()` in
-- pipeline-queries).
--
-- The status stays **derived, never stored**: nothing about `pipeline_jobs`
-- changes — `status` is still planned / production / hold / finished, and
-- `issued_at` is still the one record of "released to the floor". This
-- migration only teaches the Customer orders view the same word, so a batch
-- does not read Planning on the board and Planned in the table.
--
--   status       'received' until the batch has a card, then 'planning' for a
--                card that is planned and not issued, else the card's own
--                status (planned / production / hold / finished).
--   status_label what the chip says — searchable, so typing "planning" finds
--                the batch.
--
-- Same columns, same types, same grants as 0047; `is_finished` is untouched.

begin;

create or replace view public.factory_products_expanded
with (security_invoker = true) as
select
  p.id,
  p.factory_id,
  p.batch_no,
  p.code,
  p.name,
  p.work_order,
  p.required_qty,
  p.planned_for,
  p.active,
  p.created_at,
  p.customer_code,
  p.customer_name,
  p.sales_order_no,
  p.order_value,
  p.sales_rep,
  p.ordered_on,
  p.due_date,
  p.expected_start,
  p.expected_finish,
  coalesce(j.status, 'received') as status,
  case coalesce(j.status, 'received')
    when 'received'   then 'Received'
    when 'planning'   then 'Planning'
    when 'planned'    then 'Planned'
    when 'production' then 'In production'
    when 'hold'       then 'On hold'
    else 'Finished'
  end as status_label,
  coalesce(j.all_finished, false) as is_finished
from public.factory_products p
left join lateral (
  select
    -- `pj.status` is the pipeline_status enum, which has no 'planning' value
    -- (and must not: it is derived) — so the case is worked out as text.
    (array_agg(
      case
        when pj.status = 'planned' and pj.issued_at is null then 'planning'
        else pj.status::text
      end
      order by pj.planned_at desc
    ))[1] as status,
    bool_and(pj.status = 'finished') as all_finished
  from public.pipeline_jobs pj
  where pj.product_id = p.id
) j on true;

grant select on public.factory_products_expanded to authenticated;

commit;
