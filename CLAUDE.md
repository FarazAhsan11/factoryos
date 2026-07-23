# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**FactoryOS** — a multi-tenant SaaS platform for factory / manufacturing operations management. Each factory is an isolated tenant. It is a production rebuild of a ~4,100-line single-file HTML prototype (`factoryos_v8_final.html`, not in repo — lives at `C:\Users\Dell\Downloads\`).

The project is at **Step 0 (foundation)**: the Next.js app is scaffolded, Supabase clients are wired, and a design-only login screen exists. There is no database schema, no auth flow, and no operational feature code yet. **Read `docs/ARCHITECTURE_FLOW.md` before doing design work** — it is the living source of truth for product scope, the role hierarchy, the shift-based data model, build order, and open decisions.

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

## Environment

Copy `.env.example` → `.env.local`. All `.env*` files are gitignored.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose to the client)

## Working notes

- The login screen (`src/app/login/page.tsx`) is **presentational only** — the form does not submit and no auth is wired. Don't assume auth exists.
- Multi-tenancy is row-level by design: nearly every operational table will carry `factoryId`, and most also carry `shift` + `date` (see the shift-based operating model in the architecture doc). Bake tenant + shift scoping into any schema or query work from the start.
- This is a phase-by-phase build reviewed at each step — prefer small, self-contained changes aligned with the build order in the architecture doc over large speculative scaffolding.
