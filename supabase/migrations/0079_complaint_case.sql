-- FactoryOS · Quality — a customer complaint's case, end to end (qms-v12)
--
-- Run after 0078.
--
-- A customer complaint walks the same case page as a deviation and an NCR,
-- with what the reference QMS (qms-v12, "v9" and "v11 — Customer
-- complaints") adds for one:
--
--   Raise
--   · Title; **date received** (`received_on` — due dates, the sponsor
--     notification and the acknowledgement count from it), received via;
--     **complainant** (who complained — our customer, a distributor, a
--     pharmacy or health professional, a consumer, other) and their contact;
--     **market (country)** — Australia by default; exported product reports
--     to Medsafe, the MHRA, the FDA or the national authority instead of the
--     TGA; batch number(s), or the **product** when the batch is unknown; the
--     brand owner (`customer_name`, from the batch); **who the sponsor is**
--     (`sponsor` us / the customer) and the **ARTG** number — asked on the
--     complaint for now; expiry; units affected (`qty_affected`); the
--     complaint description; **injury or adverse reaction** — Yes asks what,
--     and whether it is serious (serious ticks the red flag and starts the
--     case Critical, severity 5); the **complaint sample** (received /
--     requested / not available, + received on); immediate action (optional).
--   · Communication: **acknowledge by** received + `ack_days` — "Mark
--     acknowledged" records how (`ack_on`, `ack_by_name`, `ack_how`; late
--     needs how and why); a requested sample is **marked received**.
--
--   Assessment
--   · The complaint categories (`nc_category`, list extended; Other is
--     described), complaint red flags, severity and likelihood wording.
--   · "Investigation required?" Yes asks the **investigating department**
--     (`department_id`), No why.
--   · **Market impact and reporting**: could released stock be affected
--     (`stock_affected`); when the customer is the sponsor, **sponsor
--     notified on** (due received + `notify_urgent_days` with an adverse
--     reaction or red flag, else `notify_days`); a **regulator report** is
--     asked only when something points to it — an adverse reaction, a red
--     flag, suspected counterfeit or tampering, or (later) a recall or
--     defect correction: needed? (`reportable`, No → why), type (serious:
--     `tga_serious_days`, other: `tga_other_days`), due, reported on,
--     reference.
--   · The due date counts from the date received.
--
--   Investigation
--   · **Complaint confirmed?** at the top (`root_cause_conclusion`, for
--     trending); **scope** (isolated unit(s) / whole batch / other batches
--     too → which) instead of the product impact assessment; required review
--     items: Batch record and Retention sample when a batch is known,
--     Complaint sample when one was received.
--
--   Actions
--   · **Market action** first (`market_action`, URPTG terms: no market
--     action · quarantine stock · recall — class I / II / III, level
--     wholesale / hospital / retail / consumer, reference · product defect
--     correction · other action), with the decision and rationale.
--
--   Close-out
--   · **Final reply** to the complainant (`final_reply`, `reply_sent_on`,
--     `resolution` optional). Closing needs the acknowledgement, the market
--     action, the sponsor notified (when the customer is the sponsor), the
--     regulator report made (when one is needed) and the final reply sent:
--     `deviations_complaint_guard`.
--   · **Close — not a quality complaint** (enquiries, delivery, pricing):
--     before the assessment is signed, by `close_ncr_not_a_case`.
--
--   Settings: `factory_quality_settings` gains `ack_days` (2),
--   `notify_days` (3), `notify_urgent_days` (1), `tga_serious_days` (15),
--   `tga_other_days` (30), logged like the rest.
--
--   Every complaint opens on the case page from now on; the one raised
--   before keeps what it recorded (nothing is invented for it).

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.deviations
  add column if not exists received_on          date,
  add column if not exists complainant          text,
  add column if not exists complainant_contact  text,
  add column if not exists country              text,
  add column if not exists product_label        text,
  add column if not exists sponsor              text,
  add column if not exists artg_no              text,
  add column if not exists expiry               text,
  add column if not exists adverse_what         text,
  add column if not exists adverse_serious      boolean,
  add column if not exists sample               text,
  add column if not exists sample_received_on   date,
  add column if not exists ack_on               date,
  add column if not exists ack_by_name          text,
  add column if not exists ack_how              text,
  add column if not exists stock_affected       text,
  add column if not exists sponsor_notified_on  date,
  add column if not exists reportable           boolean,
  add column if not exists report_reason        text,
  add column if not exists report_type          text,
  add column if not exists report_due           date,
  add column if not exists reported_on          date,
  add column if not exists report_ref           text,
  add column if not exists scope                text,
  add column if not exists market_action        text,
  add column if not exists market_why           text,
  add column if not exists recall_class         text,
  add column if not exists recall_level         text,
  add column if not exists recall_ref           text,
  add column if not exists final_reply          text,
  add column if not exists reply_sent_on        date,
  add column if not exists resolution           text;

alter table public.deviations drop constraint if exists deviations_complaint_lists_known;
alter table public.deviations add constraint deviations_complaint_lists_known check (
      (complainant is null or complainant in (
        'Our customer (brand owner)', 'Distributor or wholesaler',
        'Pharmacy or health professional', 'Consumer', 'Other'))
  and (country is null or country in (
        'Australia', 'New Zealand', 'United Kingdom', 'European Union', 'United States', 'Other'))
  and (sponsor is null or sponsor in ('us', 'customer'))
  and (sample is null or sample in ('Received', 'Requested', 'Not available'))
  and (stock_affected is null or stock_affected in ('No', 'Yes', 'Unknown'))
  and (report_type is null or report_type in ('Serious adverse reaction', 'Other report'))
  and (scope is null or scope in ('Isolated unit(s)', 'Whole batch', 'Other batches too'))
  and (market_action is null or market_action in (
        'No market action', 'Quarantine stock (pending investigation)', 'Recall',
        'Product defect correction', 'Other action (product notification, safety alert)'))
  and (recall_class is null or recall_class in ('Class I', 'Class II', 'Class III'))
  and (recall_level is null or recall_level in ('Wholesale', 'Hospital', 'Retail', 'Consumer'))
  and (resolution is null or resolution in ('None', 'Replacement', 'Credit or refund'))
);

-- "Received via" — the reference's channels (Post and Walk-in added).
alter table public.deviations drop constraint if exists deviations_received_via_known;
alter table public.deviations add constraint deviations_received_via_known check (
  received_via is null
  or received_via in ('Phone', 'Email', 'Post', 'Walk-in', 'Distributor', 'Website', 'Other')
);

-- Complaint categories and red flags beside the others.
alter table public.deviations drop constraint if exists deviations_nc_category_known;
alter table public.deviations add constraint deviations_nc_category_known check (
  nc_category is null or nc_category in (
    'Formulation / batch formula', 'Dispensing / weighing', 'Manufacturing process',
    'Equipment', 'Facility & utilities', 'Cleaning / line clearance',
    'Environmental monitoring', 'Materials (raw / packaging)', 'Labelling & packaging',
    'Laboratory testing (OOS / OOT)', 'Documentation & data integrity',
    'Storage & distribution', 'Other',
    'Wrong material or identity', 'Assay or potency out of specification',
    'Physical or dimensional defect', 'Foreign matter or contamination',
    'Microbiological', 'Damaged in transit', 'Labelling or printing error',
    'CoA or documentation error', 'Short or over delivery',
    'Expired or short shelf life', 'Storage conditions not met',
    -- complaints (0079)
    'Cosmetic or appearance defect', 'Physical defect (broken, leaking, wrong count)',
    'Packaging or labelling error', 'Adverse reaction',
    'Product didn’t work (lack of effect)', 'Suspected counterfeit or tampering'
  )
);

alter table public.deviations drop constraint if exists deviations_red_flags_known;
alter table public.deviations add constraint deviations_red_flags_known check (
  red_flags <@ array[
    'Product mix-up', 'Wrong identity or strength', 'Suspected contamination',
    'Potential recall', 'Data integrity concern',
    'Wrong material or identity', 'Material already used in released product',
    'Unapproved or unqualified supplier', 'Suspected falsified material or CoA',
    -- complaints (0079)
    'Incorrect identity or strength', 'Counterfeit or tampering concern',
    'Serious adverse reaction'
  ]::text[]
);

alter table public.deviations drop constraint if exists deviations_status_reason_known;
alter table public.deviations add constraint deviations_status_reason_known check (
  status_reason is null or status_reason in (
    'Resolved', 'No action required', 'Duplicate',
    'Problem solved', 'Information provided', 'Cancelled',
    'Not a non-conformance', 'Not a quality complaint'
  )
);

-- ── 2. Settings for complaints ───────────────────────────────────────────

alter table public.factory_quality_settings
  add column if not exists ack_days           integer not null default 2,
  add column if not exists notify_days        integer not null default 3,
  add column if not exists notify_urgent_days integer not null default 1,
  add column if not exists tga_serious_days   integer not null default 15,
  add column if not exists tga_other_days     integer not null default 30;

alter table public.factory_quality_settings drop constraint if exists factory_quality_settings_complaint_range;
alter table public.factory_quality_settings add constraint factory_quality_settings_complaint_range check (
  ack_days between 1 and 30 and notify_days between 1 and 30
  and notify_urgent_days between 1 and 30
  and tga_serious_days between 1 and 90 and tga_other_days between 1 and 90
);

/** Days to acknowledge a complaint, from the factory's settings (default 2). */
create or replace function public.quality_ack_days(p_factory uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.ack_days, 2)
  from (select 1) as one
    left join public.factory_quality_settings s on s.factory_id = p_factory;
$$;

create or replace function public.factory_quality_settings_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who       text := public.audit_actor_name();
  p_crit    integer := 15;
  p_major   integer := 30;
  p_minor   integer := 60;
  p_assess  integer := 2;
  p_ack     integer := 2;
  p_notify  integer := 3;
  p_urgent  integer := 1;
  p_tga_s   integer := 15;
  p_tga_o   integer := 30;
begin
  if tg_op = 'UPDATE' then
    p_crit   := old.due_critical_days;
    p_major  := old.due_major_days;
    p_minor  := old.due_minor_days;
    p_assess := old.assess_days;
    p_ack    := old.ack_days;
    p_notify := old.notify_days;
    p_urgent := old.notify_urgent_days;
    p_tga_s  := old.tga_serious_days;
    p_tga_o  := old.tga_other_days;
  end if;

  insert into public.quality_settings_log (factory_id, actor, actor_name, setting, old_value, new_value)
  select new.factory_id, auth.uid(), who, c.setting, c.old_value, c.new_value
  from (values
    ('Critical — days to close',  p_crit::text,   new.due_critical_days::text, 1),
    ('Major — days to close',     p_major::text,  new.due_major_days::text,    2),
    ('Minor — days to close',     p_minor::text,  new.due_minor_days::text,    3),
    ('Initial assessment — days', p_assess::text, new.assess_days::text,       4),
    ('Complaint acknowledgement — days', p_ack::text, new.ack_days::text, 5),
    ('Other complaints — days to notify the sponsor', p_notify::text, new.notify_days::text, 6),
    ('Complaint with an adverse reaction or red flag — days to notify the sponsor', p_urgent::text, new.notify_urgent_days::text, 7),
    ('TGA report, serious adverse event — days', p_tga_s::text, new.tga_serious_days::text, 8),
    ('TGA report, other — days', p_tga_o::text, new.tga_other_days::text, 9)
  ) as c(setting, old_value, new_value, ord)
  where c.old_value is distinct from c.new_value
  order by c.ord;

  return null;
end;
$fn$;

-- ── 3. Every complaint walks the case ────────────────────────────────────

create or replace function public.is_qms_case(p_type text, p_nc_item text)
returns boolean
language sql
immutable
as $$
  select p_type in ('planned', 'unplanned', 'complaint')
      or (p_type = 'ncr' and p_nc_item is not null);
$$;

/** Points to a regulator report: an adverse reaction, a red flag, counterfeit, a recall or defect correction. */
create or replace function public.complaint_report_triggered(d public.deviations)
returns boolean
language sql
immutable
as $$
  select d.adverse_reaction is true
      or cardinality(d.red_flags) > 0
      or d.nc_category = 'Suspected counterfeit or tampering'
      or d.market_action in ('Recall', 'Product defect correction');
$$;

-- ── 4. The complaint's own guard — raise, acknowledgement, close ─────────

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
    if new.sponsor is null then
      raise exception 'Say who the sponsor is — us, or the customer.' using errcode = 'check_violation';
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

drop trigger if exists deviations_complaint_guard on public.deviations;
create trigger deviations_complaint_guard
  before insert or update on public.deviations
  for each row execute function public.deviations_complaint_guard();

-- ── 5. The case guard — a complaint's immediate action is optional ──────
-- 0077's, one rule changed.

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
    if coalesce(btrim(new.immediate_action), '') = '' and new.type::text <> 'complaint' then
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

-- ── 6. The initial assessment — a complaint's categories, flags, reporting ─
-- 0077's, with the complaint's rules added.

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
       or new.country is null or new.sponsor is null or new.adverse_reaction is null
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

-- ── 7. The investigation — a complaint's scope and required items ───────
-- 0077's, with the complaint's rules added.

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
    or new.lab_ref                is distinct from old.lab_ref
    or new.scope                  is distinct from old.scope;

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
      if new.type::text = 'complaint' then
        -- A complaint is scoped, not impact-assessed (0079).
        if new.scope is null then
          raise exception 'Say how far the problem goes — the scope.' using errcode = 'check_violation';
        end if;
        if new.scope = 'Other batches too' and cardinality(new.other_batch_nos) = 0 then
          raise exception 'Name the other batches affected.' using errcode = 'check_violation';
        end if;
        required := (case when cardinality(new.batch_nos) > 0
                          then array['Batch record', 'Retention sample'] else '{}'::text[] end)
                 || (case when new.sample = 'Received' then array['Complaint sample'] else '{}'::text[] end);
        select string_agg(r, ', ') into missing
        from unnest(required) as r
        where not exists (
          select 1 from jsonb_array_elements(new.review_checks) e
          where lower(btrim(e ->> 'item')) = lower(r)
        );
        if missing is not null then
          raise exception 'Also review: %.', missing using errcode = 'check_violation';
        end if;
      elsif length(coalesce(btrim(new.impact), '')) < 5 then
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

-- ── 8. Holds — a complaint's too ────────────────────────────────────────

create or replace function public.deviations_holds_close_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  live text;
begin
  if new.type::text not in ('planned', 'unplanned', 'ncr', 'complaint') or coalesce(current_setting('factoryos.not_case', true), '') = 'on' then
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
  if target.type::text not in ('planned', 'unplanned', 'ncr', 'complaint') then
    raise exception 'Batch holds are kept on deviations, non-conformances and complaints.'
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
     and target.type::text = 'complaint' and target.scope is null then
    raise exception 'Record the scope on the Investigation tab first.'
      using errcode = 'check_violation';
  end if;
  if p_decision = 'released'
     and target.investigation_required is distinct from false
     and target.type::text <> 'complaint'
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

-- ── 9. Close — not a quality complaint ──────────────────────────────────
-- 0077's, a complaint admitted before its assessment.

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
  if not ((target.type::text = 'ncr' and target.nc_item is not null)
          or target.type::text = 'complaint') then
    raise exception 'Only a non-conformance or a complaint is closed this way.'
      using errcode = 'check_violation';
  end if;
  -- A complaint only before its assessment (0079); an NCR also after a lab error.
  if target.type::text = 'complaint' and target.assessed_at is not null then
    raise exception 'The initial assessment is signed — it is no longer closed as not a quality complaint.'
      using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is already closed.', target.deviation_no using errcode = 'check_violation';
  end if;
  if target.assessed_at is not null and target.lab_check is distinct from 'No' then
    raise exception 'The initial assessment is signed — it is closed as not a non-conformance only when the lab check found a lab error.'
      using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'Say why this is not a %.',
      case target.type::text when 'complaint' then 'quality complaint' else 'non-conformance' end
      using errcode = 'check_violation';
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
      reason          = 'Closed — not a '
                        || case target.type::text when 'complaint' then 'quality complaint' else 'non-conformance' end
                        || ': ' || btrim(p_reason)
  where deviation_id = p_case and status = 'on_hold';

  update public.deviations
  set status          = 'closed',
      status_reason   = case target.type::text when 'complaint'
                          then 'Not a quality complaint' else 'Not a non-conformance' end,
      not_case_reason = btrim(p_reason),
      closing_note    = btrim(p_reason),
      qa_sign_name    = btrim(p_by_name)
  where id = p_case;

  perform set_config('factoryos.not_case', '', true);
end;
$fn$;

-- ── 10. A CAPA plan waits for a complaint's investigation ──────────────

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
      and ((d.type::text = 'ncr' and d.nc_item is not null) or d.type::text = 'complaint')
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

-- ── 11. The case read model — the complaint's columns appended ─────────

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
  d.not_case_reason,

  -- ── Appended by 0079 ──────────────────────────────────────────────────
  d.received_on,
  d.complainant,
  d.complainant_contact,
  d.country,
  d.product_label,
  d.sponsor,
  d.artg_no,
  d.expiry,
  d.adverse_what,
  d.adverse_serious,
  d.sample,
  d.sample_received_on,
  d.ack_on,
  d.ack_by_name,
  d.ack_how,
  d.stock_affected,
  d.sponsor_notified_on,
  d.reportable,
  d.report_reason,
  d.report_type,
  d.report_due,
  d.reported_on,
  d.report_ref,
  d.scope,
  d.market_action,
  d.market_why,
  d.recall_class,
  d.recall_level,
  d.recall_ref,
  d.final_reply,
  d.reply_sent_on,
  d.resolution
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

grant select on public.deviations_expanded to authenticated;
