-- FactoryOS · Quality — the Deviation / CAPA fix list, M1 to M5, S2, S3 and D1
--
-- Run after 0074.
--
--   M1 · **A case closes once its CAPA's plan is approved.** Until now a case
--        under a CAPA waited for the CAPA to be verified effective — often
--        3–6 months — and went overdue against its own due date all that
--        time. Effectiveness is now tracked on the CAPA, which has its own
--        dates; the case still links to it, so its report shows the result.
--        `deviations_guard` (0068's, one rule changed).
--
--   M2 · **One root cause, the case's.** A CAPA may still be drafted while
--        its case's investigation is pending, but its plan is not approved
--        until that investigation is: `capas_guard` adds "investigation
--        approved on DEV-…" to what the approval still needs. The CAPA's own
--        `root_cause` stays the draft it was planned against, so the screen
--        can say when the approved one differs.
--
--   M3 · **Withdraw a CAPA.** A CAPA still in Plan can be withdrawn, with a
--        reason (`withdraw_capa`): status `withdrawn`, kept as a record (its
--        number is never reused), not edited again, and its cases go back to
--        "Is a CAPA required?" undecided. A case can no longer leave a CAPA
--        with no case at all — answering No, or removing the case, is
--        refused while it is the CAPA's only case
--        (`deviations_capa_required_guard`).
--
--   M4 · **Files on a CAPA** — `capa_attachments`, in the same private
--        `case-files` bucket under `{factory}/capa/{capa}/…`: on the CAPA,
--        on an action marked done, or with an effectiveness check. Attached
--        by a supervisor and up while the CAPA is open; never removed once
--        it is closed. Each one is on the CAPA's history.
--
--   M5 · **The date an action was done.** Marking an action done takes the
--        date it was done (not after today, not before the CAPA was
--        raised); when it was recorded stays on the history.
--
--   S2 · **Searching CAPAs to add a case to** — `search_capas()`, so the
--        list shows the latest few and finds the rest in the database.
--
--   S3 · **Removing a correction keeps it, with a reason** (EU GMP Annex 11
--        §9): `removed_at`, `removed_by`, `removed_by_name`,
--        `removed_reason`; the delete policy is gone, removal is an update.
--
--   D1 · **Creating a CAPA locks the case** — `create_capa_plan` reads the
--        case `for update`, so two CAPAs cannot be created for one case at
--        the same moment.
--
-- The new enum value is only compared as text in this file: a value added
-- by `alter type … add value` cannot be used in the same transaction.

-- ── 1. Withdrawn ─────────────────────────────────────────────────────────

alter type public.capa_status add value if not exists 'withdrawn';

alter table public.capas
  add column if not exists withdrawn_at      timestamptz,
  add column if not exists withdrawn_by      uuid references public.profiles (id) on delete set null,
  add column if not exists withdrawn_by_name text,
  add column if not exists withdraw_reason   text;

alter table public.capas drop constraint if exists capas_withdrawn_signed;
alter table public.capas add constraint capas_withdrawn_signed check (
  status::text <> 'withdrawn'
  or (
    withdrawn_at is not null
    and length(btrim(coalesce(withdraw_reason, ''))) >= 10
    and coalesce(btrim(withdrawn_by_name), '') <> ''
  )
);

-- ── 2. The CAPA's gate ───────────────────────────────────────────────────

/**
 * 0074's guard, with:
 *  · M2 — the plan is not approved while a deviation it covers has its
 *    investigation still to be approved;
 *  · M3 — Open → Withdrawn, only before the plan is approved, with a reason
 *    and a name; a withdrawn CAPA is not edited again.
 */
create or replace function public.capas_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['created_by', 'verified_by', 'plan_approved_by', 'recurrence_of', 'withdrawn_by'];
  missing text[] := '{}';
  prior   public.capas%rowtype;
  pending text;
begin
  if tg_op = 'INSERT' then
    if new.status::text <> 'open' then
      raise exception 'A new CAPA starts as Open.'
        using errcode = 'check_violation';
    end if;
    if new.recurrence_of is not null then
      select * into prior from public.capas where id = new.recurrence_of;
      if not found or prior.factory_id <> new.factory_id then
        raise exception 'That CAPA is not in this factory.'
          using errcode = 'check_violation';
      end if;
      if prior.status::text <> 'effective' then
        raise exception '% is not a closed CAPA — add the case to it instead of starting a follow-up.', prior.capa_no
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
    new.withdrawn_at          := null;
    new.withdrawn_by          := null;
    new.withdrawn_by_name     := null;
    new.withdraw_reason       := null;
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

  -- ── Effective or withdrawn: the signed record ──
  if old.status::text in ('effective', 'withdrawn') then
    if (to_jsonb(new) - nullable_keys) is distinct from (to_jsonb(old) - nullable_keys) then
      if old.status::text = 'withdrawn' then
        raise exception '% was withdrawn — a withdrawn CAPA is not edited.', old.capa_no
          using errcode = 'check_violation';
      end if;
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
    -- M2: the plan is approved against the case's approved root cause.
    select string_agg(d.deviation_no, ', ' order by d.created_at) into pending
    from public.deviations d
    where d.capa_id = new.id
      and d.type::text in ('planned', 'unplanned')
      and d.investigation_required is distinct from false
      and d.investigation_approved_at is null;
    if pending is not null then
      missing := array_append(missing, ('investigation approved on ' || pending)::text);
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

  -- ── Open → Withdrawn (M3) ──
  if new.status::text = 'withdrawn' then
    if new.plan_approved_at is not null then
      raise exception 'The plan of % is approved — an approved CAPA is not withdrawn.', old.capa_no
        using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.withdraw_reason, ''))) < 10 then
      raise exception 'Say why the CAPA is withdrawn — at least a sentence.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.withdrawn_by_name), '') = '' then
      raise exception 'Withdrawing needs a name against it.'
        using errcode = 'check_violation';
    end if;
    new.withdraw_reason   := btrim(new.withdraw_reason);
    new.withdrawn_by_name := btrim(new.withdrawn_by_name);
    new.withdrawn_at      := now();
    new.withdrawn_by      := auth.uid();
    return new;
  end if;
  new.withdrawn_at      := null;
  new.withdrawn_by      := null;
  new.withdrawn_by_name := null;
  new.withdraw_reason   := null;

  -- ── Open → Effective ──
  if new.status::text = 'effective' then
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

-- ── 3. The CAPA's history — withdrawing too ──────────────────────────────

/** 0074's, with the withdrawal on the CAPA and on each case it covered. */
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

  if old.status::text <> 'withdrawn' and new.status::text = 'withdrawn' then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, reason)
    values (new.factory_id, new.id, who, coalesce(new.withdrawn_by_name, who_name),
            'withdrawn', new.withdraw_reason);
    -- Written while the cases are still linked: `withdraw_capa` unlinks them after.
    insert into public.deviation_audit (factory_id, deviation_id, actor, actor_name, action, new_value, reason)
    select d.factory_id, d.id, who, coalesce(new.withdrawn_by_name, who_name),
           'capa_withdrawn', new.capa_no, new.withdraw_reason
    from public.deviations d where d.capa_id = new.id;
  end if;

  return null;
end;
$fn$;

-- ── 4. Withdrawing a CAPA ────────────────────────────────────────────────

/**
 * M3: a CAPA still in Plan is withdrawn with a reason. It is kept, read-only;
 * each open case it covered goes back to "Is a CAPA required?" undecided.
 */
create or replace function public.withdraw_capa(
  p_capa    uuid,
  p_reason  text,
  p_by_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target public.capas%rowtype;
begin
  select * into target from public.capas where id = p_capa for update;
  if not found then
    raise exception 'CAPA not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can withdraw a CAPA.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.status::text <> 'open' then
    raise exception '% is already %.', target.capa_no,
      case target.status::text when 'withdrawn' then 'withdrawn' else 'closed' end
      using errcode = 'check_violation';
  end if;
  if target.plan_approved_at is not null then
    raise exception 'The plan of % is approved — an approved CAPA is not withdrawn.', target.capa_no
      using errcode = 'check_violation';
  end if;

  -- The guard checks the reason and the name, stamps it, and the audit
  -- trigger records it on the CAPA and on each case.
  update public.capas
     set status = 'withdrawn',
         withdraw_reason = p_reason,
         withdrawn_by_name = p_by_name
   where id = p_capa;

  update public.deviations
     set capa_id = null,
         capa_needed = null,
         capa_not_needed_reason = null
   where capa_id = p_capa
     and status = 'open';
end;
$fn$;

revoke all on function public.withdraw_capa(uuid, text, text) from public;
grant execute on function public.withdraw_capa(uuid, text, text) to authenticated;

-- ── 5. A CAPA is never left with no case ─────────────────────────────────

/**
 * 0074's (a recurring deviation cannot answer No), and M3: a case does not
 * leave a CAPA it is the only case of — by No, or by being removed. Before
 * the plan is approved the CAPA is withdrawn instead; after, the case stays.
 */
create or replace function public.deviations_capa_required_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  linked public.capas%rowtype;
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

-- (The trigger itself is 0074's: before update on public.deviations.)

-- ── 6. A case closes once its CAPA's plan is approved (M1) ───────────────

/** 0068's guard; only the CAPA rules of linking and closing change. */
create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  nullable_keys text[] := array['product_id', 'action_id', 'capa_id', 'created_by', 'closed_by', 'department_id'];
  linked  public.capas%rowtype;
  src     text[];
  missing text;
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
     and (new.disposition = 'quarantine' or new.hold_batch is true) then
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
  if new.status = 'closed' then
    if coalesce(btrim(new.immediate_action), '') = '' then
      raise exception 'Record the immediate action taken before closing.'
        using errcode = 'check_violation';
    end if;

    if new.type::text in ('planned', 'unplanned') and new.assessed_at is null then
      raise exception 'Sign the initial assessment before closing.'
        using errcode = 'check_violation';
    end if;

    if new.likelihood is null or new.severity is null
       or (new.detection is null and new.type::text not in ('planned', 'unplanned')) then
      raise exception 'Complete the risk assessment — likelihood, severity and probability of detection.'
        using errcode = 'check_violation';
    end if;
    if new.financial_impact is null
       and new.type::text not in ('planned', 'unplanned') then
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
      -- M1: the case closes once the CAPA's plan is approved; the CAPA's
      -- effectiveness is tracked on the CAPA, on its own dates.
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

-- ── 7. The date an action was done (M5) ──────────────────────────────────

/** 0073's guard; a done date is not after today nor before the CAPA was raised. */
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

  if parent.status::text <> 'open' then
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
    -- A day's slack either way: the date is picked in the factory's time
    -- zone, the database runs in UTC.
    if new.closed_date > current_date + 1 then
      raise exception 'The date done cannot be in the future.'
        using errcode = 'check_violation';
    end if;
    if new.closed_date < (parent.created_at at time zone 'UTC')::date - 1 then
      raise exception 'The date done cannot be before % was raised.', parent.capa_no
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

-- ── 8. Files on a CAPA (M4) ──────────────────────────────────────────────

create table if not exists public.capa_attachments (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references public.factories (id) on delete cascade,
  capa_id          uuid not null references public.capas (id) on delete cascade,
  -- Where on the CAPA: the CAPA itself, an action's completion, or a check.
  section          text not null default 'capa',
  -- The action it is the evidence of (section 'action').
  action_id        uuid references public.capa_actions (id) on delete set null,
  -- `{factory_id}/capa/{capa_id}/{uuid}-{file name}` in the `case-files` bucket.
  storage_path     text not null unique,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       bigint not null,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),

  constraint capa_attachments_section_known check (section in ('capa', 'action', 'check')),
  constraint capa_attachments_size check (size_bytes > 0 and size_bytes <= 10485760),
  constraint capa_attachments_name_not_blank check (length(btrim(file_name)) > 0)
);

create index if not exists capa_attachments_capa_idx
  on public.capa_attachments (capa_id, created_at);

alter table public.capa_attachments enable row level security;

drop policy if exists "capa_attachments_member_read" on public.capa_attachments;
create policy "capa_attachments_member_read"
  on public.capa_attachments for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- Supervisor and up, onto an open CAPA of the same factory, at a path under it.
drop policy if exists "capa_attachments_review_insert" on public.capa_attachments;
create policy "capa_attachments_review_insert"
  on public.capa_attachments for insert
  with check (
    public.can_review_factory(factory_id)
    and uploaded_by = auth.uid()
    and storage_path like factory_id::text || '/capa/' || capa_id::text || '/%'
    and exists (
      select 1 from public.capas c
      where c.id = capa_id
        and c.factory_id = capa_attachments.factory_id
        and c.status::text = 'open'
    )
    and (
      action_id is null
      or exists (
        select 1 from public.capa_actions a
        where a.id = action_id and a.capa_id = capa_attachments.capa_id
      )
    )
  );

-- Only the uploader, while the CAPA is open, and not the evidence of an
-- action already done.
drop policy if exists "capa_attachments_own_delete" on public.capa_attachments;
create policy "capa_attachments_own_delete"
  on public.capa_attachments for delete
  using (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.capas c
      where c.id = capa_id and c.status::text = 'open'
    )
    and not exists (
      select 1 from public.capa_actions a
      where a.id = action_id and a.closed_date is not null
    )
  );

-- No update policy: a file is removed and attached again, not edited.

/** Each file attached or removed, on the CAPA's history. */
create or replace function public.capa_attachments_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, field, new_value)
    values (new.factory_id, new.capa_id, auth.uid(),
            coalesce(new.uploaded_by_name, public.audit_actor_name()),
            'file_attached', new.section, new.file_name);
    return null;
  end if;
  -- The CAPA itself is being removed (cascade): nothing to record.
  if not exists (select 1 from public.capas where id = old.capa_id) then
    return null;
  end if;
  insert into public.capa_audit (factory_id, capa_id, actor, actor_name, action, field, old_value)
  values (old.factory_id, old.capa_id, auth.uid(), public.audit_actor_name(),
          'file_removed', old.section, old.file_name);
  return null;
end;
$fn$;

drop trigger if exists capa_attachments_audit on public.capa_attachments;
create trigger capa_attachments_audit
  after insert or delete on public.capa_attachments
  for each row execute function public.capa_attachments_audit();

-- (The bucket and its policies are 0064's: the first folder of every path is
-- the factory, which `{factory}/capa/…` keeps.)

-- ── 9. The CAPA read model ───────────────────────────────────────────────
-- 0074's view: step `withdrawn`, and the withdrawal appended.

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
    when c.status::text = 'withdrawn' then 'withdrawn'
    when c.status::text = 'effective' then 'closed'
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
  ), '{}') as action_owners,

  -- ── Appended by 0075 ──────────────────────────────────────────────────
  c.withdrawn_at,
  c.withdrawn_by_name,
  c.withdraw_reason
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

-- ── 10. The case read model — its CAPA's plan approval appended ──────────
-- 0070's view, with `capa_plan_approved_at` (M1: the case closes on it) and
-- `capa_case_count` (M3: whether this case is its CAPA's only one).

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
  end as capa_case_count
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

grant select on public.deviations_expanded to authenticated;

-- ── 11. Searching CAPAs to add a case to (S2) ────────────────────────────

/**
 * "Add to an existing CAPA": the open (or closed) CAPAs of a factory that
 * match the search — CAPA number, title, root cause, or any of its cases'
 * number, title, root cause or product — newest first, at most `p_limit`.
 * An empty search gives the latest few. Withdrawn CAPAs are never offered.
 *
 * Returns the ids in order; the caller reads them from `capas_expanded`.
 * Security invoker: RLS decides what is visible.
 */
create or replace function public.search_capas(
  p_factory uuid,
  p_query   text,
  p_closed  boolean,
  p_limit   integer default 8
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $fn$
  with q as (
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_query, '')) = '' as blank
  )
  select c.id
  from public.capas c, q
  where c.factory_id = p_factory
    and c.status::text = case when p_closed then 'effective' else 'open' end
    and (
      q.blank
      or c.capa_no ilike q.pat
      or c.title ilike q.pat
      or coalesce(c.root_cause, '') ilike q.pat
      or exists (
        select 1 from public.deviations d
        where d.capa_id = c.id
          and (
            d.deviation_no ilike q.pat
            or d.title ilike q.pat
            or coalesce(d.root_cause, '') ilike q.pat
            or exists (
              select 1 from public.factory_products p
              where p.id = any (d.product_ids)
                and (p.name ilike q.pat or coalesce(p.code, '') ilike q.pat
                     or coalesce(p.batch_no, '') ilike q.pat)
            )
          )
      )
    )
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 50);
$fn$;

revoke all on function public.search_capas(uuid, text, boolean, integer) from public;
grant execute on function public.search_capas(uuid, text, boolean, integer) to authenticated;

-- ── 12. Removing a correction keeps it, with a reason (S3) ───────────────
-- EU GMP Annex 11 §9: a change to or deletion of GMP data carries a reason.
-- A correction is no longer deleted: it is marked removed — when, by whom and
-- why — and stays on the list, struck through. Only the case being deleted
-- still takes its corrections with it.

alter table public.deviation_corrections
  add column if not exists removed_at      timestamptz,
  add column if not exists removed_by      uuid references public.profiles (id) on delete set null,
  add column if not exists removed_by_name text,
  add column if not exists removed_reason  text;

alter table public.deviation_corrections drop constraint if exists deviation_corrections_removed_why;
alter table public.deviation_corrections add constraint deviation_corrections_removed_why check (
  removed_at is null or length(btrim(coalesce(removed_reason, ''))) >= 5
);

drop policy if exists "deviation_corrections_review_delete" on public.deviation_corrections;

drop policy if exists "deviation_corrections_review_update" on public.deviation_corrections;
create policy "deviation_corrections_review_update"
  on public.deviation_corrections for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

/**
 * 0074's guard, with removal as an update: only `removed_reason` (and the
 * name) may be set, once, on an open case; the rest of the row is fixed.
 */
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

  if tg_op = 'DELETE' then
    raise exception 'A correction is not deleted — remove it with a reason.'
      using errcode = 'check_violation';
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
    new.removed_at      := null;
    new.removed_by      := null;
    new.removed_by_name := null;
    new.removed_reason  := null;
    return new;
  end if;

  -- ── UPDATE: removing it, and nothing else ──
  if old.removed_at is not null then
    raise exception 'This correction was already removed.' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id
     or new.factory_id is distinct from old.factory_id
     or new.deviation_id is distinct from old.deviation_id
     or new.what is distinct from old.what
     or new.who is distinct from old.who
     or new.done_on is distinct from old.done_on
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'A correction is not edited — remove it with a reason and add it again.'
      using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(new.removed_reason, ''))) < 5 then
    raise exception 'Say why the correction is removed.' using errcode = 'check_violation';
  end if;
  new.removed_reason  := btrim(new.removed_reason);
  new.removed_by_name := coalesce(nullif(btrim(new.removed_by_name), ''), public.audit_actor_name());
  new.removed_at      := now();
  new.removed_by      := auth.uid();
  return new;
end;
$fn$;

drop trigger if exists deviation_corrections_guard on public.deviation_corrections;
create trigger deviation_corrections_guard
  before insert or update or delete on public.deviation_corrections
  for each row execute function public.deviation_corrections_guard();

/** 0074's, with the removal and its reason on the case's audit trail. */
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
  if tg_op = 'UPDATE' then
    if old.removed_at is null and new.removed_at is not null then
      insert into public.deviation_audit
        (factory_id, deviation_id, actor, actor_name, action, old_value, reason)
      values (new.factory_id, new.deviation_id, auth.uid(),
              coalesce(new.removed_by_name, public.audit_actor_name()),
              'correction_removed', new.what, new.removed_reason);
    end if;
    return null;
  end if;
  return null;  -- DELETE only by cascade with the case: nothing to record.
end;
$fn$;

drop trigger if exists deviation_corrections_audit on public.deviation_corrections;
create trigger deviation_corrections_audit
  after insert or update or delete on public.deviation_corrections
  for each row execute function public.deviation_corrections_audit();

-- ── 13. Creating a CAPA locks the case (D1) ──────────────────────────────
-- 0074's function; the case is read `for update`, so two people pressing
-- "Create CAPA" on the same case at once cannot both pass the "no CAPA yet"
-- check — the second waits, then is told the case is already under a CAPA.

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
  -- Locked: a second "Create CAPA" on this case waits here (D1).
  select * into target from public.deviations where id = p_case for update;
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
