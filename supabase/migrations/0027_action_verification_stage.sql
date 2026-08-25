-- FactoryOS · Issues & CAPAs — a stage records its own name
--
-- Migration 0020 gave the module four stages, and 0026 gave Open a second
-- door. What neither fixed is that the *form* and the *stage* were one step
-- out of phase with each other.
--
-- An issue sitting at Investigating was shown three boxes — root cause,
-- corrective action, preventive action — because filling all three was the
-- price of moving to Action taken. That is coherent as a transition and
-- incoherent on screen: the stepper says INVESTIGATING in blue while the card
-- under it asks what was done about a cause nobody has written down yet. The
-- corrective action was being *collected* under the heading of the stage
-- before the one it names. Then "Action taken", the stage, turned out to be
-- the sign-off queue, and asked for a verification.
--
-- So each stage now collects the thing it is named after:
--
--     open           →  who owns it
--     investigating  →  the root cause
--     action taken   →  the corrective action (+ preventive)
--     verification   →  how you know it held
--     closed
--
-- Five stages, four gates, and every gate still paid for with the evidence it
-- produces — the bargain of 0020 is untouched, only re-aligned. The short road
-- from 0026 is untouched too: an open issue that needs no CAPA still closes in
-- one move, for the price of an account of what was done and supervisor
-- standing.
--
-- Existing rows at `action_taken` already hold a corrective action and are
-- waiting for a signature. That is the *new* Verification stage, exactly, so
-- they are backfilled onto it: nobody is asked to retype a fix they wrote
-- last week.

-- ── 0. Clear the dependents off the enum ─────────────────────────────────
-- The view, the check constraint and `revert_action`'s signature all bind to
-- `action_stage`. All three are rebuilt further down this file.

drop view if exists public.actions_expanded;

alter table public.actions
  drop constraint if exists actions_evidence_follows_stage;

drop function if exists public.revert_action(uuid, public.action_stage, text);

-- ── 1. What the new stage stamps ─────────────────────────────────────────
-- One pair per stage boundary, as before. `action_taken_at` keeps its column
-- name and changes what it marks — the moment the root cause landed and the
-- issue became somebody's fix to make — while the corrective action's own
-- timestamp moves to `verification_at`. For every row written before today
-- the two are the same instant anyway: root cause and corrective action were
-- submitted in one form, so the backfill below is exact, not approximate.

alter table public.actions
  add column if not exists verification_at timestamptz,
  add column if not exists verification_by uuid references public.profiles (id) on delete set null;

-- ── 2. The fifth stage ───────────────────────────────────────────────────
-- Swapped rather than `alter type ... add value`, which cannot be used in the
-- same transaction that adds it — and this migration compares against
-- 'verification' a few lines further down. Declaration order is comparison
-- order, so 'verification' has to sit between 'action_taken' and 'closed'.

do $swap$
begin
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
    where t.typname = 'action_stage' and e.enumlabel = 'verification'
  ) then
    create type public.action_stage_next as enum (
      'open', 'investigating', 'action_taken', 'verification', 'closed'
    );

    -- The `using` clause is the backfill. An issue at the old `action_taken`
    -- has its fix recorded and is waiting on a signature, which is precisely
    -- what the new Verification stage means.
    alter table public.actions
      alter column status drop default,
      alter column status type public.action_stage_next using (
        case status::text
          when 'action_taken' then 'verification'
          else status::text
        end::public.action_stage_next
      ),
      alter column status set default 'open';

    drop type public.action_stage;
    alter type public.action_stage_next rename to action_stage;

    -- Same instant, two stamps: these rows crossed both boundaries in a
    -- single submit, so the honest record is that both happened then.
    update public.actions
       set verification_at = action_taken_at,
           verification_by = action_taken_by
     where action_taken_at is not null
       and verification_at is null;
  end if;
end
$swap$;

-- ── 3. Evidence may not run ahead of the stage that collects it ──────────
--
-- Note "collects", not "leaves". Each field is legal from the moment its own
-- stage begins, which is what lets a half-finished investigation be saved
-- without moving the issue on — an investigation is rarely one sitting. What
-- stays impossible is the thing the stages exist to prevent: a corrective
-- action on a row that has never held a root cause.

alter table public.actions
  add constraint actions_evidence_follows_stage check (
        (root_cause        is null or status >= 'investigating')
    and (corrective_action is null or status >= 'action_taken')
    and (preventive_action is null or status >= 'action_taken')
    and (verification      is null or status >= 'verification')
  );

-- ── 4. The gate ──────────────────────────────────────────────────────────
-- Replaces the version in 0026. Same shape, one more forward move and one
-- more backward one; the corrective action is now the price of entering
-- Verification rather than of leaving Investigating.

create or replace function public.actions_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  is_revert boolean;
  archived  text;
  line      text;
  -- What the text in `verification` should be called for *this* issue. An
  -- issue that was never investigated has a resolution, not a verification,
  -- and an error message that calls it the wrong thing sends someone looking
  -- for a field that isn't on their screen.
  verify_word text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new issue starts as Open.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  verify_word := case
    when new.investigating_at is null then 'resolution'
    else 'verification'
  end;

  -- ── No stage change: an assignment, a due date — or a correction ──
  if new.status is not distinct from old.status then
    if (new.root_cause        is distinct from old.root_cause)
    or (new.corrective_action is distinct from old.corrective_action)
    or (new.preventive_action is distinct from old.preventive_action)
    or (new.verification      is distinct from old.verification)
    then
      -- Amending a closed issue rewrites something a supervisor signed. It
      -- takes the standing that signing it took.
      if new.status = 'closed' and not public.can_review_factory(new.factory_id) then
        raise exception 'Only a supervisor or above can amend a closed issue.'
          using errcode = 'insufficient_privilege';
      end if;

      -- Nothing on the record may be emptied — that is reverting, minus the
      -- reason. Asked of `old`, so an issue that legitimately never held a
      -- root cause is not accused of losing one.
      if coalesce(btrim(old.root_cause), '') <> ''
         and coalesce(btrim(new.root_cause), '') = '' then
        raise exception 'The root cause is part of the record — correct it, don''t remove it.'
          using errcode = 'check_violation';
      end if;
      if coalesce(btrim(old.corrective_action), '') <> ''
         and coalesce(btrim(new.corrective_action), '') = '' then
        raise exception 'The corrective action is part of the record — correct it, don''t remove it.'
          using errcode = 'check_violation';
      end if;
      if coalesce(btrim(old.verification), '') <> ''
         and coalesce(btrim(new.verification), '') = '' then
        raise exception 'The % is part of the record — correct it, don''t remove it.', verify_word
          using errcode = 'check_violation';
      end if;

      perform public.action_amend_note(new.factory_id, new.id,
        'Root cause', old.root_cause, new.root_cause);
      perform public.action_amend_note(new.factory_id, new.id,
        'Corrective action', old.corrective_action, new.corrective_action);
      perform public.action_amend_note(new.factory_id, new.id,
        'Preventive action', old.preventive_action, new.preventive_action);
      perform public.action_amend_note(new.factory_id, new.id,
        initcap(verify_word), old.verification, new.verification);
    end if;

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

  -- ── The short road, from 0026 ──
  --
  -- The one legal skip, and the only forward move that crosses more than one
  -- stage. It leaves `investigating_at` null, which is not an omission but
  -- the record: those stages did not happen, and a timeline that claimed
  -- otherwise would be inventing an investigation.
  elsif old.status = 'open' and new.status = 'closed' then
    if coalesce(btrim(new.verification), '') = '' then
      raise exception 'Say how this was dealt with before resolving it.'
        using errcode = 'check_violation';
    end if;
    -- Judging that an issue needs no CAPA *is* the review. Same bar as any
    -- other close.
    if not public.can_review_factory(new.factory_id) then
      raise exception 'Only a supervisor or above can resolve an issue without an investigation.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Nothing may arrive pre-filled on this path: a corrective action written
    -- without an investigation is exactly what the stages exist to prevent,
    -- and the short road is not a side entrance to it.
    if coalesce(btrim(new.root_cause), '') <> ''
    or coalesce(btrim(new.corrective_action), '') <> ''
    or coalesce(btrim(new.preventive_action), '') <> '' then
      raise exception 'Resolving directly records what was done, not a root cause — start an investigation for that.'
        using errcode = 'check_violation';
    end if;

    new.closed_at := now();
    new.closed_by := auth.uid();
    line := 'Resolved directly — no investigation needed.';

  -- ── investigating → action_taken: the cause is known ──
  --
  -- The corrective action is deliberately *not* demanded here any more. What
  -- to actually do about it is the next stage's question, and asking both at
  -- once is what made the old Investigating card ask people to describe a fix
  -- for a cause they were still in the middle of typing.
  elsif old.status = 'investigating' and new.status = 'action_taken' then
    if coalesce(btrim(new.root_cause), '') = '' then
      raise exception 'Record the root cause before moving on to the fix.'
        using errcode = 'check_violation';
    end if;

    new.action_taken_at := now();
    new.action_taken_by := auth.uid();
    line := 'Root cause recorded.';

  -- ── action_taken → verification: the fix is in ──
  elsif old.status = 'action_taken' and new.status = 'verification' then
    if coalesce(btrim(new.corrective_action), '') = '' then
      raise exception 'Describe the corrective action taken.'
        using errcode = 'check_violation';
    end if;

    new.verification_at := now();
    new.verification_by := auth.uid();
    line := 'Corrective action recorded — waiting on sign-off.';

  -- ── verification → closed: the signature ──
  elsif old.status = 'verification' and new.status = 'closed' then
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
      when new.verification_by is not null and new.verification_by = auth.uid()
        then 'Closed by the same person who took the action.'
      else 'Closed.'
    end;

  -- ── Backward, and only with a reason ──
  --
  -- Each one clears the evidence of the stage being abandoned — a fix sent
  -- back must not sit under a corrective action that was already proved not
  -- to work. Nothing is lost: the cleared text goes into the thread first.
  elsif is_revert and old.status = 'verification' and new.status = 'action_taken' then
    archived := btrim(concat_ws(E'\n',
      'Cleared on sending the fix back —',
      'Corrective action: ' || new.corrective_action,
      case when new.preventive_action is not null
        then 'Preventive action: ' || new.preventive_action end,
      case when new.verification is not null
        then 'Verification: ' || new.verification end
    ));

    new.corrective_action := null;
    new.preventive_action := null;
    new.verification      := null;
    new.verification_at   := null;
    new.verification_by   := null;
    line := 'Sent back for another fix.';

  elsif is_revert and old.status = 'action_taken' and new.status = 'investigating' then
    archived := btrim(concat_ws(E'\n',
      'Cleared on reverting to Investigating —',
      'Root cause: ' || new.root_cause
    ));

    new.root_cause      := null;
    new.action_taken_at := null;
    new.action_taken_by := null;
    line := 'Reverted to Investigating.';

  elsif is_revert and old.status = 'closed' and new.status = 'open' then
    -- `concat_ws` drops the nulls, so an issue that took the short road
    -- archives the one line it actually has rather than four headings over
    -- blanks.
    archived := btrim(concat_ws(E'\n',
      'Cleared on re-opening —',
      case when new.root_cause is not null
        then 'Root cause: ' || new.root_cause end,
      case when new.corrective_action is not null
        then 'Corrective action: ' || new.corrective_action end,
      case when new.preventive_action is not null
        then 'Preventive action: ' || new.preventive_action end,
      initcap(verify_word) || ': ' || new.verification
    ));

    new.root_cause        := null;
    new.corrective_action := null;
    new.preventive_action := null;
    new.verification      := null;
    new.investigating_at  := null;
    new.investigating_by  := null;
    new.action_taken_at   := null;
    new.action_taken_by   := null;
    new.verification_at   := null;
    new.verification_by   := null;
    new.closed_at         := null;
    new.closed_by         := null;
    line := 'Re-opened.';

  else
    raise exception
      'An issue moves one stage at a time: Open → Investigating → Action taken → Verification → Closed. An open issue may also be resolved directly. Going back needs a reason.'
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
$fn$;

comment on function public.actions_stage_transition() is
  'Everything that happens when an issue changes stage. Five stages, four gates: an owner to start investigating, a root cause to reach Action taken, a corrective action to reach Verification, and a supervisor''s sign-off to close. The short road, open to closed, is the one legal skip — it costs a written account of what was done and supervisor standing, and leaves investigating_at null so nothing can later claim an investigation happened. Backward moves go through revert_action(), cost a reason, and clear the evidence of the stage being abandoned. Corrections keep the previous text in the thread and may never empty what is already on the record.';

-- ── 5. Going backwards, rebuilt on the wider enum ────────────────────────
-- Unchanged in substance from 0020; it is restated here only because its
-- signature named the old type and had to be dropped before the swap.

create or replace function public.revert_action(
  p_action uuid,
  p_to     public.action_stage,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

revoke all on function public.revert_action(uuid, public.action_stage, text) from public;
grant execute on function public.revert_action(uuid, public.action_stage, text) to authenticated;

-- ── 6. The read model ────────────────────────────────────────────────────
-- Still two clocks, and the boundary between them moves with the stage that
-- now records the fix. The fix clock runs while the problem is still a
-- problem — Open, Investigating, Action taken — and stops the moment the
-- corrective action is in, which is the moment the issue reaches
-- Verification. The slower sign-off clock takes over from there.

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

  a.batch_no,
  a.product_id,
  pr.name as product_name,
  pr.code as product_code,

  a.root_cause,
  a.corrective_action,
  a.preventive_action,
  a.verification,
  a.investigating_at,
  a.action_taken_at,
  a.verification_at,
  a.closed_at,

  u.name as unit_name,

  -- Past its due time, and the fix still isn't in.
  (a.status < 'verification' and now() > a.due_at) as is_overdue,

  -- Overdue by a whole window again.
  (
    a.status < 'verification'
    and now() > a.due_at + public.action_window(a.priority)
  ) as is_escalated,

  (a.due_at + public.action_window(a.priority)) as escalates_at,

  -- When the sign-off is due. Null unless the issue is actually waiting on
  -- one, so the UI can key off the column rather than off the stage.
  (
    case when a.status = 'verification'
      then a.verification_at + make_interval(hours => f.escalate_hours)
    end
  ) as verify_due_at,

  (
    a.status = 'verification'
    and now() > a.verification_at + make_interval(hours => f.escalate_hours)
  ) as is_verify_overdue,

  (
    select count(*) from public.action_notes n where n.action_id = a.id
  ) as note_count,

  -- Closed, and it never went through an investigation. The short road.
  (a.status = 'closed' and a.investigating_at is null) as resolved_direct
from public.actions a
  join public.factories f on f.id = a.factory_id
  left join public.factory_units    u  on u.id  = a.unit_id
  left join public.factory_products pr on pr.id = a.product_id;

comment on view public.actions_expanded is
  'Read model for Issues & CAPAs. Two clocks, both computed on every read and neither stored: is_overdue/is_escalated run while the fix is outstanding (Open, Investigating, Action taken) and stop once the corrective action is in; is_verify_overdue then runs on the factory''s own escalate_hours through Verification until someone signs the issue off. resolved_direct marks the issues that took the short road — closed without an investigation, so their verification text is a resolution, not a verification.';

grant select on public.actions_expanded to authenticated;
