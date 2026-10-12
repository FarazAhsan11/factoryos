-- FactoryOS · Who actually signed the stage off
--
-- A stage sign-off has recorded `completed_by` since 0033: the signed-in
-- account, stamped by `batch_stage_transition` from `auth.uid()`. That answers
-- "whose session pressed the button" and, in a plant where one supervisor
-- tablet is shared across a shift, it is not always the answer anyone wants.
-- The person who walked the line, checked the yield and put their name to it
-- may not be the account that was logged in.
--
-- So the sign-off now also carries a name: the person making the statement.
-- It is asked for on every sign-off — Yes and No alike, because the "No" is
-- the one a reader goes looking for.
--
-- ── Why a second column and not a replacement ────────────────────────────
--
-- `completed_by` is deliberately left exactly as it was: a uuid the *server*
-- stamps from the session, which a client cannot choose. `signed_off_by_name`
-- is what a person *says*. Both are kept so the record can show the two
-- without either overwriting the other — the account is the audit trail, the
-- name is the statement. Folding them into one would have meant either losing
-- who was signed in, or letting the client assert an identity into the column
-- the audit trail reads.
--
-- ── What the trigger now enforces ────────────────────────────────────────
--
-- The same function as 0034, widened in two places and otherwise unchanged:
--
--   • in progress → complete refuses a blank name. The form asks for it, but a
--     form is UX; this is the trust boundary, as it is for the yield answer.
--   • the signed-off branch lists `signed_off_by_name` with the other fields
--     that constitute the sign-off, so it cannot be rewritten afterwards.
--
-- Stages signed off before this migration have no name and keep none — the
-- column is nullable, and the guard only fires on the transition, so history
-- is untouched.

alter table public.batch_stages
  add column if not exists signed_off_by_name text;

alter table public.batch_stages
  drop constraint if exists batch_stages_signed_off_by_name_len;
alter table public.batch_stages
  add constraint batch_stages_signed_off_by_name_len
  check (
    signed_off_by_name is null
    or char_length(btrim(signed_off_by_name)) between 2 and 120
  );

comment on column public.batch_stages.signed_off_by_name is
  'The name of the person who signed the stage off, as they gave it at sign-off (0049). A statement, not an identity: `completed_by` is the account the server stamped. Null on stages signed off before 0049. Immutable once the stage is complete.';

-- ── The transition guard ─────────────────────────────────────────────────

create or replace function public.batch_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    -- Not a transition. A target may still be corrected — but never emptied:
    -- that would put an unplanned producing stage on a running batch, straight
    -- back through the gate that was closed when the batch was issued.
    if old.target_qty is not null and new.target_qty is null then
      raise exception
        'A stage target can be corrected, not removed — the batch was issued against it.'
        using errcode = 'check_violation';
    end if;

    -- Once signed off, nothing that constitutes the sign-off may move. A
    -- no-op update is still allowed through: it changes nothing, and refusing
    -- it would only teach callers to avoid re-sending a row they already hold.
    if old.status = 'complete' then
      if new.target_qty is distinct from old.target_qty then
        raise exception
          'This stage has been signed off — its target is part of that record.'
          using errcode = 'check_violation';
      end if;
      if (new.yield_acceptable is distinct from old.yield_acceptable)
         or (new.yield_notes is distinct from old.yield_notes)
         or (new.yield_pct is distinct from old.yield_pct)
         or (new.completed_by is distinct from old.completed_by)
         or (new.completed_at is distinct from old.completed_at)
         or (new.signed_off_by_name is distinct from old.signed_off_by_name) then
        raise exception
          'This stage has already been signed off — that record cannot be rewritten.'
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  if old.status = 'complete' then
    raise exception 'This stage has already been signed off.'
      using errcode = 'check_violation';
  end if;

  if old.status = 'pending' and new.status = 'in_progress' then
    new.started_at := coalesce(new.started_at, now());
    return new;
  end if;

  if old.status = 'in_progress' and new.status = 'complete' then
    if not public.can_review_factory(new.factory_id) then
      raise exception 'Only a supervisor or above can sign off a stage.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.yield_acceptable is null then
      raise exception 'Say whether the yield is acceptable before signing off.'
        using errcode = 'check_violation';
    end if;
    new.signed_off_by_name := nullif(btrim(new.signed_off_by_name), '');
    if new.signed_off_by_name is null then
      raise exception 'Say who is signing the stage off.'
        using errcode = 'check_violation';
    end if;
    new.completed_at := now();
    new.completed_by := coalesce(new.completed_by, auth.uid());
    -- Recorded, not asked for: it is arithmetic over two numbers already on
    -- the row, and a typed yield is a number that can disagree with them.
    new.yield_pct := case
      when new.target_qty is null or new.target_qty = 0 then null
      else round(new.accumulated_qty / new.target_qty * 100, 2)
    end;
    return new;
  end if;

  raise exception 'A stage goes pending → in progress → complete, one step at a time.'
    using errcode = 'check_violation';
end;
$$;

-- ── The read model ───────────────────────────────────────────────────────
--
-- Appended at the end, after the 0040 block, because `create or replace view`
-- may not insert a column mid-list.

create or replace view public.batch_stages_expanded
with (security_invoker = true) as
select
  s.id,
  s.factory_id,
  s.job_id,
  s.process_id,
  s.unit_id,
  s.sequence_order,
  s.label,
  s.work_order,
  s.target_qty,
  s.target_unit,
  s.pack_size,
  s.accumulated_qty,
  s.status,
  s.is_final,
  s.can_run_parallel,
  s.started_at,
  s.completed_at,
  s.completed_by,
  s.yield_pct,
  s.yield_acceptable,
  s.yield_notes,
  s.previous_target_qty,
  s.target_changed_at,
  s.created_at,

  p.name       as process_name,
  p.category   as process_category,
  u.name       as unit_name,
  cb.full_name as completed_by_name,
  pr.batch_no  as batch_no,

  s.tolerance_pct,
  coalesce(s.tolerance_pct, j.tolerance_pct, 0) as effective_tolerance_pct,
  public.batch_stage_allowed_qty(
    s.target_qty,
    coalesce(s.tolerance_pct, j.tolerance_pct, 0)
  ) as allowed_qty,
  (
    s.target_qty is not null
    and s.accumulated_qty > public.batch_stage_allowed_qty(
      s.target_qty,
      coalesce(s.tolerance_pct, j.tolerance_pct, 0)
    )
  ) as is_over_tolerance,

  s.planned_date,
  (
    s.planned_date is not null
    and s.status <> 'complete'
    and s.planned_date < current_date
  ) as is_behind_plan,

  s.est_finish_date,
  s.planning_note,
  (
    s.est_finish_date is not null
    and s.status <> 'complete'
    and s.est_finish_date < current_date
  ) as is_overrunning,

  s.signed_off_by_name
from public.batch_stages s
  left join public.factory_processes p  on p.id = s.process_id
  left join public.factory_units     u  on u.id = s.unit_id
  left join public.profiles          cb on cb.id = s.completed_by
  left join public.pipeline_jobs     j  on j.id = s.job_id
  left join public.factory_products  pr on pr.id = j.product_id;

comment on view public.batch_stages_expanded is
  'A batch''s planned stages with the process, room and signer resolved, the tolerance the shift log enforces against each one (0037), the day the stage is planned to run and whether that day has passed (0039), the planner''s estimated finish and queue note, with whether that estimate has passed (0040), and since 0049 the name the signer gave at sign-off. RLS inherited from batch_stages via security_invoker.';

grant select on public.batch_stages_expanded to authenticated;
