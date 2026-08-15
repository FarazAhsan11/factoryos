-- FactoryOS · Overproduction — filed, flagged, and explained by a manager
--
-- A batch has a required quantity. When the running total for a batch and
-- activity goes past it, the entry is still filed — the units exist, refusing
-- to record them would only make the log wrong — but it carries a flag until
-- somebody with the standing to do so writes down *why* there is more product
-- than the work order asked for.
--
-- Two design choices worth stating.
--
-- **The flag is computed, not stored.** Nothing here holds an `is_overrun`
-- boolean. It is `accumulative > required_qty`, evaluated on every read, in
-- the view — same reasoning as `is_overdue` on an issue. A stored flag would
-- go stale the moment someone amends the quantity back down: the numbers would
-- say 14,900 of 15,000 and a flag would still be sitting there claiming an
-- overrun that no longer exists. Computed, correcting the entry clears the
-- flag by itself, which is the honest behaviour.
--
-- What *is* stored is the only part a clock cannot derive: the explanation.
--
-- **Clearing it is not an amendment.** The entry's numbers do not change when
-- a manager explains an overrun, so it must not pass through the amend path
-- and stamp `amended_at` — that would mark a row as corrected when nothing
-- about what happened on the floor was corrected.

-- ── 1. The explanation ───────────────────────────────────────────────────

alter table public.shift_log_entries
  add column if not exists overrun_note       text,
  add column if not exists overrun_cleared_by uuid references public.profiles (id) on delete set null,
  add column if not exists overrun_cleared_at timestamptz;

alter table public.shift_log_entries
  drop constraint if exists shift_log_overrun_note_len;
alter table public.shift_log_entries
  add constraint shift_log_overrun_note_len
  check (overrun_note is null or length(btrim(overrun_note)) >= 4);

comment on column public.shift_log_entries.overrun_note is
  'Why this batch produced more than its work order required. Set only by a manager; its presence is what clears the overrun flag.';

-- ── 2. The amend guard, taught to tell the two apart ─────────────────────

/**
 * Replaces the version in `0011`. Unchanged for a real amendment; what is new
 * is that it recognises a **clearance-only** update — one that touches nothing
 * but the three overrun columns — and treats it as its own kind of write.
 *
 * A clearance:
 *  · needs no `amend_note`, and does not stamp `amended_at`. Nothing about the
 *    logged shift was corrected.
 *  · is manager-only. The RLS policy lets an operator update their own entry,
 *    so without this check the person who logged the overrun could wave it
 *    away themselves, which is the one thing this feature exists to prevent.
 *  · stamps who explained it and when, here rather than from the client.
 */
-- Not `security definer`, same as the version it replaces: it needs no
-- privilege of its own, and `can_manage_factory()` is already definer.
create or replace function public.shift_log_amend_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  probe          public.shift_log_entries%rowtype;
  clearance_only boolean;
begin
  -- Does this update touch anything *besides* the overrun columns? Compare
  -- the incoming row against itself with those three put back to their old
  -- values: if that is identical to the old row, they were the only changes.
  probe := new;
  probe.overrun_note       := old.overrun_note;
  probe.overrun_cleared_by := old.overrun_cleared_by;
  probe.overrun_cleared_at := old.overrun_cleared_at;

  clearance_only :=
    (new is distinct from old) and (probe is not distinct from old);

  if clearance_only then
    if not public.can_manage_factory(new.factory_id) then
      raise exception 'Only a manager or admin can clear an overproduction flag.'
        using errcode = 'insufficient_privilege';
    end if;

    if coalesce(btrim(new.overrun_note), '') = '' then
      -- Blanking it puts the flag back. Legal — an explanation can turn out to
      -- be wrong — but then it is genuinely unexplained again.
      new.overrun_note       := null;
      new.overrun_cleared_by := null;
      new.overrun_cleared_at := null;
    else
      new.overrun_cleared_by := auth.uid();
      new.overrun_cleared_at := now();
    end if;

    -- Provenance is immutable here too.
    new.factory_id := old.factory_id;
    new.logged_by  := old.logged_by;
    new.created_at := old.created_at;
    return new;
  end if;

  -- ── An ordinary amendment, exactly as before ──
  if new is distinct from old then
    if coalesce(btrim(new.amend_note), '') = '' then
      raise exception 'An amendment needs a note explaining the correction.';
    end if;
    new.amended_at := now();
    new.amended_by := coalesce(new.amended_by, auth.uid());
  end if;

  -- An amendment may not smuggle an explanation in alongside the numbers: the
  -- two are different acts, by different people, and mixing them would let an
  -- operator clear their own flag inside a correction.
  new.overrun_note       := old.overrun_note;
  new.overrun_cleared_by := old.overrun_cleared_by;
  new.overrun_cleared_at := old.overrun_cleared_at;

  new.factory_id := old.factory_id;
  new.logged_by  := old.logged_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

-- ── 3. The read model ────────────────────────────────────────────────────
-- Rebuilt to carry the batch's requirement alongside its running total, and
-- to say whether the one has passed the other.
--
-- Dropped and recreated rather than replaced: `accumulative` is a window
-- function, and a window function's result cannot be referenced from the same
-- select list that computes it. The comparison needs it in an inner query.

drop view if exists public.shift_log_entries_expanded;

create view public.shift_log_entries_expanded
with (security_invoker = true) as
with base as (
  select
    e.id,
    e.factory_id,
    e.unit_id,
    e.process_id,
    e.product_id,
    e.log_date,
    e.shift,
    e.start_time,
    e.end_time,
    e.duration_minutes,
    e.equipment_no,
    e.batch_no,
    e.target_qty,
    e.qty,
    e.qty_rejected,
    e.speed_unit,
    e.target_speed,
    e.actual_speed,
    e.slow_reason,
    e.operators,
    array_to_string(e.operators, ' / ') as operators_text,
    e.comment,
    e.action_flag,
    e.created_at,
    e.amended_at,
    e.amend_note,

    u.name          as unit_name,
    p.name          as process_name,
    p.has_machine   as has_machine,
    pr.name         as product_name,
    pr.code         as product_code,

    case
      when e.batch_no is null or btrim(e.batch_no) = '' then null
      else sum(e.qty) over (
        partition by e.factory_id, lower(btrim(e.batch_no)), e.process_id
        order by e.log_date, e.created_at
        rows between unbounded preceding and current row
      )
    end as accumulative,

    e.logged_by,

    -- What the work order asked for. Nullable in effect: a product carrying
    -- the default 0 has no requirement to exceed, and must never look overrun.
    nullif(pr.required_qty, 0) as required_qty,
    e.overrun_note,
    e.overrun_cleared_at,
    e.overrun_cleared_by,
    -- Resolved here rather than left as a uuid for the client to look up. An
    -- explanation whose author you cannot read is not an audit trail, and the
    -- id on its own is not readable. `profiles_factory_read` (migration 0007)
    -- lets a member see every profile in their own tenant, and the view is
    -- `security_invoker`, so this stays inside the tenant boundary.
    cb.full_name as overrun_cleared_by_name
  from public.shift_log_entries e
    left join public.factory_units    u  on u.id  = e.unit_id
    left join public.factory_processes p  on p.id  = e.process_id
    left join public.factory_products  pr on pr.id = e.product_id
    left join public.profiles          cb on cb.id = e.overrun_cleared_by
)
select
  base.*,

  -- Past the work order, on this batch and activity.
  (
    base.required_qty is not null
    and base.accumulative is not null
    and base.accumulative > base.required_qty
  ) as is_overrun,

  -- By how much — the number the explanation has to account for.
  (
    case
      when base.required_qty is not null
       and base.accumulative is not null
       and base.accumulative > base.required_qty
      then base.accumulative - base.required_qty
    end
  ) as overrun_qty,

  -- Overrun and nobody has said why yet. This is the badge.
  (
    base.required_qty is not null
    and base.accumulative is not null
    and base.accumulative > base.required_qty
    and base.overrun_note is null
  ) as needs_overrun_note
from base;

comment on view public.shift_log_entries_expanded is
  'Read model for the shift-log data table: joined names, running accumulative total, and the overproduction flag. `is_overrun` and `needs_overrun_note` are computed on every read from accumulative vs the product''s required_qty — never stored, so amending a quantity down clears the flag by itself. RLS is inherited from shift_log_entries via security_invoker.';

grant select on public.shift_log_entries_expanded to authenticated;
