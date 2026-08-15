# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**FactoryOS** — a multi-tenant SaaS platform for factory / manufacturing operations management. Each factory is an isolated tenant. It is a production rebuild of a single-file HTML prototype (not in repo — the current version lives at `C:\Users\Dell\Downloads\factoryos_v11.html`).

### What actually exists

Auth, tenancy and factory setup are **built and working**; the first operational module has landed. Assume all of this is real before proposing to build it:

- **Auth** — login, password reset, invite → set-password flow, middleware session refresh, role-based routing.
- **Super-admin console** (`/admin`) — create / delete a factory (cascading wipe), branded email invites via nodemailer.
- **Factory workspace** (`/factory/[slug]`) — onboarding wizard gate, sidebar shell, dashboard.
- **Admin & Settings** (`/factory/[slug]/admin`) — seven working tabs: Company, Units, Processes, Departments, Employees (invite + CSV import), Products, Shift times.
- **Shift log** (`/factory/[slug]/log`) — the entry form, activity feed, and amendments. Two tabs: **Log entry** and **Kaizen** (improvement ideas from the floor, reviewed by supervisors and up). The right-hand column belongs to the active tab — shift activity on one, the improvement queue on the other.
- **Data table** (`/factory/[slug]/data`) — server-side filter / sort / paginate over the shift log, CSV export.
- **Shift report** (`/factory/[slug]/report`) — one day, one shift, every room on one sheet. Rooms that logged nothing are *kept*, showing their pipeline status; the page prints as a landscape handover document. Supervisor and up.
- **Pipeline** (`/factory/[slug]/pipeline`) — the Kanban batch tracker. Cards move themselves from the shift log via a database trigger; nobody drags one. Two ways in: **New job** by hand, or a `planned_for` date on the batch in Admin → Products, promoted onto the board when the page loads on or after that day (`promote_scheduled_jobs()`, migration `0018`).
- **Issues & CAPAs** (`/factory/[slug]/actions`) — the accountability loop. A flagged shift entry raises an issue, which then works through four stages — **Open → Investigating → Action taken → Closed**, one at a time, each move paid for with the evidence that stage produces (owner, root cause + corrective action, verification). Enforced by the `actions_stage_transition` trigger, not the UI. Overdue and escalated are *computed*, never stored, and there are two clocks: the fix clock stops once the corrective action is in, and a slower sign-off clock (`factories.escalate_hours`) takes over.
- **Maintenance** (`/factory/[slug]/maintenance`) — **raising a request only**. Report a fault against an equipment number, say which *department* is needed (a per-tenant setup list, Admin → Departments), type the affected batch. Requests are numbered `MR-2026-014` by a counter table. Assignment, progress and verification are declared in the `maintenance_status` enum but not built.
- **Database** — 24 migrations in `supabase/migrations/`, with RLS on every tenant table.

Not built: the maintenance workflow past `reported`, OEE & Downtime, Quality, Trends, signed handover reports, and the Pipeline's Planning-by-room / Gantt / Archive tabs (they render as "Soon" from `nav.ts`). The shift log's Roster tab was dropped rather than deferred — the shift log has exactly two tabs now.

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
- **24 migrations exist** (`0001`–`0024`). `docs/IMPLEMENTATION_GUIDE.md` §0 lists `0003`–`0014`; `docs/IMPLEMENTATION_GUIDE_2.md` §0 lists `0015`–`0017` and `0020`–`0024`. Check both before assuming a table or column is missing. `0018` adds `factory_products.planned_for` and `promote_scheduled_jobs()` — the scheduled route onto the pipeline board. `0019` adds `kaizen_ideas` and the `can_review_factory()` helper (supervisor and up, wider than `can_manage_factory()`). `0020`–`0021` turn Actions into the staged CAPA flow — see IMPLEMENTATION_GUIDE_2 §6a.
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
