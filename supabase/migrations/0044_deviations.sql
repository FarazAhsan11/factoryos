-- FactoryOS · Deviations & NCRs
--
-- The QA register the prototype calls "Deviations / NCR": a numbered record
-- of something that departed from what was specified, raised against a batch,
-- reviewed and closed by QA. Three kinds, and the kind is part of the number:
--
--   planned    DEV-2026-001  a known change, made with QA approval
--   unplanned  DEV-2026-002  an unexpected departure from the process
--   ncr        NCR-2026-001  non-conforming material or product
--
-- An NCR also carries a **disposition** — use as is, rework, reject, or
-- quarantine. Quarantine is the one that reaches past this table: it is a
-- decision to *stop the batch* until QA has looked at it, so it holds the
-- pipeline card and the shift log refuses producing work against the batch
-- until the NCR is closed. It is also a holding decision rather than an
-- outcome, so an NCR cannot be closed on it — closing names what finally
-- happened to the material.
--
-- Two statuses, `open → closed`, one gate between them, paid for with a QA
-- signature and a closing note. Forward only, and a closed record is not
-- edited: it is the signed document.
--
-- The same shape as maintenance (0024): typed batch number kept as text with
-- the product id as its resolution, a trigger-stamped number from
-- `next_document_number()`, a `security_invoker` read model.

-- ── 1. Vocabulary ────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'deviation_type') then
    create type public.deviation_type as enum ('planned', 'unplanned', 'ncr');
  end if;

  if not exists (select 1 from pg_type where typname = 'deviation_status') then
    create type public.deviation_status as enum ('open', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'ncr_disposition') then
    create type public.ncr_disposition as enum (
      'use_as_is',   -- within acceptance criteria
      'rework',      -- can be brought back to spec
      'reject',      -- destroy, or return to the supplier
      'quarantine'   -- hold pending QA review — never a final answer
    );
  end if;
end $$;

-- ── 2. The register ──────────────────────────────────────────────────────

create table if not exists public.deviations (
  id           uuid primary key default gen_random_uuid(),
  factory_id   uuid not null references public.factories (id) on delete cascade,

  -- "DEV-2026-004" / "NCR-2026-001". Stamped by the trigger, never sent.
  deviation_no text not null,

  type         public.deviation_type not null,
  status       public.deviation_status not null default 'open',

  -- Typed, kept as text, and resolved to a product by the trigger — the same
  -- bargain as maintenance and issues: the number on the paperwork is what
  -- someone searches for later, and it survives matching nothing.
  batch_no     text,
  product_id   uuid references public.factory_products (id) on delete set null,

  -- The prototype's three questions: what was required, what happened, and
  -- what it might do to the product.
  specification text,
  actual        text not null,
  impact        text,

  -- NCR only. Required on one, meaningless on the other two.
  disposition  public.ncr_disposition,

  -- Typed names, like every signature in this application.
  raised_by    text,
  qa_reviewer  text,

  -- The CAPA this deviation is being worked under, when there is one.
  action_id    uuid references public.actions (id) on delete set null,

  -- The gate's evidence.
  closing_note text,
  qa_sign_name text,
  closed_at    timestamptz,
  closed_by    uuid references public.profiles (id) on delete set null,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint deviations_actual_len check (length(btrim(actual)) >= 10),

  -- An NCR has a disposition and a deviation has none.
  constraint deviations_disposition_ncr_only check (
    (type = 'ncr') = (disposition is not null)
  ),

  -- A closed record carries its signature and its outcome, and an NCR's
  -- outcome is never "still on hold".
  constraint deviations_closed_signed check (
    status <> 'closed'
    or (
      coalesce(btrim(qa_sign_name), '') <> ''
      and coalesce(btrim(closing_note), '') <> ''
      and closed_at is not null
    )
  ),
  constraint deviations_closed_not_quarantined check (
    status <> 'closed' or disposition is distinct from 'quarantine'
  )
);

create unique index if not exists deviations_no_key
  on public.deviations (factory_id, deviation_no);

create index if not exists deviations_factory_idx
  on public.deviations (factory_id, created_at desc);

-- What the shift log and the board ask on every write and every read: is this
-- batch quarantined right now?
create index if not exists deviations_quarantine_idx
  on public.deviations (product_id)
  where type = 'ncr' and status = 'open' and disposition = 'quarantine';

alter table public.deviations enable row level security;

drop policy if exists "deviations_member_read" on public.deviations;
create policy "deviations_member_read"
  on public.deviations for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- Raising one is supervisor and up, not the whole floor: a quarantine NCR
-- stops a batch, and that is the standing that closes an issue.
drop policy if exists "deviations_review_insert" on public.deviations;
create policy "deviations_review_insert"
  on public.deviations for insert
  with check (
    public.can_review_factory(factory_id)
    and created_by = auth.uid()
  );

drop policy if exists "deviations_review_update" on public.deviations;
create policy "deviations_review_update"
  on public.deviations for update
  using (public.can_review_factory(factory_id))
  with check (public.can_review_factory(factory_id));

-- No delete policy, on purpose. A raised deviation is a record, not clutter.

-- ── 3. Is this batch quarantined? ────────────────────────────────────────

/**
 * The number of the open quarantine NCR against a batch, or null.
 *
 * One definition, read by the shift log's guard, the board's sync and the
 * board's view, so "quarantined" cannot mean three different things. The
 * oldest wins when there are several — it is the one that stopped the batch.
 */
create or replace function public.batch_quarantine_no(p_product uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.deviation_no
  from public.deviations d
  where d.product_id = p_product
    and d.type = 'ncr'
    and d.status = 'open'
    and d.disposition = 'quarantine'
  order by d.created_at
  limit 1;
$$;

-- ── 4. The gate ──────────────────────────────────────────────────────────

create or replace function public.deviations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- The batch resolves here rather than in the browser, so a quarantine can
  -- never miss its batch because a form forgot to look it up.
  if tg_op = 'INSERT' or new.batch_no is distinct from old.batch_no then
    new.batch_no := nullif(btrim(coalesce(new.batch_no, '')), '');
    new.product_id := (
      select p.id from public.factory_products p
      where p.factory_id = new.factory_id
        and lower(p.batch_no) = lower(new.batch_no)
    );
  end if;

  -- A quarantine that names no batch holds nothing, and would say it did.
  if new.status = 'open'
     and new.disposition = 'quarantine'
     and new.product_id is null then
    raise exception 'Quarantine holds a batch — % is not one in the product register.',
      coalesce(new.batch_no, '(no batch)')
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A new deviation starts as Open.'
        using errcode = 'check_violation';
    end if;

    -- Stamped inside the insert's own transaction, so a failed insert never
    -- leaves a gap in a sequence people read as "one went missing".
    new.deviation_no := public.next_document_number(
      new.factory_id,
      case when new.type = 'ncr' then 'NCR' else 'DEV' end,
      case when new.type = 'ncr' then 'NCR' else 'DEV' end
    );
    new.closing_note := null;
    new.qa_sign_name := null;
    new.closed_at    := null;
    new.closed_by    := null;
    return new;
  end if;

  if new.deviation_no is distinct from old.deviation_no
     or new.factory_id is distinct from old.factory_id
     or new.created_at is distinct from old.created_at then
    raise exception 'The number, factory and raised time of a deviation are fixed.'
      using errcode = 'check_violation';
  end if;

  if new.type is distinct from old.type then
    raise exception 'The type is part of the number — raise a new record instead of changing it.'
      using errcode = 'check_violation';
  end if;

  -- ── Closed: the signed document ──
  --
  -- Only the columns that record something are frozen. The references
  -- (product, CAPA, profiles) are `on delete set null`, and refusing that
  -- update would make a closed deviation block the deletion of a CAPA.
  if old.status = 'closed' then
    if new.status        is distinct from old.status
       or new.batch_no      is distinct from old.batch_no
       or new.specification is distinct from old.specification
       or new.actual        is distinct from old.actual
       or new.impact        is distinct from old.impact
       or new.disposition   is distinct from old.disposition
       or new.raised_by     is distinct from old.raised_by
       or new.qa_reviewer   is distinct from old.qa_reviewer
       or new.closing_note  is distinct from old.closing_note
       or new.qa_sign_name  is distinct from old.qa_sign_name
       or new.closed_at     is distinct from old.closed_at
       or (new.action_id is not null and new.action_id is distinct from old.action_id)
    then
      raise exception '% is closed — a closed record is not edited.', old.deviation_no
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── Open → Closed ──
  if new.status = 'closed' then
    if coalesce(btrim(new.qa_sign_name), '') = '' then
      raise exception 'Closing needs a QA reviewer''s name against it.'
        using errcode = 'check_violation';
    end if;
    if length(coalesce(btrim(new.closing_note), '')) < 10 then
      raise exception 'Record the outcome — what was decided and what was done.'
        using errcode = 'check_violation';
    end if;
    if new.disposition = 'quarantine' then
      raise exception 'Quarantine is a hold, not an outcome — choose use as is, rework or reject to close the NCR.'
        using errcode = 'check_violation';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
  end if;

  return new;
end;
$fn$;

drop trigger if exists deviations_guard on public.deviations;
create trigger deviations_guard
  before insert or update on public.deviations
  for each row execute function public.deviations_guard();

-- ── 5. Quarantine holds the card ─────────────────────────────────────────

/**
 * An open quarantine NCR puts the batch's card On hold, with the reason
 * "Quality".
 *
 * Only the putting-on. Closing the NCR releases nothing: the card stays held
 * until the next preparatory or production entry, which is the shift log
 * saying the batch is being worked again. A rejected batch is never worked
 * again, so it stays held — which is the truth about it.
 *
 * A finished card is left alone: the material exists and has been counted.
 */
create or replace function public.deviations_hold_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'ncr'
     and new.status = 'open'
     and new.disposition = 'quarantine'
     and new.product_id is not null then
    update public.pipeline_jobs
    set status      = 'hold',
        hold_reason = 'Quality',
        held_at     = case when status <> 'hold' then now() else held_at end
    where product_id = new.product_id
      and status <> 'finished';
  end if;
  return null;
end;
$$;

drop trigger if exists deviations_hold on public.deviations;
create trigger deviations_hold
  after insert or update on public.deviations
  for each row execute function public.deviations_hold_batch();

-- ── 6. The shift log refuses producing work on a quarantined batch ───────

/**
 * Preparatory and production entries are refused against a batch under an
 * open quarantine NCR. Downtime is not: a room loses time whatever state its
 * batch is in, and refusing the record would only lose the time.
 *
 * An amendment that leaves the batch and the activity where they were is not
 * this trigger's business — it corrects work filed before the quarantine.
 */
create or replace function public.shift_log_quarantine_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat text;
  ncr text;
begin
  if new.product_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.product_id is not distinct from old.product_id
     and new.process_id is not distinct from old.process_id then
    return new;
  end if;

  select category into cat
  from public.factory_processes where id = new.process_id;

  if cat = 'downtime' then
    return new;
  end if;

  ncr := public.batch_quarantine_no(new.product_id);
  if ncr is not null then
    raise exception
      'Batch % is quarantined under % — preparatory and production work cannot be logged against it until QA closes the NCR. Downtime can still be logged.',
      coalesce(new.batch_no, ''), ncr
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists shift_log_quarantine_guard on public.shift_log_entries;
create trigger shift_log_quarantine_guard
  before insert or update on public.shift_log_entries
  for each row execute function public.shift_log_quarantine_guard();

-- ── 7. The board's moves, with two rules added ───────────────────────────

/**
 * 0033's sync, unchanged except for two rules:
 *
 *  · **Downtime never releases a hold.** A downtime entry is about the room —
 *    the machine was down, the room was cleaning — and says nothing about the
 *    batch being worked again. Only a preparatory or production entry does.
 *    This applies to every hold, a flagged issue's as much as a quarantine's.
 *    (Downtime carries no action flag, so it never *puts* a hold on either.)
 *
 *  · **Nothing releases a quarantine.** While an open quarantine NCR names the
 *    batch the card stays held, reason Quality, whatever is logged. In
 *    practice only downtime reaches here — the guard above refuses the rest —
 *    but an amendment to an entry filed before the NCR still fires this.
 *
 * A downtime entry still starts a planned job and still moves the card to the
 * room it names, exactly as before.
 */
create or replace function public.pipeline_sync_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job         public.pipeline_jobs%rowtype;
  next        public.pipeline_status;
  cat         text;
  quarantined boolean;
begin
  if new.product_id is null then
    return null;
  end if;

  select * into job
  from public.pipeline_jobs
  where product_id = new.product_id;

  if not found or job.status = 'finished' then
    return null;
  end if;

  select category into cat
  from public.factory_processes where id = new.process_id;

  quarantined := public.batch_quarantine_no(new.product_id) is not null;

  next := job.status;

  if next = 'planned' then
    next := 'production';
  end if;

  if new.action_flag is not null then
    next := 'hold';
  elsif next = 'hold' and cat is distinct from 'downtime' then
    next := 'production';
  end if;

  if quarantined then
    next := 'hold';
  end if;

  update public.pipeline_jobs
  set
    status      = next,
    unit_id     = new.unit_id,
    -- A hold kept by a downtime entry keeps the reason it already had.
    hold_reason = case
                    when next <> 'hold' then null
                    when quarantined then 'Quality'
                    else coalesce(new.action_flag, job.hold_reason)
                  end,
    started_at  = case
                    when job.started_at is null and next <> 'planned'
                    then now() else job.started_at
                  end,
    held_at     = case
                    when next = 'hold' and job.status <> 'hold'
                    then now() else job.held_at
                  end
  where id = job.id;

  return null;
end;
$$;

-- ── 8. Read models ───────────────────────────────────────────────────────

create or replace view public.deviations_expanded
with (security_invoker = true) as
select
  d.id,
  d.factory_id,
  d.deviation_no,
  d.type,
  d.status,
  d.batch_no,
  d.product_id,
  d.specification,
  d.actual,
  d.impact,
  d.disposition,
  d.raised_by,
  d.qa_reviewer,
  d.action_id,
  d.closing_note,
  d.qa_sign_name,
  d.closed_at,
  d.created_by,
  d.created_at,

  pr.name   as product_name,
  pr.code   as product_code,
  a.title   as action_title,
  a.status  as action_status,

  -- Whether this record is what is holding its batch right now.
  (d.type = 'ncr' and d.status = 'open' and d.disposition = 'quarantine'
    and d.product_id is not null) as is_quarantining
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id;

comment on view public.deviations_expanded is
  'Read model for Deviations & NCRs: the record, its product, and the linked CAPA''s title and stage.';

grant select on public.deviations_expanded to authenticated;

-- The board's view, as 0037 left it, with `quarantine_no` appended at the end
-- — `create or replace view` may only add columns after the existing ones. It
-- is what lets the card and the shift log say *which* NCR is holding a batch
-- without a second request.
create or replace view public.pipeline_jobs_expanded
with (security_invoker = true) as
select
  j.id,
  j.factory_id,
  j.product_id,
  j.status,
  j.unit_id,
  j.hold_reason,
  j.planned_at,
  j.started_at,
  j.held_at,
  j.finished_at,
  j.created_at,

  pr.batch_no,
  pr.code         as product_code,
  pr.name         as product_name,
  pr.required_qty,

  u.name          as unit_name,

  public.batch_final_group_made(j.id) as produced_qty,

  (
    select count(*)
    from public.shift_log_entries e
    where e.product_id = j.product_id
      and e.action_flag is not null
  ) as flagged_count,

  j.batch_type,
  j.parent_job_id,
  j.bulk_unit,
  j.pack_size,
  j.pack_unit,
  j.bulk_qty_received,
  j.market,
  j.overage_pct,
  j.priority,
  j.due_date,
  j.notes,
  j.rework_source_id,

  parent_pr.batch_no   as parent_batch_no,
  parent_pr.name       as parent_product_name,

  (
    select count(*)
    from public.pipeline_jobs c
    where c.parent_job_id = j.id
  ) as child_count,

  (
    select sum(cpr.required_qty * c.pack_size)
    from public.pipeline_jobs c
      join public.factory_products cpr on cpr.id = c.product_id
    where c.parent_job_id = j.id
      and c.pack_size is not null
  ) as allocated_qty,

  case
    when j.batch_type = 'packing' and j.pack_size is not null then coalesce((
      select sum(e.qty) * j.pack_size
      from public.shift_log_entries e
      where e.product_id = j.product_id
    ), 0)
  end as bulk_consumed,

  j.issued_at,
  (
    select count(*) from public.batch_stages b where b.job_id = j.id
  ) as stage_count,
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and b.status = 'complete'
  ) as stages_complete,
  (
    select count(*) from public.batch_stages b
    where b.job_id = j.id and coalesce(b.target_qty, 0) <= 0
  ) as stages_without_target,
  public.batch_final_group_target(j.id)::numeric(14, 2) as final_target_qty,

  -- ── Appended by 0037 ──────────────────────────────────────────────────
  j.tolerance_pct,

  -- ── Appended by 0044 ──────────────────────────────────────────────────
  public.batch_quarantine_no(j.product_id) as quarantine_no
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

grant select on public.pipeline_jobs_expanded to authenticated;
