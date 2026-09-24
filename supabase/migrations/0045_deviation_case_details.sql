-- FactoryOS · Deviations & NCRs — the QMS case record
--
-- 0044 built the register from the prototype's four-field modal. The real
-- document it stands in for is a QMS *case*, and the customer's own system
-- keeps it as seven tabs:
--
--   1 Initiation and identification — what happened, to what, and whose it is
--   2 Immediate / containment action — what was done that same day
--   3 Risk assessment              — likelihood × severity × detection
--   4 Investigation                — findings
--   5 Corrective action            — CA owner, target, description, closed
--   6 Preventive action            — PA owner, target, description, closed
--   7 Close out                    — CO owner, target, description, signed
--
-- Every field the screenshots mark with a `*` is demanded here too, but at
-- **one gate rather than seven**: the tabs are filled as the facts arrive —
-- an investigation's findings land days after the containment action — and
-- the close-out is refused until the starred ones are all in. A case that is
-- open is a case being worked; a case that is closed is a complete document.
--
-- What is *not* added, because this application already knows it: the product
-- name and code (resolved from the batch, as everywhere else), the equipment
-- name (resolved from the register, as in maintenance), the aging figures and
-- the risk conclusion (computed in the view, never stored).

-- ── 1. Initiation and identification ─────────────────────────────────────

alter table public.deviations
  -- The case title. The event description (`actual`, 0044) is the paragraph;
  -- this is the line that identifies the case in a list of six hundred.
  add column if not exists title text,

  add column if not exists origin        text,
  add column if not exists priority      public.action_priority not null default 'medium',
  -- Why it was closed — "Problem solved", "Cancelled". Only ever set at the
  -- gate, and demanded there.
  add column if not exists status_reason text,
  -- When it is meant to be closed by. An estimate the aging columns read;
  -- nothing refuses a case for passing it.
  add column if not exists sla_date      date,

  -- Who it concerns. `customer_name` is prefilled from the batch's own
  -- customer (0041) when the number resolves, and stays editable — a case can
  -- concern a customer the catalogue never recorded.
  add column if not exists customer_name  text,
  add column if not exists customer_other text,
  add column if not exists supplier_name  text,

  -- Typed names, like every other signature in this application: the person
  -- holding the pen is not reliably the person holding the login.
  add column if not exists owner_name      text,
  add column if not exists supervisor_name text,

  -- The paperwork the case points at.
  add column if not exists procedure_name  text,
  add column if not exists sop_number      text,
  add column if not exists document_number text,

  -- The materials it concerns. Kept as typed text rather than as references:
  -- FactoryOS has no raw-material or packaging register, and inventing one to
  -- hold a code somebody reads off a label would be a module, not a column.
  add column if not exists raw_material_code       text,
  add column if not exists raw_material_name       text,
  add column if not exists packaging_material_code text,

  -- Resolved to a name through `factory_equipment`, the same loose match the
  -- shift log and maintenance use.
  add column if not exists equipment_no text,

  -- What *kind* of non-conformance — packaging, labelling, process. A checked
  -- list rather than a per-tenant setup table: unlike departments, these are
  -- the same words in every plant, and a free-text box here makes the register
  -- unfilterable within a month.
  add column if not exists nc_category text,

  -- ── 2. Immediate / containment action ─────────────────────────────────
  add column if not exists immediate_action_date date,
  add column if not exists immediate_action      text,

  -- ── 3. Risk assessment ────────────────────────────────────────────────
  -- Three 1–3 scores. Likelihood and severity run low → high; **detection
  -- runs the other way** — 1 is "we would catch this every time", which is
  -- what makes it *less* risky — and that is the customer's own scale
  -- ("1 - High" against a case whose conclusion is Low).
  add column if not exists likelihood smallint,
  add column if not exists severity   smallint,
  add column if not exists detection  smallint,
  add column if not exists financial_impact boolean,
  add column if not exists risk_description text,
  add column if not exists risk_assessed_at timestamptz,

  -- ── 4. Investigation ──────────────────────────────────────────────────
  add column if not exists investigation_findings text,
  add column if not exists investigated_at        timestamptz,

  -- ── 5. Corrective action ──────────────────────────────────────────────
  add column if not exists ca_owner         text,
  add column if not exists ca_target_date   date,
  add column if not exists ca_closed_date   date,
  add column if not exists ca_closed_by_name text,
  add column if not exists ca_description   text,

  -- ── 6. Preventive action ──────────────────────────────────────────────
  add column if not exists pa_owner         text,
  add column if not exists pa_target_date   date,
  add column if not exists pa_closed_date   date,
  add column if not exists pa_closed_by_name text,
  add column if not exists pa_description   text,

  -- ── 7. Close out ──────────────────────────────────────────────────────
  -- The other three close-out fields already exist: `closing_note` is the CO
  -- description, `qa_sign_name` is CO closed by, and `closed_at` is the
  -- actual closed date.
  add column if not exists co_owner       text,
  add column if not exists co_target_date date;

-- Every case raised before this migration takes its title from the first line
-- of what was recorded, so the column can be `not null` from here on.
update public.deviations
   set title = left(btrim(actual), 120)
 where title is null;

alter table public.deviations
  alter column title set not null;

alter table public.deviations
  drop constraint if exists deviations_title_not_blank;
alter table public.deviations
  add constraint deviations_title_not_blank check (length(btrim(title)) > 0);

-- The three checked lists. Null is always allowed — these are answered as the
-- case is worked, not at the moment it is raised.
alter table public.deviations
  drop constraint if exists deviations_origin_known;
alter table public.deviations
  add constraint deviations_origin_known check (
    origin is null or origin in (
      'Internal inspection', 'Shift log', 'Customer complaint',
      'Supplier', 'Audit', 'Email', 'Phone', 'Other'
    )
  );

alter table public.deviations
  drop constraint if exists deviations_nc_category_known;
alter table public.deviations
  add constraint deviations_nc_category_known check (
    nc_category is null or nc_category in (
      'Raw material', 'Packaging', 'Labelling', 'Process', 'Equipment',
      'Documentation', 'Product quality', 'Storage & handling', 'Other'
    )
  );

alter table public.deviations
  drop constraint if exists deviations_status_reason_known;
alter table public.deviations
  add constraint deviations_status_reason_known check (
    status_reason is null or status_reason in (
      'Problem solved', 'Information provided', 'No action required', 'Cancelled'
    )
  );

alter table public.deviations
  drop constraint if exists deviations_risk_scores_range;
alter table public.deviations
  add constraint deviations_risk_scores_range check (
    (likelihood is null or likelihood between 1 and 3)
    and (severity  is null or severity  between 1 and 3)
    and (detection is null or detection between 1 and 3)
  );

-- The register is read by type and status, and now sorted by how urgent and
-- how old — the two columns the list actually opens on.
create index if not exists deviations_open_idx
  on public.deviations (factory_id, status, priority, created_at desc);

-- ── 2. The gate, with the starred fields ─────────────────────────────────

/**
 * Replaces 0044's guard. Everything it did still happens — the number, the
 * product resolution, the quarantine rules, the frozen closed record — plus:
 *
 *  · the three per-tab stamps (`risk_assessed_at`, `investigated_at`) land
 *    the moment their tab is first completed, so "when was this assessed?"
 *    is answered without a status column that nobody would maintain;
 *
 *  · closing demands the starred fields of tabs 2, 3, 4 and 7.
 *
 * The frozen-record test is now a jsonb comparison rather than a list of
 * columns. With forty of them, a list is a promise to forget one: the rule is
 * "nothing changes on a closed case except the references a delete may null",
 * and this says exactly that.
 */
create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- The references `on delete set null` may still null on a closed case.
  nullable_keys text[] := array['product_id', 'action_id', 'created_by', 'closed_by'];
begin
  if tg_op = 'INSERT' or new.batch_no is distinct from old.batch_no then
    new.batch_no := nullif(btrim(coalesce(new.batch_no, '')), '');
    new.product_id := (
      select p.id from public.factory_products p
      where p.factory_id = new.factory_id
        and lower(p.batch_no) = lower(new.batch_no)
    );
  end if;

  if new.status = 'open'
     and new.disposition = 'quarantine'
     and new.product_id is null then
    raise exception 'Quarantine holds a batch — % is not one in the product register.',
      coalesce(new.batch_no, '(no batch)')
      using errcode = 'check_violation';
  end if;

  -- Each tab stamps itself as it is completed, and keeps the first stamp: the
  -- date a risk was assessed does not move because a typo was corrected.
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

    new.deviation_no := public.next_document_number(
      new.factory_id,
      case when new.type = 'ncr' then 'NCR' else 'DEV' end,
      case when new.type = 'ncr' then 'NCR' else 'DEV' end
    );
    new.closing_note  := null;
    new.qa_sign_name  := null;
    new.status_reason := null;
    new.closed_at     := null;
    new.closed_by     := null;
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
    if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
      raise exception '% is closed — a closed case is not edited.', old.deviation_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── Open → Closed ──
  if new.status = 'closed' then
    -- Tab 2.
    if new.immediate_action_date is null
       or coalesce(btrim(new.immediate_action), '') = '' then
      raise exception 'Record the immediate action taken, and the date, before closing.'
        using errcode = 'check_violation';
    end if;

    -- Tab 3. Four answers, and `financial_impact` is refused while null
    -- rather than defaulted to no — an unanswered box that prints as "No" is
    -- the failure mode a controlled document exists to prevent.
    if new.likelihood is null or new.severity is null or new.detection is null then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null then
      raise exception 'Answer whether there is a financial impact.'
        using errcode = 'check_violation';
    end if;

    -- Tab 4.
    if length(coalesce(btrim(new.investigation_findings), '')) < 10 then
      raise exception 'Record the investigation findings before closing.'
        using errcode = 'check_violation';
    end if;

    -- Tab 7.
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

-- ── 3. The read model ────────────────────────────────────────────────────
--
-- Dropped and rebuilt rather than replaced: `create or replace view` may only
-- append columns, and forty of them appended in migration order would read as
-- an archaeology of this table rather than as a case record. Nothing but the
-- browser depends on it.

drop view if exists public.deviations_expanded;

create view public.deviations_expanded
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
  -- Matched the way the shift log matches it: "MO216" and "mo 216" are the
  -- same machine to everyone but a string comparison.
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

  -- Likelihood × severity × detection, 1–27, and the conclusion the register
  -- is filtered by. Computed on every read: a stored score is one somebody
  -- has to remember to recompute after correcting a single number.
  (d.likelihood * d.severity * d.detection) as risk_score,
  case
    when d.likelihood is null or d.severity is null or d.detection is null
      then null
    when d.likelihood * d.severity * d.detection >= 18 then 'High'
    when d.likelihood * d.severity * d.detection >= 9  then 'Medium'
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
  -- "CO Actual Closed Date" on the form. Kept as the instant rather than
  -- also stored as a date: the browser formats it in the reader's own
  -- timezone, and a second copy cast here would disagree with it by a day.
  d.closed_at,

  d.action_id,
  a.title  as action_title,
  a.status as action_status,

  d.created_by,
  d.created_at,

  -- ── Case aging, computed ──────────────────────────────────────────────
  -- How long the case has been open, in days, and how it stands against its
  -- SLA date. A closed case's age stops at its closing.
  (extract(epoch from (coalesce(d.closed_at, now()) - d.created_at)) / 86400)::integer
    as age_days,
  case when d.sla_date is not null then (d.sla_date - current_date) end
    as days_to_sla,
  (d.status = 'open' and d.sla_date is not null and d.sla_date < current_date)
    as is_overdue,

  (d.type = 'ncr' and d.status = 'open' and d.disposition = 'quarantine'
    and d.product_id is not null) as is_quarantining
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

comment on view public.deviations_expanded is
  'Read model for Deviations & NCRs: the seven-tab case record, with the product and equipment resolved, and the risk conclusion and case aging computed rather than stored.';

grant select on public.deviations_expanded to authenticated;
