-- FactoryOS · Who was running the shift
--
-- The shift report is a handover document — printed, signed, handed to the
-- next shift — and a handover with no name on it is weaker for it. This is the
-- one field it needs that nothing in the system already knows.
--
-- On `factory_shift_times` rather than `factories` because it is a property of
-- *a* shift, not of the factory: mornings and afternoons have different
-- supervisors, which is the whole reason the report names one. It sits next to
-- the clock it belongs to, and Admin → Shift times already edits that row.
--
-- Free text, and the same reasoning as the shift log's operators and an
-- issue's assignee: a supervisor covering a shift at short notice may have no
-- login at all, and a dropdown of accounts would refuse to record the truth.
-- A picker can be layered on later without moving what is already written.

alter table public.factory_shift_times
  add column if not exists supervisor_name text;

alter table public.factory_shift_times
  drop constraint if exists factory_shift_times_supervisor_len;
alter table public.factory_shift_times
  add constraint factory_shift_times_supervisor_len
  check (supervisor_name is null or length(btrim(supervisor_name)) between 1 and 80);

comment on column public.factory_shift_times.supervisor_name is
  'Who runs this shift. Printed on the shift report; free text because a covering supervisor may have no account.';
