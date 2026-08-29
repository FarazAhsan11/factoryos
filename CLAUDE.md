# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**FactoryOS** — a multi-tenant SaaS platform for factory / manufacturing operations management. Each factory is an isolated tenant. It is a production rebuild of a single-file HTML prototype (not in repo — the current version lives at `C:\Users\Dell\Downloads\factoryos_v11.html`).

### What actually exists

Auth, tenancy and factory setup are **built and working**; the first operational module has landed. Assume all of this is real before proposing to build it:

- **Auth** — login, password reset, invite → set-password flow, middleware session refresh, role-based routing.
- **Super-admin console** (`/admin`) — create / delete a factory (cascading wipe), branded email invites via nodemailer.
- **Factory workspace** (`/factory/[slug]`) — onboarding wizard gate, sidebar shell, dashboard.
- **Admin & Settings** (`/factory/[slug]/admin`) — eight working tabs: Company, Units, Processes, Departments, Equipment (the machine register — number + name, `0028`), Employees (invite + CSV import), Products, Shift times.
- **Shift log** (`/factory/[slug]/log`) — the entry form, activity feed, and amendments. The form has **three shapes**, chosen by the `category` set on the activity in Admin → Processes (`0030`): **downtime** asks for room, activity, start, end, batch and comments and nothing else — no quantities, no operators, no action flag; **preparatory** (mixing, drying, granulation) adds one quantity plus the unit the room counts in — batches / kg / litres / drums / containers / units, stored in `qty_unit`; **production** is the full record as before — equipment and speed on a machine stage, a target derived from speed × duration, actual and rejected quantities. `has_machine` and `has_output` survive as *derived* columns, no longer editable, so the pipeline trigger and every report keep reading what they always read. Two tabs: **Log entry** and **Kaizen** (improvement ideas from the floor, reviewed by supervisors and up). The right-hand column belongs to the active tab — shift activity on one, the improvement queue on the other.
- **Data table** (`/factory/[slug]/data`) — server-side filter / sort / paginate over the shift log, CSV export.
- **Shift report** (`/factory/[slug]/report`) — one day, one shift, every room on one sheet. Rooms that logged nothing are *kept*, showing their pipeline status; the page prints as a landscape handover document. Supervisor and up.
- **Pipeline** (`/factory/[slug]/pipeline`) — the Kanban batch tracker, plus **Batch families** and per-batch **stage planning**. Cards move themselves from the shift log via a database trigger; nobody drags one. Three ways in: **New batch** (a two-step dialog — pick manufacturing / packing / combined, then the batch itself *from the catalogue*, never typed), **From catalogue** for adding several at once, or a `planned_for` date on the batch in Admin → Products, promoted onto the board when the page loads on or after that day (`promote_scheduled_jobs()`, migration `0018`). Since `0031` a job carries a **type** and, when it is a packing run, a **parent** — the manufacturing batch whose bulk it draws on. That is what the Batch families tab reads: parent 46000 with children 46001/2/3 underneath, and a bar comparing Σ (children's containers × pack size) against the parent's bulk target. Over-allocation is badged, never blocked.

  Since `0033` each batch also carries a **plan**: one row per stage that produces something (Dispensing 500 kg → Compression 210,000 tablets → Coating → Packing), each with its own target and unit. The **last stage in the plan completes the order** — derived from position, so reordering moves it — and signing it off is what moves the card to Finished. A batch must be **issued for production** before the shift log will accept a producing entry against it, and issuing is refused until every stage has a target; downtime is always loggable. The log resolves an entry to its stage automatically, and asks *which* only where a batch runs one activity several times (three packing runs, or three work orders under one number).
- **Issues & CAPAs** (`/factory/[slug]/actions`) — the accountability loop. A flagged shift entry raises an issue, which then works through five stages — **Open → Investigating → Action taken → Verification → Closed**, one at a time, each move paid for with the evidence that stage produces, and since `0027` each stage collecting the thing it is *named after*: an owner, then a root cause, then the corrective (+ preventive) action, then the sign-off. Enforced by the `actions_stage_transition` trigger, not the UI. One legal skip: an **open** issue can be resolved straight to Closed by a supervisor when it needs no CAPA — it costs a written account of what was done (stored in `verification`) and leaves `investigating_at` null, which is what `resolved_direct` reads to label the text a *resolution* and draw the three middle stages as skipped (`0026`). Overdue and escalated are *computed*, never stored, and there are two clocks: the fix clock runs through Open, Investigating and Action taken, stopping once the corrective action is in, and a slower sign-off clock (`factories.escalate_hours`) runs through Verification.
- **Maintenance** (`/factory/[slug]/maintenance`) — the Breakdown Maintenance Request, all three sections of it. Report a fault against an equipment number (resolved to a name from the register), name the *initiating* department and the department *needed*, type the affected batch; requests are numbered `MR-2026-014` by a counter table. Opening one opens the document as **three tabs** — **Initiation → Engineering → QA review** — and the five statuses walk it: `reported → assigned → in_progress → completed → verified`, one at a time, forward only, each move paid for with what that section records. A name and a department to assign; nothing to start work (but that stamp is what makes downtime mean the machine rather than the paperwork); the work record plus the cleaning and production-review answers to complete; the change-control and deviation answers plus a signature to verify. Both yes/no pairs are tri-state — null is *unanswered* and the gate refuses it, because an unanswered box that prints as "No" is what the paper form gets wrong. Enforced by `maintenance_stage_transition` (`0029`), not the UI; supervisor and up may drive it, anyone may raise one. Response and downtime are computed in the view, never stored.
- **Database** — 30 migrations in `supabase/migrations/`, with RLS on every tenant table.

Not built: a reusable **route on the product** that a new batch's plan is copied from (stages are planned per batch, as in the prototype); rework batches (the column `rework_source_id` exists, unused); attachments on a maintenance request ("attach additional documents" on the paper form — it needs a Storage bucket), the printable controlled-document view of a request, OEE & Downtime, Quality, Trends, signed handover reports, and the Pipeline's Room schedule / Gantt / Archive tabs (they render disabled from `pipeline-tabs.ts`). The shift log's Roster tab was dropped rather than deferred — the shift log has exactly two tabs now.

### Which doc to read

- **`docs/IMPLEMENTATION_GUIDE.md`** — how everything above is built and the patterns to follow for the next module. **Read this first for any feature work.** It also lists, in order, the migrations that must be applied by hand.
- **`docs/IMPLEMENTATION_GUIDE_2.md`** — the continuation: Pipeline, Actions, product bulk import, the `Final` stage tag, and the shift-log / data-table refinements. Covers migrations `0015`–`0017`. Read alongside the first guide for anything in those modules.
- `docs/PROGRESS.md` — narrative record of what landed when.
- `docs/ARCHITECTURE_FLOW.md` — product scope, role hierarchy, shift-based data model, build order. Still useful for *intent*, but it predates most of the code: where it disagrees with the implementation guide, the guide wins.

## Commands

```bash
npm run dev      # start dev server (http://localhost:3000)
npm run build    # production build
npm run start    # serve production build
npm run lint     # eslint
```

No test runner is configured yet. Environment is **Windows / PowerShell**.

## Stack

- **Next.js 16** (App Router) + **React 19** + TypeScript (strict)
- **Tailwind CSS v4** (via `@tailwindcss/postcss`; no `tailwind.config` file — theme lives in `src/app/globals.css`)
- **shadcn/ui** — style `base-nova`, base color `neutral`, icons `lucide-react`. Config in `components.json`.
- **Supabase** (`@supabase/ssr`) for auth + Postgres
- **Forms:** `react-hook-form` + `zod` (via `@hookform/resolvers/zod`) — see *Forms & validation* below
- `sonner` (toasts), `next-themes`, `class-variance-authority` + `clsx` + `tailwind-merge`

> Note: `docs/ARCHITECTURE_FLOW.md` still lists Auth/DB/ORM as "TBD (Clerk / Neon / Drizzle-or-Prisma)". The code has already moved to **Supabase** for both auth and database. Treat Supabase as the current choice; update the doc when confirmed rather than trusting its "TBD" rows.

## Layout & conventions

- `src/app/` — App Router routes (`layout.tsx`, `page.tsx`, `login/page.tsx`, `globals.css`)
- `src/components/ui/` — shadcn/ui primitives (button, card, input, label, dropdown-menu, sonner)
- `src/components/<feature>/` — feature components grouped by domain (e.g. `auth/`, `brand/`)
- `src/lib/supabase/client.ts` — `createClient()` for Client Components (`"use client"`)
- `src/lib/supabase/server.ts` — async `createClient()` for Server Components / Actions / Route Handlers (uses `next/headers` cookies)
- `src/lib/utils.ts` — `cn()` class-merge helper
- `public/branding/` — logo + login hero SVGs
- **Import alias:** `@/*` → `src/*` (e.g. `@/components/ui/button`, `@/lib/utils`)
- Pick the right Supabase client for the context: browser client in Client Components, server client everywhere on the server. Never import the server client into a Client Component.

## Component conventions (build reusable components — don't dump everything in `page.tsx`)

Route files (`page.tsx`, `layout.tsx`) should stay thin: they wire metadata, fetch data, and **compose components**. Do not build large blocks of markup directly in a `page.tsx`.

- Extract UI into reusable, self-contained components under `src/components/<feature>/` and import them into the route. A route body should generally read as a handful of composed components.
- Group by domain/feature (`auth/`, `brand/`, later `pipeline/`, `dashboard/`, …), not by page. Keep app-wide primitives in `src/components/ui/` (shadcn) and cross-cutting bits (e.g. `Logo`) in their own folder.
- Prefer small composable pieces over monoliths: a reusable **layout shell** (e.g. `AuthSplitLayout`), reusable **field/primitive** components (e.g. `TextField`), and a **feature component** that composes them (e.g. `LoginForm`). The login route is the reference example — mirror its shape.
- Factor out anything used more than once (inputs, cards, headers, layout shells) into a shared component instead of copy-pasting class strings.
- Add `"use client"` only to the specific component that needs interactivity/hooks, keeping it as low in the tree as possible — don't make a whole page a Client Component to add one interactive control.
- Merge/compose classes with `cn()` from `@/lib/utils`; expose a `className` prop on reusable components so callers can adjust spacing/size.

## Forms & validation

Build all forms with **`react-hook-form`** for state and **`zod`** for validation, wired together via **`@hookform/resolvers/zod`**. Do not hand-roll `useState`-per-field + manual `if` checks for new forms.

- **One schema per form.** Define a `zod` schema (co-located with the form component or in a nearby `schema.ts`) and derive the TS type from it: `type Values = z.infer<typeof schema>`. The schema is the single source of truth for both validation and types — don't declare a separate interface.
- **Wire it with the resolver:** `useForm<Values>({ resolver: zodResolver(schema) })`. Read errors from `formState.errors` and disable submit via `formState.isSubmitting` rather than a separate `loading` state.
- **Server Actions are the trust boundary.** Client-side zod is for UX only. **Re-validate the same schema inside the Server Action** before touching Supabase — never trust client input. Share the schema between client and action where practical (put it in a plain, non-`"use server"` module so both can import it).
- **Field components stay controlled by RHF.** Keep the reusable `TextField` (and future field primitives) presentational; connect them with `register(...)` or a `Controller`, and pass `error`/`aria-invalid` down for inline messages. Don't bake form logic into the field primitive.
- **Match existing visuals.** Reuse `TextField`, the gradient submit button, and the red inline error note used by `LoginForm` so all forms look identical — only the state/validation mechanism changes.

> The current auth forms (`login-form`, `set-password-form`, `forgot-password-form`) and `create-factory-dialog` predate this convention and still use manual state. Migrate them to RHF + zod when you next touch them; write **new** forms this way from the start.

## Environment

Copy `.env.example` → `.env.local`. All `.env*` files are gitignored.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose to the client)
- `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` (used only by the seed script)

## Database (Supabase)

- SQL migrations live in `supabase/migrations/` (versioned, `NNNN_name.sql`). The Supabase CLI is **not** installed and there's no local DB connection string, so migrations are currently applied by hand via the **Supabase Dashboard → SQL Editor** (or a direct connection string if provided). Keep the migration files as the source of truth regardless of how they're applied.
- **35 migrations exist** (`0001`–`0035`). `docs/IMPLEMENTATION_GUIDE.md` §0 lists `0003`–`0014`; `docs/IMPLEMENTATION_GUIDE_2.md` §0 lists `0015`–`0017` and `0020`–`0025`. Check both before assuming a table or column is missing. `0018` adds `factory_products.planned_for` and `promote_scheduled_jobs()` — the scheduled route onto the pipeline board. `0019` adds `kaizen_ideas` and the `can_review_factory()` helper (supervisor and up, wider than `can_manage_factory()`). `0020`–`0021` turn Actions into the staged CAPA flow — see IMPLEMENTATION_GUIDE_2 §6a. `0026` adds the `open → closed` short road and re-bases the amendment guard on what was recorded rather than on the stage reached. `0027` splits the old Investigating gate in two — a fifth stage, `verification`, sits between `action_taken` and `closed`, the corrective action becomes the price of reaching it rather than of leaving Investigating, and rows already at `action_taken` are backfilled onto it (their `action_taken_at` copied to the new `verification_at`). `0028` adds `factory_equipment`, the per-tenant machine register — `equipment_no` unique per factory, resolved to a name in the shift log the way `batch_no` resolves to a product. `0029` fills in the rest of the maintenance request: the Section 2 and Section 3 columns, an `initiating_department_id` beside the existing "department needed", the `maintenance_stage_transition` gate, an update policy widened from `can_manage_factory` to `can_review_factory`, and a rebuilt `maintenance_requests_expanded` carrying the equipment name and the two computed clocks. `0030` classifies process stages: `factory_processes.category` (`downtime | preparatory | production`) replaces the editable `has_machine` / `has_output` pair as the thing that decides the shift-log form's shape, backfills it from those flags, and makes them derived through `factory_process_category_sync` — so a category and its flags can never disagree. It also adds `shift_log_entries.qty_unit` (a checked list matching `QTY_UNITS` in the log schemas) and rebuilds `shift_log_entries_expanded` to carry `process_category` and `qty_unit`. `0031` adds batch families: `pipeline_jobs.batch_type` (`manufacturing | packing | combined`), a self-referencing `parent_job_id` (`on delete set null` — removing a bulk card must not delete three real packing batches), the pack/bulk columns, and `pipeline_jobs_family_guard`, which holds the rules a `check` cannot see across rows: only a packing job has a parent, the parent is manufacturing and in the same factory, one level deep, pack size required, and a parent may not be re-typed while children draw on it. Deliberately **not** added: `ordered_qty` / `bulk_target_qty` — both are already `factory_products.required_qty`, and a second copy would give the overrun check (`0023`) and the family allocation different numbers. `pipeline_jobs_expanded` gains the type, the parent's batch number, `child_count`, `allocated_qty` (Σ children `required_qty × pack_size`) and `bulk_consumed`. `0032` makes `overage_pct` mean something: the shift log's over-production flag now measures against `required_qty × (1 + overage_pct/100)` rather than `required_qty`, so a batch told to make 4% extra is not flagged for doing exactly that, and `overrun_qty` counts from the allowance. `0033` is stage planning: `batch_stages` — one row per producing stage of one batch, with a target, a unit and an optional label / work order — plus `pipeline_jobs.issued_at`, `issue_job()`, and `shift_log_entries.batch_stage_id`. `is_final` is **derived from position** (the last row) by `batch_stages_final_sync`, and signing that stage off finishes the batch; `factory_processes.is_final_stage` and everything around it (the partial unique index, the produces-output check, `clear_other_final_stages`) is dropped. `shift_log_stage_guard` refuses a producing entry against an unissued batch, resolves the stage automatically when the batch runs the activity once, and asks which when it runs it several times; downtime is always allowed and always stores a null stage. `batch_stage_accumulate` keeps each stage's `accumulated_qty` equal to the good units logged against it. Both views were rebuilt: `accumulative` now partitions per **stage** (falling back to batch + process for rows with no plan), and the overrun target is the stage's where there is one. `0034` drops the `sequence_order` default — a column default is applied *before* BEFORE triggers, so the append in `batch_stages_validate` never ran and every stage sat at position 1 — and closes a hole in `batch_stage_transition` where a signed-off stage's yield answer could be rewritten through the no-status-change branch. `0035` adds `batch_stages.unit_id` (the room a stage is planned to run in — advisory, the log records where it actually ran) and `can_run_parallel` (the prototype's flag: a stage that may start before the one before it finishes, without which three packing runs off one bulk cannot be expressed except by lying about the order, which moves `is_final`), plus `batch_stages_expanded` resolving the process, room and signer names.
- Core shape: `factories` and `profiles` (1:1 with `auth.users`, carrying `role` + nullable `factory_id`) from `0001`; per-tenant setup lists (`factory_units`, `factory_processes`, `factory_products`, `factory_shift_times`); `shift_log_entries`, the first operational table; and `pipeline_jobs` + `actions` / `action_notes`, both driven by triggers on the shift log.
- **Triggers on `shift_log_entries` are load-bearing.** Filing an entry moves a pipeline card (`pipeline_sync_from_log`) and can raise an action (`actions_from_log`). Both fire on `update` too, so amendments re-evaluate. If you add another, add its React Query key to the invalidation list in `log-entry-form.tsx` — see IMPLEMENTATION_GUIDE_2 §9.
- RLS helpers to reuse rather than re-derive: `is_super_admin()`, `current_factory_id()`, `can_manage_factory(uuid)`.
- **Shift-log entries are audit-protected**: no delete policy at all, insert requires `logged_by = auth.uid()`, and updates pass through the `shift_log_amend_guard` trigger, which demands an `amend_note` and forces provenance columns back to their originals. Never add a delete path. Since `0023` the guard also recognises an **overrun clearance** — an update touching only `overrun_note` / `_cleared_by` / `_cleared_at` — which needs no amend note, does not stamp `amended_at`, and is refused unless `can_manage_factory()`.
- Seed scripts: `node --env-file=.env.local scripts/seed-super-admin.mjs` (platform super admin) and `node --env-file=.env.local scripts/seed-factory-setup.mjs <slug>` (demo units / processes / products for one factory). Both idempotent.
- `admin123!` is a **dev-only** placeholder password — rotate before any real use.

## Working notes

- Multi-tenancy is row-level by design: nearly every operational table carries `factory_id`, and most also carry `shift` + `log_date`. Bake tenant + shift scoping into any schema or query work from the start.
- **Which trust boundary?** Browser-direct under RLS for ordinary tenant data — that is what makes the optimistic updates cheap. A Server Action only when the write needs the service-role key (creating or deleting auth users) or must not be expressible from the client.
- **Store null, not zero,** for a measurement that doesn't apply: speed on a manual stage, quantities on a stage that produces nothing. OEE has to tell "not applicable" from "produced nothing", and zeroes silently drag every average computed over them.
- This is a phase-by-phase build reviewed at each step — prefer small, self-contained changes over large speculative scaffolding.
