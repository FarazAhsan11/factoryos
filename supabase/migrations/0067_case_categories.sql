-- FactoryOS · Quality — the case category, as the reference QMS (qms-v5) lists it
--
-- Run after 0066.
--
-- The category says *what went wrong*; the root cause says *why*. QA sets it
-- at the initial assessment (a deviation) or on the NCR form. The nine
-- categories of 0045 become the reference QMS's thirteen, which split out
-- formulation, dispensing, cleaning, utilities, environmental monitoring and
-- the laboratory:
--
--   Formulation / batch formula · Dispensing / weighing · Manufacturing
--   process · Equipment · Facility & utilities · Cleaning / line clearance ·
--   Environmental monitoring · Materials (raw / packaging) · Labelling &
--   packaging · Laboratory testing (OOS / OOT) · Documentation & data
--   integrity · Storage & distribution · Other
--
-- Existing cases are moved to the new names, as the reference QMS maps them:
--
--   Raw material, Packaging → Materials (raw / packaging)
--   Labelling               → Labelling & packaging
--   Process                 → Manufacturing process
--   Documentation           → Documentation & data integrity
--   Storage & handling      → Storage & distribution
--   Product quality         → Other   (the reference QMS keeps "product
--                                      quality" for complaints only)
--   Equipment, Other        → unchanged
--
-- A signed assessment and a closed case are frozen by the guards, so they are
-- switched off for this one update. The audit trigger stays on: every case
-- whose category is renamed gets a "changed" entry in its History.

-- ── 1. The old check goes first, so the new names can be written ─────────

alter table public.deviations
  drop constraint if exists deviations_nc_category_known;

-- ── 2. Rename the existing values ────────────────────────────────────────

alter table public.deviations disable trigger deviations_guard;
alter table public.deviations disable trigger deviations_assessment_guard;
alter table public.deviations disable trigger deviations_investigation_guard;
alter table public.deviations disable trigger deviations_closeout_guard;
alter table public.deviations disable trigger deviations_hold;

update public.deviations
   set nc_category = case nc_category
         when 'Raw material'       then 'Materials (raw / packaging)'
         when 'Packaging'          then 'Materials (raw / packaging)'
         when 'Labelling'          then 'Labelling & packaging'
         when 'Process'            then 'Manufacturing process'
         when 'Documentation'      then 'Documentation & data integrity'
         when 'Storage & handling' then 'Storage & distribution'
         when 'Product quality'    then 'Other'
       end
 where nc_category in (
   'Raw material', 'Packaging', 'Labelling', 'Process', 'Documentation',
   'Storage & handling', 'Product quality'
 );

alter table public.deviations enable trigger deviations_guard;
alter table public.deviations enable trigger deviations_assessment_guard;
alter table public.deviations enable trigger deviations_investigation_guard;
alter table public.deviations enable trigger deviations_closeout_guard;
alter table public.deviations enable trigger deviations_hold;

-- ── 3. The new list ──────────────────────────────────────────────────────

alter table public.deviations
  add constraint deviations_nc_category_known check (
    nc_category is null or nc_category in (
      'Formulation / batch formula',
      'Dispensing / weighing',
      'Manufacturing process',
      'Equipment',
      'Facility & utilities',
      'Cleaning / line clearance',
      'Environmental monitoring',
      'Materials (raw / packaging)',
      'Labelling & packaging',
      'Laboratory testing (OOS / OOT)',
      'Documentation & data integrity',
      'Storage & distribution',
      'Other'
    )
  );
