-- FactoryOS · Quality — a customer complaint no longer asks who the sponsor is
--
-- Run after 0079.
--
-- The complaint's raise form drops "Who is the sponsor?" and "ARTG number".
-- Neither is asked any more, so the database stops demanding the sponsor:
--
--   · `deviations_complaint_guard` — raising a complaint no longer needs
--     `sponsor`.
--   · `deviations_assessment_guard` — signing a complaint's assessment no
--     longer needs `sponsor` on the Details tab.
--
-- The columns `sponsor` and `artg_no` stay: complaints raised before keep
-- what they recorded, and the close-out rule "a customer sponsor must be
-- notified" still applies to those that said the customer is the sponsor.
-- A complaint raised from now on has no sponsor, so that step is not asked.
--
-- Both functions are 0079's, unchanged apart from the sponsor lines.

-- ── 1. Raising a complaint ───────────────────────────────────────────────

create or replace function public.deviations_complaint_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  not_case boolean := coalesce(current_setting('factoryos.not_case', true), '') = 'on';
begin
  if new.type::text <> 'complaint' then
    return new;
  end if;

  new.complainant_contact := nullif(btrim(coalesce(new.complainant_contact, '')), '');
  new.product_label       := nullif(btrim(coalesce(new.product_label, '')), '');
  new.artg_no             := nullif(btrim(coalesce(new.artg_no, '')), '');
  new.expiry              := nullif(btrim(coalesce(new.expiry, '')), '');
  new.adverse_what        := nullif(btrim(coalesce(new.adverse_what, '')), '');

  if tg_op = 'INSERT' then
    if new.received_on is null then
      raise exception 'Give the date the complaint was received.' using errcode = 'check_violation';
    end if;
    if new.received_on > current_date + 1 then
      raise exception 'The date received cannot be in the future.' using errcode = 'check_violation';
    end if;
    if new.complainant is null then
      raise exception 'Who made the complaint?' using errcode = 'check_violation';
    end if;
    if new.country is null then
      raise exception 'Give the market (country) the product was sold in.' using errcode = 'check_violation';
    end if;
    if cardinality(new.batch_nos) = 0 and coalesce(btrim(new.batch_no), '') = ''
       and new.product_label is null then
      raise exception 'Give the batch number, or the product when the batch is unknown.'
        using errcode = 'check_violation';
    end if;
    if new.adverse_reaction is null then
      raise exception 'Say whether an injury or adverse reaction was reported.' using errcode = 'check_violation';
    end if;
    if new.adverse_reaction then
      if new.adverse_what is null then
        raise exception 'Say what reaction, and when.' using errcode = 'check_violation';
      end if;
      if new.adverse_serious is null then
        raise exception 'Say whether the reaction is serious.' using errcode = 'check_violation';
      end if;
    else
      new.adverse_what := null;
      new.adverse_serious := null;
    end if;
    if new.sample is null then
      raise exception 'Say whether the complaint sample was received.' using errcode = 'check_violation';
    end if;
    if new.sample = 'Received' and new.sample_received_on is null then
      raise exception 'Give the date the sample was received.' using errcode = 'check_violation';
    end if;
    -- A serious adverse reaction is a red flag: severity 5, Critical.
    if new.adverse_serious then
      new.red_flags := array['Serious adverse reaction']::text[];
      new.severity := 5;
    end if;
    new.ack_on := null;
    new.ack_by_name := null;
    new.ack_how := null;
    new.not_case_reason := null;
    return new;
  end if;

  if old.status = 'closed' then
    return new;  -- deviations_guard freezes a closed case.
  end if;

  if not not_case and new.not_case_reason is distinct from old.not_case_reason then
    raise exception 'Close it as not a quality complaint with its own button.'
      using errcode = 'check_violation';
  end if;

  -- ── Acknowledgement ──
  if new.ack_on is distinct from old.ack_on and new.ack_on is not null then
    if new.ack_on > current_date + 1 then
      raise exception 'The acknowledgement cannot be dated in the future.' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.ack_by_name), '') = '' then
      raise exception 'Acknowledging needs a name against it.' using errcode = 'check_violation';
    end if;
    if new.ack_on > coalesce(new.received_on, old.created_at::date) + public.quality_ack_days(new.factory_id)
       and length(coalesce(btrim(new.ack_how), '')) < 10 then
      raise exception 'Acknowledged late — say how it was acknowledged, and why it was late.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── Closing, or a Critical case's first signature ──
  if not not_case and (
       (old.status = 'open' and new.status = 'closed')
    or (old.close_first_signed_at is null and new.close_first_signed_at is not null)) then
    if new.ack_on is null then
      raise exception 'Acknowledge the complainant before closing.' using errcode = 'check_violation';
    end if;
    if new.market_action is null or coalesce(btrim(new.market_why), '') = '' then
      raise exception 'Decide the market action, with its rationale, before closing.'
        using errcode = 'check_violation';
    end if;
    if new.market_action = 'Recall' and (new.recall_class is null or new.recall_level is null) then
      raise exception 'Give the recall class and level.' using errcode = 'check_violation';
    end if;
    if new.sponsor = 'customer' and new.sponsor_notified_on is null then
      raise exception 'Record when the sponsor was notified before closing.' using errcode = 'check_violation';
    end if;
    if public.complaint_report_triggered(new) and new.reportable is null then
      raise exception 'Decide whether a report to the regulator is needed.' using errcode = 'check_violation';
    end if;
    if new.reportable is true and new.reported_on is null then
      raise exception 'Record when the report was made to the regulator before closing.'
        using errcode = 'check_violation';
    end if;
    if new.reportable is false and coalesce(btrim(new.report_reason), '') = '' then
      raise exception 'Say why no regulator report is needed.' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.final_reply), '') = '' or new.reply_sent_on is null then
      raise exception 'Record the final reply to the complainant, and when it was sent.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;


-- ── 2. Signing a complaint's assessment ─────────────────────────────────

create or replace function public.deviations_assessment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  picked    integer;
  fast      integer;
  suggested integer;
  proposed  text;
begin
  if not public.is_qms_case(new.type::text, new.nc_item) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.assessed_at               := null;
    new.assessed_by               := null;
    new.assessed_by_name          := null;
    new.previous_case_ids         := '{}';
    new.no_previous_found_at      := null;
    new.no_previous_found_by_name := null;
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
       or new.category_other    is distinct from old.category_other
       or new.risk_description  is distinct from old.risk_description
       or new.previous_case_ids is distinct from old.previous_case_ids
       or new.no_previous_found_at is distinct from old.no_previous_found_at
       or new.no_previous_found_by_name is distinct from old.no_previous_found_by_name
       or new.previous_cases_external is distinct from old.previous_cases_external then
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

  -- A deviation's likelihood is 1–3. (Detection is no longer asked.)
  if new.likelihood > 3 then
    raise exception 'Likelihood is 1, 2 or 3 — first known occurrence, happened before, or recurring.'
      using errcode = 'check_violation';
  end if;

  -- ── Evidence for the likelihood ──
  if new.previous_case_ids is distinct from old.previous_case_ids then
    if new.id = any (new.previous_case_ids) then
      raise exception 'A case is not its own previous case.'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from unnest(new.previous_case_ids) as x(pid)
      where not exists (
        select 1 from public.deviations p
        where p.id = x.pid and p.factory_id = new.factory_id
      )
    ) then
      raise exception 'A previous case must be a case of this factory.'
        using errcode = 'check_violation';
    end if;
    -- In the order picked, each once.
    new.previous_case_ids := coalesce((
      select array_agg(s.pid order by s.ord)
      from (
        select pid, min(ord) as ord
        from unnest(new.previous_case_ids) with ordinality as u(pid, ord)
        group by pid
      ) s
    ), '{}');
  end if;

  -- "Searched, none found" stands only while nothing is picked; when it is
  -- first ticked, the time is the database's.
  if cardinality(new.previous_case_ids) > 0 then
    new.no_previous_found_at      := null;
    new.no_previous_found_by_name := null;
  elsif new.no_previous_found_at is null then
    new.no_previous_found_by_name := null;
  elsif old.no_previous_found_at is null then
    new.no_previous_found_at := now();
    new.no_previous_found_by_name := coalesce(
      nullif(btrim(new.no_previous_found_by_name), ''),
      public.audit_actor_name()
    );
  else
    -- Still ticked: who ticked it, and when, stay as they were.
    new.no_previous_found_at      := old.no_previous_found_at;
    new.no_previous_found_by_name := old.no_previous_found_by_name;
  end if;

  if new.assessed_at is null then
    return new;
  end if;

  -- ── Signing ──
  if new.status <> 'open' then
    raise exception 'A closed case is not assessed.'
      using errcode = 'check_violation';
  end if;
  if new.type::text = 'complaint' then
    -- A complaint's details are the complaint form's (0079).
    if new.received_on is null or new.received_via is null or new.complainant is null
       or new.country is null or new.adverse_reaction is null
       or new.sample is null then
      raise exception 'Complete the Details tab before signing the assessment.'
        using errcode = 'check_violation';
    end if;
  elsif new.department_id is null or new.occurred_at is null
     or new.detection_point is null
     or coalesce(btrim(new.immediate_action), '') = ''
     or new.hold_batch is null then
    raise exception 'Complete the Details tab before signing the assessment.'
      using errcode = 'check_violation';
  end if;
  if new.nc_category is null then
    raise exception '%', case when new.type::text = 'ncr' then 'Choose the defect type.' else 'Choose the category.' end
      using errcode = 'check_violation';
  end if;
  -- ── A non-conformance (0077) ──
  if new.type::text = 'ncr' then
    if new.specification is null then
      raise exception 'Complete the Details tab before signing the assessment.'
        using errcode = 'check_violation';
    end if;
    if new.nc_category not in (
         'Wrong material or identity', 'Assay or potency out of specification',
         'Physical or dimensional defect', 'Foreign matter or contamination',
         'Microbiological', 'Damaged in transit', 'Labelling or printing error',
         'CoA or documentation error', 'Short or over delivery',
         'Expired or short shelf life', 'Storage conditions not met', 'Other') then
      raise exception 'Choose the defect type.' using errcode = 'check_violation';
    end if;
    if new.nc_category = 'Other' and coalesce(btrim(new.category_other), '') = '' then
      raise exception 'Describe the defect.' using errcode = 'check_violation';
    end if;
    if not new.red_flags <@ array[
         'Wrong material or identity', 'Suspected contamination',
         'Material already used in released product',
         'Unapproved or unqualified supplier', 'Suspected falsified material or CoA'
       ]::text[] then
      raise exception 'Those red flags are a deviation''s, not a non-conformance''s.'
        using errcode = 'check_violation';
    end if;
    -- Found after receipt: the material may already be in batches.
    if (cardinality(new.batch_nos) > 0
        or new.detection_point in ('Dispensing', 'In-process', 'QC testing', 'Stability testing'))
       and new.investigation_required is distinct from true then
      raise exception 'Investigation required: found after receipt, so batches may already contain the material.'
        using errcode = 'check_violation';
    end if;
  -- ── A complaint (0079) ──
  elsif new.type::text = 'complaint' then
    if new.nc_category not in (
         'Cosmetic or appearance defect', 'Physical defect (broken, leaking, wrong count)',
         'Packaging or labelling error', 'Foreign matter or contamination', 'Adverse reaction',
         'Product didn’t work (lack of effect)', 'Suspected counterfeit or tampering', 'Other') then
      raise exception 'Choose the complaint category.' using errcode = 'check_violation';
    end if;
    if new.nc_category = 'Other' and coalesce(btrim(new.category_other), '') = '' then
      raise exception 'Describe the complaint type.' using errcode = 'check_violation';
    end if;
    if not new.red_flags <@ array[
         'Product mix-up', 'Incorrect identity or strength', 'Potential recall',
         'Suspected contamination', 'Counterfeit or tampering concern', 'Serious adverse reaction'
       ]::text[] then
      raise exception 'Those red flags are not a complaint''s.' using errcode = 'check_violation';
    end if;
    if new.investigation_required and new.department_id is null then
      raise exception 'Name the investigating department.' using errcode = 'check_violation';
    end if;
    if new.stock_affected is null then
      raise exception 'Say whether released stock could be affected.' using errcode = 'check_violation';
    end if;
    if public.complaint_report_triggered(new) then
      if new.reportable is null then
        raise exception 'Say whether a report to the regulator is needed.' using errcode = 'check_violation';
      end if;
      if new.reportable = false and coalesce(btrim(new.report_reason), '') = '' then
        raise exception 'Say why no regulator report is needed.' using errcode = 'check_violation';
      end if;
      if new.reportable and (new.report_type is null or new.report_due is null) then
        raise exception 'Give the report type and when it is due.' using errcode = 'check_violation';
      end if;
    end if;
  elsif not new.red_flags <@ array[
         'Product mix-up', 'Wrong identity or strength', 'Suspected contamination',
         'Potential recall', 'Data integrity concern'
       ]::text[] then
    raise exception 'Those red flags are a non-conformance''s, not a deviation''s.'
      using errcode = 'check_violation';
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
  if new.severity is null or new.likelihood is null then
    raise exception 'Score the severity and the likelihood.'
      using errcode = 'check_violation';
  end if;

  if new.likelihood = 1
     and cardinality(new.previous_case_ids) = 0
     and new.no_previous_found_at is null then
    raise exception 'Tick "Searched records — no previous case found", or pick the previous cases.'
      using errcode = 'check_violation';
  end if;
  if new.likelihood > 1
     and cardinality(new.previous_case_ids) = 0
     and coalesce(btrim(new.previous_cases_external), '') = '' then
    raise exception 'Pick the previous cases (or record the ones kept outside FactoryOS) as evidence for the likelihood.'
      using errcode = 'check_violation';
  end if;

  if new.classification is null then
    raise exception 'Classify the case — Critical, Major or Minor.'
      using errcode = 'check_violation';
  end if;

  select count(*),
         count(*) filter (
           where abs(extract(epoch from (p.created_at - old.created_at))) <= 90 * 86400
         )
    into picked, fast
  from public.deviations p
  where p.id = any (new.previous_case_ids);
  suggested := case when picked >= 4 or fast >= 2 then 3 when picked >= 1 then 2 else 1 end;

  proposed := case
    when cardinality(new.red_flags) > 0 or new.severity >= 5 then 'Critical'
    when new.severity >= 3 then
      case when new.likelihood = 3 then 'Critical' else 'Major' end
    else
      case when new.likelihood = 3 then 'Major' else 'Minor' end
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
  if new.likelihood < suggested
     and length(coalesce(btrim(new.risk_description), '')) < 5 then
    raise exception 'The picked cases suggest likelihood % — choose it, or explain the lower choice in the rationale.', suggested
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(new.assessed_by_name), '') = '' then
    raise exception 'Signing needs a name against it.'
      using errcode = 'check_violation';
  end if;

  new.assessed_at := now();
  new.assessed_by := auth.uid();
  -- A complaint counts from the date it was received (0079).
  new.sla_date := coalesce(
      case when new.type::text = 'complaint' then new.received_on end,
      (old.created_at)::date)
    + public.quality_due_days(new.factory_id, new.classification);
  new.priority := (case new.classification
    when 'Critical' then 'critical' when 'Major' then 'high' else 'medium' end)::public.action_priority;
  -- Recurring: a CAPA is required.
  if new.likelihood = 3 and new.capa_needed is null then
    new.capa_needed := true;
  end if;
  return new;
end;
$fn$;

