-- FactoryOS · Quality — customer complaints and the CAPA register
--
-- Run 0056 first: it adds the `complaint` case type this file compares against.
--
-- Quality used to be one register, Deviations & NCRs, with each case's
-- corrective and preventive action typed inline on two of its tabs. It is now
-- four screens — Deviations, Non-conformances, Customer complaints and the
-- CAPA register — and that last one needs a CAPA to be a thing of its own:
--
--   · A **CAPA** (CAPA-2026-001) is a plan: an owner, a list of actions, and a
--     verification that it worked. One CAPA can cover several cases — three
--     NCRs against one supplier are one problem, not three.
--
--   · Each **action** is a CA or a PA carrying exactly the five fields the old
--     inline tabs had: owner, target date, actual closed date, closed by,
--     description. Closing one is an actual closed date and a name.
--
--   · The CAPA is **effective** once every action is closed and someone has
--     written down how it was verified and signed it. Then it is frozen.
--
--   · A **case** now records a CAPA decision: needed (and which CAPA), or not
--     needed (and why). The close-out gate demands it — a case that needed a
--     CAPA cannot close until that CAPA is effective.
--
-- The existing inline CA/PA is **converted**, not dropped: every case that
-- has any becomes a CAPA with a CA and/or a PA action, linked to the case. A
-- closed case's CAPA is converted as effective, since the case it belongs to
-- was already signed off. The `ca_*` / `pa_*` columns stay on the table,
-- unread, so nothing is lost if the conversion needs to be looked at again.
--
-- A complaint is a case like the others, numbered CMP-2026-001, and asks two
-- more things: how it was received, and whether an injury or adverse reaction
-- was reported — the second refused at the close while unanswered, because an
-- unanswered box that prints as "No" is what a controlled record must avoid.

-- ── 1. Complaint fields and the CAPA decision, on the case ───────────────

alter table public.deviations
  add column if not exists received_via           text,
  add column if not exists adverse_reaction       boolean,
  add column if not exists capa_needed            boolean,
  add column if not exists capa_not_needed_reason text;

alter table public.deviations
  drop constraint if exists deviations_received_via_known;
alter table public.deviations
  add constraint deviations_received_via_known check (
    received_via is null
    or received_via in ('Email', 'Phone', 'Distributor', 'Website', 'Other')
  );

-- The complaint's two questions belong to a complaint. Compared as text so
-- the constraint does not depend on how the enum value was added.
alter table public.deviations
  drop constraint if exists deviations_complaint_fields;
alter table public.deviations
  add constraint deviations_complaint_fields check (
    type::text = 'complaint'
    or (received_via is null and adverse_reaction is null)
  );

-- ── 2. The CAPA and its actions ──────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'capa_status') then
    create type public.capa_status as enum ('open', 'effective');
  end if;
end $$;

create table if not exists public.capas (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references public.factories (id) on delete cascade,

  -- "CAPA-2026-001". Stamped by the trigger from `next_document_number`.
  capa_no      text not null,
  title        text not null,
  -- Typed, like every other name on a quality record.
  owner_name   text,
  status       public.capa_status not null default 'open',

  -- The verification: what would show it worked, by when it is checked, what
  -- the check found, and who signed it.
  effectiveness_criteria text,
  verify_by        date,
  verification     text,
  verified_by_name text,
  verified_at      timestamptz,
  verified_by      uuid references public.profiles (id) on delete set null,

  -- Defaulted to the caller, so the browser never has to send who it is;
  -- the insert policy still checks it.
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint capas_title_not_blank check (length(btrim(title)) > 0),
  constraint capas_effective_signed check (
    status <> 'effective'
    or (
      verified_at is not null
      and coalesce(btrim(verified_by_name), '') <> ''
      and coalesce(btrim(verification), '') <> ''
    )
  )
);

create unique index if not exists capas_no_key
  on public.capas (factory_id, capa_no);
create index if not exists capas_factory_idx
  on public.capas (factory_id, status, created_at desc);

create table if not exists public.capa_actions (
  id             uuid primary key default gen_random_uuid(),
  factory_id     uuid not null references public.factories (id) on delete cascade,
  capa_id        uuid not null references public.capas (id) on delete cascade,

  -- CA corrects the cause; PA stops it happening elsewhere.
  kind           text not null,
  description    text not null,
  owner_name     text,
  target_date    date,
  closed_date    date,
  closed_by_name text,
  -- The signed-in account that recorded the close, beside the typed name.
  closed_by      uuid references public.profiles (id) on delete set null,

  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint capa_actions_kind_known check (kind in ('ca', 'pa')),
  constraint capa_actions_description_not_blank check (length(btrim(description)) > 0),
  constraint capa_actions_closed_signed check (
    closed_date is null or coalesce(btrim(closed_by_name), '') <> ''
  )
);

create index if not exists capa_actions_capa_idx
  on public.capa_actions (capa_id, created_at);

-- The case → CAPA link. Many cases may share one CAPA. `set null` so removing
-- a CAPA (nothing in the app does) never deletes a case.
alter table public.deviations
  add column if not exists capa_id uuid references public.capas (id) on delete set null;

create index if not exists deviations_capa_idx on public.deviations (capa_id);

-- "Not needed" and a linked CAPA contradict each other.
alter table public.deviations
  drop constraint if exists deviations_capa_decision_consistent;
alter table public.deviations
  add constraint deviations_capa_decision_consistent check (
    capa_needed is distinct from false or capa_id is null
  );

-- ── 3. Who may touch them ────────────────────────────────────────────────
-- The same standing as the cases they serve: everyone in the factory reads,
-- supervisor and up writes. No delete policy — a CAPA is a record.

alter table public.capas        enable row level security;
alter table public.capa_actions enable row level security;

drop policy if exists "capas_member_read" on public.capas;
create policy "capas_member_read"
  on public.capas for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "capas_review_insert" on public.capas;
create policy "capas_review_insert"
  on public.capas for insert
  with check (public.can_review_factory(factory_id) and created_by = auth.uid());

drop policy if exists "capas_review_update" on public.capas;
create policy "capas_review_update"
  on public.capas for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

drop policy if exists "capa_actions_member_read" on public.capa_actions;
create policy "capa_actions_member_read"
  on public.capa_actions for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "capa_actions_review_insert" on public.capa_actions;
create policy "capa_actions_review_insert"
  on public.capa_actions for insert
  with check (public.can_review_factory(factory_id) and created_by = auth.uid());

drop policy if exists "capa_actions_review_update" on public.capa_actions;
create policy "capa_actions_review_update"
  on public.capa_actions for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

-- ── 4. Converting the inline CA / PA ─────────────────────────────────────
--
-- Done before the CAPA triggers below exist, so a converted CAPA can be
-- written as it actually stands (a closed case's is effective) rather than
-- walked through gates it already passed. The case guard is switched off
-- around the link because a closed case is otherwise frozen, and the hold
-- trigger with it, because linking a CAPA has nothing to say to the board.
-- Safe to run twice: a case that already has a CAPA is skipped.

alter table public.deviations disable trigger deviations_guard;
alter table public.deviations disable trigger deviations_hold;

do $convert$
declare
  d          record;
  new_capa   uuid;
  is_closed  boolean;
  closed_day date;
  has_ca     boolean;
  has_pa     boolean;
begin
  for d in
    select * from public.deviations
    where capa_id is null
    order by created_at
  loop
    has_ca := coalesce(btrim(d.ca_description), '') <> ''
           or coalesce(btrim(d.ca_owner), '') <> ''
           or coalesce(btrim(d.ca_closed_by_name), '') <> ''
           or d.ca_target_date is not null
           or d.ca_closed_date is not null;
    has_pa := coalesce(btrim(d.pa_description), '') <> ''
           or coalesce(btrim(d.pa_owner), '') <> ''
           or coalesce(btrim(d.pa_closed_by_name), '') <> ''
           or d.pa_target_date is not null
           or d.pa_closed_date is not null;

    continue when not (has_ca or has_pa);

    is_closed  := d.status = 'closed';
    closed_day := d.closed_at::date;

    insert into public.capas (
      factory_id, capa_no, title, owner_name, status,
      effectiveness_criteria, verification, verified_by_name, verified_at,
      created_by, created_at
    )
    values (
      d.factory_id,
      public.next_document_number(d.factory_id, 'CAPA', 'CAPA'),
      d.title,
      coalesce(nullif(btrim(d.ca_owner), ''), nullif(btrim(d.pa_owner), ''), d.owner_name),
      case when is_closed then 'effective' else 'open' end::public.capa_status,
      case when is_closed
        then 'Converted from ' || d.deviation_no || ' when the CAPA register was introduced.'
      end,
      case when is_closed
        then 'Closed with ' || d.deviation_no || ' on '
             || to_char(d.closed_at, 'DD Mon YYYY') || ', before the CAPA register.'
      end,
      case when is_closed
        then coalesce(nullif(btrim(d.qa_sign_name), ''), 'Not recorded')
      end,
      case when is_closed then d.closed_at end,
      d.created_by,
      d.created_at
    )
    returning id into new_capa;

    if has_ca then
      insert into public.capa_actions (
        factory_id, capa_id, kind, description, owner_name, target_date,
        closed_date, closed_by_name, created_by, created_at
      )
      values (
        d.factory_id, new_capa, 'ca',
        coalesce(nullif(btrim(d.ca_description), ''), 'Corrective action — no description was recorded.'),
        nullif(btrim(d.ca_owner), ''),
        d.ca_target_date,
        coalesce(d.ca_closed_date, case when is_closed then closed_day end),
        case when d.ca_closed_date is not null or is_closed then
          coalesce(nullif(btrim(d.ca_closed_by_name), ''), nullif(btrim(d.qa_sign_name), ''), 'Not recorded')
        end,
        d.created_by,
        d.created_at
      );
    end if;

    if has_pa then
      insert into public.capa_actions (
        factory_id, capa_id, kind, description, owner_name, target_date,
        closed_date, closed_by_name, created_by, created_at
      )
      values (
        d.factory_id, new_capa, 'pa',
        coalesce(nullif(btrim(d.pa_description), ''), 'Preventive action — no description was recorded.'),
        nullif(btrim(d.pa_owner), ''),
        d.pa_target_date,
        coalesce(d.pa_closed_date, case when is_closed then closed_day end),
        case when d.pa_closed_date is not null or is_closed then
          coalesce(nullif(btrim(d.pa_closed_by_name), ''), nullif(btrim(d.qa_sign_name), ''), 'Not recorded')
        end,
        d.created_by,
        d.created_at
      );
    end if;

    update public.deviations
       set capa_id = new_capa,
           capa_needed = true
     where id = d.id;
  end loop;
end
$convert$;

alter table public.deviations enable trigger deviations_hold;
alter table public.deviations enable trigger deviations_guard;

-- ── 5. The CAPA's gate ───────────────────────────────────────────────────

create or replace function public.capas_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Server-stamped references a delete may null on a frozen CAPA.
  nullable_keys text[] := array['created_by', 'verified_by'];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new CAPA starts as Open.'
        using errcode = 'check_violation';
    end if;
    new.capa_no := public.next_document_number(new.factory_id, 'CAPA', 'CAPA');
    new.title := btrim(new.title);
    new.verification     := null;
    new.verified_by_name := null;
    new.verified_at      := null;
    new.verified_by      := null;
    return new;
  end if;

  if new.capa_no is distinct from old.capa_no
     or new.factory_id is distinct from old.factory_id
     or new.created_at is distinct from old.created_at then
    raise exception 'The number, factory and raised time of a CAPA are fixed.'
      using errcode = 'check_violation';
  end if;

  -- ── Effective: the signed record ──
  if old.status = 'effective' then
    if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
      raise exception '% is effective — a verified CAPA is not edited.', old.capa_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── Open → Effective ──
  if new.status = 'effective' then
    if coalesce(btrim(new.effectiveness_criteria), '') = '' then
      raise exception 'Say what would show the CAPA worked — the effectiveness criteria.'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.capa_actions a where a.capa_id = new.id) then
      raise exception 'A CAPA needs at least one action before it can be verified.'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.capa_actions a
      where a.capa_id = new.id and a.closed_date is null
    ) then
      raise exception 'Close every action before verifying the CAPA.'
        using errcode = 'check_violation';
    end if;
    if length(coalesce(btrim(new.verification), '')) < 10 then
      raise exception 'Record the verification — what was checked and what it showed.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.verified_by_name), '') = '' then
      raise exception 'Verifying needs a name against it.'
        using errcode = 'check_violation';
    end if;

    new.verified_at := now();
    new.verified_by := auth.uid();
  end if;

  return new;
end;
$fn$;

drop trigger if exists capas_guard on public.capas;
create trigger capas_guard
  before insert or update on public.capas
  for each row execute function public.capas_guard();

-- ── 6. An action's gate ──────────────────────────────────────────────────

create or replace function public.capa_actions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  parent public.capas%rowtype;
  nullable_keys text[] := array['created_by', 'closed_by'];
begin
  select * into parent from public.capas where id = new.capa_id;
  if not found or parent.factory_id <> new.factory_id then
    raise exception 'That CAPA is not in this factory.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.capa_id is distinct from old.capa_id
       or new.factory_id is distinct from old.factory_id
       or new.created_at is distinct from old.created_at then
      raise exception 'An action stays on the CAPA it was raised under.'
        using errcode = 'check_violation';
    end if;

    -- A closed action is part of the record.
    if old.closed_date is not null then
      if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
        raise exception 'This action is closed — a closed action is not edited.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  end if;

  if parent.status <> 'open' then
    raise exception '% is effective — its actions are not changed.', parent.capa_no
      using errcode = 'check_violation';
  end if;

  if new.closed_date is not null then
    if coalesce(btrim(new.closed_by_name), '') = '' then
      raise exception 'Closing an action needs a name against it.'
        using errcode = 'check_violation';
    end if;
    new.closed_by := auth.uid();
  else
    new.closed_by_name := null;
    new.closed_by := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists capa_actions_guard on public.capa_actions;
create trigger capa_actions_guard
  before insert or update on public.capa_actions
  for each row execute function public.capa_actions_guard();

-- ── 7. Raising a CAPA from a case, in one transaction ────────────────────
--
-- `security invoker`: the caller's RLS still decides, so this is not a way
-- round "supervisor and up". It exists only so the CAPA and the case's link
-- to it land together — a CAPA created with no case is a plan for nothing.

create or replace function public.create_capa_for_case(
  p_case  uuid,
  p_title text,
  p_owner text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  target  public.deviations%rowtype;
  new_id  uuid;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if target.status = 'closed' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;

  insert into public.capas (factory_id, title, owner_name, created_by)
  values (target.factory_id, p_title, nullif(btrim(coalesce(p_owner, '')), ''), auth.uid())
  returning id into new_id;

  update public.deviations
     set capa_id = new_id,
         capa_needed = true,
         capa_not_needed_reason = null
   where id = p_case;

  return new_id;
end;
$fn$;

revoke all on function public.create_capa_for_case(uuid, text, text) from public;
grant execute on function public.create_capa_for_case(uuid, text, text) to authenticated;

-- ── 8. The case's gate, with complaints and the CAPA decision ────────────

/**
 * 0045's guard, unchanged except for:
 *
 *  · a complaint is numbered CMP and needs to say how it was received;
 *  · linking a CAPA needs it to be open and in the same factory, and a closed
 *    case's link cannot be moved (the jsonb test lets `capa_id` change so a
 *    delete can null it, so moving it is refused by name);
 *  · closing needs the CAPA decision — needed with an effective CAPA, or not
 *    needed with a reason — and, on a complaint, the adverse-reaction answer.
 */
create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['product_id', 'action_id', 'capa_id', 'created_by', 'closed_by'];
  linked public.capas%rowtype;
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
       or (new.action_id is not null and new.action_id is distinct from old.action_id) then
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
    if linked.status <> 'open' then
      raise exception '% is already effective — raise a new CAPA for this case.', linked.capa_no
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── Open → Closed ──
  if new.status = 'closed' then
    if new.immediate_action_date is null
       or coalesce(btrim(new.immediate_action), '') = '' then
      raise exception 'Record the immediate action taken, and the date, before closing.'
        using errcode = 'check_violation';
    end if;

    if new.likelihood is null or new.severity is null or new.detection is null then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null then
      raise exception 'Answer whether there is a financial impact.'
        using errcode = 'check_violation';
    end if;

    if length(coalesce(btrim(new.investigation_findings), '')) < 10 then
      raise exception 'Record the investigation findings before closing.'
        using errcode = 'check_violation';
    end if;

    if new.type::text = 'complaint' and new.adverse_reaction is null then
      raise exception 'Answer whether an injury or adverse reaction was reported.'
        using errcode = 'check_violation';
    end if;

    -- The CAPA decision.
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
      if linked.status <> 'effective' then
        raise exception '% must be verified as effective before the case is closed.', linked.capa_no
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

-- ── 9. Read models ───────────────────────────────────────────────────────
--
-- `deviations_expanded` is 0045's, with the new columns appended at the end
-- (`create or replace view` may only add columns after the existing ones).

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
  cp.verified_at as capa_verified_at
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

comment on view public.deviations_expanded is
  'Read model for the Quality cases — deviations, NCRs and customer complaints: the seven-tab case record with the product and equipment resolved, the risk conclusion and case aging computed rather than stored, and the linked CAPA''s number and status.';

grant select on public.deviations_expanded to authenticated;

/**
 * The CAPA register: each CAPA with its action counts and the cases it
 * covers, all computed on read. Overdue is an open action past its target
 * date; the verification is overdue when an open CAPA passes its verify-by.
 */
create or replace view public.capas_expanded
with (security_invoker = true) as
select
  c.id,
  c.factory_id,
  c.capa_no,
  c.title,
  c.owner_name,
  c.status,
  c.effectiveness_criteria,
  c.verify_by,
  c.verification,
  c.verified_by_name,
  c.verified_at,
  c.created_by,
  c.created_at,

  (select count(*) from public.capa_actions x where x.capa_id = c.id)
    as action_count,
  (select count(*) from public.capa_actions x
    where x.capa_id = c.id and x.closed_date is not null)
    as actions_closed,
  (select count(*) from public.capa_actions x
    where x.capa_id = c.id and x.closed_date is null
      and x.target_date is not null and x.target_date < current_date)
    as actions_overdue,
  (c.status = 'open' and c.verify_by is not null and c.verify_by < current_date)
    as is_verify_overdue,

  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'deviation_no', d.deviation_no,
        'type', d.type,
        'status', d.status
      )
      order by d.created_at
    )
    from public.deviations d
    where d.capa_id = c.id
  ), '[]'::jsonb) as cases
from public.capas c;

comment on view public.capas_expanded is
  'Read model for the CAPA register: each CAPA with its action counts, overdue actions, whether its verification is overdue, and the cases it covers.';

grant select on public.capas_expanded to authenticated;
