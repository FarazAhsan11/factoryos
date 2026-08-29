-- FactoryOS · Batch families — what KIND of batch is this, and whose bulk is it?
--
-- A batch on the board has been one catalogue row, one card, one number. That
-- describes a plant that manufactures and packs under a single batch number,
-- and nothing else. The customer whose packing runs carry their own numbers
-- has no way to say so:
--
--   Manufacturing  46000  Paracetamol Tablet        parent, 210,000 tablets
--     Packing 30's   46001   1,000 bottles ×  30 =  30,000
--     Packing 60's   46002   1,000 bottles ×  60 =  60,000
--     Packing 120's  46003   1,000 bottles × 120 = 120,000
--
-- Nothing in the schema can say 46001 came out of 46000, so nothing can answer
-- the question the planner is actually asking: *is there enough bulk for all
-- three packing runs?* This migration adds the three things that answer it —
-- a type on every batch, a parent → child link, and the arithmetic in the view.
--
--   manufacturing  Bulk production. Mixing, encapsulation, compression,
--                  coating. Its required quantity IS the bulk target.
--   packing        Fills finished goods from bulk. Carries a pack size, and
--                  usually a parent whose bulk it is drawing down.
--   combined       Manufacturing and packing under one batch number — what
--                  every existing job already is, which is why it is the
--                  default and the backfill.
--
-- ── What is deliberately NOT here ────────────────────────────────────────
--
-- `ordered_qty` and `bulk_target_qty`. The prototype carries both on the
-- batch, and both are already `factory_products.required_qty` here: 210,000
-- tablets on the manufacturing parent, 1,000 bottles on a packing child.
-- Duplicating the number would hand the overrun check (0023) and the
-- allocation bar below two different figures to disagree about, and the
-- catalogue is where a required quantity is edited.
--
-- Rework. The prototype's fourth type is out of scope for now; the column is
-- here, unused, so adding the module later reshapes no rows.
--
-- Per-stage planning. A batch's route — Dispensing → Compression → Coating →
-- Packing, each with its own target — is the next migration. Until then
-- completion still reads the plant-wide `factory_processes.is_final_stage`
-- from 0016, unchanged.

-- ── 1. The type, the family, and the numbers ─────────────────────────────

alter table public.pipeline_jobs
  add column if not exists batch_type        text not null default 'combined',
  -- The bulk this packing run draws from. `set null`, never cascade: taking a
  -- bulk card off the board must not delete three real packing batches. A
  -- child that loses its parent is exactly the prototype's "no parent —
  -- external bulk", which is a legitimate state, not an orphan.
  add column if not exists parent_job_id     uuid references public.pipeline_jobs (id) on delete set null,
  -- What the bulk is counted in. Null on a packing job, which counts in
  -- `pack_unit`, and on a combined job, which counts in whatever the shift log
  -- records.
  add column if not exists bulk_unit         text,
  -- Deliberate overproduction: make 4% extra so the packing runs have enough
  -- after losses. Stored as planning intent only — nothing computes from it
  -- yet, and the overrun flag in 0023 is untouched by this migration.
  add column if not exists overage_pct       numeric(5, 2) not null default 0,
  -- Units per container: 30, 60, 120. The only conversion between bulk and
  -- finished goods there is, which is why the allocation bar below cannot be
  -- drawn without it.
  add column if not exists pack_size         numeric(10, 2),
  add column if not exists pack_unit         text,
  -- Bulk physically allocated to this run, when it is known separately from
  -- what the pack size implies (a part-drum handed over, an external supply).
  add column if not exists bulk_qty_received numeric(14, 2),
  add column if not exists market            text,
  add column if not exists rework_source_id  uuid references public.pipeline_jobs (id) on delete set null,
  add column if not exists notes             text,
  add column if not exists priority          text not null default 'medium',
  add column if not exists due_date          date;

alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_batch_type_known;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_batch_type_known
  check (batch_type in ('manufacturing', 'packing', 'combined', 'rework'));

alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_priority_known;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_priority_known
  check (priority in ('high', 'medium', 'low'));

alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_pack_size_positive;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_pack_size_positive
  check (pack_size is null or pack_size > 0);

alter table public.pipeline_jobs
  drop constraint if exists pipeline_jobs_overage_bounded;
alter table public.pipeline_jobs
  add constraint pipeline_jobs_overage_bounded
  check (overage_pct >= 0 and overage_pct <= 100);

comment on column public.pipeline_jobs.batch_type is
  'manufacturing | packing | combined. Decides what the New batch form asks for and how the batch appears in Batch families. Combined is the default and describes every job written before this migration.';
comment on column public.pipeline_jobs.parent_job_id is
  'The manufacturing job whose bulk this packing run draws from. Null means external bulk. One level only — a parent never has a parent.';
comment on column public.pipeline_jobs.pack_size is
  'Units of bulk per container (30, 60, 120). The one conversion between bulk and finished goods, and what the family allocation is computed from.';

-- Children of one parent, for the families view and the allocation subquery.
create index if not exists pipeline_jobs_parent_idx
  on public.pipeline_jobs (parent_job_id)
  where parent_job_id is not null;

-- The families view reads manufacturing parents within one tenant.
create index if not exists pipeline_jobs_factory_type_idx
  on public.pipeline_jobs (factory_id, batch_type);

-- ── 2. What a family is allowed to look like ─────────────────────────────

/**
 * The family rules, as a trigger rather than check constraints.
 *
 * Every one of them is about *another row* — the parent's type, the parent's
 * factory, whether the parent is itself a child — and a `check` may not look
 * outside the row it is validating. Nothing here is enforceable in the client
 * either: two planners linking batches at the same moment would each pass a
 * browser-side check against the state they loaded.
 */
create or replace function public.pipeline_jobs_family_guard()
returns trigger
language plpgsql
as $$
declare
  parent public.pipeline_jobs%rowtype;
begin
  -- A parent cannot stop being one while it has children. Without this the
  -- rules below are only enforced from the child's side: re-typing 46000 to
  -- Combined would leave three packing runs pointing at a batch that is no
  -- longer bulk, and the allocation bar comparing their claims against a
  -- target that no longer means what it did.
  if tg_op = 'UPDATE'
     and old.batch_type = 'manufacturing'
     and new.batch_type <> 'manufacturing'
     and exists (
       select 1 from public.pipeline_jobs where parent_job_id = new.id
     ) then
    raise exception
      'Packing batches are drawing on this bulk — unlink them before changing its type.'
      using errcode = 'check_violation';
  end if;

  if new.parent_job_id is null then
    -- No parent, no family rules — but the packing columns still only mean
    -- something on a packing job. A combined batch carrying a pack size would
    -- show a bulk consumption panel for bulk nobody allocated.
    return new;
  end if;

  if new.parent_job_id = new.id then
    raise exception 'A batch cannot be its own bulk source.'
      using errcode = 'check_violation';
  end if;

  if new.batch_type <> 'packing' then
    raise exception
      'Only a packing batch draws from bulk — % is a % batch.',
      new.id, new.batch_type
      using errcode = 'check_violation';
  end if;

  select * into parent
  from public.pipeline_jobs
  where id = new.parent_job_id;

  if not found then
    raise exception 'That bulk batch no longer exists.'
      using errcode = 'foreign_key_violation';
  end if;

  if parent.factory_id <> new.factory_id then
    raise exception 'A packing batch can only draw from its own factory''s bulk.'
      using errcode = 'check_violation';
  end if;

  if parent.batch_type <> 'manufacturing' then
    raise exception
      'Bulk comes from a manufacturing batch — % is a % batch.',
      parent.id, parent.batch_type
      using errcode = 'check_violation';
  end if;

  -- One level, deliberately. A packing run that is itself packed is not a
  -- thing a plant does, and allowing the link would turn every family read
  -- into a recursive walk for a depth that never exceeds one.
  if parent.parent_job_id is not null then
    raise exception 'That batch is itself a packing run — it has no bulk to give.'
      using errcode = 'check_violation';
  end if;

  -- Without it there is no bottles → bulk conversion, so the allocation bar
  -- silently counts this run as zero against its parent's target.
  if new.pack_size is null then
    raise exception 'A packing batch drawing from bulk needs its pack size (units per container).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists pipeline_jobs_family on public.pipeline_jobs;
create trigger pipeline_jobs_family
  before insert or update of parent_job_id, batch_type, pack_size, factory_id
  on public.pipeline_jobs
  for each row execute function public.pipeline_jobs_family_guard();

-- ── 3. The read model ────────────────────────────────────────────────────
--
-- Appended to the view from 0016 rather than rebuilt: CREATE OR REPLACE may
-- add columns at the end, and every existing column keeps its name, type and
-- position. The two family numbers are the point of the whole migration:
--
--   allocated_qty  What this parent's packing children add up to, in bulk
--                  units — Σ (child required_qty × child pack_size). For the
--                  example above: 1,000×30 + 1,000×60 + 1,000×120 = 210,000,
--                  against a parent required_qty of 210,000.
--
--   bulk_consumed  For a packing child, how much bulk its own logged output
--                  has drawn down — Σ (entry qty × pack_size).
--
-- Advisory, both of them. Over-allocating is badged, never refused: a second
-- bulk batch already scheduled is a perfectly good reason to be over, and a
-- planner blocked at 6am works around the block rather than fixing the plan.

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

  coalesce((
    select sum(e.qty)
    from public.shift_log_entries e
      join public.factory_processes p on p.id = e.process_id
    where e.product_id = j.product_id
      and p.is_final_stage
  ), 0) as produced_qty,

  (
    select count(*)
    from public.shift_log_entries e
    where e.product_id = j.product_id
      and e.action_flag is not null
  ) as flagged_count,

  -- ── Appended by 0031 ──────────────────────────────────────────────────
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

  -- The card's "← 46000 bulk" link, resolved here so the board never has to
  -- cross-reference its own rows to render one.
  parent_pr.batch_no   as parent_batch_no,
  parent_pr.name       as parent_product_name,

  (
    select count(*)
    from public.pipeline_jobs c
    where c.parent_job_id = j.id
  ) as child_count,

  -- Null, not 0, when this job has no children: "nothing allocated yet" and
  -- "not a parent" are different facts, and the allocation bar is only drawn
  -- for the first.
  (
    select sum(cpr.required_qty * c.pack_size)
    from public.pipeline_jobs c
      join public.factory_products cpr on cpr.id = c.product_id
    where c.parent_job_id = j.id
      and c.pack_size is not null
  ) as allocated_qty,

  -- What this packing run has drawn down. Null on anything that isn't a
  -- packing job with a pack size — a combined batch consumes no allocation.
  case
    when j.batch_type = 'packing' and j.pack_size is not null then coalesce((
      select sum(e.qty) * j.pack_size
      from public.shift_log_entries e
      where e.product_id = j.product_id
    ), 0)
  end as bulk_consumed
from public.pipeline_jobs j
  left join public.factory_products pr        on pr.id = j.product_id
  left join public.factory_units    u         on u.id  = j.unit_id
  left join public.pipeline_jobs    parent    on parent.id    = j.parent_job_id
  left join public.factory_products parent_pr on parent_pr.id = parent.product_id;

comment on view public.pipeline_jobs_expanded is
  'Read model for the pipeline: a job plus its batch identity, current room, quantity produced at the final stage, and (since 0031) its batch type, bulk parent, and the family allocation numbers. RLS inherited from pipeline_jobs via security_invoker.';

grant select on public.pipeline_jobs_expanded to authenticated;

-- ── 4. Backfill ──────────────────────────────────────────────────────────
-- Every job written before today manufactures and packs under one batch
-- number, because that is the only thing the schema could express. `combined`
-- is not a guess about them — it is the name for what they already are, which
-- is why it is also the column default.
update public.pipeline_jobs
set batch_type = 'combined'
where batch_type is null;
