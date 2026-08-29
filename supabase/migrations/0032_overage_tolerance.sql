-- FactoryOS · Overage becomes the tolerance the overrun flag measures against
--
-- Migration 0023 flags a batch that produces more than its work order asked
-- for, and demands a manager write down why. That rule has been *too strict in
-- exactly one direction* ever since: making a few percent extra is not an
-- accident, it is the plan.
--
-- Three packing runs need 210,000 tablets between them. Tablets are lost to
-- coating rejects, machine set-up and QA samples, so the planner makes 4%
-- extra — 218,400 — precisely so the last run doesn't come up short. Under
-- 0023 every entry past 210,000 raised a flag a manager then had to clear by
-- typing "planned overage" over and over. A flag that fires on the plan
-- working correctly is a flag people learn to clear without reading.
--
-- Migration 0031 added `pipeline_jobs.overage_pct` and stored it, computing
-- nothing from it. This is what it was for.
--
--   allowed_qty = required_qty × (1 + overage_pct / 100)
--
-- and a batch is over-produced when it passes *that*, not `required_qty`.
--
-- ── What the flag now means ──────────────────────────────────────────────
--
-- Sharper, not weaker. Before, it meant "past the work order", which on a
-- batch with a declared overage was usually not news. Now it means "past what
-- this batch was allowed to make", which is always worth a sentence. The
-- overrun *quantity* moves with it: the number needing an account is the
-- excess over the allowance, not over the order.
--
-- A batch with no overage declared — the default, and every row written before
-- 0031 — behaves exactly as it did: `overage_pct` is 0, the allowance is the
-- requirement, and nothing about the flag changes.

-- ── 1. Overage is not only a manufacturing idea ──────────────────────────
-- A combined batch manufactures too — it just packs under the same number —
-- so it has the same reason to make a few percent extra. Only a *packing* run
-- has no business declaring one: it fills what it was given, and its slack was
-- already taken on the bulk it draws from. Enforced here rather than in the
-- form, so it holds for an import or a hand-written update.
alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_overage_belongs;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_overage_belongs
  check (batch_type <> 'packing' or coalesce(overage_pct, 0) = 0);

comment on column public.pipeline_jobs.overage_pct is
  'Extra this batch is deliberately allowed to make, as a percentage of its required quantity — the losses a planner expects to coating, set-up and samples. Widens the threshold the shift log''s over-production flag measures against (migration 0032). Always 0 on a packing run, which fills what it was given.';

-- ── 2. The read model ────────────────────────────────────────────────────
-- Dropped and recreated rather than replaced, for the reason 0030 gives:
-- `accumulative` is a window function the overrun comparison has to read from
-- an inner query, so the shape is a CTE and CREATE OR REPLACE cannot add a
-- column in the middle of one.
--
-- Two new columns, both so the UI can *explain* the flag rather than only
-- raise it — "540,000 required, 561,600 allowed, 562,300 made" is a sentence
-- an operator can act on, and "over by 700" alone is not:
--
--   overage_pct  What this batch was allowed to add, as a percentage.
--   allowed_qty  The requirement plus that allowance — the actual threshold.

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
    e.qty_unit,
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
    p.category      as process_category,
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

    -- The declared allowance, from the batch's card. `left join` and a
    -- coalesce: a batch with no job on the board — a plant not using the
    -- pipeline at all — is allowed exactly what it was asked for, which is the
    -- behaviour every row had before this migration.
    coalesce(j.overage_pct, 0) as overage_pct,

    e.overrun_note,
    e.overrun_cleared_at,
    e.overrun_cleared_by,
    cb.full_name as overrun_cleared_by_name
  from public.shift_log_entries e
    left join public.factory_units     u  on u.id  = e.unit_id
    left join public.factory_processes p  on p.id  = e.process_id
    left join public.factory_products  pr on pr.id = e.product_id
    left join public.pipeline_jobs     j  on j.product_id = e.product_id
    left join public.profiles          cb on cb.id = e.overrun_cleared_by
),
bounded as (
  select
    base.*,
    -- The threshold. Rounded down: a 4% allowance on 540,000 is 561,600 exactly,
    -- but on an odd requirement it lands mid-unit, and half a tablet of headroom
    -- should not decide whether someone has to write a paragraph.
    (
      case
        when base.required_qty is not null
        then floor(base.required_qty * (1 + base.overage_pct / 100.0))
      end
    ) as allowed_qty
  from base
)
select
  bounded.*,

  -- Past what this batch was allowed to make — the work order plus whatever
  -- overage was declared on it.
  (
    bounded.allowed_qty is not null
    and bounded.accumulative is not null
    and bounded.accumulative > bounded.allowed_qty
  ) as is_overrun,

  -- By how much — the number the explanation has to account for. Measured from
  -- the *allowance*, not the requirement: the planned extra is already
  -- accounted for by having been planned, and asking someone to justify it
  -- again is what taught everyone to clear these without reading.
  (
    case
      when bounded.allowed_qty is not null
       and bounded.accumulative is not null
       and bounded.accumulative > bounded.allowed_qty
      then bounded.accumulative - bounded.allowed_qty
    end
  ) as overrun_qty,

  -- Overrun and nobody has said why yet. This is the badge.
  (
    bounded.allowed_qty is not null
    and bounded.accumulative is not null
    and bounded.accumulative > bounded.allowed_qty
    and bounded.overrun_note is null
  ) as needs_overrun_note
from bounded;

comment on view public.shift_log_entries_expanded is
  'Shift log entries with their unit, process and product resolved, the running total per batch and activity, and the over-production flag. Since 0032 the flag measures against required_qty plus the batch''s declared overage, not against required_qty alone. RLS inherited via security_invoker.';

grant select on public.shift_log_entries_expanded to authenticated;
