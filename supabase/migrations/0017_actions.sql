-- FactoryOS · Actions & escalations
--
-- The accountability loop. An issue flagged in the shift log becomes a piece
-- of work with a name, a clock and a thread — so it can't quietly rot.
--
-- The design choice worth stating up front: **"overdue" and "escalated" are
-- not stored.** They are derived from `due_at` and the current time, in the
-- view at the bottom of this file.
--
-- The prototype stored them, and walked the list flipping statuses whenever
-- someone happened to open the page. An action that went overdue at 2am
-- therefore looked fine until the first person logged in, and if nobody did,
-- it never escalated at all. But nobody *decides* to escalate — it is simply
-- what "still not done, this long after it was due" means. Computed, it is
-- true the moment it is true, whether anyone is looking or not, and it needs
-- no cron job, no background worker and no write.
--
-- So `status` holds only what a person actually chose: open, in progress, or
-- resolved.

-- ── 1. Vocabulary ────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'action_status') then
    create type public.action_status as enum ('open', 'in_progress', 'resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'action_priority') then
    create type public.action_priority as enum (
      'critical', 'high', 'medium', 'low'
    );
  end if;
end $$;

/**
 * How long this priority gets before it is due — and, again, before it
 * escalates. One function so the two clocks can never drift apart.
 *
 * Priority earns its keep here rather than being a coloured label: a safety
 * issue and a paperwork deviation are not the same urgency, and this is where
 * that difference becomes real. A flat window for everything (the prototype's
 * four hours) means the label says nothing.
 */
create or replace function public.action_window(p public.action_priority)
returns interval
language sql
immutable
as $$
  select case p
    when 'critical' then interval '2 hours'
    when 'high'     then interval '4 hours'
    when 'medium'   then interval '8 hours'
    else                 interval '24 hours'
  end;
$$;

-- ── 2. Actions ───────────────────────────────────────────────────────────

create table if not exists public.actions (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories (id) on delete cascade,

  title       text not null,
  -- Nullable: a factory-wide action ("review the cleaning SOP") belongs to no
  -- one room. `restrict` for the same reason as the shift log — a room with
  -- history is retired, not deleted.
  unit_id     uuid references public.factory_units (id) on delete restrict,
  category    text not null,
  priority    public.action_priority not null default 'medium',
  status      public.action_status not null default 'open',

  -- Free text, deliberately, and the same reasoning as the shift log's
  -- operators: the person who has to fix a gate sensor is often a contractor
  -- or a maintenance tech with no login at all. A dropdown of accounts can be
  -- layered on later without moving what is already recorded.
  assigned_to text,

  due_at      timestamptz not null,
  notes       text,

  -- The entry that raised this, when it came from the log rather than a
  -- person. Unique, so amending a flagged entry — which re-fires the trigger —
  -- cannot mint a second action for the same issue.
  shift_log_entry_id uuid references public.shift_log_entries (id) on delete set null,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,

  constraint actions_title_not_blank check (length(btrim(title)) > 0),
  constraint actions_category_known check (
    category in ('Quality', 'Maintenance', 'Safety', 'Process', 'Manning', 'Other')
  )
);

create unique index if not exists actions_source_entry_key
  on public.actions (shift_log_entry_id)
  where shift_log_entry_id is not null;

-- The list reads one factory's actions, unresolved first and most urgent
-- first within that.
create index if not exists actions_factory_status_idx
  on public.actions (factory_id, status, due_at);

-- ── 3. The thread ────────────────────────────────────────────────────────
-- Every update on an action, in order: what someone typed, and every status
-- change. Kept as rows rather than a jsonb blob so a note can be counted,
-- filtered and attributed without parsing.

create table if not exists public.action_notes (
  id         uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories (id) on delete cascade,
  action_id  uuid not null references public.actions (id) on delete cascade,
  note       text not null,
  -- True for the lines the database writes on a status change, so the UI can
  -- render them as history rather than as somebody's comment.
  is_system  boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint action_notes_not_blank check (length(btrim(note)) > 0)
);

create index if not exists action_notes_action_idx
  on public.action_notes (action_id, created_at);

-- ── Row-level security ───────────────────────────────────────────────────
-- Read and write for the whole tenant: an action is collaborative work, and
-- the person who can fix a thing is not always a manager. Which roles reach
-- the page at all is a navigation concern, not a data one. Delete stays with
-- managers — a resolved action is a record, not clutter.
alter table public.actions enable row level security;
alter table public.action_notes enable row level security;

drop policy if exists "actions_member_read" on public.actions;
create policy "actions_member_read"
  on public.actions for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "actions_member_write" on public.actions;
create policy "actions_member_write"
  on public.actions for insert
  with check (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "actions_member_update" on public.actions;
create policy "actions_member_update"
  on public.actions for update
  using (public.is_super_admin() or factory_id = public.current_factory_id())
  with check (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "actions_manage_delete" on public.actions;
create policy "actions_manage_delete"
  on public.actions for delete
  using (public.can_manage_factory(factory_id));

drop policy if exists "action_notes_member_read" on public.action_notes;
create policy "action_notes_member_read"
  on public.action_notes for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "action_notes_member_write" on public.action_notes;
create policy "action_notes_member_write"
  on public.action_notes for insert
  with check (
    (public.is_super_admin() or factory_id = public.current_factory_id())
    -- A hand-written note is signed by whoever wrote it. System lines come
    -- from the trigger below, which runs as owner and bypasses this.
    and created_by = auth.uid()
    and is_system = false
  );

-- ── 4. A flagged entry becomes an action ─────────────────────────────────

/**
 * Creates the action for a flagged shift-log entry.
 *
 * In the database, not the browser, for the reasons the pipeline trigger
 * gives: the log is permanent, a client can die mid-write, and any future
 * caller gets this for free.
 *
 * Two departures from the prototype, both deliberate:
 *
 *  · **Unassigned.** The prototype assigns the action to whoever logged it.
 *    The operator who spots a capping fault is not the person who fixes it,
 *    and an action assigned to the wrong name looks handled while nothing
 *    happens. Unassigned is visibly waiting for someone.
 *
 *  · **Priority from the flag.** The prototype makes everything 'high', which
 *    makes the field decorative. A safety concern outranks a process
 *    deviation, and the due clock follows from it.
 */
create or replace function public.actions_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pri       public.action_priority;
  room      text;
  batch     text;
  body      text;
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

  -- Everything the operator already said about it, so nobody has to open the
  -- shift log to find out what happened.
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
    due_at, notes, shift_log_entry_id, created_by
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
    new.logged_by
  );

  return null;
end;
$$;

drop trigger if exists shift_log_create_action on public.shift_log_entries;
create trigger shift_log_create_action
  after insert or update on public.shift_log_entries
  for each row execute function public.actions_from_log();

-- ── 5. Status changes write themselves into the thread ───────────────────

/**
 * Appends a system line whenever the status moves, and stamps who resolved it.
 *
 * In a trigger so the history cannot be skipped by a caller that forgets, and
 * so "resolved by" is the signed-in user rather than something the client
 * claims.
 */
create or replace function public.actions_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := now();
      new.resolved_by := auth.uid();
    else
      -- Re-opening clears the resolution rather than leaving a stale stamp
      -- claiming the thing is done.
      new.resolved_at := null;
      new.resolved_by := null;
    end if;

    insert into public.action_notes (
      factory_id, action_id, note, is_system, created_by
    )
    values (
      new.factory_id,
      new.id,
      'Status changed to ' || replace(new.status::text, '_', ' ') || '.',
      true,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists actions_status_history on public.actions;
create trigger actions_status_history
  before update on public.actions
  for each row execute function public.actions_log_status_change();

-- ── 6. The read model ────────────────────────────────────────────────────
-- Where overdue and escalated are decided — every time the view is read,
-- from the clock, rather than by whoever last opened the app.
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
  a.resolved_at,

  u.name as unit_name,

  -- Past its due time and still not done.
  (a.status <> 'resolved' and now() > a.due_at) as is_overdue,

  -- Overdue by a whole window again. A resolved action is neither, however
  -- late it was — the clock stops when the work does.
  (
    a.status <> 'resolved'
    and now() > a.due_at + public.action_window(a.priority)
  ) as is_escalated,

  -- When it *will* escalate, so the list can say "escalates in 40m" rather
  -- than only telling you once it is too late.
  (a.due_at + public.action_window(a.priority)) as escalates_at,

  (
    select count(*) from public.action_notes n where n.action_id = a.id
  ) as note_count
from public.actions a
  left join public.factory_units u on u.id = a.unit_id;

comment on view public.actions_expanded is
  'Read model for Actions. `is_overdue` and `is_escalated` are computed from the clock on every read — they are never stored, so an action escalates whether or not anyone has the app open.';

grant select on public.actions_expanded to authenticated;
