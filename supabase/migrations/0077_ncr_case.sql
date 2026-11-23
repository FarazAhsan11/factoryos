-- FactoryOS · Quality — a non-conformance's case, end to end (qms-v12)
--
-- Run after 0076.
--
-- NCR phases 2–4: an NCR raised on the qms-v12 form (`nc_item` set, 0076) now
-- walks the same case as a deviation — initial assessment, investigation,
-- actions, close-out, extensions, CAPA — with what the reference QMS adds for
-- a non-conformance. NCRs raised before 0076 are untouched.
--
--   Assessment
--   · **Defect type** instead of the deviation categories: 12 NCR types
--     (`nc_category`, list extended), "Other" asks a description
--     (`category_other`). **NCR red flags** (`red_flags`, list extended).
--     Severity on the same 1–5 scale and table, with NCR wording (UI).
--   · **The investigation cannot be skipped** once the material may be in a
--     batch: any batch named, or found in dispensing, in-process, QC testing
--     or stability testing.
--
--   Investigation
--   · **Required review items**: Specification and Certificate of analysis
--     (+ Batch record when a batch is named) for a material; Specification
--     and Batch record for a product; Specification otherwise.
--   · **Laboratory check** when found at QC testing (`lab_check` Yes / In
--     progress / No, `lab_ref`): submitting needs Yes and the reference
--     (FDA OOS guidance). A lab error (No) means the result is invalid — the
--     case is closed as not a non-conformance.
--
--   Actions
--   · **Disposition** (`ncr_disposition`): use as is (concession — scope,
--     why, customer concession and its reference), sort (sorting record,
--     quantities accepted and rejected), rework (instruction, re-test Pass),
--     reject – destroy, return to supplier. QA **signs** it with
--     `sign_ncr_disposition` — it needs the assessment signed, the product
--     impact assessment unless rejecting, and the lab error ruled out — and
--     signing **releases or rejects** the quarantined lots (a material) or
--     the held batches (anything else), marked `by_disposition`.
--     `reopen_ncr_disposition` changes it with a reason and puts those holds
--     back on hold. The follow-up record — destruction record or return
--     note / RMA — is written after signing. Files go under the new
--     attachment section `disposition`.
--   · **Supplier** (a material): notified on, claim or credit, corrective
--     action requested (SCAR) Yes / No (+ why not) — reference, reply due,
--     reply received, accepted / not accepted (not accepted needs a CAPA) —
--     and tightened inspection for the next lots (+ how many). Client-
--     supplied: the customer, by the same columns.
--   · **Customer (brand owner) notification** (finished product): notified
--     on, or not needed with a reason.
--   · Closing (and a Critical case's first signature) needs all of it:
--     `deviations_ncr_guard`.
--
--   Close — not a non-conformance
--   · `close_ncr_not_a_case(case, reason, name)`: before the assessment is
--     signed, or once the lab check found a lab error. Live holds are
--     released; the case closes with reason "Not a non-conformance". The
--     other close-time guards stand aside for it (`factoryos.not_case`).
--
--   Everything else a deviation has now covers an NCR: the close-out guard,
--   due date extensions, "recurring needs a CAPA", and a CAPA's plan waits
--   for each NCR's investigation to be approved (`capas_ncr_investigation_guard`).

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.deviations
  add column if not exists category_other              text,
  add column if not exists lab_check                   text,
  add column if not exists lab_ref                     text,
  add column if not exists ncr_disposition             text,
  add column if not exists concession_scope            text,
  add column if not exists disposition_reason          text,
  add column if not exists concession                  text,
  add column if not exists concession_ref              text,
  add column if not exists sort_ref                    text,
  add column if not exists sort_accepted               text,
  add column if not exists sort_rejected               text,
  add column if not exists rework_instruction          text,
  add column if not exists retest_result               text,
  add column if not exists disposition_signed_at       timestamptz,
  add column if not exists disposition_signed_by       uuid references public.profiles (id) on delete set null,
  add column if not exists disposition_signed_by_name  text,
  add column if not exists disposition_reopen_reason   text,
  add column if not exists destruction_ref             text,
  add column if not exists return_ref                  text,
  add column if not exists supplier_notified_on        date,
  add column if not exists supplier_claim              text,
  add column if not exists scar_requested              boolean,
  add column if not exists scar_not_reason             text,
  add column if not exists scar_ref                    text,
  add column if not exists scar_due                    date,
  add column if not exists scar_reply_on               date,
  add column if not exists scar_accepted               boolean,
  add column if not exists tightened_inspection        boolean,
  add column if not exists tightened_lots              text,
  add column if not exists customer_notify             text,
  add column if not exists customer_notified_on        date,
  add column if not exists customer_notify_reason      text,
  add column if not exists not_case_reason             text;

alter table public.deviations drop constraint if exists deviations_lab_check_known;
alter table public.deviations add constraint deviations_lab_check_known
  check (lab_check is null or lab_check in ('Yes', 'In progress', 'No'));

alter table public.deviations drop constraint if exists deviations_ncr_disposition_known;
alter table public.deviations add constraint deviations_ncr_disposition_known
  check (ncr_disposition is null or ncr_disposition in ('use_as_is', 'sort', 'rework', 'destroy', 'return'));

alter table public.deviations drop constraint if exists deviations_concession_known;
alter table public.deviations add constraint deviations_concession_known
  check (concession is null or concession in ('not_needed', 'customer'));

alter table public.deviations drop constraint if exists deviations_retest_known;
alter table public.deviations add constraint deviations_retest_known
  check (retest_result is null or retest_result in ('Pass', 'Fail'));

alter table public.deviations drop constraint if exists deviations_customer_notify_known;
alter table public.deviations add constraint deviations_customer_notify_known
  check (customer_notify is null or customer_notify in ('yes', 'not_needed'));

-- The NCR defect types beside the deviation categories ("Other" is in both).
alter table public.deviations drop constraint if exists deviations_nc_category_known;
alter table public.deviations add constraint deviations_nc_category_known check (
  nc_category is null or nc_category in (
    'Formulation / batch formula', 'Dispensing / weighing', 'Manufacturing process',
    'Equipment', 'Facility & utilities', 'Cleaning / line clearance',
    'Environmental monitoring', 'Materials (raw / packaging)', 'Labelling & packaging',
    'Laboratory testing (OOS / OOT)', 'Documentation & data integrity',
    'Storage & distribution', 'Other',
    -- NCR defect types (0077)
    'Wrong material or identity', 'Assay or potency out of specification',
    'Physical or dimensional defect', 'Foreign matter or contamination',
    'Microbiological', 'Damaged in transit', 'Labelling or printing error',
    'CoA or documentation error', 'Short or over delivery',
    'Expired or short shelf life', 'Storage conditions not met'
  )
);

-- The NCR red flags beside the deviation ones.
alter table public.deviations drop constraint if exists deviations_red_flags_known;
alter table public.deviations add constraint deviations_red_flags_known check (
  red_flags <@ array[
    'Product mix-up', 'Wrong identity or strength', 'Suspected contamination',
    'Potential recall', 'Data integrity concern',
    -- NCR (0077)
    'Wrong material or identity', 'Material already used in released product',
    'Unapproved or unqualified supplier', 'Suspected falsified material or CoA'
  ]::text[]
);

alter table public.deviations drop constraint if exists deviations_status_reason_known;
alter table public.deviations add constraint deviations_status_reason_known check (
  status_reason is null or status_reason in (
    'Resolved', 'No action required', 'Duplicate',
    'Problem solved', 'Information provided', 'Cancelled',
    'Not a non-conformance'
  )
);

alter table public.deviation_attachments drop constraint if exists deviation_attachments_section_known;
alter table public.deviation_attachments add constraint deviation_attachments_section_known check (
  section in ('details', 'assessment', 'investigation', 'actions', 'closeout', 'disposition')
);

-- A hold the disposition decided — put back on hold if the disposition changes.
alter table public.deviation_batch_holds
  add column if not exists by_disposition boolean not null default false;

-- ── 2. Helpers ───────────────────────────────────────────────────────────

/** A deviation, or an NCR raised on the qms-v12 form — the case the QMS walks. */
create or replace function public.is_qms_case(p_type text, p_nc_item text)
returns boolean
language sql
immutable
as $$
  select p_type in ('planned', 'unplanned') or (p_type = 'ncr' and p_nc_item is not null);
$$;

create or replace function public.ncr_disposition_label(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'use_as_is' then 'Use as is (concession)'
    when 'sort'      then 'Sort — use good, reject the rest'
    when 'rework'    then 'Rework'
    when 'destroy'   then 'Reject – destroy'
    when 'return'    then 'Return to supplier'
  end;
$$;

/** What the chosen disposition still needs before it is signed, or null. */
create or replace function public.ncr_disposition_missing(d public.deviations)
returns text
language plpgsql
stable
as $fn$
declare
  m text[] := '{}';
  blank constant text := '';
begin
  if d.ncr_disposition is null then
    return 'the disposition';
  end if;
  if d.ncr_disposition = 'use_as_is' then
    if coalesce(btrim(d.concession_scope), blank) = blank then m := m || 'scope of the concession'; end if;
    if coalesce(btrim(d.disposition_reason), blank) = blank then m := m || 'why it can be used as is'; end if;
    if d.concession is null then m := m || 'customer concession'; end if;
    if d.concession = 'customer' and coalesce(btrim(d.concession_ref), blank) = blank then
      m := m || 'concession reference';
    end if;
  elsif d.ncr_disposition = 'sort' then
    if coalesce(btrim(d.sort_ref), blank) = blank then m := m || 'sorting record'; end if;
    if coalesce(btrim(d.sort_accepted), blank) = blank then m := m || 'quantity accepted'; end if;
    if coalesce(btrim(d.sort_rejected), blank) = blank then m := m || 'quantity rejected'; end if;
  elsif d.ncr_disposition = 'rework' then
    if coalesce(btrim(d.rework_instruction), blank) = blank then m := m || 'rework instruction'; end if;
    if d.retest_result is distinct from 'Pass' then m := m || 'a passing re-test'; end if;
  end if;
  return nullif(array_to_string(m, ', '), '');
end;
$fn$;

/** A material's supplier follow-up, or the reason it is not complete. */
create or replace function public.ncr_supplier_missing(d public.deviations)
returns text
language plpgsql
stable
as $fn$
declare
  party text := case d.supplied_by when 'customer' then 'customer' else 'supplier' end;
begin
  if d.nc_item not in ('Raw material', 'Packaging material') then
    return null;
  end if;
  if d.supplier_notified_on is null then return party || ' notification'; end if;
  if d.scar_requested is null then return 'whether a corrective action is requested from the ' || party; end if;
  if d.scar_requested = false and coalesce(btrim(d.scar_not_reason), '') = '' then
    return 'why no corrective action is requested';
  end if;
  if d.scar_requested then
    if coalesce(btrim(d.scar_ref), '') = '' then return 'the corrective action request reference'; end if;
    if d.scar_reply_on is null then return party || ' reply'; end if;
    if d.scar_accepted is null then return 'whether the ' || party || '’s root cause and fix are accepted'; end if;
    if d.scar_accepted = false and d.capa_needed is distinct from true then
      return 'a CAPA (the ' || party || '’s fix was not accepted)';
    end if;
  end if;
  if d.tightened_inspection is null then return 'whether inspection is tightened'; end if;
  if d.tightened_inspection and coalesce(btrim(d.tightened_lots), '') = '' then
    return 'for how many lots inspection is tightened';
  end if;
  return null;
end;
$fn$;

-- ── 3. The NCR's own guard — disposition and close ───────────────────────

create or replace function public.deviations_ncr_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  signing  boolean := coalesce(current_setting('factoryos.ncr_disposition', true), '') = 'on';
  not_case boolean := coalesce(current_setting('factoryos.not_case', true), '') = 'on';
  missing  text;
begin
  if new.type::text <> 'ncr' or new.nc_item is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.disposition_signed_at      := null;
    new.disposition_signed_by      := null;
    new.disposition_signed_by_name := null;
    new.not_case_reason            := null;
    return new;
  end if;

  if old.status = 'closed' then
    return new;  -- deviations_guard freezes a closed case.
  end if;

  -- ── The signature is the functions' ──
  if not signing and (
       new.disposition_signed_at is distinct from old.disposition_signed_at
    or new.disposition_signed_by_name is distinct from old.disposition_signed_by_name
    or new.disposition_reopen_reason is distinct from old.disposition_reopen_reason) then
    raise exception 'The disposition is signed with Record disposition, and changed with a reason.'
      using errcode = 'check_violation';
  end if;
  if not not_case and new.not_case_reason is distinct from old.not_case_reason then
    raise exception 'Close it as not a non-conformance with its own button.'
      using errcode = 'check_violation';
  end if;

  -- ── Signed: the decision is fixed ──
  if not signing and old.disposition_signed_at is not null and (
       new.ncr_disposition    is distinct from old.ncr_disposition
    or new.concession_scope   is distinct from old.concession_scope
    or new.disposition_reason is distinct from old.disposition_reason
    or new.concession         is distinct from old.concession
    or new.concession_ref     is distinct from old.concession_ref
    or new.sort_ref           is distinct from old.sort_ref
    or new.sort_accepted      is distinct from old.sort_accepted
    or new.sort_rejected      is distinct from old.sort_rejected
    or new.rework_instruction is distinct from old.rework_instruction
    or new.retest_result      is distinct from old.retest_result) then
    raise exception 'The disposition of % is signed — change it with a reason.', old.deviation_no
      using errcode = 'check_violation';
  end if;

  -- ── Closing, or a Critical case's first signature ──
  if not not_case and (
       (old.status = 'open' and new.status = 'closed')
    or (old.close_first_signed_at is null and new.close_first_signed_at is not null)) then
    if new.disposition_signed_at is null then
      raise exception 'Record the disposition before closing.'
        using errcode = 'check_violation';
    end if;
    missing := public.ncr_disposition_missing(new);
    if missing is not null then
      raise exception 'The disposition still needs: %.', missing
        using errcode = 'check_violation';
    end if;
    if new.ncr_disposition = 'destroy' and coalesce(btrim(new.destruction_ref), '') = '' then
      raise exception 'Record the destruction record before closing.'
        using errcode = 'check_violation';
    end if;
    if new.ncr_disposition = 'return' and coalesce(btrim(new.return_ref), '') = '' then
      raise exception 'Record the return note / RMA before closing.'
        using errcode = 'check_violation';
    end if;
    missing := public.ncr_supplier_missing(new);
    if missing is not null then
      raise exception 'Complete the % follow-up before closing — %.',
        case new.supplied_by when 'customer' then 'customer' else 'supplier' end, missing
        using errcode = 'check_violation';
    end if;
    if new.nc_item = 'Finished product' and not (
         (new.customer_notify = 'yes' and new.customer_notified_on is not null)
      or (new.customer_notify = 'not_needed' and coalesce(btrim(new.customer_notify_reason), '') <> '')) then
      raise exception 'Record the customer (brand owner) notification, or why it is not needed, before closing.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists deviations_ncr_guard on public.deviations;
create trigger deviations_ncr_guard
  before insert or update on public.deviations
  for each row execute function public.deviations_ncr_guard();

-- ── 4. Signing the disposition ───────────────────────────────────────────

create or replace function public.sign_ncr_disposition(p_case uuid, p_by_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target   public.deviations%rowtype;
  missing  text;
  rej      boolean;
  material boolean;
  label    text;
begin
  select * into target from public.deviations where id = p_case for update;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only QA approvers record the disposition.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.type::text <> 'ncr' or target.nc_item is null then
    raise exception 'A disposition is recorded on a non-conformance.' using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if target.assessed_at is null then
    raise exception 'Sign the initial assessment first.' using errcode = 'check_violation';
  end if;
  if target.disposition_signed_at is not null then
    raise exception 'The disposition is already recorded — change it with a reason.'
      using errcode = 'check_violation';
  end if;
  if target.ncr_disposition = 'rework' and target.retest_result = 'Fail' then
    raise exception 'The re-test failed — choose Reject or Return to supplier.'
      using errcode = 'check_violation';
  end if;
  missing := public.ncr_disposition_missing(target);
  if missing is not null then
    raise exception 'Still needed: %.', missing using errcode = 'check_violation';
  end if;

  rej := target.ncr_disposition in ('destroy', 'return');
  if not rej and target.investigation_required is distinct from false
     and coalesce(btrim(target.impact), '') = '' then
    raise exception 'Record the product impact assessment on the Investigation tab first.'
      using errcode = 'check_violation';
  end if;
  if target.detection_point = 'QC testing' and target.lab_check is distinct from 'Yes' then
    raise exception 'Rule out a lab error first (Investigation → Laboratory check).'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Signing needs a name against it.' using errcode = 'check_violation';
  end if;

  perform set_config('factoryos.ncr_disposition', 'on', true);
  update public.deviations
  set disposition_signed_at      = now(),
      disposition_signed_by      = auth.uid(),
      disposition_signed_by_name = btrim(p_by_name),
      disposition_reopen_reason  = null
  where id = p_case;
  perform set_config('factoryos.ncr_disposition', '', true);

  -- The decision releases or rejects what it covers: a material's lots, or
  -- anything else's batches.
  material := target.nc_item in ('Raw material', 'Packaging material');
  label := public.ncr_disposition_label(target.ncr_disposition);
  update public.deviation_batch_holds
  set status          = case when rej then 'rejected' else 'released' end,
      decided_at      = now(),
      decided_by      = auth.uid(),
      decided_by_name = btrim(p_by_name),
      reason          = 'Disposition: ' || label,
      by_disposition  = true
  where deviation_id = p_case
    and status = 'on_hold'
    and (not material or kind = 'lot');
end;
$fn$;

revoke all on function public.sign_ncr_disposition(uuid, text) from public;
grant execute on function public.sign_ncr_disposition(uuid, text) to authenticated;

/** Change a signed disposition: a reason, and its holds go back on hold. */
create or replace function public.reopen_ncr_disposition(p_case uuid, p_reason text, p_by_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
begin
  select * into target from public.deviations where id = p_case for update;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only QA approvers change the disposition.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if target.disposition_signed_at is null then
    raise exception 'The disposition is not recorded yet.' using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'Say why the disposition is changing.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The change needs a name against it.' using errcode = 'check_violation';
  end if;

  perform set_config('factoryos.ncr_disposition', 'on', true);
  update public.deviations
  set disposition_signed_at      = null,
      disposition_signed_by      = null,
      disposition_signed_by_name = null,
      disposition_reopen_reason  = btrim(p_reason)
  where id = p_case;
  perform set_config('factoryos.ncr_disposition', '', true);

  update public.deviation_batch_holds
  set status          = 'on_hold',
      decided_at      = null,
      decided_by      = null,
      decided_by_name = null,
      reason          = null,
      by_disposition  = false
  where deviation_id = p_case and by_disposition;
end;
$fn$;

revoke all on function public.reopen_ncr_disposition(uuid, text, text) from public;
grant execute on function public.reopen_ncr_disposition(uuid, text, text) to authenticated;

-- ── 5. Close — not a non-conformance ─────────────────────────────────────

create or replace function public.close_ncr_not_a_case(p_case uuid, p_reason text, p_by_name text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
begin
  select * into target from public.deviations where id = p_case for update;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only QA approvers close a case as not a non-conformance.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.type::text <> 'ncr' or target.nc_item is null then
    raise exception 'Only a non-conformance is closed this way.' using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is already closed.', target.deviation_no using errcode = 'check_violation';
  end if;
  if target.assessed_at is not null and target.lab_check is distinct from 'No' then
    raise exception 'The initial assessment is signed — it is closed as not a non-conformance only when the lab check found a lab error.'
      using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'Say why this is not a non-conformance.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Closing needs a name against it.' using errcode = 'check_violation';
  end if;

  perform set_config('factoryos.not_case', 'on', true);

  -- Nothing is held for a case that is not one.
  update public.deviation_batch_holds
  set status          = 'released',
      decided_at      = now(),
      decided_by      = auth.uid(),
      decided_by_name = btrim(p_by_name),
      reason          = 'Closed — not a non-conformance: ' || btrim(p_reason)
  where deviation_id = p_case and status = 'on_hold';

  update public.deviations
  set status          = 'closed',
      status_reason   = 'Not a non-conformance',
      not_case_reason = btrim(p_reason),
      closing_note    = btrim(p_reason),
      qa_sign_name    = btrim(p_by_name)
  where id = p_case;

  perform set_config('factoryos.not_case', '', true);
end;
$fn$;

revoke all on function public.close_ncr_not_a_case(uuid, text, text) from public;
grant execute on function public.close_ncr_not_a_case(uuid, text, text) to authenticated;

-- ── 6. Holds — the card again when a hold returns, and its trail ─────────

create or replace function public.deviation_batch_holds_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'on_hold' and new.product_id is not null
     and (tg_op = 'INSERT' or old.status <> 'on_hold') then
    update public.pipeline_jobs
    set status      = 'hold',
        hold_reason = 'Quality',
        held_at     = case when status <> 'hold' then now() else held_at end
    where product_id = new.product_id
      and status <> 'finished';
  end if;
  return null;
end;
$$;

drop trigger if exists deviation_batch_holds_card on public.deviation_batch_holds;
create trigger deviation_batch_holds_card
  after insert or update on public.deviation_batch_holds
  for each row execute function public.deviation_batch_holds_card();

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
  elsif old.status <> 'on_hold' and new.status = 'on_hold' then
    -- Back on hold: the disposition it was decided by was changed.
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, old_value, new_value, reason)
    values (new.factory_id, new.deviation_id, auth.uid(), public.audit_actor_name(),
            'hold_restored', old.status, new.batch_no,
            (select d.disposition_reopen_reason from public.deviations d where d.id = new.deviation_id));
  end if;
  return null;
end;
$fn$;

-- ── 7. Extensions, recurring cases and CAPA plans — an NCR too ───────────

create or replace function public.capas_ncr_investigation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  pending text;
begin
  if old.plan_approved_at is null and new.plan_approved_at is not null then
    select string_agg(d.deviation_no, ', ' order by d.created_at) into pending
    from public.deviations d
    where d.capa_id = new.id
      and d.type::text = 'ncr' and d.nc_item is not null
      and d.investigation_required is distinct from false
      and d.investigation_approved_at is null;
    if pending is not null then
      raise exception 'Still needed before the plan can be approved: investigation approved on %.', pending
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists capas_ncr_investigation_guard on public.capas;
create trigger capas_ncr_investigation_guard
  before update on public.capas
  for each row execute function public.capas_ncr_investigation_guard();

-- ── 8. The case guard — an NCR closes as a deviation does ──────────────
-- 0076's, with: an NCR on the qms-v12 form is scored and assessed as a
-- deviation is (no detection, no financial impact), and a case closed as not
-- a non-conformance needs only its signature.

create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['product_id', 'action_id', 'capa_id', 'created_by', 'closed_by', 'department_id', 'disposition_signed_by'];
  linked  public.capas%rowtype;
  src     text[];
  missing text;
  qms     boolean := public.is_qms_case(new.type::text, new.nc_item);
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
  -- Closed as not a non-conformance (0077): only the signature is needed.
  if new.status = 'closed' and coalesce(current_setting('factoryos.not_case', true), '') = 'on' then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
    return new;
  end if;

  if new.status = 'closed' then
    if coalesce(btrim(new.immediate_action), '') = '' then
      raise exception 'Record the immediate action taken before closing.'
        using errcode = 'check_violation';
    end if;

    if qms and new.assessed_at is null then
      raise exception 'Sign the initial assessment before closing.'
        using errcode = 'check_violation';
    end if;

    if new.likelihood is null or new.severity is null
       or (new.detection is null and not qms) then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null
       and not qms then
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

-- ── 9. The initial assessment — an NCR's defect type, flags, investigation ─
-- 0071's, with the NCR's rules added (and the type gate widened).

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
  if new.department_id is null or new.occurred_at is null
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
  new.sla_date := (old.created_at)::date
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

-- ── 10. The investigation — required items and the lab check ─────────────
-- 0070's, with the NCR's rules added.

create or replace function public.deviations_investigation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  answers_changed boolean;
  missing         text;
  required        text[];
begin
  if not public.is_qms_case(new.type::text, new.nc_item) then
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
    or new.rca_method             is distinct from old.rca_method
    or new.lab_check              is distinct from old.lab_check
    or new.lab_ref                is distinct from old.lab_ref;

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
      -- ── A non-conformance (0077) ──
      if new.type::text = 'ncr' then
        if new.detection_point = 'QC testing' then
          if new.lab_check is null then
            raise exception 'Say whether a lab error was ruled out (Laboratory check).'
              using errcode = 'check_violation';
          end if;
          if new.lab_check = 'No' then
            raise exception 'A lab error was found: close the case as not a non-conformance.'
              using errcode = 'check_violation';
          end if;
          if new.lab_check = 'In progress' then
            raise exception 'Finish the lab investigation first.'
              using errcode = 'check_violation';
          end if;
          if coalesce(btrim(new.lab_ref), '') = '' then
            raise exception 'Give the lab investigation reference.'
              using errcode = 'check_violation';
          end if;
        end if;
        required := case
          when new.nc_item in ('Raw material', 'Packaging material') then
            array['Specification', 'Certificate of analysis']
            || case when cardinality(new.batch_nos) > 0 then array['Batch record'] else '{}'::text[] end
          when new.nc_item in ('Bulk or intermediate', 'Finished product') then
            array['Specification', 'Batch record']
          else array['Specification']
        end;
        select string_agg(r, ', ') into missing
        from unnest(required) as r
        where not exists (
          select 1 from jsonb_array_elements(new.review_checks) e
          where lower(btrim(e ->> 'item')) = lower(r)
        );
        if missing is not null then
          raise exception 'Also review: %.', missing using errcode = 'check_violation';
        end if;
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
     and not coalesce(current_setting('factoryos.not_case', true), '') = 'on'
     and new.investigation_required is distinct from false
     and new.investigation_approved_at is null then
    raise exception 'Approve the investigation before closing.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- ── 11. The close-out — an NCR's too ────────────────────────────────────
-- 0065's, the type gate widened; not-a-case closing passes.

create or replace function public.deviations_closeout_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_qms_case(new.type::text, new.nc_item) then
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
  if new.status = 'closed' and not coalesce(current_setting('factoryos.not_case', true), '') = 'on' then
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

-- ── 12. No closing over a live hold — except not a case ─────────────────

create or replace function public.deviations_holds_close_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  live text;
begin
  if new.type::text not in ('planned', 'unplanned', 'ncr') or coalesce(current_setting('factoryos.not_case', true), '') = 'on' then
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

-- ── 13. A recurring NCR needs a CAPA too ────────────────────────────────

create or replace function public.deviations_capa_required_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  linked public.capas%rowtype;
begin
  if public.is_qms_case(new.type::text, new.nc_item)
     and new.status = 'open'
     and new.assessed_at is not null
     and new.detection is null
     and new.likelihood = 3
     and new.capa_needed is false
     and new.capa_needed is distinct from old.capa_needed then
    raise exception 'A recurring problem (likelihood 3) needs a CAPA — answer Yes.'
      using errcode = 'check_violation';
  end if;

  if old.capa_id is not null and new.capa_id is distinct from old.capa_id then
    select * into linked from public.capas where id = old.capa_id;
    if found
       and linked.status::text = 'open'
       and not exists (
         select 1 from public.deviations o
         where o.capa_id = old.capa_id and o.id <> old.id
       ) then
      if linked.plan_approved_at is null then
        raise exception '% was raised for this case only — withdraw it first.', linked.capa_no
          using errcode = 'check_violation';
      end if;
      raise exception '% covers only this case and its plan is approved — the case stays on it.', linked.capa_no
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

-- ── 14. Due date extensions — an NCR's too ──────────────────────────────

create or replace function public.request_due_extension(
  p_case     uuid,
  p_to       date,
  p_reason   text,
  p_by_name  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
  new_id uuid;
begin
  select * into target from public.deviations where id = p_case for update;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can ask to extend a due date.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.is_qms_case(target.type::text, target.nc_item) then
    raise exception 'Due date extensions are for deviations and non-conformances.'
      using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if target.assessed_at is null or target.sla_date is null then
    raise exception 'The due date is set when the initial assessment is signed — sign it first.'
      using errcode = 'check_violation';
  end if;
  if p_to is null or p_to <= target.sla_date then
    raise exception 'Pick a date after the current due date (%).', to_char(target.sla_date, 'DD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'Give the reason more time is needed.'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The request needs a name against it.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.deviation_due_extensions
    where deviation_id = p_case and status = 'requested'
  ) then
    raise exception 'An extension of % is already waiting for a decision.', target.deviation_no
      using errcode = 'check_violation';
  end if;

  insert into public.deviation_due_extensions
    (factory_id, deviation_id, from_date, to_date, reason, requested_by, requested_by_name)
  values
    (target.factory_id, p_case, target.sla_date, p_to, btrim(p_reason), auth.uid(), btrim(p_by_name))
  returning id into new_id;

  return new_id;
end;
$fn$;

-- ── 15. The audit trail — the disposition's signature ───────────────────
-- 0066's, with the disposition signed / reopened as events.

create or replace function public.deviations_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who      uuid := auth.uid();
  who_name text := public.audit_actor_name();
  skip     text[] := array[
    'id', 'factory_id', 'deviation_no', 'type', 'created_at', 'created_by',
    -- resolved or mirrored by the triggers
    'product_id', 'product_ids', 'risk_assessed_at', 'investigated_at',
    -- signatures and steps, logged as events below
    'status', 'closed_at', 'closed_by', 'qa_sign_name',
    'assessed_at', 'assessed_by', 'assessed_by_name',
    'investigation_submitted_at', 'investigation_submitted_by_name',
    'investigation_returned_at', 'investigation_returned_by_name',
    'investigation_return_reason',
    'investigation_approved_at', 'investigation_approved_by',
    'investigation_approved_by_name',
    'close_first_signed_at', 'close_first_signed_by', 'close_first_signed_by_name',
    -- the disposition's signature and a not-a-case close (0077)
    'disposition_signed_at', 'disposition_signed_by', 'disposition_signed_by_name',
    'disposition_reopen_reason', 'not_case_reason'
  ];
  ev public.deviation_audit%rowtype;
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value)
    values
      (new.factory_id, new.id, who, coalesce(nullif(btrim(new.raised_by), ''), who_name),
       'raised', new.deviation_no);
    return null;
  end if;

  -- `batch_no` mirrors the first of `batch_nos`; log it only on its own.
  if new.batch_nos is distinct from old.batch_nos then
    skip := skip || array['batch_no'];
  end if;

  insert into public.deviation_audit
    (factory_id, deviation_id, actor, actor_name, action, field, old_value, new_value)
  select new.factory_id, new.id, who, who_name, 'changed', n.key,
         public.audit_text(o.value), public.audit_text(n.value)
  from jsonb_each(to_jsonb(new)) n
    left join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key <> all (skip)
    -- '{}' → '{}' and null → '' are not changes anyone made.
    and public.audit_text(n.value) is distinct from public.audit_text(o.value);

  -- ── Events ──
  if old.assessed_at is null and new.assessed_at is not null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value)
    values (new.factory_id, new.id, who, coalesce(new.assessed_by_name, who_name),
            'assessment_signed', new.classification);
  end if;

  if old.investigation_approved_at is null and new.investigation_approved_at is not null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action)
    values (new.factory_id, new.id, who,
            coalesce(new.investigation_approved_by_name, who_name), 'investigation_approved');
  elsif old.investigation_submitted_at is null and new.investigation_submitted_at is not null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action)
    values (new.factory_id, new.id, who,
            coalesce(new.investigation_submitted_by_name, who_name), 'investigation_submitted');
  elsif old.investigation_submitted_at is not null and new.investigation_submitted_at is null
        and new.investigation_approved_at is null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, reason)
    values (new.factory_id, new.id, who,
            coalesce(new.investigation_returned_by_name, who_name),
            'investigation_returned', new.investigation_return_reason);
  end if;

  if old.close_first_signed_at is null and new.close_first_signed_at is not null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action)
    values (new.factory_id, new.id, who,
            coalesce(new.close_first_signed_by_name, who_name), 'closeout_first_signed');
  end if;

  if old.disposition_signed_at is null and new.disposition_signed_at is not null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value)
    values (new.factory_id, new.id, who, coalesce(new.disposition_signed_by_name, who_name),
            'disposition_signed', public.ncr_disposition_label(new.ncr_disposition));
  elsif old.disposition_signed_at is not null and new.disposition_signed_at is null then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, old_value, reason)
    values (new.factory_id, new.id, who, who_name,
            'disposition_reopened', public.ncr_disposition_label(old.ncr_disposition),
            new.disposition_reopen_reason);
  end if;

  if old.status = 'open' and new.status = 'closed' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value, reason)
    values (new.factory_id, new.id, who, coalesce(new.qa_sign_name, who_name),
            'closed', new.status_reason, new.not_case_reason);
  end if;

  return null;
end;
$fn$;

-- ── 16. The case read model — the NCR's columns appended ────────────────

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
  d.hold_not_reason,

  -- ── Appended by 0077 ──────────────────────────────────────────────────
  d.category_other,
  d.lab_check,
  d.lab_ref,
  d.ncr_disposition,
  d.concession_scope,
  d.disposition_reason,
  d.concession,
  d.concession_ref,
  d.sort_ref,
  d.sort_accepted,
  d.sort_rejected,
  d.rework_instruction,
  d.retest_result,
  d.disposition_signed_at,
  d.disposition_signed_by_name,
  d.disposition_reopen_reason,
  d.destruction_ref,
  d.return_ref,
  d.supplier_notified_on,
  d.supplier_claim,
  d.scar_requested,
  d.scar_not_reason,
  d.scar_ref,
  d.scar_due,
  d.scar_reply_on,
  d.scar_accepted,
  d.tightened_inspection,
  d.tightened_lots,
  d.customer_notify,
  d.customer_notified_on,
  d.customer_notify_reason,
  d.not_case_reason
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

grant select on public.deviations_expanded to authenticated;
