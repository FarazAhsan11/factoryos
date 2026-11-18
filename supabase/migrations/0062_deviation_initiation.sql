-- FactoryOS · Quality — the deviation's initiation, as the reference QMS asks it
--
-- Run after 0061.
--
-- Raising a deviation moves from a modal to its own page (`/deviations/new`)
-- and asks what the reference QMS (qms-v4) asks. Five changes to the case:
--
--   · **When it happened** — `occurred_at`. `created_at` is only when it was
--     typed in; a deviation found on the night shift and raised next morning
--     happened on the night shift.
--
--   · **Department, location, detected at.** `department_id` is the factory's
--     own Configuration → Departments list (`factory_departments`, 0024 — the
--     one maintenance already uses), so cases can be trended by department.
--     `location` is free text for the exact place (room, line). The point at
--     which it was found is `detection_point` (labelled "Detected at" — not a
--     timestamp, hence not called `detected_at`). It replaces `origin` on the
--     deviation form, which mixed channels (Email, Phone) with sources;
--     `origin` stays for NCRs, complaints and every older case.
--
--   · **Several batches per case** — `batch_nos text[]`, each resolved by the
--     trigger into `product_ids uuid[]`, in the order typed. `batch_no` and
--     `product_id` stay, always the *first* of the list, so everything that
--     reads one batch (the NCR and complaint forms, the case header) keeps
--     working. A form that still writes only `batch_no` replaces the list with
--     that one number.
--
--   · **Put the batch on hold?** — `hold_batch`, planned and unplanned
--     deviations only. Yes holds the batch exactly as an open quarantine NCR
--     does: the card goes On hold (reason Quality), the shift log refuses
--     preparatory and production work against it, and closing the case lets
--     the next producing entry release it. `batch_quarantine_no()` now answers
--     for both, and for every batch on a case, not only the first.
--
--   · **The immediate action is asked at raise, without its date.** The form
--     makes the action required ("None needed" is an answer); the separate
--     date is dropped — when the case was raised is on the record already.
--     The close-out gate therefore needs the action, no longer its date.
--     `immediate_action_date` stays, for the cases that have one.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.deviations
  add column if not exists occurred_at     timestamptz,
  add column if not exists department_id   uuid
    references public.factory_departments (id) on delete set null,
  add column if not exists location        text,
  add column if not exists detection_point text,
  add column if not exists batch_nos       text[] not null default '{}',
  add column if not exists product_ids     uuid[] not null default '{}',
  add column if not exists hold_batch      boolean;

alter table public.deviations
  drop constraint if exists deviations_detection_point_known;
alter table public.deviations
  add constraint deviations_detection_point_known check (
    detection_point is null or detection_point in (
      'Incoming inspection', 'In-process', 'QC testing', 'Warehouse',
      'Audit', 'Customer', 'Other'
    )
  );

-- An NCR holds through its disposition (quarantine); a complaint holds
-- nothing at raise. Only a deviation answers this question.
alter table public.deviations
  drop constraint if exists deviations_hold_batch_deviation_only;
alter table public.deviations
  add constraint deviations_hold_batch_deviation_only check (
    hold_batch is null or type::text in ('planned', 'unplanned')
  );

-- Every case so far had one batch at most. The backfill copies what is
-- already there, so it bypasses the case triggers: the guard would refuse it
-- on every closed case (a closed case is not edited), and the hold trigger
-- has nothing new to hold.
alter table public.deviations disable trigger deviations_guard;
alter table public.deviations disable trigger deviations_hold;

update public.deviations
   set batch_nos   = array[batch_no],
       product_ids = case when product_id is not null then array[product_id] else '{}' end
 where cardinality(batch_nos) = 0
   and batch_no is not null;

alter table public.deviations enable trigger deviations_guard;
alter table public.deviations enable trigger deviations_hold;

-- "Is this batch held by a case?" — asked on every shift-log write.
create index if not exists deviations_product_ids_idx
  on public.deviations using gin (product_ids)
  where status = 'open';

-- ── 2. Is this batch held? ───────────────────────────────────────────────

/**
 * The number of the open case holding a product, or null — an NCR in
 * quarantine, or a deviation raised with "put the batch on hold". Any batch on
 * the case counts. The oldest wins: it is the one that stopped the batch.
 *
 * Same name and signature as 0044, so the shift-log guard, the board's sync
 * and `pipeline_jobs_expanded.quarantine_no` all follow without being
 * rewritten.
 */
create or replace function public.batch_quarantine_no(p_product uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.deviation_no
  from public.deviations d
  where d.status = 'open'
    and p_product = any (d.product_ids)
    and (
      (d.type = 'ncr' and d.disposition = 'quarantine')
      or d.hold_batch is true
    )
  order by d.created_at
  limit 1;
$$;

-- ── 3. The gate ──────────────────────────────────────────────────────────

/**
 * 0057's guard, with:
 *
 *  · the batch list kept tidy and resolved — trimmed, blanks dropped,
 *    duplicates (any case) dropped keeping the first, each resolved to its
 *    product; `batch_no` / `product_id` mirror the first;
 *  · a hold (quarantine NCR or deviation "on hold") refused unless every
 *    batch named is in the product register — a hold on a typo holds nothing
 *    and would say it did;
 *  · the department checked to be this factory's;
 *  · the close-out needing the immediate action, no longer its date.
 */
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
     and (new.disposition = 'quarantine' or new.hold_batch is true) then
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
    if linked.status <> 'open' then
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

    if new.likelihood is null or new.severity is null or new.detection is null then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null then
      raise exception 'Answer whether there is a financial impact.'
        using errcode = 'check_violation';
    end if;

    if length(coalesce(btrim(new.investigation_findings), '')) < 10 then
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
      if linked.status <> 'effective' then
        raise exception '% must be verified as effective before the case is closed.', linked.capa_no
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

-- ── 4. A hold puts every named batch's card On hold ──────────────────────

/**
 * 0044's trigger, for both kinds of hold and every batch on the case. Only
 * the putting-on, as before: closing releases nothing, and the next
 * preparatory or production entry is what moves a card off hold.
 */
create or replace function public.deviations_hold_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open'
     and ((new.type = 'ncr' and new.disposition = 'quarantine')
          or new.hold_batch is true)
     and cardinality(new.product_ids) > 0 then
    update public.pipeline_jobs
    set status      = 'hold',
        hold_reason = 'Quality',
        held_at     = case when status <> 'hold' then now() else held_at end
    where product_id = any (new.product_ids)
      and status <> 'finished';
  end if;
  return null;
end;
$$;

-- ── 5. The shift log's refusal, worded for either kind of case ───────────

create or replace function public.shift_log_quarantine_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat  text;
  held text;
begin
  if new.product_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.product_id is not distinct from old.product_id
     and new.process_id is not distinct from old.process_id then
    return new;
  end if;

  select category into cat
  from public.factory_processes where id = new.process_id;

  if cat = 'downtime' then
    return new;
  end if;

  held := public.batch_quarantine_no(new.product_id);
  if held is not null then
    raise exception
      'Batch % is on hold under % — preparatory and production work cannot be logged against it until QA closes the case. Downtime can still be logged.',
      coalesce(new.batch_no, ''), held
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ── 6. The case read model ───────────────────────────────────────────────
-- 0061's view: `is_quarantining` now covers a deviation's hold (same name and
-- type, so it may change in place), and the new columns appended at the end.

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

  -- Whether this case is what is holding its batches right now.
  (d.status = 'open'
    and cardinality(d.product_ids) > 0
    and ((d.type = 'ncr' and d.disposition = 'quarantine') or d.hold_batch is true))
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
  -- The products the batches resolve to, in batch order, without repeats.
  coalesce((
    select array_agg(x.name order by x.ord)
    from (
      select p.name, min(u.ord) as ord
      from unnest(d.product_ids) with ordinality as u(pid, ord)
        join public.factory_products p on p.id = u.pid
      group by p.name
    ) x
  ), '{}') as product_names
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

comment on view public.deviations_expanded is
  'Read model for the Quality cases — deviations, NCRs and customer complaints: the case record with its batches, products, department and equipment resolved, the risk score (1–125) and conclusion and the case aging computed rather than stored, the linked CAPA''s number and status, and the root cause.';

grant select on public.deviations_expanded to authenticated;
