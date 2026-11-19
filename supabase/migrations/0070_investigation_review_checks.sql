-- FactoryOS · Quality — what the investigation reviewed, and what each showed
--
-- Run after 0069.
--
-- The Investigation tab's **What was reviewed** as the reference QMS (qms-v5)
-- has it. Until now (0064) it was ticks from a fixed list (`checks_reviewed`).
-- Now each ticked item carries **what it showed**, and the investigator may
-- **add other items** the list doesn't name:
--
--   · `review_checks jsonb` — `[{ "item": "Batch record", "finding": "No
--     deviations recorded for 46650." }, …]`, in the order ticked. The
--     suggested list (batch record, equipment history, previous similar
--     cases, environmental data, raw material or packaging changes, training
--     records, other batches) is the form's; any other item is allowed.
--   · `deviations_investigation_guard` (0064's, otherwise unchanged) keeps
--     each item named once and trimmed, fixes the list once the investigation
--     is submitted or approved, and refuses **submitting** while a ticked item
--     has no finding.
--   · The ticks already given are carried over, with an empty finding.
--     `checks_reviewed` stays for the record and is no longer written.

-- ── 1. The column, carried over from the ticks ───────────────────────────

alter table public.deviations
  add column if not exists review_checks jsonb not null default '[]'::jsonb;

-- Before the guard below exists in its new form, so the carry-over is not
-- refused on an investigation already submitted or approved.
alter table public.deviations disable trigger deviations_investigation_guard;
alter table public.deviations disable trigger deviations_assessment_guard;
alter table public.deviations disable trigger deviations_closeout_guard;
alter table public.deviations disable trigger deviations_guard;
alter table public.deviations disable trigger deviations_holds_close_guard;
alter table public.deviations disable trigger deviations_hold;
alter table public.deviations disable trigger deviations_audit;

update public.deviations d
   set review_checks = (
     select jsonb_agg(jsonb_build_object('item', c, 'finding', '') order by o)
     from unnest(d.checks_reviewed) with ordinality as u(c, o)
   )
 where cardinality(d.checks_reviewed) > 0
   and d.review_checks = '[]'::jsonb;

alter table public.deviations enable trigger deviations_investigation_guard;
alter table public.deviations enable trigger deviations_assessment_guard;
alter table public.deviations enable trigger deviations_closeout_guard;
alter table public.deviations enable trigger deviations_guard;
alter table public.deviations enable trigger deviations_holds_close_guard;
alter table public.deviations enable trigger deviations_hold;
alter table public.deviations enable trigger deviations_audit;

-- ── 2. The investigation's gate ──────────────────────────────────────────

/**
 * 0064's guard, with `review_checks`: kept tidy, fixed once submitted, and a
 * finding demanded for every ticked item at submission.
 */
create or replace function public.deviations_investigation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  answers_changed boolean;
  missing         text;
begin
  if new.type::text not in ('planned', 'unplanned') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.investigation_submitted_at      := null;
    new.investigation_submitted_by_name := null;
    new.investigation_returned_at       := null;
    new.investigation_returned_by_name  := null;
    new.investigation_return_reason     := null;
    new.investigation_approved_at       := null;
    new.investigation_approved_by       := null;
    new.investigation_approved_by_name  := null;
    return new;
  end if;

  -- Tidy the batch list the same way the case's own batches are.
  if new.other_batch_nos is distinct from old.other_batch_nos then
    new.other_batch_nos := coalesce((
      select array_agg(s.b order by s.ord)
      from (
        select (array_agg(btrim(x) order by ord))[1] as b, min(ord) as ord
        from unnest(new.other_batch_nos) with ordinality as u(x, ord)
        where coalesce(btrim(x), '') <> ''
        group by lower(btrim(x))
      ) s
    ), '{}');
  end if;

  -- ── What was reviewed (0070): each item named once, trimmed ──
  if new.review_checks is distinct from old.review_checks then
    if jsonb_typeof(new.review_checks) is distinct from 'array' then
      raise exception 'What was reviewed must be a list.'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from jsonb_array_elements(new.review_checks) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(btrim(e ->> 'item'), '') = ''
         or length(btrim(e ->> 'item')) > 120
         or length(coalesce(e ->> 'finding', '')) > 1000
    ) then
      raise exception 'Each reviewed item needs a name (up to 120 characters) and a finding of up to 1000.'
        using errcode = 'check_violation';
    end if;
    new.review_checks := coalesce((
      select jsonb_agg(
               jsonb_build_object('item', s.item, 'finding', s.finding)
               order by s.ord)
      from (
        select (array_agg(btrim(e ->> 'item') order by ord))[1] as item,
               (array_agg(coalesce(btrim(e ->> 'finding'), '') order by ord))[1] as finding,
               min(ord) as ord
        from jsonb_array_elements(new.review_checks) with ordinality as x(e, ord)
        group by lower(btrim(e ->> 'item'))
      ) s
    ), '[]'::jsonb);
  end if;

  answers_changed :=
       new.impact                 is distinct from old.impact
    or new.other_batch_nos        is distinct from old.other_batch_nos
    or new.checks_reviewed        is distinct from old.checks_reviewed
    or new.review_checks          is distinct from old.review_checks
    or new.investigation_findings is distinct from old.investigation_findings
    or new.root_cause_categories  is distinct from old.root_cause_categories
    or new.human_procedure_clear  is distinct from old.human_procedure_clear
    or new.human_trained          is distinct from old.human_trained
    or new.human_preventable      is distinct from old.human_preventable
    or new.root_cause             is distinct from old.root_cause
    or new.root_cause_conclusion  is distinct from old.root_cause_conclusion
    or new.rca_method             is distinct from old.rca_method;

  -- ── Approved: fixed ──
  if old.investigation_approved_at is not null then
    if answers_changed
       or new.investigation_approved_at is distinct from old.investigation_approved_at
       or new.investigation_approved_by_name is distinct from old.investigation_approved_by_name
       or new.investigation_submitted_at is distinct from old.investigation_submitted_at then
      raise exception 'The investigation of % is approved — it is not changed.', old.deviation_no
        using errcode = 'check_violation';
    end if;
  -- ── Submitted, waiting for QA ──
  elsif old.investigation_submitted_at is not null then
    if answers_changed then
      raise exception 'The investigation is with QA for approval — send it back to change it.'
        using errcode = 'check_violation';
    end if;

    if new.investigation_approved_at is not null then
      -- Approving.
      if coalesce(btrim(new.investigation_approved_by_name), '') = '' then
        raise exception 'Approving needs a name against it.'
          using errcode = 'check_violation';
      end if;
      new.investigation_approved_at := now();
      new.investigation_approved_by := auth.uid();
    elsif new.investigation_submitted_at is null then
      -- Sent back.
      if length(coalesce(btrim(new.investigation_return_reason), '')) < 5 then
        raise exception 'Say what needs to change.'
          using errcode = 'check_violation';
      end if;
      if coalesce(btrim(new.investigation_returned_by_name), '') = '' then
        raise exception 'Sending back needs a name against it.'
          using errcode = 'check_violation';
      end if;
      new.investigation_returned_at := now();
      new.investigation_submitted_by_name := null;
    end if;
  -- ── Being written ──
  else
    if new.investigation_approved_at is not null then
      raise exception 'Submit the investigation before it is approved.'
        using errcode = 'check_violation';
    end if;

    if new.investigation_submitted_at is not null then
      -- Submitting.
      if new.assessed_at is null then
        raise exception 'Sign the initial assessment before submitting the investigation.'
          using errcode = 'check_violation';
      end if;
      if new.investigation_required is false then
        raise exception 'The assessment decided no investigation is needed.'
          using errcode = 'check_violation';
      end if;
      if length(coalesce(btrim(new.impact), '')) < 5 then
        raise exception 'Record the product impact assessment.'
          using errcode = 'check_violation';
      end if;
      select string_agg(e ->> 'item', ', ') into missing
      from jsonb_array_elements(new.review_checks) e
      where coalesce(btrim(e ->> 'finding'), '') = '';
      if missing is not null then
        raise exception 'Write what each reviewed item showed — % has no finding yet.', missing
          using errcode = 'check_violation';
      end if;
      if length(coalesce(btrim(new.investigation_findings), '')) < 10 then
        raise exception 'Record the findings.'
          using errcode = 'check_violation';
      end if;
      if cardinality(new.root_cause_categories) = 0 then
        raise exception 'Tick at least one root cause category.'
          using errcode = 'check_violation';
      end if;
      if 'Man (people)' = any (new.root_cause_categories)
         and (new.human_procedure_clear is null
              or new.human_trained is null
              or new.human_preventable is null) then
        raise exception 'Answer the three questions about the human error.'
          using errcode = 'check_violation';
      end if;
      if length(coalesce(btrim(new.root_cause), '')) < 5 then
        raise exception 'State the root cause.'
          using errcode = 'check_violation';
      end if;
      if new.root_cause_conclusion is null then
        raise exception 'Is the root cause confirmed, probable or not confirmed?'
          using errcode = 'check_violation';
      end if;
      if new.rca_method is null then
        raise exception 'Name the method used to find the root cause.'
          using errcode = 'check_violation';
      end if;
      if coalesce(btrim(new.investigation_submitted_by_name), '') = '' then
        raise exception 'Submitting needs a name against it.'
          using errcode = 'check_violation';
      end if;
      new.investigation_submitted_at := now();
      new.investigation_returned_at := null;
      new.investigation_returned_by_name := null;
      new.investigation_return_reason := null;
    end if;
  end if;

  -- ── Closing needs the approval ──
  if new.status = 'closed' and old.status = 'open'
     and new.investigation_required is distinct from false
     and new.investigation_approved_at is null then
    raise exception 'Approve the investigation before closing.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists deviations_investigation_guard on public.deviations;
create trigger deviations_investigation_guard
  before update or insert on public.deviations
  for each row execute function public.deviations_investigation_guard();

-- ── 3. The case read model, with the checks appended ─────────────────────

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

  -- Whether this case is what is holding its batches right now: an NCR's
  -- quarantine, or a deviation with a batch hold still on (0069).
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
  -- The products the batches resolve to, in batch order, without repeats.
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
  d.review_checks
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
