-- FactoryOS · Shift log → Kaizen
--
-- Continuous improvement, captured where the improvement is noticed. The
-- person who spends eight hours a day at the tablet press is the one who knows
-- the transfer to the coating pan wastes fifteen minutes a batch, and the
-- distance between noticing that and it reaching anyone who can act is the
-- whole reason it never gets said. A box on the shift log, beside the entry
-- form they are already filling in, is short enough that it does.
--
-- Two departures from the prototype, both deliberate:
--
--  · **No "Submitted by" text box.** The prototype asks the operator to type
--    their own name. It is already known — they are signed in — and a field
--    that can be left blank, misspelt, or filled in with somebody else's name
--    turns the one attribution that matters into a guess. Stored as the user
--    id and joined for display, so it is right by construction.
--
--  · **A status an idea can be turned down into.** The prototype tracks new →
--    under review → approved → implemented, with no way to say no. A review
--    that can only ever agree isn't a review, and without `declined` the list
--    silently becomes a graveyard of ideas nobody will ever action and nobody
--    will admit to rejecting — which teaches the floor, correctly, that
--    submitting one is pointless.

-- ── 1. Vocabulary ────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'kaizen_status') then
    create type public.kaizen_status as enum (
      'new', 'under_review', 'approved', 'implemented', 'declined'
    );
  end if;
  -- How much work the idea is, as the person suggesting it sees it. Their
  -- estimate, not a promise — its job is to sort the ten-minute fixes out of
  -- the capital projects so the easy wins aren't queued behind a rebuild.
  if not exists (select 1 from pg_type where typname = 'kaizen_impact') then
    create type public.kaizen_impact as enum ('quick_win', 'medium', 'major');
  end if;
end $$;

-- ── 2. Who may review ────────────────────────────────────────────────────

/**
 * Supervisors and up.
 *
 * `can_manage_factory()` is admin/manager and deliberately narrow — it guards
 * factory setup. Kaizen is not setup: the supervisor on the floor is the
 * person who knows whether moving the press is feasible, and routing every
 * idea through an admin is how a queue stops moving. Hence a second, wider
 * helper rather than loosening the first.
 */
create or replace function public.can_review_factory(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.factory_id = target
      and p.role in ('admin', 'manager', 'supervisor')
  );
$$;

-- ── 3. The ideas ─────────────────────────────────────────────────────────

create table if not exists public.kaizen_ideas (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories (id) on delete cascade,

  idea        text not null,
  category    text not null,
  impact      public.kaizen_impact not null default 'quick_win',
  status      public.kaizen_status not null default 'new',

  -- Not nullable and not client-supplied: an anonymous improvement can't be
  -- credited, and credit is most of what makes the next one get submitted.
  submitted_by uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),

  -- Who last moved it, and what they said. One note rather than a thread: an
  -- idea's history is four states long, and the useful record is the current
  -- decision plus a reason — not a conversation. Actions is where a discussion
  -- belongs, and an approved idea that needs one becomes an action.
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  constraint kaizen_ideas_idea_not_blank check (length(btrim(idea)) >= 10),
  constraint kaizen_ideas_category_known check (
    category in (
      'Process', 'Quality', 'Safety', 'Cost', 'Ergonomics', 'Waste', 'Other'
    )
  )
);

-- The feed reads one factory's ideas, newest first, and filters by status.
create index if not exists kaizen_ideas_factory_idx
  on public.kaizen_ideas (factory_id, status, created_at desc);

-- ── Row-level security ───────────────────────────────────────────────────
-- Read for the whole tenant: an improvement everyone can see is one somebody
-- else can build on, and a suggestion box only the boss can look into is a
-- suggestion box nobody uses. Anyone may submit — that is the point — but only
-- as themselves. Only reviewers move an idea along.
alter table public.kaizen_ideas enable row level security;

drop policy if exists "kaizen_member_read" on public.kaizen_ideas;
create policy "kaizen_member_read"
  on public.kaizen_ideas for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

drop policy if exists "kaizen_member_submit" on public.kaizen_ideas;
create policy "kaizen_member_submit"
  on public.kaizen_ideas for insert
  with check (
    factory_id = public.current_factory_id()
    and submitted_by = auth.uid()
  );

drop policy if exists "kaizen_review" on public.kaizen_ideas;
create policy "kaizen_review"
  on public.kaizen_ideas for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

-- Withdrawing your own idea is allowed only while nobody has looked at it.
-- After that it is part of a record someone has acted on — and an idea deleted
-- the moment it was declined is how a rejection gets quietly erased.
drop policy if exists "kaizen_delete" on public.kaizen_ideas;
create policy "kaizen_delete"
  on public.kaizen_ideas for delete
  using (
    public.can_manage_factory(factory_id)
    or (submitted_by = auth.uid() and status = 'new')
  );

-- ── 4. Reviews stamp themselves ──────────────────────────────────────────

/**
 * Records who moved an idea and when, on every status change.
 *
 * In a trigger for the same reason as `actions_log_status_change`: "reviewed
 * by" must be the signed-in user, not a name the client asserts. Sending it
 * back to New clears the stamp rather than leaving one claiming the idea was
 * reviewed by someone who has since un-reviewed it.
 */
create or replace function public.kaizen_stamp_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'new' then
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists kaizen_review_stamp on public.kaizen_ideas;
create trigger kaizen_review_stamp
  before update on public.kaizen_ideas
  for each row execute function public.kaizen_stamp_review();

-- ── 5. The read model ────────────────────────────────────────────────────
-- The feed shows names, not ids. Joined in a view rather than fetched
-- alongside so one read answers the whole panel — and `security_invoker` so it
-- inherits the policies above instead of running as its owner.
create or replace view public.kaizen_ideas_expanded
with (security_invoker = true) as
select
  k.id,
  k.factory_id,
  k.idea,
  k.category,
  k.impact,
  k.status,
  k.submitted_by,
  k.created_at,
  k.reviewed_by,
  k.reviewed_at,
  k.review_note,

  -- Falls back to the email's local part: an account invited but never
  -- completed has no full name yet, and "—" would lose the attribution the
  -- whole design is built on.
  coalesce(
    nullif(btrim(s.full_name), ''), split_part(s.email, '@', 1)
  ) as submitted_by_name,
  coalesce(
    nullif(btrim(r.full_name), ''), split_part(r.email, '@', 1)
  ) as reviewed_by_name
from public.kaizen_ideas k
  left join public.profiles s on s.id = k.submitted_by
  left join public.profiles r on r.id = k.reviewed_by;

comment on view public.kaizen_ideas_expanded is
  'Read model for Shift log → Kaizen: an idea plus the display names of who submitted and who reviewed it. RLS inherited from kaizen_ideas via security_invoker.';

grant select on public.kaizen_ideas_expanded to authenticated;
