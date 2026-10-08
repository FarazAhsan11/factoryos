---
paths:
  - "supabase/migrations/**"
  - "scripts/**"
---

# Writing migrations

Full history and per-migration reasoning: `docs/DATABASE.md`. Each migration file opens with a comment saying what it changes and why — write one.

- Files are `NNNN_name.sql`, numbered in sequence. They are **applied by hand** in the Supabase SQL Editor (no CLI, no local DB connection) — tell the user which file to run. The migration file is the source of truth either way.
- Add a line for it in `docs/DATABASE.md` (and the count in `CLAUDE.md`'s Data section).
- **Views:** `create or replace view` may not insert a column mid-list — append new columns at the end. A column's type cannot change under a view or a trigger's `update of` list: drop and recreate both, identical (see `0046`). Make views `security_invoker = true` and `grant select … to authenticated`.
- **A column default is applied before BEFORE triggers**, so a trigger that fills the same column never runs (`0034`).
- **Derive, don't store** anything the shift log or the pipeline already decides (status, overdue, finished); put the derivation in a view (`factory_products_expanded`, `pipeline_jobs_expanded`).
- **Never add a delete policy to `shift_log_entries`.** The one cleanup `delete` in the codebase (`0038`) runs as the migration's owner.
- A rule a `check` cannot see across rows belongs in a trigger (`pipeline_jobs_family_guard`, `batch_stage_transition`…); a rule that fails the wrong field when constrained (e.g. `est_finish_date >= planned_date`) belongs in the zod schema, where the message can name both fields.
- A trigger on `shift_log_entries` also needs its React Query key added to the invalidation list in `log-entry-form.tsx`.
