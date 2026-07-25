-- FactoryOS · Drop the sample-data flag from onboarding
-- The wizard no longer offers "Load sample pharma data", so the column added
-- in 0003 has no writer and no reader.

alter table public.factories
  drop column if exists sample_data;
