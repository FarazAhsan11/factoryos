-- FactoryOS · Batch number model
--
-- Companies number their batches one of two ways, and it is a company-wide
-- fact rather than a per-batch choice:
--
--   single   Manufacturing and packing share one batch number. 46000 is mixed,
--            compressed and bottled as 46000 — the Single Batch
--            (`batch_type = 'combined'`, 0031) every batch was before families.
--   split    The bulk and the packed lot are numbered separately. 46000 is the
--            bulk; 46001, 46002 are the finished lots that draw on it — Bulk
--            Production (`manufacturing`) and Finished Lot (`packing`).
--
-- Set in Admin → Company. What it changes is what Pipeline → New batch
-- offers: `single` asks for no type at all — every new batch is a Single
-- Batch; `split` asks only for Bulk Production or Finished Lot, as two tabs.
--
-- ── What is deliberately not here ────────────────────────────────────────
--
-- No trigger refusing a `combined` job in a split factory. The model says how
-- new batches are *raised*; it does not re-type the cards already on the
-- board, and switching a company from one model to the other must not strand
-- its existing batches behind a guard they were created before.

alter table public.factories
  add column if not exists batch_model text not null default 'single';

alter table public.factories
  drop constraint if exists factories_batch_model_known;
alter table public.factories
  add constraint factories_batch_model_known
  check (batch_model in ('single', 'split'));
