-- FactoryOS · Quality — a deviation's investigation, and case attachments
--
-- Run after 0063.
--
-- The Investigation tab as the reference QMS (qms-v4) lays it out, for planned
-- and unplanned deviations, and files attached to a case.
--
--   · **Impact** — `other_batch_nos text[]` (other batches assessed) and the
--     product impact assessment, which is the existing `impact` column (it
--     was "Potential impact" on the NCR raise form).
--   · **What was reviewed** — `checks_reviewed text[]`, ticked from a fixed
--     list (batch record, equipment history, …).
--   · **Root cause** — findings (`investigation_findings`, as before);
--     `root_cause_categories text[]`, the 6M, several may be ticked, the first
--     ticked is the one trended (the older single `root_cause_category`, 5M,
--     stays for the cases that have it); when "Man (people)" is ticked, three
--     human-error questions (`human_procedure_clear`, `human_trained`,
--     `human_preventable`); the root cause; `root_cause_conclusion`
--     (Confirmed / Probable / Not confirmed); and the method (`rca_method`,
--     which gains "Simple review").
--   · **Submit → approve** — the owner submits the investigation
--     (`investigation_submitted_at` / `_by_name`), and QA approves it
--     (`investigation_approved_at` / `_by` / `_by_name`) or sends it back with
--     a reason (`investigation_returned_at` / `_by_name` / `investigation_return_reason`).
--     Submitted or approved, the investigation is read-only. Submitting needs
--     the signed initial assessment and every answer; a deviation that
--     requires an investigation cannot be closed until it is approved.
--
-- **Attachments** — `deviation_attachments`, one row per file, and a private
-- Storage bucket `case-files`. The browser uploads straight to Supabase
-- Storage — never through a Vercel function, whose request body is capped at
-- 4.5 MB — at `{factory_id}/{deviation_id}/{uuid}-{file name}`, then writes
-- the row. The bucket itself refuses anything over 10 MB or of a type not on
-- its list, whatever the client sent. Reading is by short-lived signed URL.

-- ── 1. Investigation columns ─────────────────────────────────────────────

alter table public.deviations
  add column if not exists other_batch_nos                  text[] not null default '{}',
  add column if not exists checks_reviewed                  text[] not null default '{}',
  add column if not exists root_cause_categories            text[] not null default '{}',
  add column if not exists human_procedure_clear            boolean,
  add column if not exists human_trained                    boolean,
  add column if not exists human_preventable                boolean,
  add column if not exists root_cause_conclusion            text,
  add column if not exists investigation_submitted_at       timestamptz,
  add column if not exists investigation_submitted_by_name  text,
  add column if not exists investigation_returned_at        timestamptz,
  add column if not exists investigation_returned_by_name   text,
  add column if not exists investigation_return_reason      text,
  add column if not exists investigation_approved_at        timestamptz,
  add column if not exists investigation_approved_by        uuid
    references public.profiles (id) on delete set null,
  add column if not exists investigation_approved_by_name   text;

alter table public.deviations
  drop constraint if exists deviations_checks_reviewed_known;
alter table public.deviations
  add constraint deviations_checks_reviewed_known check (
    checks_reviewed <@ array[
      'Batch record', 'Equipment history', 'Previous similar cases',
      'Environmental data', 'Raw material or packaging changes',
      'Training records', 'Other batches'
    ]::text[]
  );

alter table public.deviations
  drop constraint if exists deviations_root_cause_categories_known;
alter table public.deviations
  add constraint deviations_root_cause_categories_known check (
    root_cause_categories <@ array[
      'Man (people)', 'Machine', 'Method', 'Material', 'Measurement', 'Environment'
    ]::text[]
  );

alter table public.deviations
  drop constraint if exists deviations_root_cause_conclusion_known;
alter table public.deviations
  add constraint deviations_root_cause_conclusion_known check (
    root_cause_conclusion is null
    or root_cause_conclusion in ('Confirmed', 'Probable', 'Not confirmed')
  );

-- "Simple review" joins the methods (0061's list), for minor cases.
alter table public.deviations
  drop constraint if exists deviations_rca_method_known;
alter table public.deviations
  add constraint deviations_rca_method_known check (
    rca_method is null or rca_method in (
      'Simple review', '5-Why', 'Fishbone (Ishikawa)', 'Fault tree', 'FMEA'
    )
  );

-- ── 2. The investigation's gate ──────────────────────────────────────────

/**
 * Planned and unplanned deviations only. Fires before `deviations_guard`
 * (name order), after `deviations_assessment_guard`.
 *
 *  · Raising carries no submission or approval.
 *  · Submitted or approved, the investigation's answers are fixed.
 *  · Submitting needs the signed assessment, an investigation that is
 *    required, and every answer; approving needs a submission and a name;
 *    sending back needs a reason, and reopens it.
 *  · Closing needs the approval, when an investigation was required.
 */
create or replace function public.deviations_investigation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  answers_changed boolean;
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

  answers_changed :=
       new.impact                 is distinct from old.impact
    or new.other_batch_nos        is distinct from old.other_batch_nos
    or new.checks_reviewed        is distinct from old.checks_reviewed
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

-- ── 3. Attachments ───────────────────────────────────────────────────────

create table if not exists public.deviation_attachments (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references public.factories (id) on delete cascade,
  deviation_id    uuid not null references public.deviations (id) on delete cascade,
  -- Which part of the case it belongs to: 'details', 'investigation', …
  section         text not null,
  -- `{factory_id}/{deviation_id}/{uuid}-{file name}` in the `case-files` bucket.
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint not null,
  uploaded_by     uuid references public.profiles (id) on delete set null,
  uploaded_by_name text,
  created_at      timestamptz not null default now(),

  constraint deviation_attachments_section_known check (
    section in ('details', 'assessment', 'investigation', 'actions', 'closeout')
  ),
  constraint deviation_attachments_size check (
    size_bytes > 0 and size_bytes <= 10485760
  ),
  constraint deviation_attachments_name_not_blank check (
    length(btrim(file_name)) > 0
  )
);

create index if not exists deviation_attachments_case_idx
  on public.deviation_attachments (deviation_id, created_at);

alter table public.deviation_attachments enable row level security;

drop policy if exists "deviation_attachments_member_read" on public.deviation_attachments;
create policy "deviation_attachments_member_read"
  on public.deviation_attachments for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- Attaching is supervisor and up, like every other write to a case, onto an
-- open case of the same factory, at a path under that case.
drop policy if exists "deviation_attachments_review_insert" on public.deviation_attachments;
create policy "deviation_attachments_review_insert"
  on public.deviation_attachments for insert
  with check (
    public.can_review_factory(factory_id)
    and uploaded_by = auth.uid()
    and storage_path like factory_id::text || '/' || deviation_id::text || '/%'
    and exists (
      select 1 from public.deviations d
      where d.id = deviation_id
        and d.factory_id = deviation_attachments.factory_id
        and d.status = 'open'
    )
  );

-- Removing a file: only the person who attached it, while the case is open.
drop policy if exists "deviation_attachments_own_delete" on public.deviation_attachments;
create policy "deviation_attachments_own_delete"
  on public.deviation_attachments for delete
  using (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.deviations d
      where d.id = deviation_id and d.status = 'open'
    )
  );

-- ── 4. The bucket ────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-files',
  'case-files',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The first folder of every path is the factory: members read their own
-- factory's files, supervisors and up write them, and only the uploader
-- removes one.
drop policy if exists "case_files_member_read" on storage.objects;
create policy "case_files_member_read"
  on storage.objects for select
  using (
    bucket_id = 'case-files'
    and (
      public.is_super_admin()
      or (storage.foldername(name))[1] = public.current_factory_id()::text
    )
  );

drop policy if exists "case_files_review_insert" on storage.objects;
create policy "case_files_review_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'case-files'
    and (storage.foldername(name))[1] = public.current_factory_id()::text
    and public.can_review_factory(public.current_factory_id())
  );

drop policy if exists "case_files_own_delete" on storage.objects;
create policy "case_files_own_delete"
  on storage.objects for delete
  using (
    bucket_id = 'case-files'
    and owner = auth.uid()
  );

-- ── 5. The case read model, with the investigation appended ──────────────

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
  d.investigation_approved_by_name
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
