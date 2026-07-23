# FactoryOS — Progress Guide

_A running record of what has been built, how it fits together, and how to run it. Update as work lands._

_Last updated: 2026-07-23_

---

## 1. Where the project stands

FactoryOS is a multi-tenant SaaS for factory operations, being rebuilt from the `factoryos_v8_final.html` prototype into a production Next.js app. We are at the end of **Step 0 (foundation)**:

- ✅ Next.js app scaffolded (App Router, React 19, TS strict, Tailwind v4, shadcn/ui)
- ✅ Supabase wired for auth + Postgres
- ✅ Polished, reusable **login screen**
- ✅ Database schema: roles, `factories`, `profiles` (+ RLS, auto-profile trigger)
- ✅ **Super Admin** account seeded and able to log in
- ✅ Auth flow: login → role-based routing → **Super Admin dashboard** with a factories master–detail view

Not built yet: functional "Create factory", factory-admin provisioning, onboarding wizard, and all operational modules.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS v4 (theme in `src/app/globals.css`, no config file) |
| UI kit | shadcn/ui (`base-nova`, neutral), icons via `lucide-react` |
| Auth + DB | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) |
| Misc | `sonner`, `next-themes`, `clsx` + `tailwind-merge` (`cn()`) |

Brand blue is `#2563EB` (from the logo); the shadcn theme tokens themselves are neutral/grayscale.

---

## 3. Environment setup

1. Copy `.env.example` → `.env.local` (all `.env*` are gitignored).
2. Fill in from Supabase Dashboard → **Project Settings → API Keys**:

   | Var | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_…`) — browser-safe |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key (`sb_secret_…`) — **server only** |
   | `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | Used only by the seed script |

   > This project uses Supabase's **new API key format**: the *Publishable* key is the anon/public key; the *Secret* key is the service-role key.

3. Commands:

   ```bash
   npm run dev      # http://localhost:3000
   npm run build    # production build
   npm run lint     # eslint
   ```

---

## 4. Database

SQL migrations live in `supabase/migrations/`. There is **no Supabase CLI or local DB connection** set up, so migrations are applied by hand via **Dashboard → SQL Editor**. The migration files remain the source of truth.

### Migration `0001_init_auth_tenancy.sql`

- `user_role` enum: `super_admin | admin | manager | supervisor | operator`
- `factories` — tenants (`id, name, slug, created_at`)
- `profiles` — one row per `auth.users` (`id, email, full_name, role, factory_id`), with a check that super admins have no `factory_id`
- `handle_new_user()` trigger — auto-creates a profile on signup, reading `role` / `full_name` / `factory_id` from the auth user's metadata
- **RLS**: users read their own profile; super admins have full access to profiles and factories; factory members can read their own factory. `is_super_admin()` is a `security definer` helper (avoids policy recursion).

### Applying it

1. Open the SQL Editor for the project.
2. Paste the contents of `supabase/migrations/0001_init_auth_tenancy.sql` and **Run**.

### Seeding the Super Admin

After the migration is applied:

```bash
node --env-file=.env.local scripts/seed-super-admin.mjs
```

Creates `admin@factoryos.com` / `admin123!` as `super_admin` via the Supabase Admin API. Idempotent (updates password + profile if the user already exists).

> ⚠️ `admin123!` is a **dev-only** placeholder — rotate before any real deployment.

Two sample factories (**Riverside Nutraceuticals**, **AcelPharma**) were also seeded so the dashboard list isn't empty.

---

## 5. Auth flow

```
/login  ──sign in──▶  look up profile.role  ──▶  super_admin → /admin
                                              └──▶  other roles → / (placeholder)
```

- **`middleware.ts`** (+ `src/lib/supabase/middleware.ts`) refreshes the Supabase session on every request and redirects unauthenticated users away from `/admin` → `/login`.
- **`/admin`** is a Server Component that re-checks `auth.getUser()` and `profile.role === 'super_admin'`; anyone else is redirected to `/login`. (Defense in depth: middleware + page guard.)
- Supabase clients:
  - `src/lib/supabase/client.ts` — browser client for Client Components
  - `src/lib/supabase/server.ts` — server client (cookies) for Server Components / Actions / Route Handlers
  - `src/lib/supabase/middleware.ts` — request/response client for middleware

---

## 6. Component architecture

Routes stay thin and **compose components**; UI lives in `src/components/<feature>/`. (See the "Component conventions" section in `CLAUDE.md`.)

```
src/
├─ app/
│  ├─ login/page.tsx        → composes <AuthSplitLayout><LoginForm/></AuthSplitLayout>
│  └─ admin/page.tsx        → auth guard + data fetch, renders <FactoriesConsole/>
├─ components/
│  ├─ brand/
│  │  └─ logo.tsx           → <Logo className="h-8"/>  (reads /branding SVG)
│  ├─ auth/
│  │  ├─ auth-split-layout.tsx → reusable split shell (hero + form column)
│  │  ├─ auth-hero.tsx         → left brand panel + isometric illustration + tagline
│  │  ├─ text-field.tsx        → reusable labeled input (icon, labelAction, trailing)
│  │  ├─ login-form.tsx        → "use client"; real Supabase sign-in + routing
│  │  └─ sign-out-button.tsx   → "use client"; signOut + redirect
│  └─ admin/
│     └─ factories-console.tsx → "use client"; factories master–detail
└─ lib/supabase/{client,server,middleware}.ts
```

**Reuse notes**
- `AuthSplitLayout` + `AuthHero` are ready to back future signup / forgot-password pages.
- `TextField` and `Logo` are app-wide primitives.
- `"use client"` is pushed as low as possible (only the interactive pieces).

---

## 7. The screens

### Login (`/login`)
Split layout: left brand hero with a bespoke isometric factory illustration (`public/branding/login-hero.svg` — warehouse, silo, conveyor with boxes, delivery truck), right a centered form. Single-viewport height (`svh`), mobile-responsive (hero hidden below `lg`, form stacks). Functional: email + password → Supabase sign-in → role-based redirect, with show/hide password and inline errors.

### Super Admin dashboard (`/admin`)
- Top bar: logo, "Super Admin" badge, current user, **Sign out**.
- **Factories master–detail** (`FactoriesConsole`): left column is a selectable list of factory "tabs"; clicking one shows its details on the right (name, slug, Factory ID, created date, and placeholder status tiles for *First admin* / *Onboarding*). Empty states on both sides when there are no factories.

---

## 8. The isometric login illustration

`public/branding/login-hero.svg` is generated, not hand-drawn. A small Node script projects cubes into a true isometric grid (`0.866`/`0.5` basis vectors), stacks them into a factory scene (warehouse, silo, conveyor + boxes, pallets, box truck), sorts them back-to-front, and emits SVG polygons. It's a standalone file so it can be swapped for a real 3D render later without touching the page.

---

## 9. How to run it end-to-end

1. `.env.local` filled in (§3), migration applied + super admin seeded (§4).
2. `npm run dev`
3. Visit `http://localhost:3000/login`, sign in with `admin@factoryos.com` / `admin123!`.
4. Land on `/admin` → the two seeded factories appear in the list; click to view details.

---

## 10. Next steps

- Wire **Create factory**: a dialog that inserts a `factories` row and provisions its first **Factory Admin** (auth user with `role='admin'` + `factory_id`) via the Admin API.
- Per-factory **delete** / manage.
- **Factory onboarding wizard** (port from the prototype: units, processes, products, shift times, employees).
- Route non-super-admin roles to a real factory dashboard instead of `/`.
- Operational modules (pipeline, shift log, roster/attendance, actions, OEE, quality, trends, handovers) — see `docs/ARCHITECTURE_FLOW.md` for scope and the shift-based data model.

---

## 11. Related docs

- `docs/ARCHITECTURE_FLOW.md` — product scope, role hierarchy, shift-based data model, build order, open decisions.
- `CLAUDE.md` — repo conventions (stack, layout, component conventions, database workflow).
