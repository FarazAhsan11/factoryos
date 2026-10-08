# CLAUDE.md

**FactoryOS** — a multi-tenant SaaS platform for factory / manufacturing operations. Each factory is an isolated tenant. A production rebuild of a single-file HTML prototype (not in the repo: `C:\Users\Dell\Downloads\factoryos_v11.html`).

Auth, tenancy, factory setup and a dozen operational modules are **built and working** — assume a feature exists before proposing to build it. The module inventory is in `docs/MODULES.md`; UI names differ from route names there (e.g. *Customer orders* is `/products`, *Production log / Shift report* is `/log`).

## Where to look

- **`docs/IMPLEMENTATION_GUIDE.md`, `docs/IMPLEMENTATION_GUIDE_2.md`** — how everything is built and the patterns to follow. **Read first for feature work.** §0 of each lists migrations to apply by hand.
- **`docs/MODULES.md`** — every module, screen by screen, and the rules each enforces. Read the section for the module you are changing.
- **`docs/DATABASE.md`** — migration-by-migration notes, core schema, seed scripts. Migration files themselves open with an explanatory comment.
- `docs/ARCHITECTURE_FLOW.md` — product scope and intent; predates the code, so the guides win. Its "TBD (Clerk / Neon / Drizzle)" is out of date: auth and DB are **Supabase**. `docs/PROGRESS.md` — what landed when.
- `.claude/rules/` — path-scoped rules for the pipeline / shift log, migrations, and navigation / speed. They load when you touch matching files.

## Commands

Windows / PowerShell. No test runner is configured.

```bash
npm run dev        # http://localhost:3000
npm run build      # production build
npm run start      # serve the build
npm run lint       # must stay clean — see React Compiler below
npx tsc --noEmit   # typecheck
```

## Stack

Next.js 16 (App Router), React 19, TypeScript strict · Tailwind v4 (no `tailwind.config`; the theme and the colour palette live in `src/app/globals.css` — use palette tokens, never raw hex) · shadcn/ui (`base-nova`, `lucide-react`) · Supabase (`@supabase/ssr`) · `react-hook-form` + `zod` · `sonner`, `next-themes`.

**Size in rem, not px** — including text (`text-[0.75rem]`, not `text-[12px]`). The root font size in `globals.css` steps down on smaller screens, and anything in px stays behind.

## Conventions

- Alias `@/*` → `src/*`. Browser client `@/lib/supabase/client` in Client Components; server client `@/lib/supabase/server` everywhere on the server — never import the server client into a Client Component.
- **Routes stay thin** (`page.tsx` / `layout.tsx` wire metadata, fetch, compose). UI lives in `src/components/<feature>/`, grouped by domain; shadcn primitives in `components/ui/`. Add `"use client"` as low in the tree as possible. Compose classes with `cn()` and expose `className`.
- **Forms:** `react-hook-form` + `zod` via `zodResolver`. One schema per form (`type Values = z.infer<…>`), in a plain non-`"use server"` module so a Server Action can **re-validate the same schema** — the action is the trust boundary, client zod is UX only. Reuse `TextField` and the existing submit-button / inline-error visuals. `SelectField` and `DateField` are controlled: connect them with `Controller`, not `register`. The auth forms (`login-form`, `set-password-form`, `forgot-password-form`, `create-factory-dialog`) predate this and use manual state — migrate when you next touch them.
- **Never write a native `<select>`.** Every dropdown is `SelectField` (`src/components/ui/select-field.tsx` — its header documents `options`, `groups`, `clearable`, `pinned`).
- **Rail:** a screen of a page that has several (Pipeline, Shift log, Resources, Admin) is a child of `FACTORY_NAV` (`src/lib/factory/nav.ts`) linking to `?tab=` — there are no tab strips. A new screen needs a rail child; its prefetch goes in `nav-prefetch.ts` keyed by the full href; a new module needs a case in `NavigationFrame`.

## Data and tenancy

- **Multi-tenant by row:** nearly every operational table carries `factory_id` (most also `shift` + `log_date`), with RLS on every tenant table. Build tenant and shift scoping in from the start. Helpers: `is_super_admin()`, `current_factory_id()`, `can_manage_factory(uuid)`, `can_review_factory()` (supervisor and up).
- **Trust boundary:** browser-direct under RLS for ordinary tenant data (that is what makes optimistic updates cheap). A Server Action only when the write needs the service-role key or must not be expressible from the client. A Server Action that changes a page's server payload must `revalidatePath`.
- **Shift-log entries are audit-protected:** no delete policy (never add one), insert requires `logged_by = auth.uid()`, updates go through `shift_log_amend_guard` (needs an `amend_note`, restores provenance columns). **Triggers on `shift_log_entries` are load-bearing** — they move pipeline cards and raise actions, and fire on update too. Adding one means adding its React Query key to the invalidation list in `log-entry-form.tsx` (IMPLEMENTATION_GUIDE_2 §9).
- **Derived, never stored:** product status, overdue / escalated, maintenance response and downtime. A stored copy is a second record of one fact.
- **Null, not zero,** for a measurement that does not apply (speed on a manual stage, quantity on a stage that produces nothing) — OEE must tell "not applicable" from "produced nothing".
- Migrations (`supabase/migrations/NNNN_name.sql`, currently `0001`–`0047`) are applied **by hand** in the Supabase SQL Editor; the CLI is not installed. Say so when you add one. See the migrations rule.

## Performance

- **React Compiler is on** (`reactCompiler: true`) and relies on `npm run lint` staying clean. Don't mutate props, state or a hook's return value in render; think twice before RHF's `watch()`, `setError` or `clearErrors`. **Never read the clock in render** (`todayKey()`, `new Date()`, `Date.now()`, `resolveCurrentShift()`, "3h ago") — use `useRenderClock` (`src/lib/use-render-clock.ts`). Event handlers and effects may read it directly.
- Take the signed-in user from `getFactoryContext(slug).viewer`; never call `supabase.auth.getUser()` in a page (a Supabase Auth round trip per navigation).
- Judge speed on `npm run build && npm start`, not `npm run dev`.
- Navigation, prefetch, skeletons and tab transitions: see the navigation rule.

## Environment

Copy `.env.example` → `.env.local` (all `.env*` are gitignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, never to the client), `SEED_SUPER_ADMIN_EMAIL` / `_PASSWORD`. Seed scripts are in `docs/DATABASE.md`. `admin123!` is a dev-only password — rotate before real use.

## Working style

A phase-by-phase build reviewed at each step: prefer small, self-contained changes over large speculative scaffolding.
