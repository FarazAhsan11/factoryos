-- FactoryOS · Quality — the case audit trail
--
-- Run after 0065.
--
-- Every change to a case, recorded by the database rather than the screens:
-- who did it, when, what it was, and the value before and after. A case is a
-- GMP record (Annex 11 §9: changes to GMP data are recorded with who, when
-- and why), and a log written by the browser is a log the browser can skip.
--
-- `deviation_audit` is append-only: members of the factory read it; nothing
-- may insert, update or delete it but the triggers below (security definer).
--
-- What is written, by `deviations_audit()` after each insert or update:
--
--   · **raised** on insert;
--   · one **event** per signature and step — assessment_signed,
--     investigation_submitted / _approved / _returned (with the reason),
--     closeout_first_signed, closed;
--   · one **changed** row per column that changed, with the old and new
--     value as text. Columns the database fills in itself, or that only
--     mirror another (the resolved product ids, the signature stamps already
--     logged as events), are left out so the trail reads as what people did.
--
-- And by `deviation_attachments_audit()`: **file_attached** / **file_removed**.
--
-- Cases raised before this migration get their **raised** entry back-filled
-- from `created_at` and `raised_by`; nothing earlier was recorded.

-- ── 1. The trail ─────────────────────────────────────────────────────────

create table if not exists public.deviation_audit (
  id            bigint generated always as identity primary key,
  factory_id    uuid not null references public.factories (id) on delete cascade,
  deviation_id  uuid not null references public.deviations (id) on delete cascade,
  at            timestamptz not null default now(),
  actor         uuid references public.profiles (id) on delete set null,
  actor_name    text,
  -- raised | changed | assessment_signed | investigation_submitted |
  -- investigation_approved | investigation_returned | closeout_first_signed |
  -- closed | file_attached | file_removed
  action        text not null,
  -- The column, for `changed`.
  field         text,
  old_value     text,
  new_value     text,
  reason        text
);

create index if not exists deviation_audit_case_idx
  on public.deviation_audit (deviation_id, at, id);

alter table public.deviation_audit enable row level security;

drop policy if exists "deviation_audit_member_read" on public.deviation_audit;
create policy "deviation_audit_member_read"
  on public.deviation_audit for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No insert, update or delete policy, on purpose: only the triggers write it.

-- ── 2. Helpers ───────────────────────────────────────────────────────────

/** A jsonb value as the text the trail shows: arrays joined, null as null. */
create or replace function public.audit_text(v jsonb)
returns text
language sql
immutable
as $$
  select case jsonb_typeof(v)
    when 'null' then null
    when 'array' then (
      select nullif(string_agg(e #>> '{}', ', ' order by o), '')
      from jsonb_array_elements(v) with ordinality as x(e, o)
    )
    else v #>> '{}'
  end;
$$;

/** Who is doing this: the profile's name, else its email, else "System". */
create or replace function public.audit_actor_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.full_name), ''), p.email)
       from public.profiles p where p.id = auth.uid()),
    'System'
  );
$$;

-- ── 3. Recording a case's changes ────────────────────────────────────────

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
    'close_first_signed_at', 'close_first_signed_by', 'close_first_signed_by_name'
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

  if old.status = 'open' and new.status = 'closed' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value)
    values (new.factory_id, new.id, who, coalesce(new.qa_sign_name, who_name),
            'closed', new.status_reason);
  end if;

  return null;
end;
$fn$;

drop trigger if exists deviations_audit on public.deviations;
create trigger deviations_audit
  after insert or update on public.deviations
  for each row execute function public.deviations_audit();

-- ── 4. Recording attachments ─────────────────────────────────────────────

create or replace function public.deviation_attachments_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, field, new_value)
    values (new.factory_id, new.deviation_id, auth.uid(),
            coalesce(new.uploaded_by_name, public.audit_actor_name()),
            'file_attached', new.section, new.file_name);
  else
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, field, old_value)
    values (old.factory_id, old.deviation_id, auth.uid(),
            public.audit_actor_name(), 'file_removed', old.section, old.file_name);
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviation_attachments_audit on public.deviation_attachments;
create trigger deviation_attachments_audit
  after insert or delete on public.deviation_attachments
  for each row execute function public.deviation_attachments_audit();

-- ── 5. Back-fill: each existing case was raised ──────────────────────────

insert into public.deviation_audit
  (factory_id, deviation_id, at, actor, actor_name, action, new_value)
select d.factory_id, d.id, d.created_at, d.created_by,
       coalesce(nullif(btrim(d.raised_by), ''), 'Unknown'), 'raised', d.deviation_no
from public.deviations d
where not exists (
  select 1 from public.deviation_audit a
  where a.deviation_id = d.id and a.action = 'raised'
);
