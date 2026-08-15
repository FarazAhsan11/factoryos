-- FactoryOS · Which batch an issue affects
--
-- An issue raised from the shift log already knew — the entry that flagged it
-- names a batch — and threw it away, keeping only the product name inside the
-- generated title. So "Quality flagged — Room 5 · Vitamin D3" could not be
-- traced back to a run without opening the shift log and hunting for it, and
-- an issue raised by hand had nowhere to record a batch at all.
--
-- Two columns, for the same reason maintenance carries both (migration 0024):
-- the typed text is what someone searches for later and survives a batch that
-- was never added to the catalogue; the id is the resolution *when there is
-- one*, never a requirement.

alter table public.actions
  add column if not exists batch_no   text,
  add column if not exists product_id uuid references public.factory_products (id) on delete set null;

comment on column public.actions.batch_no is
  'The affected batch as typed. Optional, and never validated against the catalogue — an issue can concern a batch nobody has added yet.';

-- ── The shift-log trigger keeps what it already knew ─────────────────────

/**
 * Replaces the version in `0017`. Identical except that the batch it looks up
 * to build the title is now also *recorded*, rather than being folded into a
 * string and lost.
 */
create or replace function public.actions_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pri   public.action_priority;
  room  text;
  batch text;
  body  text;
begin
  if new.action_flag is null then
    return null;
  end if;

  -- Amending a flagged entry re-fires this trigger. The issue already has an
  -- action, and its thread; a second one would split the conversation.
  if exists (
    select 1 from public.actions where shift_log_entry_id = new.id
  ) then
    return null;
  end if;

  pri := case new.action_flag
    when 'Safety'      then 'critical'
    when 'Quality'     then 'high'
    when 'Maintenance' then 'high'
    else                    'medium'
  end::public.action_priority;

  select u.name into room
  from public.factory_units u where u.id = new.unit_id;

  select p.name into batch
  from public.factory_products p where p.id = new.product_id;

  body := btrim(concat_ws(' ',
    'Raised from the shift log.',
    nullif(btrim(coalesce(new.comment, '')), ''),
    case
      when new.slow_reason is not null
      then 'Slow run: ' || new.slow_reason
    end
  ));

  insert into public.actions (
    factory_id, title, unit_id, category, priority,
    due_at, notes, shift_log_entry_id, created_by,
    batch_no, product_id
  )
  values (
    new.factory_id,
    new.action_flag || ' flagged'
      || coalesce(' — ' || room, '')
      || coalesce(' · ' || batch, ''),
    new.unit_id,
    new.action_flag,
    pri,
    now() + public.action_window(pri),
    nullif(body, ''),
    new.id,
    new.logged_by,
    -- Straight off the entry: the operator already typed it, and asking a
    -- supervisor to retype it into the issue is how the two drift apart.
    nullif(btrim(coalesce(new.batch_no, '')), ''),
    new.product_id
  );

  return null;
end;
$$;

-- ── Issues already raised keep theirs too ────────────────────────────────
--
-- The trigger only fires on insert, so without this every issue raised before
-- today would carry a null batch forever — and those are precisely the ones
-- someone is still working. The entry that raised each one is still on file
-- and still names its batch, so nothing has to be guessed: this copies what
-- was always there.
--
-- Idempotent, and deliberately narrow. `where a.batch_no is null` means a
-- re-run cannot overwrite a batch someone has since typed by hand, and only
-- issues that came *from* the log are touched — a hand-raised issue with no
-- batch was a decision, not a gap.

update public.actions a
   set batch_no   = nullif(btrim(coalesce(e.batch_no, '')), ''),
       product_id = e.product_id
  from public.shift_log_entries e
 where e.id = a.shift_log_entry_id
   and a.batch_no is null
   and a.product_id is null;

-- ── The read model ───────────────────────────────────────────────────────
-- Rebuilt with the batch and its product flattened on. Dropped rather than
-- replaced: `create or replace view` cannot add columns in the middle, and
-- these belong beside the issue's other facts rather than tacked on the end.

drop view if exists public.actions_expanded;

create view public.actions_expanded
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
  ) as note_count
from public.actions a
  join public.factories f on f.id = a.factory_id
  left join public.factory_units    u  on u.id  = a.unit_id
  left join public.factory_products pr on pr.id = a.product_id;

comment on view public.actions_expanded is
  'Read model for Issues & CAPAs. Two clocks, both computed on every read and neither stored: `is_overdue`/`is_escalated` run while the fix is outstanding (Open, Investigating) and stop once the corrective action is in; `is_verify_overdue` then runs on the factory''s own escalate_hours until someone signs the issue off.';

grant select on public.actions_expanded to authenticated;
