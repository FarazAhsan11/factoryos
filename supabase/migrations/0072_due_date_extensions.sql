-- FactoryOS · Quality — a deviation's due date extensions
--
-- Run after 0071.
--
-- The reference QMS (qms-v5) lets a case ask for more time: the owner
-- requests a **new due date with a reason**, and a QA approver **approves**
-- it (the due date moves) or **rejects** it (with a reason). The old date
-- stays in the history. Planned and unplanned deviations only.
--
--   · `deviation_due_extensions` — one row per request: from (the due date
--     when asked), to, reason, who asked and when, status `requested` →
--     `approved` | `rejected`, who decided, when, and the note. Members read
--     it; nothing writes it but the two functions below.
--   · `request_due_extension(case, to, reason, name)` — supervisor and up, on
--     an open deviation whose initial assessment is signed (it has a due
--     date), for a date after the current one; one request open at a time.
--   · `decide_due_extension(request, approve, note, name)` — supervisor and
--     up, on an open case. Approving moves `deviations.sla_date` to the new
--     date (the view's overdue follows it); rejecting needs a reason. The
--     person who asked **may** decide their own request for now — the
--     reference QMS's independent sign-off is not enforced yet, so it can be
--     tested with one login. The screen warns.
--   · **The audit trail** gets `extension_requested`, `extension_approved`
--     and `extension_rejected` (from → to, with the reason). Approving also
--     logs the due date's change, as every change to a case is.

-- ── 1. The requests ──────────────────────────────────────────────────────

create table if not exists public.deviation_due_extensions (
  id                 uuid primary key default gen_random_uuid(),
  factory_id         uuid not null references public.factories (id) on delete cascade,
  deviation_id       uuid not null references public.deviations (id) on delete cascade,
  from_date          date not null,
  to_date            date not null,
  reason             text not null,
  status             text not null default 'requested',
  requested_at       timestamptz not null default now(),
  requested_by       uuid references public.profiles (id) on delete set null,
  requested_by_name  text,
  decided_at         timestamptz,
  decided_by         uuid references public.profiles (id) on delete set null,
  decided_by_name    text,
  note               text,
  constraint deviation_due_extensions_status_known
    check (status in ('requested', 'approved', 'rejected')),
  constraint deviation_due_extensions_later
    check (to_date > from_date),
  constraint deviation_due_extensions_decided
    check ((status = 'requested') = (decided_at is null))
);

create index if not exists deviation_due_extensions_case_idx
  on public.deviation_due_extensions (deviation_id, requested_at);

-- One request waiting at a time.
create unique index if not exists deviation_due_extensions_one_open
  on public.deviation_due_extensions (deviation_id)
  where status = 'requested';

alter table public.deviation_due_extensions enable row level security;

drop policy if exists "deviation_due_extensions_member_read" on public.deviation_due_extensions;
create policy "deviation_due_extensions_member_read"
  on public.deviation_due_extensions for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No insert, update or delete policy, on purpose: only the functions write it.

-- ── 2. Asking for more time ──────────────────────────────────────────────

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
  if target.type::text not in ('planned', 'unplanned') then
    raise exception 'Due date extensions are for deviations.'
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

grant execute on function public.request_due_extension(uuid, date, text, text) to authenticated;

-- ── 3. Deciding ──────────────────────────────────────────────────────────

create or replace function public.decide_due_extension(
  p_extension uuid,
  p_approve   boolean,
  p_note      text,
  p_by_name   text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  ext    public.deviation_due_extensions%rowtype;
  target public.deviations%rowtype;
begin
  select * into ext from public.deviation_due_extensions where id = p_extension for update;
  if not found then
    raise exception 'Extension request not found.' using errcode = 'no_data_found';
  end if;
  select * into target from public.deviations where id = ext.deviation_id for update;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can decide a due date extension.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if ext.status <> 'requested' then
    raise exception 'This extension has already been %.', ext.status
      using errcode = 'check_violation';
  end if;
  if p_approve is null then
    raise exception 'Approve or reject — nothing else.' using errcode = 'check_violation';
  end if;
  if not p_approve and length(coalesce(btrim(p_note), '')) < 5 then
    raise exception 'Give the reason for rejecting the extension.'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The decision needs a name against it.' using errcode = 'check_violation';
  end if;
  -- Asked against a due date that has since moved: ask again.
  if p_approve and target.sla_date is distinct from ext.from_date then
    raise exception 'The due date has changed since this was asked — ask again from the current one.'
      using errcode = 'check_violation';
  end if;

  update public.deviation_due_extensions
  set status          = case when p_approve then 'approved' else 'rejected' end,
      decided_at      = now(),
      decided_by      = auth.uid(),
      decided_by_name = btrim(p_by_name),
      note            = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_extension;

  if p_approve then
    update public.deviations set sla_date = ext.to_date where id = ext.deviation_id;
  end if;
end;
$fn$;

grant execute on function public.decide_due_extension(uuid, boolean, text, text) to authenticated;

-- ── 4. The audit trail ───────────────────────────────────────────────────

create or replace function public.deviation_due_extensions_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, at, actor, actor_name, action, old_value, new_value, reason)
    values (new.factory_id, new.deviation_id, new.requested_at, new.requested_by,
            coalesce(new.requested_by_name, public.audit_actor_name()),
            'extension_requested', new.from_date::text, new.to_date::text, new.reason);
  elsif old.status = 'requested' and new.status <> 'requested' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, old_value, new_value, reason)
    values (new.factory_id, new.deviation_id, new.decided_by,
            coalesce(new.decided_by_name, public.audit_actor_name()),
            case new.status when 'approved' then 'extension_approved' else 'extension_rejected' end,
            new.from_date::text, new.to_date::text,
            coalesce(new.note, case when new.status = 'approved' then new.reason end));
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviation_due_extensions_audit on public.deviation_due_extensions;
create trigger deviation_due_extensions_audit
  after insert or update on public.deviation_due_extensions
  for each row execute function public.deviation_due_extensions_audit();
