-- FactoryOS · Maintenance — the rest of the paper form
--
-- 0024 built the raising half and stopped there, on purpose: the columns that
-- record the work were not invented ahead of knowing what they had to hold.
-- Now we know. The controlled document this replaces is a Breakdown
-- Maintenance Request in three sections, each signed by different hands:
--
--   Section 1 · Initiation      — who found it, on what, how bad  (0024)
--   Section 2 · Engineering     — who took it, what they did, was cleaning
--                                 needed, did Production review it
--   Section 3 · QA review       — change control? deviation? remarks, sign
--
-- Those sections are *phases*, not departments with logins. FactoryOS has no
-- engineer or QA role and is not growing one for this: the sections are named
-- after the work, and who may drive them is the same standing that signs off
-- an issue — supervisor and up, `can_review_factory`.
--
-- The five statuses declared unused in 0024 map straight onto the sections:
--
--   reported            → Section 1 done, waiting for a fitter
--   assigned            → Section 2 opened, a name on it
--   in_progress         → tools down, the downtime clock is running
--   completed           → Section 2 signed: work recorded, cleaning and
--                         production review answered
--   verified            → Section 3 signed: QA has reviewed it
--
-- One stage at a time, forward only, each move paid for with the evidence the
-- stage is named after — the same bargain `actions_stage_transition` strikes,
-- and for the same reason: a status anyone can set to anything records nothing.

-- ── 1. What the sections have to hold ────────────────────────────────────

alter table public.maintenance_requests
  -- Section 1. The paper asks twice about departments and means different
  -- things: *Initiating Department* is who raised it (Production), while
  -- Section II is headed by the department doing the work. 0024 only had the
  -- second. Nullable, and back-filled by nobody — requests raised before this
  -- migration genuinely do not know.
  add column if not exists initiating_department_id uuid
    references public.factory_departments (id) on delete restrict,

  -- Section 2.
  add column if not exists assigned_at     timestamptz,
  add column if not exists work_started_at timestamptz,

  -- One box on the paper — "Details of Maintenance work carried out. Include
  -- reasons for breakdown if known." — and one column here. Splitting it into
  -- work-done and root-cause reads better in a schema and worse on a screen:
  -- the fitter writes one paragraph and the second box comes back empty.
  add column if not exists work_details text,

  -- "Cleaning to be arranged after maintenance if necessary." A tri-state on
  -- purpose: null is *not answered yet*, and the gate below refuses to let a
  -- request reach `completed` while it is. false is an answer.
  add column if not exists cleaning_required boolean,
  add column if not exists cleaning_note     text,

  -- "Production review of work if necessary" — signed by Production, not by
  -- the fitter. Same tri-state, and the name is only demanded when the answer
  -- is yes.
  add column if not exists production_review_required boolean,
  add column if not exists production_review_by       text,
  add column if not exists production_review_at       timestamptz,

  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles (id) on delete set null,

  -- Section 3. Both questions are yes/no with a reference number when yes,
  -- and both are the reason this form is a controlled document at all: they
  -- are where a broken machine becomes a quality event.
  add column if not exists change_control_required boolean,
  add column if not exists change_control_no       text,
  add column if not exists deviation_raised        boolean,
  add column if not exists deviation_no            text,

  -- A deviation already has a home in this application — the CAPA register.
  -- The number stays text (a deviation may predate FactoryOS, or live in
  -- another system), and the link is the resolution when there is one.
  add column if not exists deviation_action_id uuid
    references public.actions (id) on delete set null,

  add column if not exists qa_remarks   text,
  -- Typed, like every other signature in this application: the person holding
  -- the pen over the paper form is not reliably the person holding the login.
  add column if not exists qa_sign_name text,
  add column if not exists verified_at  timestamptz,
  add column if not exists verified_by  uuid references public.profiles (id) on delete set null;

-- Answered means answered: a number is required exactly when its question is
-- yes, and is meaningless when it is no. Checked here as well as in the gate
-- so a later correction cannot quietly strand one without the other.
alter table public.maintenance_requests
  drop constraint if exists maintenance_change_control_no_ck;
alter table public.maintenance_requests
  add constraint maintenance_change_control_no_ck check (
    change_control_required is not true
    or coalesce(btrim(change_control_no), '') <> ''
  );

alter table public.maintenance_requests
  drop constraint if exists maintenance_deviation_no_ck;
alter table public.maintenance_requests
  add constraint maintenance_deviation_no_ck check (
    deviation_raised is not true
    or coalesce(btrim(deviation_no), '') <> ''
  );

-- The list is filtered by status far more often than by anything else now
-- that there is more than one of them.
create index if not exists maintenance_requests_status_idx
  on public.maintenance_requests (factory_id, status, created_at desc);

-- ── 2. Who may drive it ──────────────────────────────────────────────────
--
-- 0024 left update to `can_manage_factory` because nothing updated. Driving a
-- request through its phases is shift-floor work — the supervisor who called
-- the fitter is the one who knows the tools are down — so it widens to
-- `can_review_factory`, the same standing that closes an issue.

drop policy if exists "maintenance_manage_update" on public.maintenance_requests;
drop policy if exists "maintenance_review_update" on public.maintenance_requests;
create policy "maintenance_review_update"
  on public.maintenance_requests for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

-- ── 3. The gate ──────────────────────────────────────────────────────────

create or replace function public.maintenance_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'reported' then
      raise exception 'A new request starts as Reported.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── No stage change: a correction, or filling a box in early ──
  --
  -- Typing into Section 2 before formally moving there is normal on paper and
  -- allowed here. What is refused is *emptying* a box that a completed phase
  -- was paid with — that is reverting a signature without saying so.
  if new.status is not distinct from old.status then
    if old.completed_at is not null
       and coalesce(btrim(old.work_details), '') <> ''
       and coalesce(btrim(new.work_details), '') = '' then
      raise exception 'The work record is part of the signed request — correct it, don''t remove it.'
        using errcode = 'check_violation';
    end if;

    if old.verified_at is not null
       and coalesce(btrim(old.qa_remarks), '') <> ''
       and coalesce(btrim(new.qa_remarks), '') = '' then
      raise exception 'The QA review is part of the signed request — correct it, don''t remove it.'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- ── Forward, one stage at a time ──

  -- Section 2 opens. The whole content of this move is that the request stops
  -- being everybody's and starts being somebody's, so a name is the price —
  -- and which department is needed, because that is what routes it.
  if old.status = 'reported' and new.status = 'assigned' then
    if coalesce(btrim(new.assigned_to), '') = '' then
      raise exception 'Who is taking this? Name the fitter or contractor.'
        using errcode = 'check_violation';
    end if;
    if new.department_id is null then
      raise exception 'Say which department is needed before assigning the work.'
        using errcode = 'check_violation';
    end if;
    new.assigned_at := coalesce(new.assigned_at, now());
    return new;
  end if;

  -- Tools down. Costs nothing to declare and is the only reason the downtime
  -- figure means anything: without it, "how long was that machine off?" is
  -- answered by how long the paperwork sat in a tray.
  if old.status = 'assigned' and new.status = 'in_progress' then
    new.work_started_at := coalesce(new.work_started_at, now());
    return new;
  end if;

  -- Section 2 is signed. Three answers, and the paper wants all three: what
  -- was done, whether cleaning has to be arranged, whether Production has to
  -- look at it. The two yes/no boxes are refused while null rather than
  -- defaulted to no — an unanswered question that reads as "no" on a printed
  -- record is the failure mode this whole form exists to prevent.
  if old.status = 'in_progress' and new.status = 'completed' then
    if length(coalesce(btrim(new.work_details), '')) < 10 then
      raise exception 'Record what was done — and why it broke, if it is known.'
        using errcode = 'check_violation';
    end if;
    if new.cleaning_required is null then
      raise exception 'Answer whether cleaning has to be arranged after this work.'
        using errcode = 'check_violation';
    end if;
    if new.production_review_required is null then
      raise exception 'Answer whether Production has to review this work.'
        using errcode = 'check_violation';
    end if;
    if new.production_review_required and coalesce(btrim(new.production_review_by), '') = '' then
      raise exception 'Production review is required — record who signed it off.'
        using errcode = 'check_violation';
    end if;

    if new.production_review_required then
      new.production_review_at := coalesce(new.production_review_at, now());
    else
      -- Answered "no": clear a name and a time left behind by an earlier
      -- draft, so the printed record cannot show a review that did not happen.
      new.production_review_by := null;
      new.production_review_at := null;
    end if;

    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
    return new;
  end if;

  -- Section 3 is signed.
  if old.status = 'completed' and new.status = 'verified' then
    if coalesce(btrim(new.qa_sign_name), '') = '' then
      raise exception 'A QA review needs a name against it.'
        using errcode = 'check_violation';
    end if;
    if new.change_control_required is null then
      raise exception 'Answer whether change control is required.'
        using errcode = 'check_violation';
    end if;
    if new.deviation_raised is null then
      raise exception 'Answer whether a deviation was raised.'
        using errcode = 'check_violation';
    end if;
    if new.change_control_required and coalesce(btrim(new.change_control_no), '') = '' then
      raise exception 'Change control is required — record its number.'
        using errcode = 'check_violation';
    end if;
    if new.deviation_raised and coalesce(btrim(new.deviation_no), '') = '' then
      raise exception 'A deviation was raised — record its number.'
        using errcode = 'check_violation';
    end if;

    -- Same tidy-up as above, and the same reason.
    if not new.change_control_required then
      new.change_control_no := null;
    end if;
    if not new.deviation_raised then
      new.deviation_no        := null;
      new.deviation_action_id := null;
    end if;

    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
    return new;
  end if;

  raise exception 'A request moves one phase at a time, forwards: Reported → Assigned → In progress → Completed → Verified.'
    using errcode = 'check_violation';
end;
$fn$;

drop trigger if exists maintenance_stage on public.maintenance_requests;
create trigger maintenance_stage
  before insert or update on public.maintenance_requests
  for each row execute function public.maintenance_stage_transition();

comment on function public.maintenance_stage_transition() is
  'The three sections of the Breakdown Maintenance Request, as five statuses and four gates: a name and a department to assign, nothing to start work, a work record plus the cleaning and production-review answers to complete, and the change-control and deviation answers plus a signature to verify. Forward only, one at a time. Corrections between moves are allowed; emptying what a signed section was paid with is not.';

-- ── 4. The read model ────────────────────────────────────────────────────
--
-- Dropped and rebuilt rather than replaced: `create or replace view` may only
-- *append* columns, and 0024's column order puts the two departments nowhere
-- near each other. Nothing depends on this view but the browser, so the drop
-- costs a moment inside the transaction and buys a readable select list.

drop view if exists public.maintenance_requests_expanded;

create view public.maintenance_requests_expanded
with (security_invoker = true) as
select
  m.id,
  m.factory_id,
  m.request_no,
  m.equipment_no,
  m.unit_id,
  m.department_id,
  m.initiating_department_id,
  m.priority,
  m.status,
  m.description,
  m.batch_no,
  m.product_id,
  m.reported_by,
  m.assigned_to,
  m.created_at,
  m.created_by,

  m.assigned_at,
  m.work_started_at,
  m.work_details,
  m.cleaning_required,
  m.cleaning_note,
  m.production_review_required,
  m.production_review_by,
  m.production_review_at,
  m.completed_at,
  m.completed_by,

  m.change_control_required,
  m.change_control_no,
  m.deviation_raised,
  m.deviation_no,
  m.deviation_action_id,
  m.qa_remarks,
  m.qa_sign_name,
  m.verified_at,
  m.verified_by,

  u.name   as unit_name,
  d.name   as department_name,
  idp.name as initiating_department_name,
  pr.name  as product_name,
  pr.code  as product_code,

  -- The machine register resolves the number to a name the same way the shift
  -- log does — matched loosely, because the number on the paperwork is typed
  -- by hand and "MO216" and "mo 216" are the same machine to everyone but a
  -- string comparison. Null when the number was never registered, which is
  -- allowed: a fault can be raised against a machine nobody has added yet.
  eq.name as equipment_name,

  -- How long the machine was actually off, in minutes, and only once someone
  -- said the tools were down. Null while it is still off — a running clock is
  -- a display concern, not a stored number.
  case
    when m.work_started_at is not null and m.completed_at is not null
      then (extract(epoch from (m.completed_at - m.work_started_at)) / 60)::integer
  end as downtime_minutes,

  -- The other clock: how long it took anyone to pick the request up. This is
  -- the number that says whether maintenance is responsive; the one above
  -- says whether it is quick.
  case
    when m.assigned_at is not null
      then (extract(epoch from (m.assigned_at - m.created_at)) / 60)::integer
  end as response_minutes
from public.maintenance_requests m
  left join public.factory_units       u   on u.id   = m.unit_id
  left join public.factory_departments d   on d.id   = m.department_id
  left join public.factory_departments idp on idp.id = m.initiating_department_id
  left join public.factory_products    pr  on pr.id  = m.product_id
  left join public.factory_equipment   eq
    on eq.factory_id = m.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(m.equipment_no));

comment on view public.maintenance_requests_expanded is
  'Read model for Maintenance. All three sections of the request, with the unit, both departments, the product, the registered equipment name, and the two clocks — response and downtime — computed rather than stored.';

grant select on public.maintenance_requests_expanded to authenticated;
