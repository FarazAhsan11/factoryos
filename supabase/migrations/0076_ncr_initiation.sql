-- FactoryOS · Quality — raising a non-conformance (qms-v12), and lot quarantine
--
-- Run after 0075.
--
-- A non-conformance is raised on the reference QMS's NCR form (qms-v12), not
-- the old one-size form. Phase 1 of the NCR rebuild: the raise and the
-- record's Details. The assessment, investigation, disposition and close-out
-- follow in later migrations.
--
--   · **What is non-conforming?** — `nc_item`: Raw material · Packaging
--     material · Bulk or intermediate · Finished product · Other (with
--     `nc_item_other`, what it is). It decides the rest of the form:
--       – a **material** asks who supplied it (`supplied_by`: a supplier, or
--         our customer — client-supplied), the material code, the supplier
--         (or customer), the supplier lot number(s) — several, each held on
--         its own row — and the quantity affected; the batch it was found in
--         is optional, and required when it was found in dispensing or
--         in-process (then the batch is known);
--       – **bulk or finished product** asks its batches and the quantity;
--       – **other** asks the quantity, if it applies.
--     Then: detected at (the NCR list — no "Customer", a customer report is
--     a complaint), date found, department, location, requirement /
--     specification (required: an NCR is a failed requirement, ISO 9001
--     8.7), description of the non-conformance, immediate action, and
--     **quarantine the lot? / put the batch on hold?** — Yes by default; No
--     needs a reason (`hold_not_reason`).
--   · Every NCR is raised this way from now on: the insert refuses one
--     without `nc_item` (`deviations_ncr_initiation_guard`). NCRs raised
--     before keep their old fields and their disposition, and still open in
--     the case dialog.
--   · **The disposition is no longer asked at raise** — QA decides it on the
--     Actions tab once it can (a later migration). So an NCR may now have no
--     disposition: `deviations_disposition_ncr_only` becomes "only an NCR
--     has one". The old quarantine-by-disposition rules stay for the NCRs
--     that have one.
--   · **Lot quarantine** — `deviation_batch_holds.kind`: `batch` (as before)
--     or `lot`. A lot is a supplier's lot number, not a batch in the product
--     register, so a lot row has no product and touches no pipeline card; it
--     is labelled "Quarantine — do not use" and is released or rejected by
--     the disposition, never by hand (`decide_batch_hold` refuses it).
--     Raising a material NCR with Yes quarantines each lot and holds the
--     batch it was found in; a product NCR holds its batches; an "Other"
--     holds "(no batch)", as the reference does.
--   · `place_batch_holds` now also serves an NCR; `place_lot_holds`
--     quarantines more lots on a material NCR. Holds on an NCR, like a
--     deviation's, must all be decided before the case closes.
--   · The audit trail says "Quarantine placed" for a lot.

-- ── 1. The NCR's raise fields ────────────────────────────────────────────

alter table public.deviations
  add column if not exists nc_item         text,
  add column if not exists nc_item_other   text,
  add column if not exists supplied_by     text,
  add column if not exists material_code   text,
  add column if not exists supplier_lots   text[] not null default '{}',
  add column if not exists qty_affected    text,
  add column if not exists hold_not_reason text;

alter table public.deviations
  drop constraint if exists deviations_nc_item_known;
alter table public.deviations
  add constraint deviations_nc_item_known check (
    nc_item is null or (
      type::text = 'ncr' and nc_item in (
        'Raw material', 'Packaging material', 'Bulk or intermediate',
        'Finished product', 'Other'
      )
    )
  );

alter table public.deviations
  drop constraint if exists deviations_supplied_by_known;
alter table public.deviations
  add constraint deviations_supplied_by_known check (
    supplied_by is null or supplied_by in ('supplier', 'customer')
  );

-- An NCR's disposition is decided on its Actions tab, not when it is raised.
alter table public.deviations
  drop constraint if exists deviations_disposition_ncr_only;
alter table public.deviations
  add constraint deviations_disposition_ncr_only check (
    disposition is null or type::text = 'ncr'
  );

-- "Quarantine the lot? / Put the batch on hold?" is asked of an NCR too.
alter table public.deviations
  drop constraint if exists deviations_hold_batch_deviation_only;
alter table public.deviations
  add constraint deviations_hold_batch_deviation_only check (
    hold_batch is null or type::text in ('planned', 'unplanned', 'ncr')
  );

-- The NCR list of where it was found, beside the deviation one.
alter table public.deviations
  drop constraint if exists deviations_detection_point_known;
alter table public.deviations
  add constraint deviations_detection_point_known check (
    detection_point is null or detection_point in (
      'Incoming inspection', 'In-process', 'QC testing', 'Warehouse',
      'Audit', 'Customer', 'Other',
      -- NCR (0076)
      'Warehouse or storage', 'Dispensing', 'Stability testing',
      'Supplier told us'
    )
  );

-- ── 2. Lot quarantine ────────────────────────────────────────────────────

alter table public.deviation_batch_holds
  add column if not exists kind text not null default 'batch';

alter table public.deviation_batch_holds
  drop constraint if exists deviation_batch_holds_kind_known;
alter table public.deviation_batch_holds
  add constraint deviation_batch_holds_kind_known check (kind in ('batch', 'lot'));

-- One live quarantine per lot per case (a lot has no product to key on).
create unique index if not exists deviation_batch_holds_one_live_lot
  on public.deviation_batch_holds (deviation_id, lower(batch_no))
  where status = 'on_hold' and kind = 'lot';

-- ── 3. Raising an NCR ────────────────────────────────────────────────────

/**
 * The qms-v12 NCR raise form's answers: what each kind of item needs, tidied
 * and checked. Fires after `deviations_guard` (trigger names sort), so the
 * batches are already tidied and resolved to products.
 */
create or replace function public.deviations_ncr_initiation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  material boolean;
  product  boolean;
  missing  text;
begin
  if new.type::text <> 'ncr' or tg_op <> 'INSERT' then
    return new;
  end if;

  if new.nc_item is null then
    raise exception 'Say what is non-conforming — raw material, packaging material, bulk or intermediate, finished product, or other.'
      using errcode = 'check_violation';
  end if;

  material := new.nc_item in ('Raw material', 'Packaging material');
  product  := new.nc_item in ('Bulk or intermediate', 'Finished product');

  new.nc_item_other   := nullif(btrim(coalesce(new.nc_item_other, '')), '');
  new.material_code   := nullif(btrim(coalesce(new.material_code, '')), '');
  new.supplier_name   := nullif(btrim(coalesce(new.supplier_name, '')), '');
  new.qty_affected    := nullif(btrim(coalesce(new.qty_affected, '')), '');
  new.specification   := nullif(btrim(coalesce(new.specification, '')), '');
  new.hold_not_reason := nullif(btrim(coalesce(new.hold_not_reason, '')), '');
  new.supplier_lots := coalesce((
    select array_agg(s.l order by s.ord)
    from (
      select (array_agg(btrim(x) order by ord))[1] as l, min(ord) as ord
      from unnest(new.supplier_lots) with ordinality as u(x, ord)
      where coalesce(btrim(x), '') <> ''
      group by lower(btrim(x))
    ) s
  ), '{}');

  -- What the item does not ask is not kept.
  if new.nc_item <> 'Other' then
    new.nc_item_other := null;
  end if;
  if not material then
    new.supplied_by   := null;
    new.material_code := null;
    new.supplier_name := null;
    new.supplier_lots := '{}';
  end if;

  if new.nc_item = 'Other' and new.nc_item_other is null then
    raise exception 'Say what the non-conforming item is.'
      using errcode = 'check_violation';
  end if;

  if material then
    if new.supplied_by is null then
      raise exception 'Say who supplied the material — a supplier, or our customer.'
        using errcode = 'check_violation';
    end if;
    if new.material_code is null then
      raise exception 'Give the material code.' using errcode = 'check_violation';
    end if;
    if new.supplier_name is null then
      raise exception 'Name the %.',
        case new.supplied_by when 'customer' then 'customer' else 'supplier' end
        using errcode = 'check_violation';
    end if;
    if cardinality(new.supplier_lots) = 0 then
      raise exception 'Give the % lot number(s).',
        case new.supplied_by when 'customer' then 'customer' else 'supplier' end
        using errcode = 'check_violation';
    end if;
    if new.qty_affected is null then
      raise exception 'Give the quantity affected.' using errcode = 'check_violation';
    end if;
    if new.detection_point in ('Dispensing', 'In-process')
       and cardinality(new.batch_nos) = 0 then
      raise exception 'Found during %, so the batch is known — give the affected batch.',
        lower(new.detection_point)
        using errcode = 'check_violation';
    end if;
  elsif product then
    if cardinality(new.batch_nos) = 0 then
      raise exception 'Give the batches affected.' using errcode = 'check_violation';
    end if;
    if new.qty_affected is null then
      raise exception 'Give the quantity affected.' using errcode = 'check_violation';
    end if;
  else
    -- "Other" asks no batches.
    new.batch_nos   := '{}';
    new.product_ids := '{}';
    new.batch_no    := null;
    new.product_id  := null;
  end if;

  if new.detection_point is null or new.detection_point not in (
       'Incoming inspection', 'Warehouse or storage', 'Dispensing', 'In-process',
       'QC testing', 'Stability testing', 'Supplier told us', 'Audit', 'Other'
     ) then
    raise exception 'Say where it was detected.' using errcode = 'check_violation';
  end if;
  if new.occurred_at is null then
    raise exception 'Give the date it was found.' using errcode = 'check_violation';
  end if;
  if new.department_id is null then
    raise exception 'Which department found it?' using errcode = 'check_violation';
  end if;
  if new.specification is null then
    raise exception 'Give the requirement or specification that is not met.'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(new.immediate_action), '') = '' then
    raise exception 'Say what was done straight away, or “None needed”.'
      using errcode = 'check_violation';
  end if;

  if new.hold_batch is null then
    raise exception '%',
      case when material then 'Say whether the lot goes into quarantine.'
           else 'Say whether the batch goes on hold.' end
      using errcode = 'check_violation';
  end if;
  if new.hold_batch then
    new.hold_not_reason := null;
    -- A held batch must be one the register knows; a lot need not be.
    select string_agg(b, ', ') into missing
    from unnest(new.batch_nos) as b
    where not exists (
      select 1 from public.factory_products p
      where p.factory_id = new.factory_id and lower(p.batch_no) = lower(b)
    );
    if missing is not null then
      raise exception 'Holding a batch — % is not one in the product register.', missing
        using errcode = 'check_violation';
    end if;
  elsif new.hold_not_reason is null then
    raise exception '%',
      case when material then 'Say why the lot is not quarantined.'
           else 'Say why the batch is not put on hold.' end
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists deviations_ncr_initiation_guard on public.deviations;
create trigger deviations_ncr_initiation_guard
  before insert on public.deviations
  for each row execute function public.deviations_ncr_initiation_guard();

-- ── 4. The case guard — an NCR's hold is checked by its own guard ────────
-- 0075's `deviations_guard`, with one rule changed: "a hold names real
-- batches" no longer applies to an NCR's raise-time hold, whose lots are not
-- batches (`deviations_ncr_initiation_guard` checks its batches instead).
-- The old quarantine-by-disposition still needs its batches.

create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['product_id', 'action_id', 'capa_id', 'created_by', 'closed_by', 'department_id'];
  linked  public.capas%rowtype;
  src     text[];
  missing text;
begin
  -- ── Batches ──
  if tg_op = 'INSERT' then
    src := case
             when cardinality(new.batch_nos) > 0 then new.batch_nos
             else array[new.batch_no]
           end;
  elsif new.batch_nos is distinct from old.batch_nos then
    src := new.batch_nos;
  elsif new.batch_no is distinct from old.batch_no then
    src := array[new.batch_no];
  end if;

  if src is not null then
    new.batch_nos := coalesce((
      select array_agg(s.b order by s.ord)
      from (
        select (array_agg(btrim(x) order by ord))[1] as b, min(ord) as ord
        from unnest(src) with ordinality as u(x, ord)
        where coalesce(btrim(x), '') <> ''
        group by lower(btrim(x))
      ) s
    ), '{}');

    new.product_ids := coalesce((
      select array_agg(p.id order by u.ord)
      from unnest(new.batch_nos) with ordinality as u(b, ord)
        join public.factory_products p
          on p.factory_id = new.factory_id
         and lower(p.batch_no) = lower(u.b)
    ), '{}');

    new.batch_no := new.batch_nos[1];
    new.product_id := (
      select p.id from public.factory_products p
      where p.factory_id = new.factory_id
        and lower(p.batch_no) = lower(new.batch_no)
    );
  end if;

  -- ── A hold names real batches ──
  if new.status = 'open'
     and (new.disposition = 'quarantine'
          or (new.hold_batch is true and new.type::text <> 'ncr')) then
    if cardinality(new.batch_nos) = 0 then
      raise exception 'Putting a batch on hold needs its batch number.'
        using errcode = 'check_violation';
    end if;
    select string_agg(b, ', ') into missing
    from unnest(new.batch_nos) as b
    where not exists (
      select 1 from public.factory_products p
      where p.factory_id = new.factory_id
        and lower(p.batch_no) = lower(b)
    );
    if missing is not null then
      raise exception 'Holding a batch — % is not one in the product register.', missing
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── The department is this factory's ──
  if new.department_id is not null
     and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id)
     and not exists (
       select 1 from public.factory_departments fd
       where fd.id = new.department_id and fd.factory_id = new.factory_id
     ) then
    raise exception 'That department is not in this factory.'
      using errcode = 'check_violation';
  end if;

  if new.likelihood is not null and new.severity is not null
     and new.detection is not null and new.financial_impact is not null then
    new.risk_assessed_at := coalesce(new.risk_assessed_at, now());
  end if;

  if coalesce(btrim(new.investigation_findings), '') <> '' then
    new.investigated_at := coalesce(new.investigated_at, now());
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new case starts as Open.'
        using errcode = 'check_violation';
    end if;

    if new.type::text = 'complaint' and new.received_via is null then
      raise exception 'Say how the complaint was received.'
        using errcode = 'check_violation';
    end if;

    if new.occurred_at is not null and new.occurred_at > now() + interval '5 minutes' then
      raise exception 'When it happened cannot be in the future.'
        using errcode = 'check_violation';
    end if;

    new.deviation_no := public.next_document_number(
      new.factory_id,
      case new.type::text when 'ncr' then 'NCR' when 'complaint' then 'CMP' else 'DEV' end,
      case new.type::text when 'ncr' then 'NCR' when 'complaint' then 'CMP' else 'DEV' end
    );
    new.closing_note  := null;
    new.qa_sign_name  := null;
    new.status_reason := null;
    new.closed_at     := null;
    new.closed_by     := null;
    -- The CAPA decision is made on the case's CAPA tab, not when it is raised.
    new.capa_id                := null;
    new.capa_needed            := null;
    new.capa_not_needed_reason := null;
    return new;
  end if;

  if new.deviation_no is distinct from old.deviation_no
     or new.factory_id is distinct from old.factory_id
     or new.created_at is distinct from old.created_at then
    raise exception 'The number, factory and raised time of a case are fixed.'
      using errcode = 'check_violation';
  end if;

  if new.type is distinct from old.type then
    raise exception 'The type is part of the number — raise a new case instead of changing it.'
      using errcode = 'check_violation';
  end if;

  -- ── Closed: the signed document ──
  if old.status = 'closed' then
    if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys)
       or (new.capa_id is not null and new.capa_id is distinct from old.capa_id)
       or (new.action_id is not null and new.action_id is distinct from old.action_id)
       or (new.department_id is not null and new.department_id is distinct from old.department_id) then
      raise exception '% is closed — a closed case is not edited.', old.deviation_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── Linking a CAPA ──
  if new.capa_id is not null and new.capa_id is distinct from old.capa_id then
    select * into linked from public.capas where id = new.capa_id;
    if not found or linked.factory_id <> new.factory_id then
      raise exception 'That CAPA is not in this factory.'
        using errcode = 'check_violation';
    end if;
    if linked.status::text = 'withdrawn' then
      raise exception '% was withdrawn — choose another CAPA, or raise a new one.', linked.capa_no
        using errcode = 'check_violation';
    end if;
    if linked.status::text <> 'open' then
      raise exception '% is already effective — raise a new CAPA for this case.', linked.capa_no
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── Open → Closed ──
  if new.status = 'closed' then
    if coalesce(btrim(new.immediate_action), '') = '' then
      raise exception 'Record the immediate action taken before closing.'
        using errcode = 'check_violation';
    end if;

    if new.type::text in ('planned', 'unplanned') and new.assessed_at is null then
      raise exception 'Sign the initial assessment before closing.'
        using errcode = 'check_violation';
    end if;

    if new.likelihood is null or new.severity is null
       or (new.detection is null and new.type::text not in ('planned', 'unplanned')) then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null
       and new.type::text not in ('planned', 'unplanned') then
      raise exception 'Answer whether there is a financial impact.'
        using errcode = 'check_violation';
    end if;

    if length(coalesce(btrim(new.investigation_findings), '')) < 10
       and new.investigation_required is distinct from false then
      raise exception 'Record the investigation findings before closing.'
        using errcode = 'check_violation';
    end if;

    if new.type::text = 'complaint' and new.adverse_reaction is null then
      raise exception 'Answer whether an injury or adverse reaction was reported.'
        using errcode = 'check_violation';
    end if;

    if new.capa_needed is null then
      raise exception 'Decide whether a CAPA is needed before closing.'
        using errcode = 'check_violation';
    end if;
    if new.capa_needed then
      if new.capa_id is null then
        raise exception 'Link the CAPA this case is worked under before closing.'
          using errcode = 'check_violation';
      end if;
      select * into linked from public.capas where id = new.capa_id;
      if linked.plan_approved_at is null then
        raise exception 'Approve the plan of % before the case is closed.', linked.capa_no
          using errcode = 'check_violation';
      end if;
    elsif length(coalesce(btrim(new.capa_not_needed_reason), '')) < 10 then
      raise exception 'Say why no CAPA is needed.'
        using errcode = 'check_violation';
    end if;

    if coalesce(btrim(new.qa_sign_name), '') = '' then
      raise exception 'Closing needs a name against it.'
        using errcode = 'check_violation';
    end if;
    if length(coalesce(btrim(new.closing_note), '')) < 10 then
      raise exception 'Record the close-out — what was decided and what was done.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.status_reason), '') = '' then
      raise exception 'Say why the case is being closed.'
        using errcode = 'check_violation';
    end if;

    if new.disposition = 'quarantine' then
      raise exception 'Quarantine is a hold, not an outcome — choose use as is, rework or reject to close the NCR.'
        using errcode = 'check_violation';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
  end if;

  return new;
end;
$fn$;

-- ── 5. Raising with a hold — lots, batches, or "(no batch)" ─────────────

create or replace function public.deviations_place_holds()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who_name text := coalesce(nullif(btrim(new.raised_by), ''), public.audit_actor_name());
begin
  if new.hold_batch is not true then
    return null;
  end if;

  -- A material NCR: each supplier lot into quarantine (no product, no card).
  if new.type::text = 'ncr' and new.nc_item in ('Raw material', 'Packaging material') then
    insert into public.deviation_batch_holds
      (factory_id, deviation_id, batch_no, product_id, kind, placed_at, placed_by, placed_by_name)
    select new.factory_id, new.id, u.l, null, 'lot', new.created_at, auth.uid(), who_name
    from unnest(new.supplier_lots) with ordinality as u(l, ord)
    order by u.ord
    on conflict do nothing;
  end if;

  -- "Other" names no batch; the reference holds "(no batch)".
  if new.type::text = 'ncr' and new.nc_item = 'Other' then
    insert into public.deviation_batch_holds
      (factory_id, deviation_id, batch_no, product_id, kind, placed_at, placed_by, placed_by_name)
    values (new.factory_id, new.id, '(no batch)', null, 'batch', new.created_at, auth.uid(), who_name);
    return null;
  end if;

  -- Every named batch: a deviation's, a product NCR's, the batch a material
  -- was found in.
  if new.type::text in ('planned', 'unplanned', 'ncr') then
    insert into public.deviation_batch_holds
      (factory_id, deviation_id, batch_no, product_id, kind, placed_at, placed_by, placed_by_name)
    select new.factory_id, new.id, p.batch_no, p.id, 'batch', new.created_at, auth.uid(), who_name
    from unnest(new.batch_nos) with ordinality as u(b, ord)
      join public.factory_products p
        on p.factory_id = new.factory_id and lower(p.batch_no) = lower(btrim(u.b))
    order by u.ord
    on conflict do nothing;
  end if;
  return null;
end;
$fn$;

-- ── 6. Putting more batches on hold — on an NCR too ──────────────────────
-- 0069's function; the type check now admits an NCR.

create or replace function public.place_batch_holds(
  p_case      uuid,
  p_batch_nos text[],
  p_by_name   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target  public.deviations%rowtype;
  missing text;
  done    integer;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can put a batch on hold.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.type::text not in ('planned', 'unplanned', 'ncr') then
    raise exception 'Batch holds are kept on deviations and non-conformances.'
      using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Putting a batch on hold needs a name against it.'
      using errcode = 'check_violation';
  end if;
  if coalesce(cardinality(p_batch_nos), 0) = 0 then
    raise exception 'Name the batch to put on hold.' using errcode = 'check_violation';
  end if;

  select string_agg(btrim(b), ', ') into missing
  from unnest(p_batch_nos) as b
  where btrim(b) <> ''
    and not exists (
      select 1 from public.factory_products p
      where p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(b))
    );
  if missing is not null then
    raise exception 'Holding a batch — % is not one in the product register.', missing
      using errcode = 'check_violation';
  end if;

  select string_agg(p.batch_no, ', ') into missing
  from unnest(p_batch_nos) as b
    join public.factory_products p
      on p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(b))
  where exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = p_case and h.product_id = p.id and h.status = 'rejected'
  );
  if missing is not null then
    raise exception 'Batch % has already been rejected on this case.', missing
      using errcode = 'check_violation';
  end if;

  insert into public.deviation_batch_holds
    (factory_id, deviation_id, batch_no, product_id, kind, placed_by, placed_by_name)
  select target.factory_id, p_case, p.batch_no, p.id, 'batch', auth.uid(), btrim(p_by_name)
  from (
    select p.batch_no, p.id, min(u.ord) as ord
    from unnest(p_batch_nos) with ordinality as u(b, ord)
      join public.factory_products p
        on p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(u.b))
    group by p.batch_no, p.id
  ) p
  where not exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = p_case and h.product_id = p.id and h.status = 'on_hold'
  )
  order by p.ord;
  get diagnostics done = row_count;
  return done;
end;
$fn$;

revoke all on function public.place_batch_holds(uuid, text[], text) from public;
grant execute on function public.place_batch_holds(uuid, text[], text) to authenticated;

-- ── 7. Quarantining more lots ────────────────────────────────────────────

/**
 * "Quarantine a lot" on a material NCR — supervisor and up, on an open case.
 * A lot already in quarantine here is skipped; one already rejected here is
 * refused. Returns how many lots were quarantined.
 */
create or replace function public.place_lot_holds(
  p_case    uuid,
  p_lots    text[],
  p_by_name text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target  public.deviations%rowtype;
  missing text;
  done    integer;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can quarantine a lot.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.type::text <> 'ncr'
     or target.nc_item not in ('Raw material', 'Packaging material') then
    raise exception 'Lots are quarantined on a raw or packaging material non-conformance.'
      using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Quarantining a lot needs a name against it.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from unnest(p_lots) as l where btrim(l) <> '') then
    raise exception 'Name the lot to quarantine.' using errcode = 'check_violation';
  end if;

  select string_agg(distinct h.batch_no, ', ') into missing
  from unnest(p_lots) as l
    join public.deviation_batch_holds h
      on h.deviation_id = p_case and h.kind = 'lot'
     and lower(h.batch_no) = lower(btrim(l)) and h.status = 'rejected';
  if missing is not null then
    raise exception 'Lot % has already been rejected on this case.', missing
      using errcode = 'check_violation';
  end if;

  insert into public.deviation_batch_holds
    (factory_id, deviation_id, batch_no, product_id, kind, placed_by, placed_by_name)
  select target.factory_id, p_case, s.l, null, 'lot', auth.uid(), btrim(p_by_name)
  from (
    select (array_agg(btrim(x) order by ord))[1] as l, min(ord) as ord
    from unnest(p_lots) with ordinality as u(x, ord)
    where btrim(x) <> ''
    group by lower(btrim(x))
  ) s
  where not exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = p_case and h.kind = 'lot'
      and lower(h.batch_no) = lower(s.l) and h.status = 'on_hold'
  )
  order by s.ord;
  get diagnostics done = row_count;
  return done;
end;
$fn$;

revoke all on function public.place_lot_holds(uuid, text[], text) from public;
grant execute on function public.place_lot_holds(uuid, text[], text) to authenticated;

-- ── 8. Deciding a hold — never a lot by hand ─────────────────────────────
-- 0069's function; a lot in quarantine is released or rejected by the
-- disposition (the NCR's Actions tab), not one row at a time.

create or replace function public.decide_batch_hold(
  p_hold     uuid,
  p_decision text,
  p_reason   text,
  p_by_name  text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  h_row  public.deviation_batch_holds%rowtype;
  target public.deviations%rowtype;
begin
  select * into h_row from public.deviation_batch_holds where id = p_hold for update;
  if not found then
    raise exception 'Hold not found.' using errcode = 'no_data_found';
  end if;
  select * into target from public.deviations where id = h_row.deviation_id;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can release or reject a batch.'
      using errcode = 'insufficient_privilege';
  end if;
  if h_row.kind = 'lot' then
    raise exception 'A quarantined lot is released or rejected by the disposition (Actions).'
      using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if h_row.status <> 'on_hold' then
    raise exception 'Batch % has already been %.', h_row.batch_no, h_row.status
      using errcode = 'check_violation';
  end if;
  if p_decision not in ('released', 'rejected') then
    raise exception 'Release or reject — nothing else.' using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception '%',
      case p_decision
        when 'released' then 'Say why it is safe to release while the case is open.'
        else 'Give the reason for rejecting the batch.'
      end
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The decision needs a name against it.' using errcode = 'check_violation';
  end if;
  if p_decision = 'released'
     and target.investigation_required is distinct from false
     and coalesce(btrim(target.impact), '') = '' then
    raise exception 'Record the product impact assessment on the Investigation tab first.'
      using errcode = 'check_violation';
  end if;

  update public.deviation_batch_holds
  set status          = p_decision,
      decided_at      = now(),
      decided_by      = auth.uid(),
      decided_by_name = btrim(p_by_name),
      reason          = btrim(p_reason)
  where id = p_hold;
end;
$fn$;

revoke all on function public.decide_batch_hold(uuid, text, text, text) from public;
grant execute on function public.decide_batch_hold(uuid, text, text, text) to authenticated;

-- ── 9. No closing over a live hold — an NCR's too ────────────────────────

create or replace function public.deviations_holds_close_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  live text;
begin
  if new.type::text not in ('planned', 'unplanned', 'ncr') then
    return new;
  end if;
  if (old.status = 'open' and new.status = 'closed')
     or (old.close_first_signed_at is null and new.close_first_signed_at is not null) then
    select string_agg(h.batch_no, ', ' order by h.placed_at) into live
    from public.deviation_batch_holds h
    where h.deviation_id = new.id and h.status = 'on_hold';
    if live is not null then
      raise exception 'Release or reject every batch and lot on hold before closing — % still on hold.', live
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

-- ── 10. The audit trail — a lot's quarantine by its own name ─────────────

create or replace function public.deviation_batch_holds_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, at, actor, actor_name, action, new_value)
    values (new.factory_id, new.deviation_id, new.placed_at, new.placed_by,
            coalesce(new.placed_by_name, public.audit_actor_name()),
            case new.kind when 'lot' then 'quarantine_placed' else 'hold_placed' end,
            new.batch_no);
  elsif old.status = 'on_hold' and new.status <> 'on_hold' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value, reason)
    values (new.factory_id, new.deviation_id, new.decided_by,
            coalesce(new.decided_by_name, public.audit_actor_name()),
            case
              when new.kind = 'lot' and new.status = 'released' then 'lot_released'
              when new.kind = 'lot' then 'lot_rejected'
              when new.status = 'released' then 'batch_released'
              else 'batch_rejected'
            end,
            new.batch_no, new.reason);
  end if;
  return null;
end;
$fn$;

-- ── 11. The case read model — the NCR's raise fields appended ────────────
-- 0075's view, with the 0076 columns at the end.

create or replace view public.deviations_expanded
with (security_invoker = true) as
select
  d.id,
  d.factory_id,
  d.deviation_no,
  d.type,
  d.status,
  d.status_reason,
  d.priority,
  d.title,
  d.origin,
  d.sla_date,

  d.batch_no,
  d.product_id,
  pr.name as product_name,
  pr.code as product_code,

  d.customer_name,
  d.customer_other,
  d.supplier_name,
  d.owner_name,
  d.supervisor_name,

  d.procedure_name,
  d.sop_number,
  d.document_number,
  d.raw_material_code,
  d.raw_material_name,
  d.packaging_material_code,

  d.equipment_no,
  eq.name as equipment_name,

  d.nc_category,
  d.specification,
  d.actual,
  d.impact,
  d.disposition,
  d.raised_by,
  d.qa_reviewer,

  d.immediate_action_date,
  d.immediate_action,

  d.likelihood,
  d.severity,
  d.detection,
  d.financial_impact,
  d.risk_description,
  d.risk_assessed_at,

  (d.likelihood * d.severity * d.detection) as risk_score,
  case
    when d.likelihood is null or d.severity is null or d.detection is null
      then null
    when d.severity = 5
      or d.likelihood * d.severity * d.detection >= 60 then 'High'
    when d.likelihood * d.severity * d.detection >= 20 then 'Medium'
    else 'Low'
  end as risk_conclusion,

  d.investigation_findings,
  d.investigated_at,

  d.ca_owner,
  d.ca_target_date,
  d.ca_closed_date,
  d.ca_closed_by_name,
  d.ca_description,

  d.pa_owner,
  d.pa_target_date,
  d.pa_closed_date,
  d.pa_closed_by_name,
  d.pa_description,

  d.co_owner,
  d.co_target_date,
  d.closing_note,
  d.qa_sign_name,
  d.closed_at,

  d.action_id,
  a.title  as action_title,
  a.status as action_status,

  d.created_by,
  d.created_at,

  (extract(epoch from (coalesce(d.closed_at, now()) - d.created_at)) / 86400)::integer
    as age_days,
  case when d.sla_date is not null then (d.sla_date - current_date) end
    as days_to_sla,
  (d.status = 'open' and d.sla_date is not null and d.sla_date < current_date)
    as is_overdue,

  (d.status = 'open'
    and (
      (d.type = 'ncr' and d.disposition = 'quarantine' and cardinality(d.product_ids) > 0)
      or exists (
        select 1 from public.deviation_batch_holds h
        where h.deviation_id = d.id and h.status = 'on_hold'
      )
    ))
    as is_quarantining,

  -- ── Appended by 0057 ──────────────────────────────────────────────────
  d.received_via,
  d.adverse_reaction,
  d.capa_needed,
  d.capa_not_needed_reason,
  d.capa_id,
  cp.capa_no,
  cp.status      as capa_status,
  cp.verified_at as capa_verified_at,

  -- ── Appended by 0058 ──────────────────────────────────────────────────
  d.root_cause_category,

  -- ── Appended by 0061 ──────────────────────────────────────────────────
  d.root_cause,
  d.rca_method,

  -- ── Appended by 0062 ──────────────────────────────────────────────────
  d.occurred_at,
  d.department_id,
  dep.name as department_name,
  d.location,
  d.detection_point,
  d.batch_nos,
  d.product_ids,
  d.hold_batch,
  coalesce((
    select array_agg(x.name order by x.ord)
    from (
      select p.name, min(u.ord) as ord
      from unnest(d.product_ids) with ordinality as u(pid, ord)
        join public.factory_products p on p.id = u.pid
      group by p.name
    ) x
  ), '{}') as product_names,

  -- ── Appended by 0063 ──────────────────────────────────────────────────
  d.investigation_required,
  d.investigation_not_required_reason,
  d.red_flags,
  d.classification,
  d.classification_reason,
  d.assessed_at,
  d.assessed_by_name,

  -- ── Appended by 0064 ──────────────────────────────────────────────────
  d.other_batch_nos,
  d.checks_reviewed,
  d.root_cause_categories,
  d.human_procedure_clear,
  d.human_trained,
  d.human_preventable,
  d.root_cause_conclusion,
  d.investigation_submitted_at,
  d.investigation_submitted_by_name,
  d.investigation_returned_at,
  d.investigation_returned_by_name,
  d.investigation_return_reason,
  d.investigation_approved_at,
  d.investigation_approved_by_name,

  -- ── Appended by 0065 ──────────────────────────────────────────────────
  d.unresolved_risk,
  d.duplicate_of,
  d.cost_of_quality,
  d.close_first_signed_at,
  d.close_first_signed_by_name,

  -- ── Appended by 0068 ──────────────────────────────────────────────────
  d.previous_case_ids,
  d.no_previous_found_at,
  d.no_previous_found_by_name,
  d.previous_cases_external,

  -- ── Appended by 0069 ──────────────────────────────────────────────────
  (select count(*)::integer from public.deviation_batch_holds h
    where h.deviation_id = d.id and h.status = 'on_hold') as holds_on_hold,
  (select count(*)::integer from public.deviation_batch_holds h
    where h.deviation_id = d.id) as holds_total,

  -- ── Appended by 0070 ──────────────────────────────────────────────────
  d.review_checks,

  -- ── Appended by 0075 ──────────────────────────────────────────────────
  cp.plan_approved_at as capa_plan_approved_at,
  case when d.capa_id is not null then
    (select count(*)::integer from public.deviations o where o.capa_id = d.capa_id)
  end as capa_case_count,

  -- ── Appended by 0076 ──────────────────────────────────────────────────
  d.nc_item,
  d.nc_item_other,
  d.supplied_by,
  d.material_code,
  d.supplier_lots,
  d.qty_affected,
  d.hold_not_reason
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

grant select on public.deviations_expanded to authenticated;
