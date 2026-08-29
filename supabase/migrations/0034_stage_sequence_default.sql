-- FactoryOS · A stage's position must be computed, not defaulted
--
-- `batch_stages.sequence_order` was declared `not null default 1`, and
-- `batch_stages_validate` appends a new stage to the end of the plan only when
-- the incoming value "is null or < 1".
--
-- Those two never meet. A column default is applied *before* BEFORE triggers
-- run, so a caller that omits `sequence_order` — which every caller does,
-- deliberately, so the database decides the order — arrives at the trigger
-- holding 1, not null. 1 is not less than 1, so the append is skipped and the
-- row keeps it.
--
-- Every stage therefore landed at position 1. The symptoms were subtle enough
-- to miss: `batch_stages_final_sync` orders by `sequence_order desc,
-- created_at desc`, so the *final* tag still landed on the last stage added,
-- by the tie-break alone. What broke was everything that reads the order — the
-- plan rendered in insertion order rather than planned order, and reordering a
-- stage moved a number that already equalled its neighbours', so nothing moved.
--
-- Dropping the default is the whole fix: an omitted `sequence_order` is then
-- genuinely null at trigger time, the append runs, and `not null` is checked
-- afterwards, as it always was.

alter table public.batch_stages
  alter column sequence_order drop default;

comment on column public.batch_stages.sequence_order is
  'Position in the plan, 1-based. Computed by batch_stages_validate when omitted — deliberately no column default, which would pre-empt that. The greatest position carries is_final and completes the order.';

-- Re-space the plans written before this fix, which are all sitting at 1.
-- Ordered by creation, which is the order they were added in and the only
-- record of intent there is. `is_final` is recomputed by its own trigger as
-- each row is updated, so the tag lands where the numbering now says.
with renumbered as (
  select id, row_number() over (
    partition by job_id order by sequence_order, created_at
  ) as position
  from public.batch_stages
)
update public.batch_stages b
set sequence_order = r.position
from renumbered r
where r.id = b.id
  and b.sequence_order <> r.position;

-- ── The sign-off record is immutable, not just its target ────────────────
--
-- `batch_stage_transition` guards a completed stage in two places, and there
-- was a gap between them. The "no stage change" branch — the one that handles
-- an ordinary edit — refused a changed `target_qty` on a signed-off stage and
-- said nothing about the sign-off itself. An update carrying
-- `status = 'complete'` on a stage that is *already* complete never reaches
-- the "already been signed off" check below it, because the status did not
-- change; it falls into that first branch and is waved through.
--
-- So the yield answer and the sign-off note could be rewritten afterwards,
-- silently, by anyone who could reach the row. That is the one field on a
-- stage whose whole purpose is to be somebody's statement about a batch —
-- "the yield was acceptable" — and it is the field that ends up on a handover
-- sheet and in front of an auditor.
--
-- The rest of the function is unchanged; only the completed-stage branch is
-- widened from the target to the whole record.

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
         or (new.completed_at is distinct from old.completed_at) then
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
