-- FactoryOS · Quality — a deviation's batch holds, one per batch
--
-- Run after 0068.
--
-- Until now a deviation held its batches with one answer, `hold_batch`, and
-- the hold lifted only when the case closed. The reference QMS (qms-v5) holds
-- **each batch on its own record**, and QA decides each one — **release** it
-- (why it is safe while the case stays open) or **reject** it — once the
-- impact is assessed, while the case stays open for its CAPA.
--
--   · `deviation_batch_holds` — one row per hold: the batch (resolved to its
--     product), status `on_hold` → `released` | `rejected`, who placed it and
--     when, who decided it, when, and why. Members read it; nothing writes it
--     but the two functions below and the raise trigger.
--   · **Raising** with "Put the batch on hold? Yes" places a hold on every
--     named batch, as before. Open cases raised that way get theirs
--     back-filled, placed when the case was raised.
--   · `place_batch_holds(case, batches, name)` — put more batches on hold
--     (Details → Batch holds, or the other batches from the Investigation).
--     Supervisor and up, on an open planned / unplanned deviation; each batch
--     must be in the product register; one already on hold here is skipped.
--   · `decide_batch_hold(hold, 'released' | 'rejected', reason, name)` —
--     supervisor and up, on an open case, with a reason. Releasing needs the
--     product impact assessment on the Investigation tab first, unless the
--     assessment said no investigation is needed.
--   · **What a hold does** — `batch_quarantine_no()` answers for an on-hold
--     batch of an open case (as before) **and for a rejected batch, for
--     good**: the shift log refuses preparatory and production work against a
--     rejected batch, and its card stays held. Downtime is always accepted.
--     A released batch's card comes off hold with its next preparatory or
--     production entry, exactly as a closed case's did.
--   · **Closing** — a deviation does not close (nor take its first close-out
--     signature) while any of its batches is still on hold.
--   · **The audit trail** gets `hold_placed`, `batch_released` and
--     `batch_rejected` (with the reason).
--
-- NCR quarantine is unchanged: an open NCR with disposition quarantine still
-- holds its batches until it closes.

-- ── 1. The holds ─────────────────────────────────────────────────────────

create table if not exists public.deviation_batch_holds (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references public.factories (id) on delete cascade,
  deviation_id     uuid not null references public.deviations (id) on delete cascade,
  batch_no         text not null,
  product_id       uuid references public.factory_products (id) on delete set null,
  status           text not null default 'on_hold',
  placed_at        timestamptz not null default now(),
  placed_by        uuid references public.profiles (id) on delete set null,
  placed_by_name   text,
  decided_at       timestamptz,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_by_name  text,
  reason           text,
  constraint deviation_batch_holds_status_known
    check (status in ('on_hold', 'released', 'rejected')),
  constraint deviation_batch_holds_decided
    check ((status = 'on_hold') = (decided_at is null))
);

-- One live hold per batch per case.
create unique index if not exists deviation_batch_holds_one_live
  on public.deviation_batch_holds (deviation_id, product_id)
  where status = 'on_hold';
create index if not exists deviation_batch_holds_case
  on public.deviation_batch_holds (deviation_id, placed_at);
create index if not exists deviation_batch_holds_product
  on public.deviation_batch_holds (product_id)
  where status in ('on_hold', 'rejected');

alter table public.deviation_batch_holds enable row level security;

drop policy if exists "deviation_batch_holds_member_read" on public.deviation_batch_holds;
create policy "deviation_batch_holds_member_read"
  on public.deviation_batch_holds for select
  using (public.is_super_admin() or factory_id = public.current_factory_id());

-- No insert, update or delete policy, on purpose: the functions below write it.

-- ── 2. Is this batch held? ───────────────────────────────────────────────

/**
 * The number of the case holding a product, or null. An open quarantine NCR
 * (as before); a deviation's hold still on, while the case is open; or a
 * batch a deviation rejected — that one for good. The oldest wins.
 *
 * Same name and signature as 0044 / 0062, so the shift-log guard, the
 * board's sync and `pipeline_jobs_expanded.quarantine_no` all follow.
 */
create or replace function public.batch_quarantine_no(p_product uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select x.no
  from (
    select d.deviation_no as no, d.created_at as at
    from public.deviations d
    where d.status = 'open'
      and d.type = 'ncr'
      and d.disposition = 'quarantine'
      and p_product = any (d.product_ids)
    union all
    select d.deviation_no, h.placed_at
    from public.deviation_batch_holds h
      join public.deviations d on d.id = h.deviation_id
    where h.product_id = p_product
      and (h.status = 'rejected' or (h.status = 'on_hold' and d.status = 'open'))
  ) x
  order by x.at
  limit 1;
$$;

-- ── 3. The shift log's refusal ───────────────────────────────────────────

create or replace function public.shift_log_quarantine_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat      text;
  held     text;
  rejected text;
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

  select d.deviation_no into rejected
  from public.deviation_batch_holds h
    join public.deviations d on d.id = h.deviation_id
  where h.product_id = new.product_id and h.status = 'rejected'
  order by h.decided_at
  limit 1;
  if rejected is not null then
    raise exception
      'Batch % was rejected under % — preparatory and production work cannot be logged against it. Downtime can still be logged.',
      coalesce(new.batch_no, ''), rejected
      using errcode = 'check_violation';
  end if;

  held := public.batch_quarantine_no(new.product_id);
  if held is not null then
    raise exception
      'Batch % is on hold under % — preparatory and production work cannot be logged against it until QA releases it or closes the case. Downtime can still be logged.',
      coalesce(new.batch_no, ''), held
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ── 4. Cards on hold ─────────────────────────────────────────────────────

/** 0062's, now for an NCR's quarantine only — a deviation holds through §5. */
create or replace function public.deviations_hold_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open'
     and new.type = 'ncr' and new.disposition = 'quarantine'
     and cardinality(new.product_ids) > 0 then
    update public.pipeline_jobs
    set status      = 'hold',
        hold_reason = 'Quality',
        held_at     = case when status <> 'hold' then now() else held_at end
    where product_id = any (new.product_ids)
      and status <> 'finished';
  end if;
  return null;
end;
$$;

/** A hold placed puts its batch's card On hold (reason Quality). */
create or replace function public.deviation_batch_holds_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'on_hold' and new.product_id is not null then
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

drop trigger if exists deviation_batch_holds_card on public.deviation_batch_holds;
create trigger deviation_batch_holds_card
  after insert on public.deviation_batch_holds
  for each row execute function public.deviation_batch_holds_card();

-- ── 5. The audit trail ───────────────────────────────────────────────────

create or replace function public.deviation_batch_holds_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.deviation_audit
      (factory_id, deviation_id, at, actor, actor_name, action, new_value)
    values (new.factory_id, new.deviation_id, new.placed_at, new.placed_by,
            coalesce(new.placed_by_name, public.audit_actor_name()),
            'hold_placed', new.batch_no);
  elsif old.status = 'on_hold' and new.status <> 'on_hold' then
    insert into public.deviation_audit
      (factory_id, deviation_id, actor, actor_name, action, new_value, reason)
    values (new.factory_id, new.deviation_id, new.decided_by,
            coalesce(new.decided_by_name, public.audit_actor_name()),
            case new.status when 'released' then 'batch_released' else 'batch_rejected' end,
            new.batch_no, new.reason);
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviation_batch_holds_audit on public.deviation_batch_holds;
create trigger deviation_batch_holds_audit
  after insert or update on public.deviation_batch_holds
  for each row execute function public.deviation_batch_holds_audit();

-- ── 6. Raising with a hold ───────────────────────────────────────────────

/** "Put the batch on hold? Yes" — a hold on each named batch. */
create or replace function public.deviations_place_holds()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.type::text in ('planned', 'unplanned') and new.hold_batch is true then
    insert into public.deviation_batch_holds
      (factory_id, deviation_id, batch_no, product_id, placed_at, placed_by, placed_by_name)
    select new.factory_id, new.id, p.batch_no, p.id, new.created_at,
           auth.uid(), coalesce(nullif(btrim(new.raised_by), ''), public.audit_actor_name())
    from unnest(new.batch_nos) with ordinality as u(b, ord)
      join public.factory_products p
        on p.factory_id = new.factory_id and lower(p.batch_no) = lower(btrim(u.b))
    order by u.ord
    on conflict do nothing;
  end if;
  return null;
end;
$fn$;

drop trigger if exists deviations_place_holds on public.deviations;
create trigger deviations_place_holds
  after insert on public.deviations
  for each row execute function public.deviations_place_holds();

-- ── 7. Putting more batches on hold ──────────────────────────────────────

create or replace function public.place_batch_holds(
  p_case      uuid,
  p_batch_nos text[],
  p_by_name   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target  public.deviations%rowtype;
  missing text;
  done    integer;
begin
  select * into target from public.deviations where id = p_case;
  if not found then
    raise exception 'Case not found.' using errcode = 'no_data_found';
  end if;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can put a batch on hold.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.type::text not in ('planned', 'unplanned') then
    raise exception 'Batch holds are kept on deviations.' using errcode = 'check_violation';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'Putting a batch on hold needs a name against it.'
      using errcode = 'check_violation';
  end if;
  if coalesce(cardinality(p_batch_nos), 0) = 0 then
    raise exception 'Name the batch to put on hold.' using errcode = 'check_violation';
  end if;

  select string_agg(btrim(b), ', ') into missing
  from unnest(p_batch_nos) as b
  where btrim(b) <> ''
    and not exists (
      select 1 from public.factory_products p
      where p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(b))
    );
  if missing is not null then
    raise exception 'Holding a batch — % is not one in the product register.', missing
      using errcode = 'check_violation';
  end if;

  select string_agg(p.batch_no, ', ') into missing
  from unnest(p_batch_nos) as b
    join public.factory_products p
      on p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(b))
  where exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = p_case and h.product_id = p.id and h.status = 'rejected'
  );
  if missing is not null then
    raise exception 'Batch % has already been rejected on this case.', missing
      using errcode = 'check_violation';
  end if;

  insert into public.deviation_batch_holds
    (factory_id, deviation_id, batch_no, product_id, placed_by, placed_by_name)
  select target.factory_id, p_case, p.batch_no, p.id, auth.uid(), btrim(p_by_name)
  from (
    select p.batch_no, p.id, min(u.ord) as ord
    from unnest(p_batch_nos) with ordinality as u(b, ord)
      join public.factory_products p
        on p.factory_id = target.factory_id and lower(p.batch_no) = lower(btrim(u.b))
    group by p.batch_no, p.id
  ) p
  where not exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = p_case and h.product_id = p.id and h.status = 'on_hold'
  )
  order by p.ord;
  get diagnostics done = row_count;
  return done;
end;
$fn$;

revoke all on function public.place_batch_holds(uuid, text[], text) from public;
grant execute on function public.place_batch_holds(uuid, text[], text) to authenticated;

-- ── 8. Releasing or rejecting one ────────────────────────────────────────

create or replace function public.decide_batch_hold(
  p_hold     uuid,
  p_decision text,
  p_reason   text,
  p_by_name  text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  h_row  public.deviation_batch_holds%rowtype;
  target public.deviations%rowtype;
begin
  select * into h_row from public.deviation_batch_holds where id = p_hold for update;
  if not found then
    raise exception 'Hold not found.' using errcode = 'no_data_found';
  end if;
  select * into target from public.deviations where id = h_row.deviation_id;
  if not public.can_review_factory(target.factory_id) then
    raise exception 'Only a supervisor or QA can release or reject a batch.'
      using errcode = 'insufficient_privilege';
  end if;
  if target.status <> 'open' then
    raise exception '% is closed — a closed case is not edited.', target.deviation_no
      using errcode = 'check_violation';
  end if;
  if h_row.status <> 'on_hold' then
    raise exception 'Batch % has already been %.', h_row.batch_no, h_row.status
      using errcode = 'check_violation';
  end if;
  if p_decision not in ('released', 'rejected') then
    raise exception 'Release or reject — nothing else.' using errcode = 'check_violation';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception '%',
      case p_decision
        when 'released' then 'Say why it is safe to release while the case is open.'
        else 'Give the reason for rejecting the batch.'
      end
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_by_name), '') = '' then
    raise exception 'The decision needs a name against it.' using errcode = 'check_violation';
  end if;
  if p_decision = 'released'
     and target.investigation_required is distinct from false
     and coalesce(btrim(target.impact), '') = '' then
    raise exception 'Record the product impact assessment on the Investigation tab first.'
      using errcode = 'check_violation';
  end if;

  update public.deviation_batch_holds
  set status          = p_decision,
      decided_at      = now(),
      decided_by      = auth.uid(),
      decided_by_name = btrim(p_by_name),
      reason          = btrim(p_reason)
  where id = p_hold;
end;
$fn$;

revoke all on function public.decide_batch_hold(uuid, text, text, text) from public;
grant execute on function public.decide_batch_hold(uuid, text, text, text) to authenticated;

-- ── 9. No closing over a live hold ───────────────────────────────────────

create or replace function public.deviations_holds_close_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  live text;
begin
  if new.type::text not in ('planned', 'unplanned') then
    return new;
  end if;
  if (old.status = 'open' and new.status = 'closed')
     or (old.close_first_signed_at is null and new.close_first_signed_at is not null) then
    select string_agg(h.batch_no, ', ' order by h.placed_at) into live
    from public.deviation_batch_holds h
    where h.deviation_id = new.id and h.status = 'on_hold';
    if live is not null then
      raise exception 'Release or reject every batch on hold before closing — % still on hold.', live
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists deviations_holds_close_guard on public.deviations;
create trigger deviations_holds_close_guard
  before update on public.deviations
  for each row execute function public.deviations_holds_close_guard();

-- ── 10. Back-fill the open cases already holding ─────────────────────────

insert into public.deviation_batch_holds
  (factory_id, deviation_id, batch_no, product_id, placed_at, placed_by, placed_by_name)
select d.factory_id, d.id, p.batch_no, p.id, d.created_at, d.created_by, d.raised_by
from public.deviations d
  cross join lateral unnest(d.product_ids) as u(pid)
  join public.factory_products p on p.id = u.pid
where d.type::text in ('planned', 'unplanned')
  and d.hold_batch is true
  and d.status = 'open'
  and not exists (
    select 1 from public.deviation_batch_holds h
    where h.deviation_id = d.id and h.product_id = p.id
  );

-- ── 11. The case read model ──────────────────────────────────────────────
-- 0068's view: `is_quarantining` (same name and type) now reads a deviation's
-- holds, and the hold counts are appended.

create or replace view public.deviations_expanded
with (security_invoker = true) as
select
  d.id,
  d.factory_id,
  d.deviation_no,
  d.type,
  d.status,
  d.status_reason,
  d.priority,
  d.title,
  d.origin,
  d.sla_date,

  d.batch_no,
  d.product_id,
  pr.name as product_name,
  pr.code as product_code,

  d.customer_name,
  d.customer_other,
  d.supplier_name,
  d.owner_name,
  d.supervisor_name,

  d.procedure_name,
  d.sop_number,
  d.document_number,
  d.raw_material_code,
  d.raw_material_name,
  d.packaging_material_code,

  d.equipment_no,
  eq.name as equipment_name,

  d.nc_category,
  d.specification,
  d.actual,
  d.impact,
  d.disposition,
  d.raised_by,
  d.qa_reviewer,

  d.immediate_action_date,
  d.immediate_action,

  d.likelihood,
  d.severity,
  d.detection,
  d.financial_impact,
  d.risk_description,
  d.risk_assessed_at,

  (d.likelihood * d.severity * d.detection) as risk_score,
  case
    when d.likelihood is null or d.severity is null or d.detection is null
      then null
    when d.severity = 5
      or d.likelihood * d.severity * d.detection >= 60 then 'High'
    when d.likelihood * d.severity * d.detection >= 20 then 'Medium'
    else 'Low'
  end as risk_conclusion,

  d.investigation_findings,
  d.investigated_at,

  d.ca_owner,
  d.ca_target_date,
  d.ca_closed_date,
  d.ca_closed_by_name,
  d.ca_description,

  d.pa_owner,
  d.pa_target_date,
  d.pa_closed_date,
  d.pa_closed_by_name,
  d.pa_description,

  d.co_owner,
  d.co_target_date,
  d.closing_note,
  d.qa_sign_name,
  d.closed_at,

  d.action_id,
  a.title  as action_title,
  a.status as action_status,

  d.created_by,
  d.created_at,

  (extract(epoch from (coalesce(d.closed_at, now()) - d.created_at)) / 86400)::integer
    as age_days,
  case when d.sla_date is not null then (d.sla_date - current_date) end
    as days_to_sla,
  (d.status = 'open' and d.sla_date is not null and d.sla_date < current_date)
    as is_overdue,

  -- Whether this case is what is holding its batches right now: an NCR's
  -- quarantine, or a deviation with a batch hold still on (0069).
  (d.status = 'open'
    and (
      (d.type = 'ncr' and d.disposition = 'quarantine' and cardinality(d.product_ids) > 0)
      or exists (
        select 1 from public.deviation_batch_holds h
        where h.deviation_id = d.id and h.status = 'on_hold'
      )
    ))
    as is_quarantining,

  -- ── Appended by 0057 ──────────────────────────────────────────────────
  d.received_via,
  d.adverse_reaction,
  d.capa_needed,
  d.capa_not_needed_reason,
  d.capa_id,
  cp.capa_no,
  cp.status      as capa_status,
  cp.verified_at as capa_verified_at,

  -- ── Appended by 0058 ──────────────────────────────────────────────────
  d.root_cause_category,

  -- ── Appended by 0061 ──────────────────────────────────────────────────
  d.root_cause,
  d.rca_method,

  -- ── Appended by 0062 ──────────────────────────────────────────────────
  d.occurred_at,
  d.department_id,
  dep.name as department_name,
  d.location,
  d.detection_point,
  d.batch_nos,
  d.product_ids,
  d.hold_batch,
  -- The products the batches resolve to, in batch order, without repeats.
  coalesce((
    select array_agg(x.name order by x.ord)
    from (
      select p.name, min(u.ord) as ord
      from unnest(d.product_ids) with ordinality as u(pid, ord)
        join public.factory_products p on p.id = u.pid
      group by p.name
    ) x
  ), '{}') as product_names,

  -- ── Appended by 0063 ──────────────────────────────────────────────────
  d.investigation_required,
  d.investigation_not_required_reason,
  d.red_flags,
  d.classification,
  d.classification_reason,
  d.assessed_at,
  d.assessed_by_name,

  -- ── Appended by 0064 ──────────────────────────────────────────────────
  d.other_batch_nos,
  d.checks_reviewed,
  d.root_cause_categories,
  d.human_procedure_clear,
  d.human_trained,
  d.human_preventable,
  d.root_cause_conclusion,
  d.investigation_submitted_at,
  d.investigation_submitted_by_name,
  d.investigation_returned_at,
  d.investigation_returned_by_name,
  d.investigation_return_reason,
  d.investigation_approved_at,
  d.investigation_approved_by_name,

  -- ── Appended by 0065 ──────────────────────────────────────────────────
  d.unresolved_risk,
  d.duplicate_of,
  d.cost_of_quality,
  d.close_first_signed_at,
  d.close_first_signed_by_name,

  -- ── Appended by 0068 ──────────────────────────────────────────────────
  d.previous_case_ids,
  d.no_previous_found_at,
  d.no_previous_found_by_name,
  d.previous_cases_external,

  -- ── Appended by 0069 ──────────────────────────────────────────────────
  (select count(*)::integer from public.deviation_batch_holds h
    where h.deviation_id = d.id and h.status = 'on_hold') as holds_on_hold,
  (select count(*)::integer from public.deviation_batch_holds h
    where h.deviation_id = d.id) as holds_total
from public.deviations d
  left join public.factory_products pr on pr.id = d.product_id
  left join public.actions          a  on a.id  = d.action_id
  left join public.capas            cp on cp.id = d.capa_id
  left join public.factory_departments dep on dep.id = d.department_id
  left join public.factory_equipment eq
    on eq.factory_id = d.factory_id
   and lower(btrim(eq.equipment_no)) = lower(btrim(d.equipment_no));

comment on view public.deviations_expanded is
  'Read model for the Quality cases — deviations, NCRs and customer complaints: the case record with its batches, products, department and equipment resolved, the risk score (1–125) and conclusion and the case aging computed rather than stored, the linked CAPA''s number and status, and the root cause.';

grant select on public.deviations_expanded to authenticated;
