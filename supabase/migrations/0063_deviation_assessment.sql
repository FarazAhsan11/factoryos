-- FactoryOS · Quality — a deviation's initial assessment
--
-- Run after 0062.
--
-- The reference QMS (qms-v4) puts a step between raising a deviation and
-- investigating it: QA's **initial assessment**. It classifies the case, sets
-- its owner, decides whether it needs an investigation and scores the risk,
-- and signing it accepts the case into the quality system and sets its due
-- date. Planned and unplanned deviations only; NCRs and complaints keep their
-- Risk tab.
--
--   · **Classification** — the category (`nc_category`, which the deviation
--     raise form no longer asks), the case owner (`owner_name`), and
--     `investigation_required` with `investigation_not_required_reason` when
--     it is No.
--   · **Red flags** — `red_flags text[]` from a fixed list. Any red flag means
--     severity 5, which makes the case Critical.
--   · **Risk** — the existing `severity`, `detection` and `likelihood` (1–5).
--     Severity and detection keep their columns with the reference QMS's
--     wording in the form (detection is now "which control would catch it
--     before release"); likelihood keeps this application's 1–5 dropdown.
--     The rationale is `risk_description`. Financial impact is not asked.
--   · **Class** — `classification` Critical / Major / Minor, proposed from
--     the score (High → Critical; Medium, or severity 4 → Major; else Minor;
--     any red flag → Critical), with `classification_reason` when QA picks a
--     different one. It replaces priority on a deviation: signing writes the
--     matching priority (Critical → critical, Major → high, Minor → medium) so
--     the register's priority keeps meaning something.
--   · **The signature** — `assessed_at`, `assessed_by`, `assessed_by_name`.
--     Signing needs every answer above, and sets the due date (`sla_date`)
--     to the raise date + 15 / 30 / 60 days for Critical / Major / Minor. A
--     signed assessment is not changed.
--
-- `deviations_guard` (0062's) changes three things at the close-out, for a
-- deviation: the initial assessment must be signed; financial impact is no
-- longer demanded; and no investigation findings are demanded when the
-- assessment said none was needed.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.deviations
  add column if not exists investigation_required            boolean,
  add column if not exists investigation_not_required_reason text,
  add column if not exists red_flags                         text[] not null default '{}',
  add column if not exists classification                    text,
  add column if not exists classification_reason             text,
  add column if not exists assessed_at                       timestamptz,
  add column if not exists assessed_by                       uuid
    references public.profiles (id) on delete set null,
  add column if not exists assessed_by_name                  text;

alter table public.deviations
  drop constraint if exists deviations_classification_known;
alter table public.deviations
  add constraint deviations_classification_known check (
    classification is null or classification in ('Critical', 'Major', 'Minor')
  );

alter table public.deviations
  drop constraint if exists deviations_red_flags_known;
alter table public.deviations
  add constraint deviations_red_flags_known check (
    red_flags <@ array[
      'Product mix-up', 'Wrong identity or strength', 'Suspected contamination',
      'Potential recall', 'Data integrity concern'
    ]::text[]
  );

-- ── 2. The assessment's gate ─────────────────────────────────────────────

/**
 * Runs before `deviations_guard` (triggers fire in name order). Planned and
 * unplanned deviations only.
 *
 *  · Raising never carries a signature.
 *  · Signing (assessed_at going from null to set) needs the whole
 *    assessment, stamps who and when, and sets the due date and priority.
 *  · A signed assessment is not changed.
 */
create or replace function public.deviations_assessment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  score    integer;
  proposed text;
begin
  if new.type::text not in ('planned', 'unplanned') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.assessed_at      := null;
    new.assessed_by      := null;
    new.assessed_by_name := null;
    return new;
  end if;

  -- ── Signed: fixed ──
  if old.assessed_at is not null then
    if new.assessed_at       is distinct from old.assessed_at
       or new.assessed_by_name is distinct from old.assessed_by_name
       or new.classification    is distinct from old.classification
       or new.classification_reason is distinct from old.classification_reason
       or new.severity          is distinct from old.severity
       or new.detection         is distinct from old.detection
       or new.likelihood        is distinct from old.likelihood
       or new.red_flags         is distinct from old.red_flags
       or new.investigation_required is distinct from old.investigation_required
       or new.investigation_not_required_reason is distinct from old.investigation_not_required_reason
       or new.nc_category       is distinct from old.nc_category
       or new.risk_description  is distinct from old.risk_description then
      raise exception 'The initial assessment of % is signed — it is not changed.', old.deviation_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- A red flag is severity 5, signed or not.
  if cardinality(new.red_flags) > 0 and new.severity is distinct from 5 then
    raise exception 'A red flag sets severity to 5.'
      using errcode = 'check_violation';
  end if;

  if new.assessed_at is null then
    return new;
  end if;

  -- ── Signing ──
  if new.status <> 'open' then
    raise exception 'A closed case is not assessed.'
      using errcode = 'check_violation';
  end if;
  if new.department_id is null or new.occurred_at is null
     or new.detection_point is null
     or coalesce(btrim(new.immediate_action), '') = ''
     or new.hold_batch is null then
    raise exception 'Complete the Details tab before signing the assessment.'
      using errcode = 'check_violation';
  end if;
  if new.nc_category is null then
    raise exception 'Choose the category.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(new.owner_name), '') = '' then
    raise exception 'Name the case owner.' using errcode = 'check_violation';
  end if;
  if new.investigation_required is null then
    raise exception 'Say whether an investigation is required.'
      using errcode = 'check_violation';
  end if;
  if new.investigation_required = false
     and length(coalesce(btrim(new.investigation_not_required_reason), '')) < 5 then
    raise exception 'Say why no investigation is needed.'
      using errcode = 'check_violation';
  end if;
  if new.severity is null or new.detection is null or new.likelihood is null then
    raise exception 'Score severity, detection and likelihood.'
      using errcode = 'check_violation';
  end if;
  if new.classification is null then
    raise exception 'Classify the case — Critical, Major or Minor.'
      using errcode = 'check_violation';
  end if;

  score := new.severity * new.likelihood * new.detection;
  proposed := case
    when cardinality(new.red_flags) > 0 then 'Critical'
    when new.severity = 5 or score >= 60 then 'Critical'
    when score >= 20 or new.severity = 4 then 'Major'
    else 'Minor'
  end;
  if new.classification <> proposed
     and length(coalesce(btrim(new.classification_reason), '')) < 5 then
    raise exception 'Say why it is %, not %.', new.classification, proposed
      using errcode = 'check_violation';
  end if;
  if new.classification in ('Critical', 'Major')
     and length(coalesce(btrim(new.risk_description), '')) < 5 then
    raise exception 'A % case needs the rationale for its scores.', new.classification
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(new.assessed_by_name), '') = '' then
    raise exception 'Signing needs a name against it.'
      using errcode = 'check_violation';
  end if;

  new.assessed_at := now();
  new.assessed_by := auth.uid();
  new.sla_date := (old.created_at)::date + case new.classification
    when 'Critical' then 15 when 'Major' then 30 else 60 end;
  new.priority := (case new.classification
    when 'Critical' then 'critical' when 'Major' then 'high' else 'medium' end)::public.action_priority;
  return new;
end;
$fn$;

drop trigger if exists deviations_assessment_guard on public.deviations;
create trigger deviations_assessment_guard
  before insert or update on public.deviations
  for each row execute function public.deviations_assessment_guard();

-- ── 3. The case's gate, for an assessed deviation ────────────────────────

/**
 * 0062's guard, with the close-out changed for planned and unplanned
 * deviations: the initial assessment must be signed, financial impact is not
 * asked, and investigation findings are not demanded when the assessment
 * said no investigation was needed. Everything else is unchanged.
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

    -- A deviation is scored and classified at its initial assessment (0063),
    -- which must be signed first; the assessment drops financial impact.
    if new.type::text in ('planned', 'unplanned') and new.assessed_at is null then
      raise exception 'Sign the initial assessment before closing.'
        using errcode = 'check_violation';
    end if;

    if new.likelihood is null or new.severity is null or new.detection is null then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null
       and new.type::text not in ('planned', 'unplanned') then
      raise exception 'Answer whether there is a financial impact.'
        using errcode = 'check_violation';
    end if;

    -- Unless the assessment decided no investigation was needed (with a
    -- reason, which signing demanded).
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

-- ── 4. The case read model, with the assessment appended ─────────────────

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
  ), '{}') as product_names,

  -- ── Appended by 0063 ──────────────────────────────────────────────────
  d.investigation_required,
  d.investigation_not_required_reason,
  d.red_flags,
  d.classification,
  d.classification_reason,
  d.assessed_at,
  d.assessed_by_name
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
