# FactoryOS — Implementation Guide (Steps 1b–3)

_How the factory delete, onboarding wizard, workspace shell, and Admin tab are built — and the patterns to follow when adding the next tab._

_Last updated: 2026-07-26_

Covers everything landed after the create-factory flow described in `docs/PROGRESS.md`:

| # | Feature | Where |
|---|---|---|
| 1 | Delete a factory (cascading wipe) | `/admin` |
| 2 | Factory onboarding wizard | `/factory/[slug]` (gate) |
| 3 | Factory workspace shell + sidebar | `/factory/[slug]/*` |
| 4 | Admin & Settings tab (Company / Units / Processes) | `/factory/[slug]/admin` |
| 5 | Navigation + data-fetching performance | app-wide |

---

## 0. Run these migrations first

Applied by hand via **Supabase Dashboard → SQL Editor**, in order. The files stay the source of truth.

| File | What it does |
|---|---|
| `0003_factory_onboarding.sql` | `factories.unit_label`, `unit_label_plural`, `onboarded_at` (+ a `sample_data` column, dropped again in 0004); RLS letting a factory admin update its own row |
| `0004_drop_sample_data.sql` | Drops `sample_data` — the wizard no longer offers sample seeding |
| `0005_factory_setup_core.sql` | `factories.oee_target` / `escalate_hours` (+ range checks); `factory_units` and `factory_processes` tables; `current_factory_id()` / `can_manage_factory()` helpers; RLS for both lists; widens the factory-update policy from admin-only to admin **or** manager |

New dependency: **`@tanstack/react-query`** (`npm install` picks it up).

---

## 1. Delete a factory

**Entry point:** red *Delete factory* button in the detail header of `/admin`.

`src/components/admin/delete-factory-dialog.tsx` → `deleteFactory()` in `src/app/admin/actions.ts`.

The action is deliberately ordered — read the ordering before changing it:

1. **Authorize** via the shared `requireSuperAdmin()` helper (also used by `createFactory`).
2. **Re-validate** `deleteFactorySchema` server-side (`src/app/admin/schemas.ts`).
3. **Confirm** the typed name matches the factory's real name (case-insensitive). The dialog requires retyping it.
4. **Delete every member**: `admin.auth.admin.deleteUser(profile.id)` for each `profiles` row with that `factory_id`. Deleting the auth user cascades to `profiles` (FK `on delete cascade`). Any `super_admin` is skipped as a guard.
5. **Clear storage**: list and remove `factory-logos/<slug>/*`.
6. **Delete the factory row**, then `revalidatePath("/admin")`.

Partial failures (a stuck user, a storage error) come back as `{ ok: true, warning }` rather than a false success.

> ⚠️ When operational tables land, give their `factory_id` FKs `on delete cascade` — otherwise step 6 starts failing on references. `profiles.factory_id` is `on delete set null`, which is safe only because step 4 removes those rows first.

---

## 2. Onboarding wizard

A factory is "onboarded" once `factories.onboarded_at` is set. Until then the **entire workspace** is gated — the check lives in `src/app/factory/[slug]/layout.tsx`, not on one page, so future modules inherit it:

- `admin` / `super_admin` → `OnboardingWizard` (`src/components/factory/onboarding-wizard.tsx`)
- anyone else → `SetupPending` ("your admin still has to finish setup")

The wizard is a non-dismissible overlay over the dashboard: **company/site name** (prefilled with the factory name) and **what you call your production units** (Rooms / Lines / Machines / Areas / Processes / Custom). Picking *Custom* reveals a required singular-name input.

`completeOnboarding()` (`src/app/factory/[slug]/actions.ts`) re-validates the shared schema, authorizes the caller as that factory's admin (or a super admin), refuses a second run if `onboarded_at` is already set, then writes `name`, `unit_label`, `unit_label_plural`, `onboarded_at`.

**Unit vocabulary is the point of this step.** `resolveUnitLabels()` in `src/app/factory/[slug]/schemas.ts` derives singular + plural; every later module should read `unit_label_plural` instead of hardcoding "room" or "line". `unitWords(factory)` in `src/lib/factory/context.ts` gives you both with fallbacks.

The super-admin console reflects the real state: Onboarding shows *Not started* or *Completed <date>* plus the chosen unit label.

---

## 3. Workspace shell

`/factory/[slug]` is a **layout**, so the chrome is rendered once and future modules just drop a `page.tsx` into a new folder.

```
src/app/factory/[slug]/
├─ layout.tsx        → getFactoryContext() + <FactoryShell> + onboarding gate
├─ loading.tsx       → <PageSkeleton/> while a segment streams
├─ page.tsx          → dashboard
└─ admin/
   ├─ page.tsx       → server: auth + initial tab
   ├─ loading.tsx
   ├─ actions.ts     → updateCompanySettings
   └─ schemas.ts     → companySettingsSchema
```

### `getFactoryContext(slug)` — `src/lib/factory/context.ts`

The single auth + load path for every factory route. Wrapped in React `cache()` so the layout and page **share one round-trip**; the profile and factory reads run in `Promise.all`. It redirects to `/login` when the viewer doesn't belong, 404s on an unknown slug, and returns `{ factory, role, canManage }` — so callers can treat the result as always valid.

`canManage` = `super_admin | admin | manager`.

### Sidebar — `src/lib/factory/nav.ts` + `factory-sidebar.tsx`

Nav config is data: sections → items with `roles` and a `ready` flag. `navForRole(role)` filters and drops empty sections. Unbuilt modules render **disabled with a "Soon" tag** rather than linking to a 404.

**To add a module:** flip `ready: true` in `nav.ts` and create `app/factory/[slug]/<href>/page.tsx`. Nothing else.

---

## 4. Admin & Settings tab

`/factory/[slug]/admin?tab=company|units|processes`. Manager-and-up; anyone else is redirected to the dashboard.

### Split of responsibilities

- **`page.tsx` (server)** — authorizes, resolves the initial tab, hands `factory` + `canManage` to the client.
- **`admin-workspace.tsx` (client)** — owns the active tab, renders the panels.
- **`src/lib/factory/admin-tabs.ts` (plain module)** — `ADMIN_TABS`, `TAB_TABLE`, `resolveAdminTab()`.

> **Why the config lives in a plain module:** a *value* exported from a `"use client"` module crosses the boundary as a client **reference**, not data — a server component importing it gets a stub, and `ADMIN_TABS.find(...)` throws `is not a function` at runtime (types still compile, so the build won't catch it). Anything both sides read must live outside the client module.

### Company panel

`company-settings-form.tsx` — `react-hook-form` + `zod` + a Server Action (`updateCompanySettings`), wrapped in `useMutation` for pending/error state. Save is disabled until dirty and re-baselines via `reset(values)` on success, then `router.refresh()` so the top bar picks up a renamed factory.

Numbers are registered with `{ valueAsNumber: true }` and typed as `z.number()` — **not** `z.coerce.number()`, which infers `unknown` input in zod 4 and breaks the resolver's types.

### Units / Processes panels

One component, `setup-list-manager.tsx`, serves both — the two tables share a shape (`id, name, active, sort_order`). Add, inline rename, retire/reactivate, delete.

Data access is `src/lib/factory/setup-queries.ts`, going **straight from the browser to Supabase**. RLS (`can_manage_factory`) is the trust boundary here, not a Server Action — that's what makes optimistic updates cheap. Postgres `23505` (the per-tenant unique index on `lower(name)`) is translated into `"Room 9" already exists.`

`active` exists so a unit with shift history can be **retired** instead of deleted once operational data references it.

---

## 5. Performance patterns

The first cut felt sluggish because both the sidebar and the sub-tabs did full RSC round-trips. What fixed it, in order of impact:

1. **Sub-tabs are client state, not navigation.** The server already sent the factory; React Query holds the lists. `window.history.replaceState` keeps `?tab=` in the address bar **without** re-running the server component — deep links and refresh still work.
2. **Panels stay mounted once visited** (`hidden`, not unmounted), so returning to Company keeps in-progress edits and returning to Units renders from cache with no flash. Unvisited panels are lazy, so nothing fetches until opened.
3. **Hover prefetch.** `onMouseEnter` / `onFocus` on a tab fires `queryClient.prefetchQuery`, so data usually lands before the click.
4. **Optimistic sidebar activation.** `usePathname` only updates *after* navigation resolves, which is why the clicked item stayed dim. The sidebar tracks a `pendingHref` with `useTransition` and treats it as current while `isPending` — no effect, no state to clear — and shows a spinner on that row.
5. **`loading.tsx` per segment.** Shell and sidebar stay fixed; only the main area shimmers (`components/factory/page-skeleton.tsx`).

**React Query setup** is in `src/app/providers.tsx` (wrapped in the root layout): one `QueryClient` per browser session created in `useState`, `staleTime: 30_000`, `refetchOnWindowFocus: false`.

> `next dev` compiles routes on first visit and limits prefetching, so the first Dashboard→Admin click in dev pays a cost no client-side work removes. Judge navigation feel with `npm run build && npm run start`.

---

## 6. Adding the next Admin tab (Employees / Products / Shift times)

The scaffolding is in place; a new tab is roughly:

1. **Migration** — new table with `factory_id uuid not null references factories(id) on delete cascade`, RLS using the existing `can_manage_factory()` / `current_factory_id()` helpers.
2. **`admin-tabs.ts`** — flip the tab's `ready` to `true`; add it to `TAB_TABLE` if it's a flat name list.
3. **Panel component** under `src/components/factory/admin/`:
   - a flat list → reuse `SetupListManager` with a new `SetupTable` value;
   - anything richer (Employees has role + default shift) → its own component, but keep the same shape: React Query for reads/mutations with optimistic updates, RLS as the trust boundary, `sonner` for errors.
4. **Mount it** in `admin-workspace.tsx` inside a `<Panel active={tab === "…"} lazy>`.

Forms follow the repo convention (`CLAUDE.md` → *Forms & validation*): one zod schema per form, shared between client and Server Action, `zodResolver`, errors from `formState`.

---

## 7. File map for this work

```
supabase/migrations/{0003,0004,0005}_*.sql

src/app/
├─ providers.tsx                      → QueryClientProvider
├─ admin/{actions.ts,schemas.ts}      → deleteFactory + confirm schema
└─ factory/[slug]/
   ├─ layout.tsx, loading.tsx, page.tsx
   ├─ {actions.ts,schemas.ts}         → completeOnboarding + unit presets
   └─ admin/{page.tsx,loading.tsx,actions.ts,schemas.ts}

src/components/
├─ admin/delete-factory-dialog.tsx
└─ factory/
   ├─ factory-shell.tsx, factory-sidebar.tsx, page-skeleton.tsx
   ├─ onboarding-wizard.tsx, setup-pending.tsx
   └─ admin/{admin-workspace.tsx,admin-tabs.tsx,company-settings-form.tsx,setup-list-manager.tsx}

src/lib/factory/{context.ts,nav.ts,admin-tabs.ts,setup-queries.ts}
```

---

## 8. Related docs

- `docs/PROGRESS.md` — running record of what's built and how to run it.
- `docs/ARCHITECTURE_FLOW.md` — product scope, role hierarchy, shift-based data model, build order.
- `CLAUDE.md` — repo conventions (component structure, forms, database workflow).
