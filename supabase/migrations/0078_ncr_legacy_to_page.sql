-- FactoryOS · Quality — every non-conformance on the qms-v12 case page
--
-- Run after 0077.
--
-- NCRs raised before 0076 kept the old one-size form and opened in the case
-- dialog. From now on every NCR opens as its own page, like a deviation, so
-- the ones raised before are brought onto the qms-v12 model, once:
--
--   · **What is non-conforming?** (`nc_item`) is read from what they hold: a
--     raw material code → Raw material (its code becomes `material_code`); a
--     packaging material code only → Packaging material; a batch only → Bulk
--     or intermediate; nothing → Other, "Not recorded — raised before the
--     qms-v12 form".
--   · **The disposition** moves to `ncr_disposition`: use as is → use as is,
--     rework → rework, reject → reject – destroy. A closed NCR's is recorded
--     as signed, by whoever closed it, when it was closed. An open NCR's is a
--     draft for QA to record on the Actions tab. (None held a batch by
--     "quarantine"; one that did would be held on `deviation_batch_holds`
--     instead, and its old disposition cleared, or it could never close.)
--   · Nothing else is invented: an open NCR's missing raise answers —
--     detected at, date found, department, requirement, immediate action,
--     the hold question — are completed on its Details tab before the
--     initial assessment is signed (which demands them).
--   · Each is noted on its audit trail ("converted").
--
-- The update would trip the case guards (a closed case is frozen; a signature
-- is the functions'), so the table's own triggers are off for it — the
-- migration owner's one-off data move, as 0038's cleanup was.

alter table public.deviations disable trigger user;

-- An old quarantine becomes a hold row (none expected; kept for safety).
insert into public.deviation_batch_holds
  (factory_id, deviation_id, batch_no, product_id, kind, placed_at, placed_by_name)
select d.factory_id, d.id, p.batch_no, p.id, 'batch', d.created_at, d.raised_by
from public.deviations d
  join public.factory_products p on p.id = any (d.product_ids)
where d.type::text = 'ncr' and d.nc_item is null
  and d.status = 'open' and d.disposition = 'quarantine'
on conflict do nothing;

with legacy as (
  select id from public.deviations
  where type::text = 'ncr' and nc_item is null
),
moved as (
  update public.deviations d
  set nc_item = case
        when coalesce(btrim(d.raw_material_code), '') <> '' then 'Raw material'
        when coalesce(btrim(d.packaging_material_code), '') <> '' then 'Packaging material'
        when cardinality(d.batch_nos) > 0 or d.batch_no is not null then 'Bulk or intermediate'
        else 'Other'
      end,
      nc_item_other = case
        when coalesce(btrim(d.raw_material_code), '') = ''
         and coalesce(btrim(d.packaging_material_code), '') = ''
         and cardinality(d.batch_nos) = 0 and d.batch_no is null
          then 'Not recorded — raised before the qms-v12 form'
      end,
      supplied_by = case
        when coalesce(btrim(d.raw_material_code), '') <> ''
          or coalesce(btrim(d.packaging_material_code), '') <> '' then 'supplier'
      end,
      material_code = nullif(btrim(coalesce(d.raw_material_code, d.packaging_material_code, '')), ''),
      ncr_disposition = case d.disposition::text
        when 'use_as_is' then 'use_as_is'
        when 'rework'    then 'rework'
        when 'reject'    then 'destroy'
      end,
      disposition = case when d.disposition::text = 'quarantine' and d.status = 'open'
                         then null else d.disposition end,
      hold_batch = case when d.disposition::text = 'quarantine' and d.status = 'open'
                        then true else d.hold_batch end,
      disposition_signed_at = case
        when d.status = 'closed' and d.disposition::text in ('use_as_is', 'rework', 'reject')
          then d.closed_at end,
      disposition_signed_by_name = case
        when d.status = 'closed' and d.disposition::text in ('use_as_is', 'rework', 'reject')
          then d.qa_sign_name end
  from legacy l
  where d.id = l.id
  returning d.id, d.factory_id, d.nc_item
)
insert into public.deviation_audit
  (factory_id, deviation_id, actor_name, action, new_value)
select factory_id, id, 'FactoryOS', 'converted', nc_item from moved;

alter table public.deviations enable trigger user;
