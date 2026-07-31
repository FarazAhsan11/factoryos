-- FactoryOS · Processes: does this activity produce output?
--
-- An activity has TWO independent properties, and until now the schema only
-- had one of them:
--
--   has_machine (0006) → does it run on a machine?  → drives the SPEED fields
--   has_output  (here) → does it produce anything?  → drives the QTY fields
--
-- They genuinely come apart. Sorting and Testing produce output but run no
-- machine. Idle, Break and Set Up run no machine *and* produce nothing. One
-- flag cannot express both, which is why the log form has been asking for a
-- quantity on a tea break and storing `0`.
--
-- Zero is the wrong answer for the same reason it was wrong for speed: OEE
-- has to distinguish "not applicable" from "produced nothing". A hundred
-- legitimate 0-qty Break rows drag every output and quality average computed
-- over them. So the quantity columns become nullable, and a non-producing
-- activity stores null.

-- ── 1. The flag ──────────────────────────────────────────────────────────
-- Defaults true: an activity produces output unless someone says otherwise,
-- which keeps every existing process behaving exactly as it does today.
alter table public.factory_processes
  add column if not exists has_output boolean not null default true;

comment on column public.factory_processes.has_output is
  'False for activities that consume shift time but produce no units (Idle, Break, Set Up, cleaning, maintenance). Drives whether the log form asks for quantities.';

-- Back-stamp the stages the prototype treated as non-productive. Matched on
-- name because that is all we have to go on; a factory that named its stages
-- differently just sets the flag by hand in Admin → Processes.
update public.factory_processes
set has_output = false
where lower(btrim(name)) in (
  'manning', 'materials', 'set up', 'setup', 'idle', 'ready',
  'document recon', 'prov. clean', 'prov clean', 'full clean',
  'cleaning', 'maintenance', 'quality issue', 'break'
);

-- ── 2. Quantities become nullable ────────────────────────────────────────
-- The `>= 0` check constraint is unaffected: a null comparison yields null,
-- which a CHECK treats as satisfied.
alter table public.shift_log_entries alter column target_qty   drop not null;
alter table public.shift_log_entries alter column qty          drop not null;
alter table public.shift_log_entries alter column qty_rejected drop not null;

-- ── 3. Clear the zeroes already logged against non-producing activities ──
-- Only rows that are entirely zero: a row with a real quantity is real data,
-- whatever its process is flagged as now, and must not be erased.
update public.shift_log_entries e
set target_qty = null, qty = null, qty_rejected = null
from public.factory_processes p
where p.id = e.process_id
  and p.has_output = false
  and coalesce(e.target_qty, 0) = 0
  and coalesce(e.qty, 0) = 0
  and coalesce(e.qty_rejected, 0) = 0;
