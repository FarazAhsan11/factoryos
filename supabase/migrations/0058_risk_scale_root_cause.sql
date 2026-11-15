-- FactoryOS · Quality — the five-point risk scales, and the root cause category
--
-- Run after 0057.
--
-- **The risk scales go from 1–3 to 1–5**, each point described, as the
-- reference QMS scores them — keeping this application's names for the three
-- (Likelihood, Severity of impact, Probability of detection):
--
--   Severity     1 No impact on quality … 5 Could harm a patient or trigger a recall
--   Likelihood   1 Not seen before      … 5 Monthly or more
--   Detection    1 Always caught by an existing check … 5 Would not be caught
--
-- Detection still runs the way it did: a low number is a check that catches
-- it, which makes the risk lower.
--
-- The conclusion follows the reference's arithmetic: score = severity ×
-- likelihood × detection (1–125); 20 and over is Medium, 60 and over is High,
-- and **severity 5 is always High**.
--
-- Scores already recorded on the old three-point scale are **rescaled** so
-- they keep their meaning — 1 stays 1 (low), 2 becomes 3 (middle), 3 becomes
-- 5 (high) — rather than being read as the bottom of the new scale, where a
-- "High" severity would silently become "Out of specification but
-- recoverable". Closed cases are rescaled too: the assessment is the same, only
-- the scale it is written on changed. The case guard (which freezes closed
-- cases) is switched off around that one update. It runs only while the old
-- 1–3 constraint is still in place, so running this file twice does not
-- rescale twice.
--
-- **Root cause category** is new on the Investigation tab: Man, Method,
-- Material, Machine or Environment. A checked list, like the
-- non-conformance category, so the register can be read by cause.

-- ── 1. Rescale, then widen ───────────────────────────────────────────────

do $rescale$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'deviations_risk_scores_range'
      and conrelid = 'public.deviations'::regclass
  ) then
    alter table public.deviations drop constraint deviations_risk_scores_range;

    alter table public.deviations disable trigger deviations_guard;
    alter table public.deviations disable trigger deviations_hold;

    update public.deviations
       set likelihood = case likelihood when 2 then 3 when 3 then 5 else likelihood end,
           severity   = case severity   when 2 then 3 when 3 then 5 else severity   end,
           detection  = case detection  when 2 then 3 when 3 then 5 else detection  end
     where likelihood is not null
        or severity   is not null
        or detection  is not null;

    alter table public.deviations enable trigger deviations_hold;
    alter table public.deviations enable trigger deviations_guard;
  end if;
end
$rescale$;

alter table public.deviations
  drop constraint if exists deviations_risk_scores_1_5;
alter table public.deviations
  add constraint deviations_risk_scores_1_5 check (
    (likelihood is null or likelihood between 1 and 5)
    and (severity  is null or severity  between 1 and 5)
    and (detection is null or detection between 1 and 5)
  );

-- ── 2. Root cause category ───────────────────────────────────────────────

alter table public.deviations
  add column if not exists root_cause_category text;

alter table public.deviations
  drop constraint if exists deviations_root_cause_category_known;
alter table public.deviations
  add constraint deviations_root_cause_category_known check (
    root_cause_category is null
    or root_cause_category in ('Man', 'Method', 'Material', 'Machine', 'Environment')
  );

-- ── 3. The read model ────────────────────────────────────────────────────
-- 0057's view with the new conclusion and `root_cause_category` appended.

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

  -- Severity × likelihood × detection, 1–125. 20 and over is Medium, 60 and
  -- over is High, and a severity of 5 is High whatever the other two say —
  -- a defect that could harm a patient is not made safe by being rare.
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

  (d.type = 'ncr' and d.status = 'open' and d.disposition = 'quarantine'
    and d.product_id is not null) as is_quarantining,

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
  d.root_cause_category
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

comment on view public.deviations_expanded is
  'Read model for the Quality cases — deviations, NCRs and customer complaints: the case record with the product and equipment resolved, the risk score (1–125) and conclusion and the case aging computed rather than stored, the linked CAPA''s number and status, and the root cause category.';

grant select on public.deviations_expanded to authenticated;
