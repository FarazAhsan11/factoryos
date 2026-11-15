-- FactoryOS · Quality — the customer complaint, a fourth kind of case
--
-- Quality is split into Deviations, Non-conformances, Customer complaints and
-- the CAPA register. A complaint is a case like the other three: the same
-- seven-tab record, the same Open → Closed gate. It is numbered CMP-2026-001.
--
-- This file holds only the new enum value. Postgres refuses to *use* a value
-- in the transaction that adds it ("unsafe use of new value"), and 0057
-- compares against it. So run this file first, on its own, then 0057.

alter type public.deviation_type add value if not exists 'complaint';
