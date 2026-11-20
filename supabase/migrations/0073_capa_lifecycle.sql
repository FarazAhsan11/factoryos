-- FactoryOS · Quality — a CAPA's lifecycle: CAPA plan → Do → Effectiveness check
--
-- Run after 0072.
--
-- Until now a CAPA was open or effective: actions were added and closed in
-- any order, and "verified effective" was a form anyone could fill in once the
-- actions were closed. The reference QMS (qms-v6) runs every CAPA through three
-- steps, and this migration gives ours the same trail:
--
--   1 · **CAPA plan** — the owner writes the actions (what, who, due), how
--       we will know it worked (`effectiveness_criteria`), when to check
--       (`check_mode`: on a date, `verify_by`; or when the actions are done —
--       a simple fix — with `check_why`), and who checks it (`checker_name`).
--       Then the plan is **approved** (`plan_approved_at` / `_by` /
--       `_by_name`, with an optional `plan_approval_note`). Approving needs
--       every one of those answers. Until then actions may be added, changed
--       and removed; nothing can be done.
--   2 · **Do** — each action is marked done with its **evidence** (a
--       document, record or work order) and, optionally, a **linked record**
--       (a change control or training record). More actions may be added
--       after approval; the history says so.
--   3 · **Effectiveness check** — once every action is done: **worked** or
--       **didn't work**, with what was found, and why if it is checked before
--       its date. Each check is kept (`capa_checks`). Worked closes the CAPA
--       (status `effective`, as before). Didn't work sends it back to Do: it
--       is checked again once a new action has been added and done.
--
-- The step is **derived** in `capas_expanded` (`step`: plan / do / check /
-- closed), never stored. "Didn't work, nothing added since" is derived too.
--
-- Who may: supervisor and up, as for every Quality record. For now the owner
-- may approve their own plan and check their own CAPA — the reference QMS's
-- independent sign-off is not enforced yet, so it can be tested with one login.
--
-- **History** — `capa_audit`, append-only, written by triggers: the CAPA's
-- changes (marked "Changed after plan approval" once it is approved), every
-- action added, changed, removed or done, the plan approval, each check, and
-- each case linked or unlinked. Each linked case's own audit trail also gets
-- the plan approval and the check results.
--
-- **Existing CAPAs** — an effective one keeps its verification as its first
-- check, and its plan counts as approved. An open one with an action already
-- closed has started its Do step, so its plan counts as approved too. Both are
-- signed "Recorded before CAPA plan approval". Every other open CAPA starts in
-- the CAPA plan step.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.capas
  add column if not exists check_mode            text not null default 'dated',
  add column if not exists check_why             text,
  add column if not exists checker_name          text,
  add column if not exists plan_approved_at      timestamptz,
  add column if not exists plan_approved_by      uuid references public.profiles (id) on delete set null,
  add column if not exists plan_approved_by_name text,
  add column if not exists plan_approval_note    text;

alter table public.capas
  drop constraint if exists capas_check_mode_known;
alter table public.capas
  add constraint capas_check_mode_known check (
    check_mode in ('dated', 'at_implementation')
  );

alter table public.capa_actions
  add column if not exists evidence      text,
  add column if not exists linked_record text;

-- ── 2. The effectiveness checks ──────────────────────────────────────────

create table if not exists public.capa_checks (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references public.factories (id) on delete cascade,
  capa_id          uuid not null references public.capas (id) on delete cascade,
  result           text not null,
  findings         text not null,
  early_reason     text,
  checked_at       timestamptz not null default now(),
  checked_by       uuid references public.profiles (id) on delete set null,
  checked_by_name  text not null,
  constraint capa_checks_result_known check (result in ('effective', 'not_effective'))
);

create index if not exists capa_checks_capa_idx
  on public.capa_checks (capa_id, checked_at);

alter table public.capa_checks enable row level security;

drop policy if exists "capa_checks_member_read" on public.capa_checks;
create policy "capa_checks_member_read"
  on public.capa_checks for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No write policy: only `record_capa_check` writes it.

-- ── 3. Existing CAPAs ────────────────────────────────────────────────────

alter table public.capas disable trigger capas_guard;

insert into public.capa_checks
  (factory_id, capa_id, result, findings, checked_at, checked_by, checked_by_name)
select c.factory_id, c.id, 'effective', c.verification,
       coalesce(c.verified_at, c.created_at), c.verified_by,
       coalesce(nullif(btrim(c.verified_by_name), ''), 'Recorded before CAPA plan approval')
from public.capas c
where c.status = 'effective'
  and coalesce(btrim(c.verification), '') <> ''
  and not exists (select 1 from public.capa_checks k where k.capa_id = c.id);

update public.capas c
   set plan_approved_at      = c.created_at,
       plan_approved_by_name = 'Recorded before CAPA plan approval'
 where c.plan_approved_at is null
   and (
     c.status = 'effective'
     or exists (
       select 1 from public.capa_actions a
       where a.capa_id = c.id and a.closed_date is not null
     )
   );

alter table public.capas enable trigger capas_guard;

-- ── 4. The CAPA's gate ───────────────────────────────────────────────────

/**
 * 0057's guard, with the plan approval and the check:
 *  · the plan approval is set once, with every answer it needs, and stamped
 *    by the database; it is never taken back;
 *  · open → effective needs an effective check on record — only
 *    `record_capa_check` writes one — besides 0057's conditions.
 */
create or replace function public.capas_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['created_by', 'verified_by', 'plan_approved_by'];
  missing text[] := '{}';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new CAPA starts as Open.'
        using errcode = 'check_violation';
    end if;
    new.capa_no := public.next_document_number(new.factory_id, 'CAPA', 'CAPA');
    new.title := btrim(new.title);
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
     or new.created_at is distinct from old.created_at then
    raise exception 'The number, factory and raised time of a CAPA are fixed.'
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
      missing := array_append(missing, 'who and due date on every action'::text);
    end if;
    if coalesce(btrim(new.effectiveness_criteria), '') = '' then
      missing := array_append(missing, 'how you will know it worked'::text);
    end if;
    if new.check_mode = 'dated' and new.verify_by is null then
      missing := array_append(missing, 'the check date'::text);
    end if;
    if new.check_mode = 'at_implementation' and coalesce(btrim(new.check_why), '') = '' then
      missing := array_append(missing, 'why no dated check is needed'::text);
    end if;
    if coalesce(btrim(new.checker_name), '') = '' then
      missing := array_append(missing, 'who checks it'::text);
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

-- ── 5. An action's gate ──────────────────────────────────────────────────

/**
 * 0057's guard, with the plan: an action is done only once the plan is
 * approved, and only with its evidence. A done action is frozen, as before.
 */
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

    if old.closed_date is not null then
      if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
        raise exception 'This action is done — a done action is not edited.'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
  end if;

  if parent.status <> 'open' then
    raise exception '% is closed — its actions are not changed.', parent.capa_no
      using errcode = 'check_violation';
  end if;

  new.evidence      := nullif(btrim(coalesce(new.evidence, '')), '');
  new.linked_record := nullif(btrim(coalesce(new.linked_record, '')), '');

  if new.closed_date is not null then
    if parent.plan_approved_at is null then
      raise exception 'Approve the CAPA plan first — its actions start after approval.'
        using errcode = 'check_violation';
    end if;
    if new.evidence is null then
      raise exception 'Give the evidence — a document, record or work order.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.closed_by_name), '') = '' then
      raise exception 'Marking an action done needs a name against it.'
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

/** Removing an action: only from a plan not yet approved, and never a done one. */
create or replace function public.capa_actions_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  parent public.capas%rowtype;
begin
  select * into parent from public.capas where id = old.capa_id;
  -- The CAPA itself is being removed (cascade): nothing to protect.
  if not found then
    return old;
  end if;
  if parent.plan_approved_at is not null or old.closed_date is not null then
    raise exception 'Actions are removed only from a CAPA plan not yet approved.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$fn$;

drop trigger if exists capa_actions_delete_guard on public.capa_actions;
create trigger capa_actions_delete_guard
  before delete on public.capa_actions
  for each row execute function public.capa_actions_delete_guard();

drop policy if exists "capa_actions_review_delete" on public.capa_actions;
create policy "capa_actions_review_delete"
  on public.capa_actions for delete
  using (public.can_review_factory(factory_id));

-- ── 6. Recording the effectiveness check ─────────────────────────────────

/**
 * Worked → the CAPA closes (effective). Didn't work → it goes back to Do,
 * until a new action is added and done. Supervisor and up; the owner may
 * check their own CAPA for now.
 */
create or replace function public.record_capa_check(
  p_capa         uuid,
  p_effective    boolean,
  p_findings     text,
  p_early_reason text,
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
  -- Didn't work last time: something new must have been done since.
  select max(k.checked_at) into last_bad
  from public.capa_checks k
  where k.capa_id = p_capa and k.result = 'not_effective';
  if last_bad is not null and not exists (
    select 1 from public.capa_actions a where a.capa_id = p_capa and a.created_at > last_bad
  ) then
    raise exception 'The last check said it didn''t work — add a new action, then check again.'
      using errcode = 'check_violation';
  end if;
  if p_effective is null then
    raise exception 'Say whether it worked.' using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_findings), '')) < 10 then
    raise exception 'Say what you found — what you looked at and what it showed.'
      using errcode = 'check_violation';
  end if;
  if target.check_mode = 'dated' and target.verify_by is not null
     and current_date < target.verify_by
     and length(coalesce(btrim(p_early_reason), '')) < 5 then
    raise exception 'Say why it is checked before %.', to_char(target.verify_by, 'DD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The check needs a name against it.' using errcode = 'check_violation';
  end if;

  insert into public.capa_checks
    (factory_id, capa_id, result, findings, early_reason, checked_by, checked_by_name)
  values
    (target.factory_id, p_capa,
     case when p_effective then 'effective' else 'not_effective' end,
     btrim(p_findings), nullif(btrim(coalesce(p_early_reason, '')), ''),
     auth.uid(), btrim(p_by_name));

  if p_effective then
    update public.capas
       set status = 'effective',
           verification = btrim(p_findings),
           verified_by_name = btrim(p_by_name)
     where id = p_capa;
  end if;
end;
$fn$;

grant execute on function public.record_capa_check(uuid, boolean, text, text, text) to authenticated;

-- ── 7. The CAPA's history ────────────────────────────────────────────────

create table if not exists public.capa_audit (
  id          bigint generated always as identity primary key,
  factory_id  uuid not null references public.factories (id) on delete cascade,
  capa_id     uuid not null references public.capas (id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references public.profiles (id) on delete set null,
  actor_name  text,
  -- created | changed | plan_approved | action_added | action_changed |
  -- action_removed | action_done | check_effective | check_not_effective |
  -- case_linked | case_unlinked
  action      text not null,
  field       text,
  old_value   text,
  new_value   text,
  reason      text
);

create index if not exists capa_audit_capa_idx on public.capa_audit (capa_id, at, id);

alter table public.capa_audit enable row level security;

drop policy if exists "capa_audit_member_read" on public.capa_audit;
create policy "capa_audit_member_read"
  on public.capa_audit for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No write policy, on purpose: only the triggers write it.

/** The CAPA's own changes, the plan approval, and closing. */
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
    -- And on every case it covers.
    insert into public.deviation_audit (factory_id, deviation_id, actor, actor_name, action, new_value)
    select d.factory_id, d.id, who, coalesce(new.plan_approved_by_name, who_name),
           'capa_plan_approved', new.capa_no
    from public.deviations d where d.capa_id = new.id;
  end if;

  return null;
end;
$fn$;

drop trigger if exists capas_audit on public.capas;
create trigger capas_audit
  after insert or update on public.capas
  for each row execute function public.capas_audit();

/** Actions added, changed, done and removed. */
create or replace function public.capa_actions_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who      uuid := auth.uid();
  who_name text := public.audit_actor_name();
  parent   public.capas%rowtype;
  label    text;
begin
  select * into parent from public.capas where id = coalesce(new.capa_id, old.capa_id);
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, field, new_value, reason)
    values (new.factory_id, new.capa_id, who, who_name, 'action_added', new.kind, new.description,
            case when parent.plan_approved_at is not null then 'Added after plan approval' end);
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, field, old_value)
    values (old.factory_id, old.capa_id, who, who_name, 'action_removed', old.kind, old.description);
    return null;
  end if;

  label := upper(new.kind) || ': ' || left(new.description, 60);

  if old.closed_date is null and new.closed_date is not null then
    insert into public.capa_audit
      (factory_id, capa_id, actor, actor_name, action, field, new_value, reason)
    values (new.factory_id, new.capa_id, who, coalesce(new.closed_by_name, who_name),
            'action_done', new.kind, new.description,
            new.evidence || coalesce(' · ' || new.linked_record, ''));
    return null;
  end if;

  insert into public.capa_audit
    (factory_id, capa_id, actor, actor_name, action, field, old_value, new_value, reason)
  select new.factory_id, new.capa_id, who, who_name, 'action_changed', label || ' — ' || c.field, c.o, c.n,
         case when parent.plan_approved_at is not null then 'Changed after plan approval' end
  from (values
    ('type',          upper(old.kind),       upper(new.kind)),
    ('description',   old.description,       new.description),
    ('owner',         old.owner_name,        new.owner_name),
    ('due date',      old.target_date::text, new.target_date::text),
    ('linked record', old.linked_record,     new.linked_record)
  ) as c(field, o, n)
  where c.o is distinct from c.n;

  return null;
end;
$fn$;

drop trigger if exists capa_actions_audit on public.capa_actions;
create trigger capa_actions_audit
  after insert or update or delete on public.capa_actions
  for each row execute function public.capa_actions_audit();

/** Each effectiveness check — on the CAPA, and on every case it covers. */
create or replace function public.capa_checks_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cp public.capas%rowtype;
begin
  select * into cp from public.capas where id = new.capa_id;
  insert into public.capa_audit (factory_id, capa_id, at, actor, actor_name, action, reason)
  values (new.factory_id, new.capa_id, new.checked_at, new.checked_by, new.checked_by_name,
          case new.result when 'effective' then 'check_effective' else 'check_not_effective' end,
          new.findings || coalesce(' · checked early because: ' || new.early_reason, ''));
  insert into public.deviation_audit (factory_id, deviation_id, at, actor, actor_name, action, new_value, reason)
  select d.factory_id, d.id, new.checked_at, new.checked_by, new.checked_by_name,
         case new.result when 'effective' then 'capa_effective' else 'capa_not_effective' end,
         cp.capa_no, new.findings
  from public.deviations d where d.capa_id = new.capa_id;
  return null;
end;
$fn$;

drop trigger if exists capa_checks_audit on public.capa_checks;
create trigger capa_checks_audit
  after insert on public.capa_checks
  for each row execute function public.capa_checks_audit();

/** A case linked to, or unlinked from, a CAPA — on the CAPA's history. */
create or replace function public.deviations_capa_link_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  who      uuid := auth.uid();
  who_name text := public.audit_actor_name();
begin
  if tg_op = 'UPDATE' and new.capa_id is not distinct from old.capa_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.capa_id is not null then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, old_value)
    select c.factory_id, c.id, who, who_name, 'case_unlinked', new.deviation_no
    from public.capas c where c.id = old.capa_id;
  end if;
  if new.capa_id is not null then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, new_value)
    select c.factory_id, c.id, who, who_name, 'case_linked', new.deviation_no
    from public.capas c where c.id = new.capa_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviations_capa_link_audit on public.deviations;
create trigger deviations_capa_link_audit
  after insert or update of capa_id on public.deviations
  for each row execute function public.deviations_capa_link_audit();

-- Every CAPA already raised gets its "created" entry, from when it was.
insert into public.capa_audit (factory_id, capa_id, at, actor, action, actor_name, new_value)
select c.factory_id, c.id, c.created_at, c.created_by, 'created',
       coalesce((select coalesce(nullif(btrim(p.full_name), ''), p.email)
                 from public.profiles p where p.id = c.created_by), 'System'),
       c.capa_no
from public.capas c
where not exists (select 1 from public.capa_audit a where a.capa_id = c.id);

-- ── 8. The read model, with the step derived ─────────────────────────────

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
  -- plan → do → check → closed, from the record.
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
  s.first_check_effective
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
      -- Didn't work, and nothing added since.
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

comment on view public.capas_expanded is
  'Read model for the CAPA register: the CAPA with its action counts, its cases, and its step (plan / do / check / closed) derived from the plan approval, the actions and the effectiveness checks — never stored.';

grant select on public.capas_expanded to authenticated;
