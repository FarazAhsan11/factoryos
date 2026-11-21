-- FactoryOS · Quality — the case's Actions tab and the CAPA, as qms-v8 has them
--
-- Run after 0073.
--
-- The reference QMS (qms-v8) reworks the case's Actions tab and the CAPA:
--
--   · **Corrections** — what was done to fix *this* case (what, who, when),
--     a list of its own on the Actions tab. Until now a correction could only
--     be written into the "reason no CAPA is needed". `deviation_corrections`,
--     supervisor and up, while the case is open; each one added or removed is
--     on the case's audit trail.
--
--   · **"Is a CAPA required?"** is asked on its own (Yes / No + justification),
--     and a **recurring** deviation (likelihood 3 at the initial assessment)
--     cannot answer No — `deviations_capa_required_guard`.
--
--   · **A new CAPA is created with its whole plan** — corrective and
--     preventive actions (what, owner, target date), effectiveness criteria,
--     when to check and who verifies — and goes straight to plan approval:
--     `create_capa_plan()`, one transaction, which also links the case.
--
--   · **Follow-up of a closed CAPA.** A closed CAPA is never reopened: when
--     its problem comes back, a new CAPA is started as its follow-up
--     (`capas.recurrence_of`, set when it is created, fixed after). The
--     register and the CAPA page show "Follow-up of …" and "Recurred".
--
--   · **"Verify on completion"** (check mode `at_implementation`) no longer
--     asks why — v8 offers it as a quick pick beside +1 / +3 / +6 months.
--
--   · **Not effective → the next check date.** `record_capa_check` takes the
--     date the effectiveness check is repeated on; the CAPA's check moves to
--     it. A check before its date is allowed without a reason — it is noted
--     as "verified before the planned date" on the record.
--
--   · **Who raised the CAPA** — `capas.created_by_name`, stamped on insert,
--     for "raised by … on …".
--
--   · `capas_expanded` appends `recurrence_of`, `recurrence_of_no`,
--     `recurred_by`, `created_by_name` and `action_owners`.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.capas
  add column if not exists recurrence_of   uuid references public.capas (id) on delete set null,
  add column if not exists created_by_name text;

create index if not exists capas_recurrence_of_idx
  on public.capas (recurrence_of) where recurrence_of is not null;

-- Who raised each CAPA so far (runs as the migration's owner, so profiles
-- are readable whatever their policies). Past the guard: it would refuse
-- every CAPA already verified effective (a closed CAPA is not edited), and
-- this only fills in a fact the record already holds.
alter table public.capas disable trigger capas_guard;

update public.capas c
   set created_by_name = coalesce(
         (select coalesce(nullif(btrim(p.full_name), ''), p.email)
            from public.profiles p where p.id = c.created_by),
         'Unknown')
 where c.created_by_name is null;

alter table public.capas enable trigger capas_guard;

-- ── 2. Corrections ───────────────────────────────────────────────────────

create table if not exists public.deviation_corrections (
  id            uuid primary key default gen_random_uuid(),
  factory_id    uuid not null references public.factories (id) on delete cascade,
  deviation_id  uuid not null references public.deviations (id) on delete cascade,
  what          text not null,
  who           text not null,
  done_on       date not null,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  constraint deviation_corrections_what_len check (length(btrim(what)) between 3 and 1000),
  constraint deviation_corrections_who_set  check (btrim(who) <> '')
);

create index if not exists deviation_corrections_case_idx
  on public.deviation_corrections (deviation_id, done_on, created_at);

alter table public.deviation_corrections enable row level security;

drop policy if exists "deviation_corrections_member_read" on public.deviation_corrections;
create policy "deviation_corrections_member_read"
  on public.deviation_corrections for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "deviation_corrections_review_insert" on public.deviation_corrections;
create policy "deviation_corrections_review_insert"
  on public.deviation_corrections for insert
  with check (public.can_review_factory(factory_id) and created_by = auth.uid());

drop policy if exists "deviation_corrections_review_delete" on public.deviation_corrections;
create policy "deviation_corrections_review_delete"
  on public.deviation_corrections for delete
  using (public.can_review_factory(factory_id));

-- No update policy: a correction is removed and added again, not edited.

/** On an open case of the same factory; not done in the future. */
create or replace function public.deviation_corrections_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target public.deviations%rowtype;
begin
  select * into target from public.deviations
  where id = coalesce(new.deviation_id, old.deviation_id);
  if not found then
    -- The case itself is being removed (cascade): nothing to protect.
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and target.factory_id <> new.factory_id then
    raise exception 'That case is not in this factory.' using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if new.done_on > current_date + 1 then
      raise exception 'A correction is recorded once it is done — the date cannot be in the future.'
        using errcode = 'check_violation';
    end if;
    new.what := btrim(new.what);
    new.who  := btrim(new.who);
    return new;
  end if;
  return old;
end;
$fn$;

drop trigger if exists deviation_corrections_guard on public.deviation_corrections;
create trigger deviation_corrections_guard
  before insert or delete on public.deviation_corrections
  for each row execute function public.deviation_corrections_guard();

/** Each correction added or removed, on the case's audit trail. */
create or replace function public.deviation_corrections_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value, reason)
    values (new.factory_id, new.deviation_id, auth.uid(), public.audit_actor_name(),
            'correction_added', new.what,
            new.who || ' · ' || to_char(new.done_on, 'DD Mon YYYY'));
    return null;
  end if;
  if exists (select 1 from public.deviations d where d.id = old.deviation_id) then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, old_value)
    values (old.factory_id, old.deviation_id, auth.uid(), public.audit_actor_name(),
            'correction_removed', old.what);
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviation_corrections_audit on public.deviation_corrections;
create trigger deviation_corrections_audit
  after insert or delete on public.deviation_corrections
  for each row execute function public.deviation_corrections_audit();

-- ── 3. A recurring deviation needs a CAPA ────────────────────────────────

/**
 * Likelihood 3 ("recurring") at a signed initial assessment means a CAPA is
 * required: "No" is refused. Assessments signed on the old 1–125 scale
 * (they carry a detection score) are left alone.
 */
create or replace function public.deviations_capa_required_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.type::text in ('planned', 'unplanned')
     and new.status = 'open'
     and new.assessed_at is not null
     and new.detection is null
     and new.likelihood = 3
     and new.capa_needed is false
     and new.capa_needed is distinct from old.capa_needed then
    raise exception 'A recurring problem (likelihood 3) needs a CAPA — answer Yes.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists deviations_capa_required_guard on public.deviations;
create trigger deviations_capa_required_guard
  before update on public.deviations
  for each row execute function public.deviations_capa_required_guard();

-- ── 4. The CAPA's gate ───────────────────────────────────────────────────

/**
 * 0073's guard, with:
 *  · the follow-up link checked when the CAPA is created (a closed CAPA of
 *    this factory) and fixed after, like who raised it;
 *  · "verify on completion" needing no reason.
 */
create or replace function public.capas_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['created_by', 'verified_by', 'plan_approved_by', 'recurrence_of'];
  missing text[] := '{}';
  prior   public.capas%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new CAPA starts as Open.'
        using errcode = 'check_violation';
    end if;
    if new.recurrence_of is not null then
      select * into prior from public.capas where id = new.recurrence_of;
      if not found or prior.factory_id <> new.factory_id then
        raise exception 'That CAPA is not in this factory.'
          using errcode = 'check_violation';
      end if;
      if prior.status <> 'effective' then
        raise exception '% is still open — add the case to it instead of starting a follow-up.', prior.capa_no
          using errcode = 'check_violation';
      end if;
    end if;
    new.capa_no := public.next_document_number(new.factory_id, 'CAPA', 'CAPA');
    new.title := btrim(new.title);
    new.created_by_name := coalesce(nullif(btrim(new.created_by_name), ''), public.audit_actor_name());
    new.verification          := null;
    new.verified_by_name      := null;
    new.verified_at           := null;
    new.verified_by           := null;
    new.plan_approved_at      := null;
    new.plan_approved_by      := null;
    new.plan_approved_by_name := null;
    new.plan_approval_note    := null;
    return new;
  end if;

  if new.capa_no is distinct from old.capa_no
     or new.factory_id is distinct from old.factory_id
     or new.created_at is distinct from old.created_at
     or new.created_by_name is distinct from old.created_by_name then
    raise exception 'The number, factory, raised time and raiser of a CAPA are fixed.'
      using errcode = 'check_violation';
  end if;
  -- The follow-up link may only be cleared (by `on delete set null`).
  if new.recurrence_of is not null and new.recurrence_of is distinct from old.recurrence_of then
    raise exception 'Which CAPA this follows up is set when it is created.'
      using errcode = 'check_violation';
  end if;

  -- ── Effective: the signed record ──
  if old.status = 'effective' then
    if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
      raise exception '% is closed — a CAPA verified effective is not edited.', old.capa_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── The plan approval: once, and never taken back ──
  if old.plan_approved_at is not null then
    if new.plan_approved_at is distinct from old.plan_approved_at
       or new.plan_approved_by_name is distinct from old.plan_approved_by_name
       or new.plan_approval_note is distinct from old.plan_approval_note
       or (new.plan_approved_by is not null and new.plan_approved_by is distinct from old.plan_approved_by) then
      raise exception 'The plan of % is approved — the approval is not changed.', old.capa_no
        using errcode = 'check_violation';
    end if;
  elsif new.plan_approved_at is not null then
    if not exists (select 1 from public.capa_actions a where a.capa_id = new.id) then
      missing := array_append(missing, 'at least one action'::text);
    end if;
    if exists (
      select 1 from public.capa_actions a
      where a.capa_id = new.id
        and (coalesce(btrim(a.owner_name), '') = '' or a.target_date is null)
    ) then
      missing := array_append(missing, 'action, owner and target date on every row'::text);
    end if;
    if coalesce(btrim(new.effectiveness_criteria), '') = '' then
      missing := array_append(missing, 'effectiveness criteria'::text);
    end if;
    if new.check_mode = 'dated' and new.verify_by is null then
      missing := array_append(missing, 'check due date'::text);
    end if;
    if coalesce(btrim(new.checker_name), '') = '' then
      missing := array_append(missing, 'verifier'::text);
    end if;
    if cardinality(missing) > 0 then
      raise exception 'Still needed before the plan can be approved: %.', array_to_string(missing, ', ')
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.plan_approved_by_name), '') = '' then
      raise exception 'Approving the plan needs a name against it.'
        using errcode = 'check_violation';
    end if;
    new.plan_approved_at      := now();
    new.plan_approved_by      := auth.uid();
    new.plan_approved_by_name := btrim(new.plan_approved_by_name);
    new.plan_approval_note    := nullif(btrim(coalesce(new.plan_approval_note, '')), '');
  else
    new.plan_approved_by      := null;
    new.plan_approved_by_name := null;
    new.plan_approval_note    := null;
  end if;

  -- ── Open → Effective ──
  if new.status = 'effective' then
    if new.plan_approved_at is null then
      raise exception 'Approve the CAPA plan first.' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.capa_checks k
      where k.capa_id = new.id and k.result = 'effective'
    ) then
      raise exception 'Record the effectiveness check — a CAPA closes when a check says it worked.'
        using errcode = 'check_violation';
    end if;
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
      raise exception 'Mark every action done before the effectiveness check.'
        using errcode = 'check_violation';
    end if;
    if length(coalesce(btrim(new.verification), '')) < 10 then
      raise exception 'Record what the check found.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.verified_by_name), '') = '' then
      raise exception 'The check needs a name against it.'
        using errcode = 'check_violation';
    end if;

    new.verified_at := now();
    new.verified_by := auth.uid();
  end if;

  return new;
end;
$fn$;

-- ── 4b. The CAPA's history — its own root cause too ──────────────────────

/**
 * 0073's, with `root_cause` among the fields logged: a CAPA whose case's
 * investigation is not approved records the root cause it works on.
 */
create or replace function public.capas_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who      uuid := auth.uid();
  who_name text := public.audit_actor_name();
  after_approval text;
begin
  if tg_op = 'INSERT' then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, new_value)
    values (new.factory_id, new.id, who, who_name, 'created', new.capa_no);
    return null;
  end if;

  after_approval := case when old.plan_approved_at is not null then 'Changed after plan approval' end;

  insert into public.capa_audit
    (factory_id, capa_id, actor, actor_name, action, field, old_value, new_value, reason)
  select new.factory_id, new.id, who, who_name, 'changed', c.field, c.o, c.n, after_approval
  from (values
    ('title',                  old.title,                  new.title),
    ('owner_name',             old.owner_name,             new.owner_name),
    ('reason',                 old.reason,                 new.reason),
    ('root_cause',             old.root_cause,             new.root_cause),
    ('target_date',            old.target_date::text,      new.target_date::text),
    ('effectiveness_criteria', old.effectiveness_criteria, new.effectiveness_criteria),
    ('check_mode',             old.check_mode,             new.check_mode),
    ('check_why',              old.check_why,              new.check_why),
    ('verify_by',              old.verify_by::text,        new.verify_by::text),
    ('checker_name',           old.checker_name,           new.checker_name)
  ) as c(field, o, n)
  where c.o is distinct from c.n;

  if old.plan_approved_at is null and new.plan_approved_at is not null then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, reason)
    values (new.factory_id, new.id, who, coalesce(new.plan_approved_by_name, who_name),
            'plan_approved', new.plan_approval_note);
    insert into public.deviation_audit (factory_id, deviation_id, actor, actor_name, action, new_value)
    select d.factory_id, d.id, who, coalesce(new.plan_approved_by_name, who_name),
           'capa_plan_approved', new.capa_no
    from public.deviations d where d.capa_id = new.id;
  end if;

  return null;
end;
$fn$;

-- ── 5. Creating a CAPA with its plan ─────────────────────────────────────

/**
 * v8's "Create CAPA and send for approval": the CAPA, its actions and the
 * effectiveness check in one go, linked to the case. Security invoker, so
 * the CAPA tables' own policies (supervisor and up) apply.
 *
 * `p_actions`: [{ kind: 'ca' | 'pa', description, owner_name, target_date }].
 * `p_check_mode`: 'dated' (with `p_verify_by`) or 'at_implementation'.
 */
create or replace function public.create_capa_plan(
  p_case          uuid,
  p_title         text,
  p_root_cause    text,
  p_actions       jsonb,
  p_criteria      text,
  p_check_mode    text,
  p_verify_by     date,
  p_checker       text,
  p_recurrence_of uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  target  public.deviations%rowtype;
  new_id  uuid;
  missing text[] := '{}';
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if target.capa_id is not null then
    raise exception '% is already under a CAPA.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if p_check_mode not in ('dated', 'at_implementation') then
    raise exception 'Choose when the effectiveness check is due.'
      using errcode = 'check_violation';
  end if;

  if coalesce(jsonb_array_length(p_actions), 0) = 0 then
    missing := array_append(missing, 'at least one action'::text);
  elsif exists (
    select 1 from jsonb_to_recordset(p_actions)
      as x(kind text, description text, owner_name text, target_date date)
    where coalesce(btrim(x.description), '') = ''
       or coalesce(btrim(x.owner_name), '') = ''
       or x.target_date is null
       or x.kind not in ('ca', 'pa')
  ) then
    missing := array_append(missing, 'action, owner and target date on every row'::text);
  end if;
  if coalesce(btrim(p_criteria), '') = '' then
    missing := array_append(missing, 'effectiveness criteria'::text);
  end if;
  if p_check_mode = 'dated' and p_verify_by is null then
    missing := array_append(missing, 'check due date'::text);
  end if;
  if coalesce(btrim(p_checker), '') = '' then
    missing := array_append(missing, 'verifier'::text);
  end if;
  if coalesce(btrim(target.root_cause), '') = '' and coalesce(btrim(p_root_cause), '') = '' then
    missing := array_append(missing, 'root cause'::text);
  end if;
  if cardinality(missing) > 0 then
    raise exception 'Still needed: %.', array_to_string(missing, ', ')
      using errcode = 'check_violation';
  end if;

  insert into public.capas (
    factory_id, title, root_cause, effectiveness_criteria,
    check_mode, verify_by, checker_name, recurrence_of, created_by
  )
  values (
    target.factory_id,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), target.title),
    -- Given when the case's investigation is not approved (or was not done):
    -- the root cause this CAPA works on. Otherwise the case's approved root
    -- cause is read from the case.
    nullif(btrim(coalesce(p_root_cause, '')), ''),
    btrim(p_criteria),
    p_check_mode,
    case when p_check_mode = 'dated' then p_verify_by end,
    btrim(p_checker),
    p_recurrence_of,
    auth.uid()
  )
  returning id into new_id;

  insert into public.capa_actions (
    factory_id, capa_id, kind, description, owner_name, target_date, created_by
  )
  -- In the order written. (`jsonb_to_recordset` cannot take WITH ORDINALITY
  -- beside a column list, so each element is read by key.)
  select target.factory_id, new_id,
         e.v ->> 'kind',
         btrim(e.v ->> 'description'),
         btrim(e.v ->> 'owner_name'),
         (e.v ->> 'target_date')::date,
         auth.uid()
  from jsonb_array_elements(p_actions) with ordinality as e(v, ord)
  order by e.ord;

  update public.deviations
     set capa_id = new_id,
         capa_needed = true,
         capa_not_needed_reason = null
   where id = p_case;

  return new_id;
end;
$fn$;

revoke all on function public.create_capa_plan(uuid, text, text, jsonb, text, text, date, text, uuid) from public;
grant execute on function public.create_capa_plan(uuid, text, text, jsonb, text, text, date, text, uuid) to authenticated;

-- ── 6. Recording the effectiveness check ─────────────────────────────────

drop function if exists public.record_capa_check(uuid, boolean, text, text, text);

/**
 * 0073's, with v8's outcome: Effective closes the CAPA; Not effective takes
 * the date the check is repeated on (the CAPA goes back to Implement for new
 * actions). A check before its planned date is allowed — it is noted.
 */
create or replace function public.record_capa_check(
  p_capa         uuid,
  p_effective    boolean,
  p_findings     text,
  p_next_check   date,
  p_by_name      text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target    public.capas%rowtype;
  last_bad  timestamptz;
  early     text;
begin
  select * into target from public.capas where id = p_capa for update;
  if not found then
    raise exception 'CAPA not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can record the effectiveness check.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.status <> 'open' then
    raise exception '% is already closed.', target.capa_no using errcode = 'check_violation';
  end if;
  if target.plan_approved_at is null then
    raise exception 'Approve the CAPA plan first.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.capa_actions a where a.capa_id = p_capa) then
    raise exception 'A CAPA needs at least one action.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.capa_actions a where a.capa_id = p_capa and a.closed_date is null
  ) then
    raise exception 'Mark every action done before the effectiveness check.'
      using errcode = 'check_violation';
  end if;
  -- Not effective last time: something new must have been done since.
  select max(k.checked_at) into last_bad
  from public.capa_checks k
  where k.capa_id = p_capa and k.result = 'not_effective';
  if last_bad is not null and not exists (
    select 1 from public.capa_actions a where a.capa_id = p_capa and a.created_at > last_bad
  ) then
    raise exception 'The last check was not effective — add a new action, then verify again.'
      using errcode = 'check_violation';
  end if;
  if p_effective is null then
    raise exception 'Effective or not effective?' using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_findings), '')) < 10 then
    raise exception 'Add the findings — what you checked and what you found.'
      using errcode = 'check_violation';
  end if;
  if not p_effective and (p_next_check is null or p_next_check < current_date) then
    raise exception 'Set the date the effectiveness check is repeated on.'
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The check needs a name against it.' using errcode = 'check_violation';
  end if;

  if target.check_mode = 'dated' and target.verify_by is not null
     and current_date < target.verify_by then
    early := 'Verified before the planned date (' || to_char(target.verify_by, 'DD Mon YYYY') || ')';
  end if;

  insert into public.capa_checks
    (factory_id, capa_id, result, findings, early_reason, checked_by, checked_by_name)
  values
    (target.factory_id, p_capa,
     case when p_effective then 'effective' else 'not_effective' end,
     btrim(p_findings), early, auth.uid(), btrim(p_by_name));

  if p_effective then
    update public.capas
       set status = 'effective',
           verification = btrim(p_findings),
           verified_by_name = btrim(p_by_name)
     where id = p_capa;
  else
    update public.capas
       set check_mode = 'dated',
           verify_by  = p_next_check
     where id = p_capa;
  end if;
end;
$fn$;

revoke all on function public.record_capa_check(uuid, boolean, text, date, text) from public;
grant execute on function public.record_capa_check(uuid, boolean, text, date, text) to authenticated;

-- ── 7. The read model ────────────────────────────────────────────────────
-- 0073's view, with the follow-up links, who raised it and the action
-- owners appended.

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
  ), '[]'::jsonb) as cases,

  -- ── Appended by 0059 ──────────────────────────────────────────────────
  c.reason,
  c.target_date,
  c.root_cause,
  c.rca_method,
  (c.status = 'open' and c.target_date is not null and c.target_date < current_date)
    as is_overdue,

  -- ── Appended by 0073 ──────────────────────────────────────────────────
  c.check_mode,
  c.check_why,
  c.checker_name,
  c.plan_approved_at,
  c.plan_approved_by_name,
  c.plan_approval_note,
  s.reopened,
  case
    when c.status = 'effective' then 'closed'
    when c.plan_approved_at is null then 'plan'
    when s.reopened then 'do'
    when s.total > 0 and s.open_actions = 0 then 'check'
    else 'do'
  end as step,
  s.next_due,
  s.last_due,
  s.last_done,
  s.check_count,
  s.first_check_effective,

  -- ── Appended by 0074 ──────────────────────────────────────────────────
  c.recurrence_of,
  (select p.capa_no from public.capas p where p.id = c.recurrence_of)
    as recurrence_of_no,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'capa_no', f.capa_no,
        'created_at', f.created_at,
        'case_no', (select d.deviation_no from public.deviations d
                     where d.capa_id = f.id order by d.created_at limit 1)
      )
      order by f.created_at
    )
    from public.capas f
    where f.recurrence_of = c.id
  ), '[]'::jsonb) as recurred_by,
  c.created_by_name,
  coalesce((
    select array_agg(distinct btrim(a.owner_name) order by btrim(a.owner_name))
    from public.capa_actions a
    where a.capa_id = c.id and coalesce(btrim(a.owner_name), '') <> ''
  ), '{}') as action_owners
from public.capas c
  cross join lateral (
    select
      (select count(*) from public.capa_actions a where a.capa_id = c.id) as total,
      (select count(*) from public.capa_actions a
        where a.capa_id = c.id and a.closed_date is null) as open_actions,
      (select min(a.target_date) from public.capa_actions a
        where a.capa_id = c.id and a.closed_date is null) as next_due,
      (select max(a.target_date) from public.capa_actions a where a.capa_id = c.id) as last_due,
      (select max(a.closed_date) from public.capa_actions a where a.capa_id = c.id) as last_done,
      (select count(*) from public.capa_checks k where k.capa_id = c.id) as check_count,
      (select k.result = 'effective' from public.capa_checks k
        where k.capa_id = c.id order by k.checked_at asc limit 1) as first_check_effective,
      coalesce((
        select k.result = 'not_effective'
               and not exists (
                 select 1 from public.capa_actions a
                 where a.capa_id = c.id and a.created_at > k.checked_at
               )
        from public.capa_checks k
        where k.capa_id = c.id
        order by k.checked_at desc
        limit 1
      ), false) as reopened
  ) s;

grant select on public.capas_expanded to authenticated;
