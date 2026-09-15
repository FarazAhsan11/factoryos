-- FactoryOS · Work order tracking
--
-- Whether a company numbers work orders at all, and if so against what. A
-- company-wide choice, set in Admin → Company beside the batch number model
-- (0042):
--
--   none    No work orders. A batch and its stages are known by the batch
--           number alone; neither New batch nor stage planning asks.
--   batch   One work order per batch. New batch asks for it, and it is saved
--           on the batch's own row in Products — `factory_products.work_order`
--           (0008), the column the shift log and the batch record already
--           read. Stage planning does not ask.
--   stage   One work order per planned stage — `batch_stages.work_order`
--           (0033), asked when a stage is planned and in the schedule's stage
--           editor. New batch does not ask.
--
-- ── Why no new column for the per-batch number ───────────────────────────
--
-- The catalogue row *is* the batch — one row per batch number — and it has
-- carried a work order since 0008. A second copy on `pipeline_jobs` would give
-- the shift log's autofill and the card two numbers to disagree about.
--
-- ── What is deliberately not here ────────────────────────────────────────
--
-- Nothing clears or refuses the other mode's column. The setting decides what
-- the forms *ask*; switching it must not wipe work orders already recorded,
-- and a stage's existing work order still names it (`stageName`) whatever the
-- company later chooses.

alter table public.factories
  add column if not exists work_order_mode text not null default 'none';

alter table public.factories
  drop constraint if exists factories_work_order_mode_known;
alter table public.factories
  add constraint factories_work_order_mode_known
  check (work_order_mode in ('none', 'batch', 'stage'));
