-- FactoryOS · Admin → Processes: does this stage run on a machine?
-- Stages split into machine-backed ones (a compression press, a spray dryer —
-- these get OEE / downtime tracking later) and manual ones (visual inspection,
-- packing by hand). Capturing it at setup time keeps every later module from
-- having to guess.

alter table public.factory_processes
  add column if not exists has_machine boolean not null default false;
