-- FactoryOS · Issues & CAPAs — the short road
--
-- Migration 0020 gave every issue the same shape: four stages, each paid for
-- with the evidence it produces. That is right for the issues the module was
-- built around — a capping fault, a batch that failed spec, anything where
-- "what caused it" is a question worth an hour.
--
-- It is wrong for the rest of them. A guard left off a conveyor, a bin in the
-- wrong bay, a light out: raised, sorted in two minutes, and nothing about it
-- has a root cause worth writing down. Forcing those through an investigation,
-- a corrective action and a sign-off does not produce a better record — it
-- produces four boxes of "n/a" and a floor that stops raising the small stuff
-- at all, which is precisely the stuff that is cheap to fix early.
--
-- So an open issue gets a second door:
--
--     open  →  closed          "dealt with, no CAPA needed"
--     open  →  investigating   the full cycle, unchanged
--
-- The short road is still not free. It costs a written account of what was
-- done, and it takes the same standing closing an issue has always taken —
-- supervisor and up — because *deciding an issue does not need a CAPA is
-- itself the review*. An operator who can wave their own flagged entry away
-- in one sentence is the failure mode this whole module exists to prevent.
--
-- The account is stored in `verification`, the column the long road already
-- fills at the same boundary. One column, one place to look, no third kind of
-- evidence — but the two are not the same thing, so anything reading them
-- back tells them apart by `investigating_at`: null means the issue was
-- resolved directly, and the text is a resolution rather than a verification.

-- ── The gate, with the short road added ──────────────────────────────────
--
-- Replaces the version in `0021`. Two changes, both below the insert branch:
--
--  1. A new forward transition, `open → closed`.
--
--  2. The "a stage already passed cannot be emptied" guard now asks what was
--     actually *recorded* rather than what stage the issue reached. It used
--     to read `status >= 'action_taken'`, which was the same question right
--     up until an issue could be closed without ever holding a root cause —
--     and then it refused to let anyone correct a resolution on the grounds
--     that a root cause the issue never had was missing. Keyed to `old`, it
--     says what it always meant: you may correct what is on the record, you
--     may not delete it.

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
    if coalesce(btrim(new.assigned_to), '') = '' then
      raise exception 'Assign this issue to someone before starting the investigation.'
        using errcode = 'check_violation';
    end if;

    new.investigating_at := now();
    new.investigating_by := auth.uid();
    line := 'Investigation started.';

  -- ── The short road ──
  --
  -- The one legal skip, and the only forward move that crosses more than one
  -- stage. It leaves `investigating_at` and `action_taken_at` null, which is
  -- not an omission but the record: those stages did not happen, and a
  -- timeline that claimed otherwise would be inventing an investigation.
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
    new.closed_at         := null;
    new.closed_by         := null;
    line := 'Re-opened.';

  else
    raise exception
      'An issue moves one stage at a time: Open → Investigating → Action taken → Closed. An open issue may also be resolved directly. Going back needs a reason.'
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
  'Everything that happens when an issue changes stage. Forward moves are one stage at a time, each paid for with the evidence that stage produces — except the short road, open to closed, for issues that need no CAPA: it costs a written account of what was done and supervisor standing, and leaves investigating_at null so nothing can later claim an investigation happened. Backward moves go through revert_action() and cost a reason. Corrections keep the previous text in the thread and may never empty what is already on the record.';

-- ── The read model ───────────────────────────────────────────────────────
-- One column appended: was this closed without ever being investigated? It is
-- pure derivation from a stamp the client already reads, but every other
-- "how should this issue be read" question in this module is answered in the
-- view, and the label on the closed evidence is one of those.

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
  a.closed_at,

  u.name as unit_name,

  (a.status < 'action_taken' and now() > a.due_at) as is_overdue,

  (
    a.status < 'action_taken'
    and now() > a.due_at + public.action_window(a.priority)
  ) as is_escalated,

  (a.due_at + public.action_window(a.priority)) as escalates_at,

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
  ) as note_count,

  -- Closed, and it never went through an investigation. The short road.
  (a.status = 'closed' and a.investigating_at is null) as resolved_direct
from public.actions a
  join public.factories f on f.id = a.factory_id
  left join public.factory_units    u  on u.id  = a.unit_id
  left join public.factory_products pr on pr.id = a.product_id;

comment on view public.actions_expanded is
  'Read model for Issues & CAPAs. Two clocks, both computed on every read and neither stored: is_overdue/is_escalated run while the fix is outstanding (Open, Investigating) and stop once the corrective action is in; is_verify_overdue then runs on the factory''s own escalate_hours until someone signs the issue off. resolved_direct marks the issues that took the short road — closed without an investigation, so their verification text is a resolution, not a verification.';

grant select on public.actions_expanded to authenticated;
