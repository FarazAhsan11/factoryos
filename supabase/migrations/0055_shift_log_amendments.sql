-- 0055 — Amendment history: one row per amendment, written by the database.
--
-- A filed entry has kept only a summary of its corrections: `amend_note`, which
-- is appended to, `amended_at`, which each amendment overwrites, and
-- `amended_by`, which keeps the first person who ever amended the entry (the
-- guard's `coalesce` finds the value already on the row). So the sheet could
-- say an entry was amended and why, but not when each correction was made, who
-- made the later ones, or what any of them changed. The shift report's
-- amendment history asks for all of that: Date | Time | What was amended |
-- Reason for amendment | Amended by.
--
-- What changed is worked out here, by comparing the row before and after,
-- rather than sent by the screen. Corrections come from two dialogs today and
-- could come from anywhere tomorrow; a trigger is the one place none of them can
-- leave out, and it records what the row did rather than what a caller said.
--
-- The table is append-only from the app's side: a read policy and no others, so
-- a client can neither add a row nor change one, the same enforcement-by-absence
-- as `shift_log_entries` having no delete policy. `amended_at` and friends stay
-- on the entry — the feed, the Log history and the batch record all read them —
-- and the guard (0033) is untouched.
--
-- Amendments made before this migration are backfilled from `amend_note`, as far
-- as it goes. `changes` is **null** on those rows, meaning "not recorded", as
-- distinct from `[]`, meaning a note was added and nothing else changed.

-- ── The history ──────────────────────────────────────────────────────────

create table if not exists public.shift_log_amendments (
  -- Also the reading order: an entry's amendments in the order they were made.
  id              bigint generated always as identity primary key,
  factory_id      uuid not null references public.factories (id) on delete cascade,
  entry_id        uuid not null references public.shift_log_entries (id) on delete cascade,
  -- The day it was made. Always known; `amended_at` is null on a backfilled row
  -- whose note carried only a date.
  amended_on      date not null,
  amended_at      timestamptz,
  reason          text,
  -- [{ "field": "qty", "from": "200", "to": "2000" }, …] — null if not recorded.
  changes         jsonb,
  amended_by      uuid references public.profiles (id) on delete set null,
  -- The name as it stood. A correction is signed by who made it then, and a
  -- renamed or removed account must not rewrite that.
  amended_by_name text
);

create index if not exists shift_log_amendments_entry_idx
  on public.shift_log_amendments (entry_id, id);

alter table public.shift_log_amendments enable row level security;

drop policy if exists "shift_log_amendments_member_read"
  on public.shift_log_amendments;
create policy "shift_log_amendments_member_read"
  on public.shift_log_amendments for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

grant select on public.shift_log_amendments to authenticated;

-- ── Working out what changed ─────────────────────────────────────────────

-- One field's change as a one-item array, or an empty one if it didn't change,
-- so the trigger can join them with `||`. A blank and a null are the same
-- nothing: the forms write either, and neither is a correction.
create or replace function public.shift_log_change(
  field text,
  before_value text,
  after_value text
)
returns jsonb
language sql
immutable
as $$
  select case
    when nullif(btrim(before_value), '') is not distinct from nullif(btrim(after_value), '')
      then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'field', field,
      'from', nullif(btrim(before_value), ''),
      'to', nullif(btrim(after_value), '')
    ))
  end;
$$;

-- A stage as `stageName()` shows it. Stored by name, like the room and the
-- activity below: an id in a history is a riddle once the plan has moved on.
create or replace function public.shift_log_stage_label(stage_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(p.name, 'Stage')
    || coalesce(' — ' || coalesce(nullif(btrim(s.label), ''), nullif(btrim(s.work_order), '')), '')
  from public.batch_stages s
  left join public.factory_processes p on p.id = s.process_id
  where s.id = stage_id;
$$;

-- `security definer`: the amender can read their own row but has no policy to
-- write this table, and must not be given one.
create or replace function public.shift_log_record_amendment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added text;
  who   text;
begin
  -- `shift_log_amend_guard` stamps `amended_at` on an amendment and only on an
  -- amendment. An overrun clearance, a stage being resolved and a write that
  -- changed nothing all leave it alone, and none of them corrected anything.
  if new.amended_at is not distinct from old.amended_at then
    return null;
  end if;

  -- The note is appended to, so the reason is whatever was added. Falls back to
  -- the whole note should a caller ever replace it instead of appending.
  added := case
    when old.amend_note is not null
      and left(new.amend_note, length(old.amend_note)) = old.amend_note
      then ltrim(substr(new.amend_note, length(old.amend_note) + 1), E'\n')
    else new.amend_note
  end;

  -- `auth.uid()`, not `new.amended_by`, which still names the first amender.
  select coalesce(nullif(btrim(full_name), ''), email)
    into who
  from public.profiles
  where id = auth.uid();

  insert into public.shift_log_amendments (
    factory_id, entry_id, amended_on, amended_at,
    reason, changes, amended_by, amended_by_name
  )
  values (
    new.factory_id,
    new.id,
    new.amended_at::date,
    new.amended_at,
    -- The "[2026-10-31] " stamp is the date column's job here.
    nullif(btrim(regexp_replace(added, '^\[\d{4}-\d{2}-\d{2}\]\s*', '')), ''),
    -- Everything a person can get wrong on an entry, in the sheet's order.
    -- `duration_minutes` and `product_id` are left out: they follow the clocks
    -- and the batch, which are listed, and would only say the same thing twice.
    public.shift_log_change('log_date', old.log_date::text, new.log_date::text)
      || public.shift_log_change('shift', old.shift::text, new.shift::text)
      || public.shift_log_change('start_time', to_char(old.start_time, 'HH24:MI'), to_char(new.start_time, 'HH24:MI'))
      || public.shift_log_change('end_time', to_char(old.end_time, 'HH24:MI'), to_char(new.end_time, 'HH24:MI'))
      || public.shift_log_change(
           'unit',
           (select name from public.factory_units where id = old.unit_id),
           (select name from public.factory_units where id = new.unit_id)
         )
      || public.shift_log_change(
           'process',
           (select name from public.factory_processes where id = old.process_id),
           (select name from public.factory_processes where id = new.process_id)
         )
      || public.shift_log_change('batch_no', old.batch_no, new.batch_no)
      || public.shift_log_change(
           'stage',
           public.shift_log_stage_label(old.batch_stage_id),
           public.shift_log_stage_label(new.batch_stage_id)
         )
      || public.shift_log_change('qty', trim_scale(old.qty)::text, trim_scale(new.qty)::text)
      || public.shift_log_change('qty_unit', old.qty_unit, new.qty_unit)
      || public.shift_log_change('target_qty', trim_scale(old.target_qty)::text, trim_scale(new.target_qty)::text)
      || public.shift_log_change('qty_rejected', trim_scale(old.qty_rejected)::text, trim_scale(new.qty_rejected)::text)
      || public.shift_log_change('speed_unit', old.speed_unit, new.speed_unit)
      || public.shift_log_change('target_speed', trim_scale(old.target_speed)::text, trim_scale(new.target_speed)::text)
      || public.shift_log_change('actual_speed', trim_scale(old.actual_speed)::text, trim_scale(new.actual_speed)::text)
      || public.shift_log_change('slow_reason', old.slow_reason, new.slow_reason)
      || public.shift_log_change('equipment_no', old.equipment_no, new.equipment_no)
      || public.shift_log_change('operators', array_to_string(old.operators, ', '), array_to_string(new.operators, ', '))
      || public.shift_log_change('action_flag', old.action_flag, new.action_flag)
      || public.shift_log_change('comment', old.comment, new.comment),
    auth.uid(),
    who
  );

  return null;
end;
$$;

-- After, so it reads the row as the guard and the stage triggers left it.
drop trigger if exists shift_log_record_amendment on public.shift_log_entries;
create trigger shift_log_record_amendment
  after update on public.shift_log_entries
  for each row execute function public.shift_log_record_amendment();

-- ── Backfill ─────────────────────────────────────────────────────────────
--
-- One row per stamped line of `amend_note`, splitting only where a new stamp
-- starts so a reason typed over two lines stays one reason.
--
-- Only what the entry really knows goes in. `amended_at` was overwritten by
-- every amendment, so it belongs to the last line; `amended_by` was kept from
-- the first, so it belongs to the first. On an entry amended once that is the
-- whole story. On one amended more, the rows between are left blank rather than
-- guessed at: a wrong name is worse than none in an audit record.
--
-- Skips any entry that already has history, so running this file twice is safe.

insert into public.shift_log_amendments (
  factory_id, entry_id, amended_on, amended_at,
  reason, changes, amended_by, amended_by_name
)
select
  e.factory_id,
  e.id,
  coalesce(
    substring(part.note from '^\[(\d{4}-\d{2}-\d{2})\]')::date,
    e.amended_at::date,
    e.log_date
  ),
  case when part.n = part.total then e.amended_at end,
  nullif(btrim(regexp_replace(part.note, '^\[\d{4}-\d{2}-\d{2}\]\s*', '')), ''),
  null,
  case when part.n = 1 then e.amended_by end,
  case when part.n = 1 then coalesce(nullif(btrim(p.full_name), ''), p.email) end
from public.shift_log_entries e
left join public.profiles p on p.id = e.amended_by
cross join lateral (
  select split.note, split.n, count(*) over () as total
  from regexp_split_to_table(
    e.amend_note,
    E'\n(?=\\[\\d{4}-\\d{2}-\\d{2}\\])'
  ) with ordinality as split (note, n)
) part
where coalesce(btrim(e.amend_note), '') <> ''
  and not exists (
    select 1 from public.shift_log_amendments a where a.entry_id = e.id
  )
order by e.id, part.n;
