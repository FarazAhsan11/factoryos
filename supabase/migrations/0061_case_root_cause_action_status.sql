-- FactoryOS · Quality — root cause on the case, and an action's status
--
-- Run after 0060.
--
-- Two changes the client asked for:
--
--   · **Root cause and its method move to the case's Investigation tab.**
--     They were asked for when a CAPA was initiated and stored on the CAPA
--     (0059). The investigation is where a cause is found, so the case now
--     carries `root_cause` and `rca_method` (the same four methods). The
--     CAPA's own columns stay, unread by the case screens, so nothing already
--     recorded is lost.
--
--   · **Initiating a CAPA asks only for its actions** — each CA / PA with a
--     target date, an owner and a **status**. `capa_actions.status` is
--     `open` (not started) or `in_progress`; "closed" is not a status a row
--     is set to but the close itself — an actual closed date and a name, as
--     before — so the two cannot disagree. The CAPA's title is the case's,
--     and its reason, owner, target date and verification are filled in later
--     from the register.
--
-- `initiate_capa()` keeps its signature and now reads each action's status.

-- ── 1. Root cause on the case ────────────────────────────────────────────

alter table public.deviations
  add column if not exists root_cause text,
  add column if not exists rca_method text;

alter table public.deviations
  drop constraint if exists deviations_rca_method_known;
alter table public.deviations
  add constraint deviations_rca_method_known check (
    rca_method is null or rca_method in (
      '5-Why', 'Fishbone (Ishikawa)', 'Fault tree', 'FMEA'
    )
  );

-- ── 2. An action's status ────────────────────────────────────────────────

alter table public.capa_actions
  add column if not exists status text not null default 'open';

alter table public.capa_actions
  drop constraint if exists capa_actions_status_known;
alter table public.capa_actions
  add constraint capa_actions_status_known check (
    status in ('open', 'in_progress')
  );

-- ── 3. Initiate, reading each action's status ────────────────────────────
-- 0060's function, with `status` read from each action.

create or replace function public.initiate_capa(
  p_case       uuid,
  p_title      text,
  p_reason     text,
  p_owner      text,
  p_target     date,
  p_root_cause text,
  p_rca_method text,
  p_criteria   text,
  p_verify_by  date,
  p_actions    jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
  new_id uuid;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if target.status = 'closed' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;

  insert into public.capas (
    factory_id, title, reason, owner_name, target_date,
    root_cause, rca_method, effectiveness_criteria, verify_by, created_by
  )
  values (
    target.factory_id,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), target.title),
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_owner, '')), ''),
    p_target,
    nullif(btrim(coalesce(p_root_cause, '')), ''),
    nullif(btrim(coalesce(p_rca_method, '')), ''),
    nullif(btrim(coalesce(p_criteria, '')), ''),
    p_verify_by,
    auth.uid()
  )
  returning id into new_id;

  insert into public.capa_actions (
    factory_id, capa_id, kind, description, owner_name, target_date,
    status, created_by
  )
  select
    target.factory_id,
    new_id,
    x.kind,
    btrim(x.description),
    nullif(btrim(coalesce(x.owner_name, '')), ''),
    x.target_date,
    coalesce(nullif(x.status, ''), 'open'),
    auth.uid()
  from jsonb_to_recordset(coalesce(p_actions, '[]'::jsonb))
    as x(kind text, description text, owner_name text, target_date date, status text)
  where coalesce(btrim(x.description), '') <> '';

  update public.deviations
     set capa_id = new_id,
         capa_needed = true,
         capa_not_needed_reason = null
   where id = p_case;

  return new_id;
end;
$fn$;

revoke all on function public.initiate_capa(uuid, text, text, text, date, text, text, text, date, jsonb) from public;
grant execute on function public.initiate_capa(uuid, text, text, text, date, text, text, text, date, jsonb) to authenticated;

-- ── 4. The case read model, with the root cause appended ─────────────────

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
  d.root_cause_category,

  -- ── Appended by 0061 ──────────────────────────────────────────────────
  d.root_cause,
  d.rca_method
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
