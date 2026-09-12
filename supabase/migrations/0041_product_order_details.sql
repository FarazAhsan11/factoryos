-- FactoryOS · The sales order behind a batch
--
-- A catalogue row has said what a batch *is* — number, code, name, required
-- quantity — and nothing about who it is *for*. The planning sheet a factory
-- actually runs on carries that on every line: the customer, the sales order,
-- what it is worth, who sold it, when it came in, when it is promised, and
-- when production expects to start and finish it. Without these columns the
-- catalogue holds the half of the sheet production needs, and the other half
-- stays in Excel beside it.
--
--   customer_code / customer_name    BOD506 · Body Armour Pty Ltd
--   sales_order_no                   56006. One order can cover several
--                                    batches — 60215 is both a bulk liquid and
--                                    its 60 ml fill — so it is not unique.
--   order_value                      numeric(14, 2). Null is "not recorded".
--                                    0 is kept as typed: a bulk line whose
--                                    value sits on its finished lot is a real 0.
--   sales_rep                        who owns the customer
--   ordered_on                       the day the order was received
--   due_date                         the day the customer was promised it
--   expected_start / expected_finish production's own estimate
--
-- The ordered quantity is not here. It is `required_qty`, and has been since
-- 0008; a second copy would give the overrun check (0023/0032) and the plan
-- (0033) two numbers to disagree about.
--
-- ── Why expected_start is not planned_for ────────────────────────────────
--
-- They sound like one date and do different jobs. `planned_for` (0018) is an
-- instruction: on that day `promote_scheduled_jobs()` puts the batch on the
-- board, so it may not be set in the past and it freezes once the card exists.
-- `expected_start` is an estimate on a planning sheet — routinely already in
-- the past by the time the sheet is imported — and it moves nothing. Folding
-- them together would either refuse half of every imported sheet or let an
-- estimate start putting cards on the board.
--
-- ── Why due_date is a second column and not pipeline_jobs.due_date ───────
--
-- The card's due date (0031) is the planner's; this one is the customer's.
-- They start equal — the promotion below copies it, and the New batch and
-- From catalogue paths do the same in the app — but a planner who brings a
-- card forward to make room has not changed what the customer was promised.
-- Copied at creation, never linked.
--
-- ── What is deliberately not here ────────────────────────────────────────
--
-- No check that expected_finish >= expected_start, for the reason 0040 gives
-- for est_finish_date: as a constraint it refuses whichever date was saved
-- second, not the one that is wrong. The rule lives in `productSchema`, where
-- the message can name both dates.
--
-- No customers table. A code and a name on the row is what the sheet has, and
-- the form fills the name in from a code the catalogue has already seen. A
-- register of customers is worth building when something needs to hang off
-- one; until then it is a second place for the same name to be spelled two
-- ways.

-- ── 1. The columns ───────────────────────────────────────────────────────

alter table public.factory_products
  add column if not exists customer_code   text,
  add column if not exists customer_name   text,
  add column if not exists sales_order_no  text,
  add column if not exists order_value     numeric(14, 2),
  add column if not exists sales_rep       text,
  add column if not exists ordered_on      date,
  add column if not exists due_date        date,
  add column if not exists expected_start  date,
  add column if not exists expected_finish date;

alter table public.factory_products
  drop constraint if exists factory_products_order_value_positive;
alter table public.factory_products
  add constraint factory_products_order_value_positive
  check (order_value is null or order_value >= 0);

comment on column public.factory_products.customer_code is
  'The customer''s account code as the sales system writes it (BOD506). Free text; not unique.';
comment on column public.factory_products.customer_name is
  'The customer''s name. The form fills it from a customer_code already in the catalogue.';
comment on column public.factory_products.sales_order_no is
  'The sales order this batch is made against. One order may cover several batches, so not unique.';
comment on column public.factory_products.order_value is
  'What the order line is worth. Null is not recorded; 0 is kept as typed.';
comment on column public.factory_products.sales_rep is
  'The rep / sales manager who owns the customer.';
comment on column public.factory_products.ordered_on is
  'The day the order was received.';
comment on column public.factory_products.due_date is
  'The day the customer was promised it. Copied onto a new pipeline card''s due_date; never linked.';
comment on column public.factory_products.expected_start is
  'Production''s estimate of when the batch starts. Informational — unlike planned_for it moves nothing and may be in the past.';
comment on column public.factory_products.expected_finish is
  'Production''s estimate of when the batch finishes. Informational.';

-- ── 2. The board's due date starts as the order's ────────────────────────

/**
 * 0018's promotion, with one column more: a card created on its scheduled day
 * starts with the order's due date, so a batch that reaches the board on its
 * own does not arrive knowing less than one raised by hand.
 *
 * Everything else is 0018's function exactly — the tenant check, the
 * `planned_for <= current_date` catch-up, the active-only filter and the
 * `on conflict do nothing` that makes it safe to call on every page load.
 */
create or replace function public.promote_scheduled_jobs(p_factory_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  added integer;
begin
  if not (
    public.is_super_admin() or p_factory_id = public.current_factory_id()
  ) then
    raise exception 'Not your factory.' using errcode = '42501';
  end if;

  insert into public.pipeline_jobs (factory_id, product_id, status, due_date)
  select p.factory_id, p.id, 'planned', p.due_date
  from public.factory_products p
  where p.factory_id = p_factory_id
    and p.planned_for is not null
    and p.planned_for <= current_date
    -- A retired batch is not run again, so a date left on it from before is
    -- history, not a schedule.
    and p.active
  on conflict (product_id) do nothing;

  get diagnostics added = row_count;
  return added;
end;
$$;

comment on function public.promote_scheduled_jobs(uuid) is
  'Adds a Planned pipeline job for every active batch whose planned_for date has arrived and that has no job yet, carrying the batch''s due_date onto the card. Idempotent. Called when the Pipeline board loads.';

revoke all on function public.promote_scheduled_jobs(uuid) from public;
grant execute on function public.promote_scheduled_jobs(uuid) to authenticated;
