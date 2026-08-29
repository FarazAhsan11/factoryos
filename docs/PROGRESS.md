# FactoryOS — Progress Guide

_A running record of what has been built, how it fits together, and how to run it. Update as work lands._

_Last updated: 2026-07-31_

---

## 1. Where the project stands

FactoryOS is a multi-tenant SaaS for factory operations, being rebuilt from a single-file HTML prototype (currently `factoryos_v11.html`) into a production Next.js app. **Steps 0–3 are complete**, and the **first operational module (Shift log) has landed** along with its data table:

- ✅ Next.js app scaffolded (App Router, React 19, TS strict, Tailwind v4, shadcn/ui)
- ✅ Supabase wired for auth + Postgres
- ✅ Polished, reusable **login screen**
- ✅ Database schema: roles, `factories`, `profiles` (+ RLS, auto-profile trigger)
- ✅ **Super Admin** account seeded and able to log in
- ✅ Auth flow: login → role-based routing → **Super Admin dashboard** with a factories master–detail view
- ✅ **Create factory** (Step 1): modal (name, info, logo upload, admin email) → server action uploads the logo to Storage, inserts the factory, provisions its **Factory Admin** via a Supabase invite link, and emails a **branded invite** through nodemailer. The admin sets a password (`/set-password`) and lands on the **factory workspace** (`/factory/[slug]`, tenant-gated; the dashboard itself is still placeholder data).

- ✅ **Delete factory** (Step 1b): cascading wipe of a tenant — every member's auth user + profile, its logo files, then the factory row, behind a type-the-name confirmation.
- ✅ **Onboarding wizard** (Step 2): gates the whole factory workspace until `onboarded_at` is set; captures the site name and the tenant's production-unit vocabulary.
- ✅ **Factory workspace shell** (Step 3): role-gated left sidebar over a shared layout; unbuilt modules show as "Soon".
- ✅ **Admin & Settings — full tab set**: Company, Units, Processes (machine + output flags), **Employees** (invite, CSV import, roster), **Products** (batch list), **Shift times** (morning + afternoon clock).
- ✅ **Shift log — Log entry** (`/factory/[slug]/log`): the first module that *writes* production data. Adaptive form driven by the selected stage's flags, batch auto-fill, operator picker, live activity feed. Entries are audit-protected — no delete path, corrections are amendments.
- ✅ **Shift log — Data table** (`/factory/[slug]/data`): server-side filter / sort / pagination over every entry, live totals, CSV export, and the amend dialog.

> Details, migrations, and the patterns to follow for the next module live in **`docs/IMPLEMENTATION_GUIDE.md`** — that is the working reference; this file is the narrative record.

Not built yet: Pipeline, Actions, OEE & Downtime, Quality, Trends, handover reports, and the shift log's Roster / CI-ideas tabs. They render as "Soon" in the sidebar from `nav.ts`.

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
   | `NEXT_PUBLIC_SITE_URL` | Public base URL (e.g. `http://localhost:3000`) — used to build invite links in emails |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | nodemailer transport for the factory-admin invite email. Gmail: host `smtp.gmail.com`, port `465`, pass = a Google **App password** |

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

### Migration `0002_factory_details.sql`

- Adds `description` + `logo_url` to `factories`.
- Creates a **public** Storage bucket `factory-logos`. Logos are uploaded server-side with the service-role key (bypasses RLS), so no storage policies are needed for the create-factory flow.

### Applying them

1. Open the SQL Editor for the project.
2. Paste the contents of each `supabase/migrations/NNNN_*.sql` in order and **Run**.

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
                                              └──▶  factory roles → /factory/[slug]

Invite:  create factory ──▶ email link ──▶ /auth/confirm (verifyOtp) ──▶ /set-password ──▶ /factory/[slug]
```

- **`middleware.ts`** (+ `src/lib/supabase/middleware.ts`) refreshes the Supabase session on every request and redirects unauthenticated users away from `/admin` **and `/factory`** → `/login`.
- **`/`** (root) is a Server Component that routes by role: super admins → `/admin`, factory members → their `/factory/[slug]`, no session → `/login`.
- **`/admin`** is a Server Component that re-checks `auth.getUser()` and `profile.role === 'super_admin'`; anyone else is redirected to `/login`. (Defense in depth: middleware + page guard.)
- **`/auth/confirm`** — route handler that verifies the emailed one-time token (`verifyOtp`) and sets the SSR session, then forwards to `next`. Landing point for the invite link.
- **`/set-password`** — page where the freshly-invited admin sets a password (`auth.updateUser`), then is sent to their factory dashboard.
- **`/forgot-password`** — code-based reset. Step 1 emails a 6-digit code (`generateLink({type:'recovery'})` → `properties.email_otp`, delivered by nodemailer). Step 2 verifies it (`verifyOtp({type:'recovery'})`, which also starts the session) and sets a new password → routed home by role. Returns a generic success even for unknown emails (no user enumeration).
- **`/factory/[slug]`** — Server Component guarded by `auth.getUser()` + tenant match (super admins may view any factory; members only their own).
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
│  ├─ page.tsx               → role-based redirect (super_admin/factory/login)
│  ├─ login/page.tsx         → composes <AuthSplitLayout><LoginForm/></AuthSplitLayout>
│  ├─ set-password/page.tsx  → <AuthSplitLayout><Suspense><SetPasswordForm/></...>
│  ├─ forgot-password/{page.tsx,actions.ts} → 6-digit code reset flow
│  ├─ auth/confirm/route.ts  → verifyOtp for the emailed invite token
│  ├─ admin/page.tsx         → auth guard + data fetch, renders <FactoriesConsole/>
│  ├─ admin/actions.ts       → "use server"; createFactory (upload→insert→invite→email)
│  └─ factory/[slug]/page.tsx→ tenant-gated dummy dashboard
├─ components/
│  ├─ brand/logo.tsx         → <Logo className="h-8"/>  (reads /branding SVG)
│  ├─ auth/
│  │  ├─ auth-split-layout.tsx / auth-hero.tsx / text-field.tsx
│  │  ├─ login-form.tsx        → "use client"; Supabase sign-in + routing
│  │  ├─ set-password-form.tsx → "use client"; updateUser({password}) → dashboard
│  │  └─ sign-out-button.tsx   → "use client"; signOut + redirect
│  ├─ admin/
│  │  ├─ factories-console.tsx   → "use client"; factories master–detail
│  │  └─ create-factory-dialog.tsx → "use client"; modal + calls createFactory action
│  ├─ factory/factory-dashboard.tsx → tenant dashboard (dummy KPIs/shifts)
│  └─ ui/dialog.tsx          → base-ui Dialog primitive (base-nova style)
├─ lib/
│  ├─ supabase/{client,server,middleware,admin}.ts  (admin = service-role client)
│  └─ email/{transport,factory-invite,password-reset}.ts (nodemailer + templates)
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
- **Factories master–detail** (`FactoriesConsole`): left column is a selectable list of factory "tabs"; clicking one shows its details on the right (name, slug, Factory ID, created date, an **Open dashboard →** link, and placeholder status tiles for *First admin* / *Onboarding*). Empty states on both sides when there are no factories.
- **Create factory** (`CreateFactoryDialog`): modal collecting name, short info, logo upload (with preview), and admin email → calls the `createFactory` server action; success/warning surfaced via `sonner` toast, list refreshes.

### Factory dashboard (`/factory/[slug]`)
Tenant-gated placeholder: top bar with the factory logo/name + "Factory Admin" badge, dummy KPI tiles (OEE, units, lines, on-shift) and a "today's shifts" list. Replaced by real onboarding + operational data in later steps.

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

## 9b. Batch families — migration 0031

The pipeline learned what *kind* of batch it is looking at, and which batches
belong together.

**The problem.** A batch was one catalogue row, one card, one number. That
describes a plant that manufactures and packs under a single batch number and
nothing else. The customer whose packing runs carry their own numbers —
46000 bulk, then 46001 / 46002 / 46003 filling 30s, 60s and 120s out of it —
had no way to say so, so nothing could answer the question their planner
actually asks: *is there enough bulk for all three packing runs?*

**What landed.**

- `pipeline_jobs.batch_type` — `manufacturing | packing | combined`. Combined
  is the default and the backfill, because it is what every job written before
  this already was.
- `parent_job_id`, a self-FK with `on delete set null`. Taking a bulk card off
  the board must not delete three real packing batches; a child that loses its
  parent becomes "external bulk", which is a legitimate state.
- The pack/bulk columns: `pack_size`, `pack_unit`, `bulk_unit`,
  `bulk_qty_received`, `market`, `overage_pct`, plus `priority`, `due_date`,
  `notes`. `rework_source_id` is there and unused — the type is deferred, and
  leaving the column means adding it later reshapes no rows.
- `pipeline_jobs_family_guard`, holding every rule a `check` cannot see across
  rows: only a packing job has a parent, the parent is manufacturing and in the
  same factory, one level deep, pack size required, and a parent may not be
  re-typed while children draw on it.
- `pipeline_jobs_expanded` gains the type, the parent's batch number,
  `child_count`, `allocated_qty` (Σ children `required_qty × pack_size`) and
  `bulk_consumed` (Σ entry qty × pack size).

**What was deliberately not added.** `ordered_qty` and `bulk_target_qty`. The
prototype carries both on the batch and both are already
`factory_products.required_qty` — 210,000 tablets on the parent, 1,000 bottles
on a child. A second copy would hand the overrun check (0023) and the
allocation bar different numbers to disagree about.

**UI.** A **New batch** dialog in two steps — the type cards first, because the
answer changes what the second step asks for — and a **Batch families** tab
beside the Kanban board. The batch itself is *picked from the catalogue*, never
typed: Admin → Products owns the batch number, name, code, work order and
required quantity, and the shift log resolves entries against that same row.
The board's cards carry a type badge and a `← 46000 bulk` link, and the shift
log's batch panel shows a packing run's bulk received / consumed / remaining
and warns when it is still waiting on its parent.

**Next.** Per-stage planning: a route on the product copied onto the batch,
per-stage targets, an issue gate refusing producing entries against an
unplanned batch, and completion re-based on the last stage of the plan — which
is what finally retires `factory_processes.is_final_stage`.

---

## 9c. Stage planning — migrations 0032, 0033

**0032 — overage stops being decoration.** 0031 stored `overage_pct` and
computed nothing from it. The over-production flag now measures against
`required_qty × (1 + overage_pct/100)`, so a batch told to make 4% extra is not
flagged for doing exactly that, and the overrun quantity counts from the
allowance rather than the order. A flag that fires when the plan works
correctly is a flag people learn to clear without reading. A packing run may
not declare one — its bulk already carries the slack.

**0033 — a batch is a route, not a number.** `batch_stages` holds one row per
producing stage of one batch: target, unit, optional label or work order, and
the accumulated total kept in step with the shift log by
`batch_stage_accumulate`.

- **The last stage is the final one**, derived from position by
  `batch_stages_final_sync` rather than tagged. Reordering the plan moves it;
  signing it off finishes the batch.
- **The issue gate.** `issue_job()` refuses a batch whose plan is empty or
  whose stages lack targets. `shift_log_stage_guard` then refuses *producing*
  entries against an unissued batch and always accepts downtime — a room must
  be able to account for its time whatever the paperwork says.
- **Stage resolution.** An entry is matched to its stage automatically when the
  batch runs that activity once. Where it runs it several times — Packing 30's
  / 60's / 120's, or work orders 46000D/E/F — the entry must say which, which is
  precisely where the old per-(batch, process) total pooled three runs into one
  meaningless number. `accumulative` now partitions per stage.
- **`factory_processes.is_final_stage` is gone**, with its partial unique index,
  its produces-output check and `clear_other_final_stages`. One process per
  plant could never describe a batch whose stages have their own targets, nor
  one ending in three parallel packing runs.
- Existing jobs are grandfathered: marked issued, with a plan reconstructed
  from what was actually logged and targets left null — nobody can honestly say
  what a batch that ran last month was aiming for.

**UI.** A **Plan stages** dialog on every card (add, reorder, set targets,
start, sign off, issue), a stage strip on the Kanban card, and in the shift log
a per-stage progress bar plus the stage picker that appears only when it is
needed. The three customer scenarios — one batch, child batches, work orders —
all run on this one model.

---

## 10. Next steps

- **Actions** — `action_flag` is captured on every log entry but nothing consumes it yet; this is where a flagged entry becomes a tracked action item.
- **OEE & Downtime** — the first module to *read* the shift log analytically. The clock maths it needs (`shiftLengthMinutes`, `productiveMinutes`) already lives in `shift-time-queries.ts`, and the machine / output flags on each stage are what make availability and performance computable.
- **Roster / attendance** and **CI ideas** — the two placeholder tabs in the shift log.
- **Pipeline**, **Quality**, **Trends**, **handover reports** — see `docs/ARCHITECTURE_FLOW.md` for scope.
- **Re-invite** a factory admin from the super-admin console.

> Patterns to follow for any of these are in `docs/IMPLEMENTATION_GUIDE.md` — §11 for a new Admin tab, §13 for a data-heavy read module.

---

## 11. Related docs

- `docs/IMPLEMENTATION_GUIDE.md` — how delete-factory, onboarding, the workspace shell, and the Admin tab are built; migrations 0003–0005; navigation/data-fetching patterns.
- `docs/ARCHITECTURE_FLOW.md` — product scope, role hierarchy, shift-based data model, build order, open decisions.
- `CLAUDE.md` — repo conventions (stack, layout, component conventions, database workflow).
