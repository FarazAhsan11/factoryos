-- FactoryOS · Customer orders, filtered and paged on the server
--
-- The Customer orders table read the whole catalogue into the browser and
-- worked out in JavaScript which half each batch belonged to: Open (not yet
-- planned, or still on the board) or Finished (every pipeline job signed off),
-- and what its status chip said. That is fine at a few dozen batches and wrong
-- at a few thousand — and PostgREST silently stops at 1,000 rows, so past that
-- the table would have started quietly dropping batches.
--
-- Paging on the server needs the database to know the answer to those two
-- questions, because a filter that is applied after the page was cut is not a
-- filter. So the status is derived here, once, beside the row it belongs to —
-- the same derivation the client made (`productStatus()` in product-queries),
-- **still never stored**: the card's own status is moved by the shift log, and
-- a copy on the product would be a second record of the same fact.
--
--   status       'received' until the batch has a card on the board, then the
--                card's own status (planned / production / hold / finished).
--   status_label what the chip says — searchable, so typing "hold" or
--                "in production" still finds the batch.
--   is_finished  every pipeline job against the batch is finished. A batch with
--                no job is not finished, it has not started. (0016's unique
--                index allows one card per batch; the aggregate is so a second
--                one, if it ever existed, would be held to the same rule the
--                client applied.)
--
-- `security_invoker`, so a viewer sees exactly the rows `factory_products`'s own
-- RLS gives them and nothing more.

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
    when 'planned'    then 'Planned'
    when 'production' then 'In production'
    when 'hold'       then 'On hold'
    else 'Finished'
  end as status_label,
  coalesce(j.all_finished, false) as is_finished
from public.factory_products p
left join lateral (
  select
    (array_agg(pj.status order by pj.planned_at desc))[1]::text as status,
    bool_and(pj.status = 'finished') as all_finished
  from public.pipeline_jobs pj
  where pj.product_id = p.id
) j on true;

grant select on public.factory_products_expanded to authenticated;

-- The table pages newest first within one factory; without this the sort reads
-- every one of the factory's rows to hand back fifty.
create index if not exists factory_products_factory_created_idx
  on public.factory_products (factory_id, created_at desc);

commit;
