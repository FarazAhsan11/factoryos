-- FactoryOS · Quality — quality settings: due dates
--
-- Run after 0070.
--
-- Configuration → Quality settings, as the reference QMS (qms-v5) has it:
-- the days a case has to close, by class, and the days QA has to sign the
-- initial assessment — per factory, and every change logged.
--
--   · `factory_quality_settings` — one row per factory: `due_critical_days`
--     (default 15), `due_major_days` (30), `due_minor_days` (60) and
--     `assess_days` (2). No row means the defaults. Members read it; manager
--     and up (`can_manage_factory`, as the rest of Configuration) write it.
--   · `quality_due_days(factory, class)` — the days for a class, from the
--     settings or the default.
--   · **Signing the initial assessment** (`deviations_assessment_guard`,
--     0068's, otherwise unchanged) sets the due date from the settings rather
--     than a fixed 15 / 30 / 60. The due date is written when the assessment
--     is signed and recorded in the case's audit trail, so a change to the
--     settings applies to cases assessed after it — it does not move the due
--     date of a case already signed.
--   · "Assess by" (raise + `assess_days`) is derived by the screens from the
--     settings, never stored, so it follows a change at once.
--   · `quality_settings_log` — append-only: who changed which setting, when,
--     from what to what. Written by a trigger, never by the browser.

-- ── 1. The settings ──────────────────────────────────────────────────────

create table if not exists public.factory_quality_settings (
  factory_id        uuid primary key references public.factories (id) on delete cascade,
  due_critical_days integer not null default 15,
  due_major_days    integer not null default 30,
  due_minor_days    integer not null default 60,
  assess_days       integer not null default 2,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  constraint factory_quality_settings_due_range check (
    due_critical_days between 1 and 365
    and due_major_days between 1 and 365
    and due_minor_days between 1 and 365
  ),
  constraint factory_quality_settings_assess_range check (
    assess_days between 1 and 30
  )
);

alter table public.factory_quality_settings enable row level security;

drop policy if exists "factory_quality_settings_member_read" on public.factory_quality_settings;
create policy "factory_quality_settings_member_read"
  on public.factory_quality_settings for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "factory_quality_settings_manager_insert" on public.factory_quality_settings;
create policy "factory_quality_settings_manager_insert"
  on public.factory_quality_settings for insert
  with check (public.can_manage_factory(factory_id));

drop policy if exists "factory_quality_settings_manager_update" on public.factory_quality_settings;
create policy "factory_quality_settings_manager_update"
  on public.factory_quality_settings for update
  using (public.can_manage_factory(factory_id))
  with check (public.can_manage_factory(factory_id));

-- No delete policy: the defaults are a row's absence, not its removal.

/** Who and when, from the database — not from the browser. */
create or replace function public.factory_quality_settings_stamp()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' and new.factory_id is distinct from old.factory_id then
    raise exception 'The factory of a settings row is fixed.'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$fn$;

drop trigger if exists factory_quality_settings_stamp on public.factory_quality_settings;
create trigger factory_quality_settings_stamp
  before insert or update on public.factory_quality_settings
  for each row execute function public.factory_quality_settings_stamp();

/** The days a case of this class has to close, from the factory's settings. */
create or replace function public.quality_due_days(p_factory uuid, p_class text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case p_class
    when 'Critical' then coalesce(s.due_critical_days, 15)
    when 'Major'    then coalesce(s.due_major_days, 30)
    else                 coalesce(s.due_minor_days, 60)
  end
  from (select 1) as one
    left join public.factory_quality_settings s on s.factory_id = p_factory;
$$;

-- ── 2. The change log ────────────────────────────────────────────────────

create table if not exists public.quality_settings_log (
  id          bigint generated always as identity primary key,
  factory_id  uuid not null references public.factories (id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references public.profiles (id) on delete set null,
  actor_name  text,
  setting     text not null,
  old_value   text,
  new_value   text
);

create index if not exists quality_settings_log_factory_idx
  on public.quality_settings_log (factory_id, at desc, id desc);

alter table public.quality_settings_log enable row level security;

drop policy if exists "quality_settings_log_member_read" on public.quality_settings_log;
create policy "quality_settings_log_member_read"
  on public.quality_settings_log for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No insert, update or delete policy, on purpose: only the trigger writes it.

/**
 * One row per setting that changed. The first save of a factory compares
 * against the defaults, which is what the factory ran on until then.
 */
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
begin
  if tg_op = 'UPDATE' then
    p_crit   := old.due_critical_days;
    p_major  := old.due_major_days;
    p_minor  := old.due_minor_days;
    p_assess := old.assess_days;
  end if;

  insert into public.quality_settings_log (factory_id, actor, actor_name, setting, old_value, new_value)
  select new.factory_id, auth.uid(), who, c.setting, c.old_value, c.new_value
  from (values
    ('Critical — days to close',  p_crit::text,   new.due_critical_days::text, 1),
    ('Major — days to close',     p_major::text,  new.due_major_days::text,    2),
    ('Minor — days to close',     p_minor::text,  new.due_minor_days::text,    3),
    ('Initial assessment — days', p_assess::text, new.assess_days::text,       4)
  ) as c(setting, old_value, new_value, ord)
  where c.old_value is distinct from c.new_value
  order by c.ord;

  return null;
end;
$fn$;

drop trigger if exists factory_quality_settings_log on public.factory_quality_settings;
create trigger factory_quality_settings_log
  after insert or update on public.factory_quality_settings
  for each row execute function public.factory_quality_settings_log();

-- ── 3. Signing the assessment sets the due date from the settings ────────

/**
 * 0068's guard, with one change: the due date is the raise date plus the
 * factory's days for the class (`quality_due_days`), not a fixed 15 / 30 / 60.
 */
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
  if new.type::text not in ('planned', 'unplanned') then
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
    raise exception 'Choose the category.' using errcode = 'check_violation';
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
