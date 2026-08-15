-- FactoryOS · Issues & CAPAs — correcting what a stage recorded
--
-- Migration 0020 made each stage cost the evidence it produces. What it did
-- not answer is what happens when that evidence is *wrong* — a mistyped root
-- cause, a corrective action described before the last detail was known, a
-- verification note with the wrong retest time.
--
-- The two obvious answers are both bad. Freeze it and the record collects
-- known-wrong text nobody can fix, which is how people learn to write nothing
-- much in the box. Let it be silently rewritten and a signed-off issue can be
-- re-authored after the fact, which is the whole reason an audit trail exists.
--
-- So: **amendable, never silently.** Every correction keeps the previous text
-- in the thread, exactly the bargain the shift log strikes with
-- `shift_log_amend_guard`. And a stage that has already been passed cannot be
-- hollowed out — you may correct a root cause, not delete one.

-- ── 1. One amendment line ────────────────────────────────────────────────

/**
 * Writes the "X amended, previously: …" line, if X actually changed.
 *
 * A helper because the alternative is the same eight lines four times over,
 * and the four fields must not drift apart in how they are recorded.
 */
create or replace function public.action_amend_note(
  p_factory uuid,
  p_action  uuid,
  p_label   text,
  p_old     text,
  p_new     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_new is not distinct from p_old then
    return;
  end if;

  insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
  values (
    p_factory,
    p_action,
    case
      when coalesce(btrim(p_old), '') = ''
        then p_label || ' added.'
      -- The previous text travels with the amendment. Losing it is the only
      -- version of this feature that would be worth refusing.
      else p_label || ' amended. Previously: ' || p_old
    end,
    true,
    auth.uid()
  );
end;
$$;

-- ── 2. The transition function, now with an amendment path ───────────────
-- Replaces the version in 0020. Unchanged above the `is not distinct from`
-- early return; what used to be a bare `return new` is now the branch that
-- handles corrections made *without* moving stage.

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
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new issue starts as Open.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

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

      -- A stage already passed cannot be emptied. Otherwise the record could
      -- be hollowed out field by field without ever reverting — which is
      -- reverting, minus the reason. Blank the text and the stage is a lie.
      if new.status >= 'action_taken'
         and coalesce(btrim(new.root_cause), '') = '' then
        raise exception 'The root cause is part of the record — correct it, don''t remove it.'
          using errcode = 'check_violation';
      end if;
      if new.status >= 'action_taken'
         and coalesce(btrim(new.corrective_action), '') = '' then
        raise exception 'The corrective action is part of the record — correct it, don''t remove it.'
          using errcode = 'check_violation';
      end if;
      if new.status = 'closed'
         and coalesce(btrim(new.verification), '') = '' then
        raise exception 'The verification is part of the record — correct it, don''t remove it.'
          using errcode = 'check_violation';
      end if;

      perform public.action_amend_note(new.factory_id, new.id,
        'Root cause', old.root_cause, new.root_cause);
      perform public.action_amend_note(new.factory_id, new.id,
        'Corrective action', old.corrective_action, new.corrective_action);
      perform public.action_amend_note(new.factory_id, new.id,
        'Preventive action', old.preventive_action, new.preventive_action);
      perform public.action_amend_note(new.factory_id, new.id,
        'Verification', old.verification, new.verification);
    end if;

    return new;
  end if;

  is_revert := coalesce(current_setting('factoryos.revert', true), '') = 'on';

  -- ── Forward, one stage at a time ──
  if old.status = 'open' and new.status = 'investigating' then
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
    if not public.can_review_factory(new.factory_id) then
      raise exception 'Only a supervisor or above can close an issue.'
        using errcode = 'insufficient_privilege';
    end if;

    new.closed_at := now();
    new.closed_by := auth.uid();

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

  insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
  values (new.factory_id, new.id, line, true, auth.uid());

  if archived is not null and archived <> '' then
    insert into public.action_notes (factory_id, action_id, note, is_system, created_by)
    values (new.factory_id, new.id, archived, true, auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.actions_stage_transition() is
  'Everything that happens when an issue changes stage — what is allowed, what it costs, what gets stamped — plus the amendment path for correcting recorded evidence in place. Corrections keep the previous text in the thread; a stage already passed cannot be emptied.';
