-- FactoryOS · Issues & CAPAs — the staged flow
--
-- Migration 0017 gave an issue a clock and a thread. What it did not give it
-- was a *shape*: `open → in_progress → resolved`, with both buttons live from
-- the first second. You could open an issue and resolve it in one click, and
-- the record would say a thing was fixed without ever saying what was wrong.
--
-- This migration makes the loop a real CAPA cycle:
--
--     open  →  investigating  →  action_taken  →  closed
--
-- One stage at a time, forward, and each move has to be *paid for* with the
-- thing that stage exists to produce — an owner, a root cause, a corrective
-- action, a verification. That is the point. Four statuses that anyone can
-- jump between are just three extra clicks; four stages that each demand
-- evidence are a record of how the problem was actually solved.
--
-- Enforced here, in the database, and not in the dialog. Issues are written
-- browser-direct under RLS, so a gate that lives in React is decoration —
-- anyone with the anon key and the tenant's session can PATCH straight past
-- it. The trigger below is the only thing that actually cannot be skipped.

-- ── 1. The stages ────────────────────────────────────────────────────────
-- The view depends on `status`, so it has to go before the column type can
-- change. It is rebuilt, wider, at the bottom of this file.

drop view if exists public.actions_expanded;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'action_stage') then
    create type public.action_stage as enum (
      'open', 'investigating', 'action_taken', 'closed'
    );
  end if;
end $$;

-- Declaration order is comparison order for a Postgres enum, which is why the
-- check constraint further down can say `status >= 'action_taken'` and mean
-- "at or past the stage where a corrective action exists".

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'actions'
      and column_name = 'status' and udt_name = 'action_status'
  ) then
    -- The `using` clause *is* the backfill: existing rows are mapped in place,
    -- and nothing already finished is dragged back onto the board. Old rows
    -- carry no root cause and never will — the guard applies to transitions
    -- made from here on, not retroactively to history.
    alter table public.actions
      alter column status drop default,
      alter column status type public.action_stage using (
        case status::text
          when 'in_progress' then 'investigating'
          when 'resolved'    then 'closed'
          else                    'open'
        end::public.action_stage
      ),
      alter column status set default 'open';

    drop type if exists public.action_status;
  end if;
end $$;

-- ── 2. What each stage produces ──────────────────────────────────────────
-- Four fields, one per stage boundary. They live on `actions` rather than in
-- a child table because the cardinality is fixed — an issue has exactly one
-- root cause, not a list — and because a stage form that needs a join to
-- render is a stage form nobody fills in.
--
-- `action_notes` keeps doing its own job: the running commentary ("waiting on
-- the part", "retest booked Thursday") that changes nothing and belongs
-- nowhere near a stage gate.

alter table public.actions
  add column if not exists root_cause        text,
  add column if not exists corrective_action text,
  -- The P in CAPA, and the only optional one: not every issue has a
  -- generalisable fix, and a mandatory field with nothing to say collects
  -- "N/A" until it means nothing.
  add column if not exists preventive_action text,
  add column if not exists verification      text,

  add column if not exists investigating_at  timestamptz,
  add column if not exists investigating_by  uuid references public.profiles (id) on delete set null,
  add column if not exists action_taken_at   timestamptz,
  add column if not exists action_taken_by   uuid references public.profiles (id) on delete set null;

-- `resolved` became `closed`, so the stamps follow the vocabulary. Renamed
-- rather than dropped and re-added: these columns hold who actually signed off
-- on every issue closed before today, and that is not regenerable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'actions'
      and column_name = 'resolved_at'
  ) then
    alter table public.actions rename column resolved_at to closed_at;
    alter table public.actions rename column resolved_by to closed_by;
  end if;
end $$;

/**
 * Evidence may not run ahead of the stage that produces it.
 *
 * This is the constraint that answers "can someone write the corrective action
 * without ever investigating?" — no, because a row carrying `corrective_action`
 * while still `open` does not exist. It holds on insert as well as update, so
 * it cannot be dodged by creating an issue pre-filled.
 */
alter table public.actions
  drop constraint if exists actions_evidence_follows_stage;
alter table public.actions
  add constraint actions_evidence_follows_stage check (
    (root_cause        is null or status >= 'investigating')
    and (corrective_action is null or status >= 'action_taken')
    and (verification      is null or status >= 'closed')
    and (preventive_action is null or status >= 'action_taken')
  );

-- ── 3. The gate ──────────────────────────────────────────────────────────

/**
 * Everything that happens when an issue changes stage: what is allowed, what
 * it costs, and what gets stamped.
 *
 * Deliberately **one** function rather than a guard trigger plus a history
 * trigger. Two `before update` triggers fire in name order, which means the
 * correctness of the gate would rest on someone never renaming one of them.
 *
 * Backward moves are the interesting case. They are legal — verification does
 * fail, and a closed issue does come back — but only through
 * `revert_action()`, which demands a written reason. The transaction-local
 * `factoryos.revert` flag is how this function knows the caller came through
 * that door. A direct `update ... set status = 'open'` from the browser cannot
 * set it, so a revert without a recorded reason is not expressible.
 *
 * Going backwards also *clears* the evidence of the stage being abandoned —
 * a re-opened issue must not sit under a root cause that was already proved
 * wrong. Nothing is lost: the cleared text is copied into the thread first.
 */
create or replace function public.actions_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_revert boolean;
  archived  text;
  line      text;
begin
  -- New issues start at the beginning. Always, including the ones the shift
  -- log raises.
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new issue starts as Open.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Assignment, a corrected due date, a tweaked title: none of that is a
  -- stage change and none of it is this function's business.
  if new.status is not distinct from old.status then
    return new;
  end if;

  is_revert := coalesce(current_setting('factoryos.revert', true), '') = 'on';

  -- ── Forward, one stage at a time ──
  if old.status = 'open' and new.status = 'investigating' then
    -- You cannot investigate what nobody owns. This is the whole content of
    -- the first stage: the issue stops being everyone's problem, which is to
    -- say nobody's, and becomes someone's.
    if coalesce(btrim(new.assigned_to), '') = '' then
      raise exception 'Assign this issue to someone before starting the investigation.'
        using errcode = 'check_violation';
    end if;

    new.investigating_at := now();
    new.investigating_by := auth.uid();
    line := 'Investigation started.';

  elsif old.status = 'investigating' and new.status = 'action_taken' then
    if coalesce(btrim(new.root_cause), '') = '' then
      raise exception 'Record the root cause before logging the action taken.'
        using errcode = 'check_violation';
    end if;
    if coalesce(btrim(new.corrective_action), '') = '' then
      raise exception 'Describe the corrective action taken.'
        using errcode = 'check_violation';
    end if;

    new.action_taken_at := now();
    new.action_taken_by := auth.uid();
    line := 'Action taken.';

  elsif old.status = 'action_taken' and new.status = 'closed' then
    if coalesce(btrim(new.verification), '') = '' then
      raise exception 'Record how the fix was verified before closing.'
        using errcode = 'check_violation';
    end if;
    -- Supervisor and up — `can_review_factory()`, the same bar Kaizen reviews
    -- use. Closing is a review, not a self-declaration.
    if not public.can_review_factory(new.factory_id) then
      raise exception 'Only a supervisor or above can close an issue.'
        using errcode = 'insufficient_privilege';
    end if;

    new.closed_at := now();
    new.closed_by := auth.uid();

    -- Not blocked when the closer is the person who did the work: a factory
    -- running one supervisor on nights would deadlock until the day shift.
    -- Recorded instead, permanently, in the thread.
    line := case
      when new.action_taken_by is not null and new.action_taken_by = auth.uid()
        then 'Closed by the same person who took the action.'
      else 'Closed.'
    end;

  -- ── Backward, and only with a reason ──
  elsif is_revert and old.status = 'action_taken' and new.status = 'investigating' then
    archived := btrim(concat_ws(E'\n',
      'Cleared on reverting to Investigating —',
      'Corrective action: ' || new.corrective_action,
      case when new.preventive_action is not null
        then 'Preventive action: ' || new.preventive_action end
    ));

    new.corrective_action := null;
    new.preventive_action := null;
    new.action_taken_at   := null;
    new.action_taken_by   := null;
    line := 'Reverted to Investigating.';

  elsif is_revert and old.status = 'closed' and new.status = 'open' then
    archived := btrim(concat_ws(E'\n',
      'Cleared on re-opening —',
      'Root cause: ' || new.root_cause,
      'Corrective action: ' || new.corrective_action,
      case when new.preventive_action is not null
        then 'Preventive action: ' || new.preventive_action end,
      'Verification: ' || new.verification
    ));

    new.root_cause        := null;
    new.corrective_action := null;
    new.preventive_action := null;
    new.verification      := null;
    new.investigating_at  := null;
    new.investigating_by  := null;
    new.action_taken_at   := null;
    new.action_taken_by   := null;
    new.closed_at         := null;
    new.closed_by         := null;
    line := 'Re-opened.';

  else
    raise exception
      'An issue moves one stage at a time: Open → Investigating → Action taken → Closed. Going back needs a reason.'
      using errcode = 'check_violation';
  end if;

  -- The stage change writes itself into the thread. In the trigger so it
  -- cannot be skipped by a caller that forgets, and so the name on it is the
  -- signed-in user rather than something the client claimed.
  insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
  values (new.factory_id, new.id, line, true, auth.uid());

  if archived is not null and archived <> '' then
    insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
    values (new.factory_id, new.id, archived, true, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists actions_status_history on public.actions;
drop function if exists public.actions_log_status_change();

drop trigger if exists actions_stage_transition on public.actions;
create trigger actions_stage_transition
  before insert or update on public.actions
  for each row execute function public.actions_stage_transition();

-- ── 4. Going backwards, with the reason attached ─────────────────────────

/**
 * Moves an issue back a stage. The only door to a backward transition.
 *
 * The reason is a required argument rather than a note the client is trusted
 * to write first, because "please also add a note" is not a rule — it is a
 * hope. Here the reason and the move are one statement: no reason, no move,
 * and no way to perform the move without passing through this function.
 */
create or replace function public.revert_action(
  p_action uuid,
  p_to     public.action_stage,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.actions%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this is going back.'
      using errcode = 'check_violation';
  end if;

  select * into target from public.actions where id = p_action;
  if not found then
    raise exception 'Issue not found.' using errcode = 'no_data_found';
  end if;

  -- `security definer` bypasses RLS, so tenancy is re-checked by hand.
  if not (public.is_super_admin() or target.factory_id = public.current_factory_id()) then
    raise exception 'Issue not found.' using errcode = 'no_data_found';
  end if;

  -- Re-opening a closed issue undoes a supervisor's sign-off, so it takes the
  -- same standing that closing it did.
  if target.status = 'closed' and not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or above can re-open a closed issue.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The reason goes in first, so the thread reads in the order things
  -- happened: why, then the move. Signed by whoever pressed the button — the
  -- trigger's own lines are the ones marked `is_system`.
  insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
  values (target.factory_id, p_action, btrim(p_reason), false, auth.uid());

  -- Transaction-local: gone the moment this statement ends, so it cannot leak
  -- into an unrelated update later in a pooled connection.
  perform set_config('factoryos.revert', 'on', true);

  update public.actions set status = p_to where id = p_action;

  perform set_config('factoryos.revert', 'off', true);
end;
$$;

revoke all on function public.revert_action(uuid, public.action_stage, text) from public;
grant execute on function public.revert_action(uuid, public.action_stage, text) to authenticated;

-- ── 5. The read model ────────────────────────────────────────────────────
-- Two clocks now, and the reason there are two is that they measure different
-- kinds of lateness.
--
-- `due_at` and escalation belong to the fix: Open and Investigating are the
-- stages where a problem is still a problem. Once the corrective action is in,
-- the urgency is genuinely over — what remains is a signature. Keeping the
-- Critical badge burning through that window is how a factory learns to stop
-- reading badges.
--
-- So verification gets its own, slower clock, taken from `factories.
-- escalate_hours` — the 1–48h setting that has sat in Company settings since
-- migration 0005 without anything reading it.

create or replace view public.actions_expanded
with (security_invoker = true) as
select
  a.id,
  a.factory_id,
  a.title,
  a.unit_id,
  a.category,
  a.priority,
  a.status,
  a.assigned_to,
  a.due_at,
  a.notes,
  a.shift_log_entry_id,
  a.created_by,
  a.created_at,

  a.root_cause,
  a.corrective_action,
  a.preventive_action,
  a.verification,
  a.investigating_at,
  a.action_taken_at,
  a.closed_at,

  u.name as unit_name,

  -- Past its due time, and the fix still isn't in.
  (a.status < 'action_taken' and now() > a.due_at) as is_overdue,

  -- Overdue by a whole window again.
  (
    a.status < 'action_taken'
    and now() > a.due_at + public.action_window(a.priority)
  ) as is_escalated,

  (a.due_at + public.action_window(a.priority)) as escalates_at,

  -- When the sign-off is due. Null unless the issue is actually waiting on
  -- one, so the UI can key off the column rather than off the stage.
  (
    case when a.status = 'action_taken'
      then a.action_taken_at + make_interval(hours => f.escalate_hours)
    end
  ) as verify_due_at,

  (
    a.status = 'action_taken'
    and now() > a.action_taken_at + make_interval(hours => f.escalate_hours)
  ) as is_verify_overdue,

  (
    select count(*) from public.action_notes n where n.action_id = a.id
  ) as note_count
from public.actions a
  join public.factories f on f.id = a.factory_id
  left join public.factory_units u on u.id = a.unit_id;

comment on view public.actions_expanded is
  'Read model for Issues & CAPAs. Two clocks, both computed on every read and neither stored: `is_overdue`/`is_escalated` run while the fix is outstanding (Open, Investigating) and stop once the corrective action is in; `is_verify_overdue` then runs on the factory''s own escalate_hours until someone signs the issue off.';

grant select on public.actions_expanded to authenticated;
