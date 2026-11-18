-- FactoryOS · Quality — a deviation's close-out
--
-- Run after 0064.
--
-- The Close-out tab as the reference QMS (qms-v4) lays it out, for planned
-- and unplanned deviations:
--
--   · **Any unresolved product or patient risk?** — `unresolved_risk`. A
--     case does not close while risk remains (Yes refuses the close).
--   · **Close-out summary and residual risk** — the existing `closing_note`.
--   · **Reason for closing** — `status_reason`, which gains Resolved and
--     Duplicate (the older four stay valid for NCRs, complaints and every
--     case already closed). Duplicate names the case it duplicates
--     (`duplicate_of`); otherwise an optional **cost of quality**
--     (`cost_of_quality`), which replaces the financial-impact yes/no.
--   · **Signatures** — one QA signature closes a case; a **Critical** one
--     needs two. The first is `close_first_signed_at` / `_by` / `_by_name`
--     and leaves the case open with its close-out fixed; the second closes it
--     (its name is `qa_sign_name`, as every close-out's is).
--
-- The CO owner and CO target date are no longer asked on a deviation.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.deviations
  add column if not exists unresolved_risk             boolean,
  add column if not exists duplicate_of                text,
  add column if not exists cost_of_quality             numeric(12, 2),
  add column if not exists close_first_signed_at       timestamptz,
  add column if not exists close_first_signed_by       uuid
    references public.profiles (id) on delete set null,
  add column if not exists close_first_signed_by_name  text;

alter table public.deviations
  drop constraint if exists deviations_cost_of_quality_positive;
alter table public.deviations
  add constraint deviations_cost_of_quality_positive check (
    cost_of_quality is null or cost_of_quality >= 0
  );

alter table public.deviations
  drop constraint if exists deviations_status_reason_known;
alter table public.deviations
  add constraint deviations_status_reason_known check (
    status_reason is null or status_reason in (
      'Resolved', 'No action required', 'Duplicate',
      'Problem solved', 'Information provided', 'Cancelled'
    )
  );

-- ── 2. The close-out's gate ──────────────────────────────────────────────

/**
 * Planned and unplanned deviations only. Fires between
 * `deviations_assessment_guard` and `deviations_guard` (name order), so the
 * main guard still re-checks everything else a close needs.
 *
 *  · The first signature of a Critical case: the close-out answers, a name;
 *    the case stays open and its close-out is then fixed.
 *  · Closing: no unresolved risk, a duplicate names its original, and a
 *    Critical case has its first signature.
 */
create or replace function public.deviations_closeout_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.type::text not in ('planned', 'unplanned') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.unresolved_risk            := null;
    new.close_first_signed_at      := null;
    new.close_first_signed_by      := null;
    new.close_first_signed_by_name := null;
    return new;
  end if;

  if old.status = 'closed' then
    return new;  -- deviations_guard freezes a closed case.
  end if;

  -- ── First-signed: the close-out is fixed until the second signature ──
  if old.close_first_signed_at is not null then
    if new.close_first_signed_at is distinct from old.close_first_signed_at
       or new.close_first_signed_by_name is distinct from old.close_first_signed_by_name
       or new.unresolved_risk is distinct from old.unresolved_risk
       or new.closing_note    is distinct from old.closing_note
       or new.status_reason   is distinct from old.status_reason
       or new.duplicate_of    is distinct from old.duplicate_of
       or new.cost_of_quality is distinct from old.cost_of_quality then
      raise exception 'The close-out of % has its first signature — it waits for the second.', old.deviation_no
        using errcode = 'check_violation';
    end if;
  elsif new.close_first_signed_at is not null then
    -- ── The first signature ──
    if new.classification is distinct from 'Critical' then
      raise exception 'Only a Critical case needs two signatures — sign the close-out once.'
        using errcode = 'check_violation';
    end if;
    if new.status <> 'open' then
      raise exception 'The first signature leaves the case open.'
        using errcode = 'check_violation';
    end if;
    if new.unresolved_risk is distinct from false then
      raise exception 'A case does not close while product or patient risk remains.'
        using errcode = 'check_violation';
    end if;
    if length(coalesce(btrim(new.closing_note), '')) < 10 then
      raise exception 'Record the close-out summary.'
        using errcode = 'check_violation';
    end if;
    if new.status_reason is null then
      raise exception 'Say why the case is being closed.'
        using errcode = 'check_violation';
    end if;
    if new.status_reason = 'Duplicate' and coalesce(btrim(new.duplicate_of), '') = '' then
      raise exception 'Name the case this duplicates.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.close_first_signed_by_name), '') = '' then
      raise exception 'Signing needs a name against it.'
        using errcode = 'check_violation';
    end if;
    new.close_first_signed_at := now();
    new.close_first_signed_by := auth.uid();
  end if;

  -- ── Closing ──
  if new.status = 'closed' then
    if new.unresolved_risk is distinct from false then
      raise exception 'A case does not close while product or patient risk remains.'
        using errcode = 'check_violation';
    end if;
    if new.status_reason = 'Duplicate' and coalesce(btrim(new.duplicate_of), '') = '' then
      raise exception 'Name the case this duplicates.'
        using errcode = 'check_violation';
    end if;
    if new.classification = 'Critical' and new.close_first_signed_at is null then
      raise exception 'A Critical case needs two QA signatures — sign the first, then a second approver closes it.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists deviations_closeout_guard on public.deviations;
create trigger deviations_closeout_guard
  before insert or update on public.deviations
  for each row execute function public.deviations_closeout_guard();

-- ── 3. The case read model, with the close-out appended ──────────────────

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
  d.close_first_signed_by_name
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
