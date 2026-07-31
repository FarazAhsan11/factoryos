# FactoryOS — Implementation Guide (Steps 1b–4)

_How the factory delete, onboarding wizard, workspace shell, Admin tab and Shift log are built — and the patterns to follow when adding the next module._

_Last updated: 2026-07-31_

Covers everything landed after the create-factory flow described in `docs/PROGRESS.md`:

| # | Feature | Where |
|---|---|---|
| 1 | Delete a factory (cascading wipe) | `/admin` |
| 2 | Factory onboarding wizard | `/factory/[slug]` (gate) |
| 3 | Factory workspace shell + sidebar | `/factory/[slug]/*` |
| 4 | Admin & Settings tab (Company / Units / Processes) | `/factory/[slug]/admin` |
| 5 | Navigation + data-fetching performance | app-wide |
| 6 | Processes: machine flag | `?tab=processes` |
| 7 | Employees: invite, CSV import, roster | `?tab=employees` |
| 8 | Products: batch list | `?tab=products` |
| 9 | Shift times: morning + afternoon clock | `?tab=shift-times` |
| 10 | Create factory asks for the admin's name | `/admin` |
| 11 | **Shift log — Log entry** (the first operational module) | `/factory/[slug]/log` |
| 12 | Demo-data seed script | `scripts/seed-factory-setup.mjs` |
| 13 | **Shift log — data table** (filter / sort / paginate / export) | `/factory/[slug]/data` |

Sections 1–5 cover the first cut of the Admin tab; sections 6–10 completed the tab set; §12 is the first module that *writes* production data rather than configuring it, and **§13 is the newest work** — the module that reads it back.

> Section numbers below track the build order, not the rows in this table.

---

## 0. Run these migrations first

Applied by hand via **Supabase Dashboard → SQL Editor**, in order. The files stay the source of truth.

| File | What it does |
|---|---|
| `0003_factory_onboarding.sql` | `factories.unit_label`, `unit_label_plural`, `onboarded_at` (+ a `sample_data` column, dropped again in 0004); RLS letting a factory admin update its own row |
| `0004_drop_sample_data.sql` | Drops `sample_data` — the wizard no longer offers sample seeding |
| `0005_factory_setup_core.sql` | `factories.oee_target` / `escalate_hours` (+ range checks); `factory_units` and `factory_processes` tables; `current_factory_id()` / `can_manage_factory()` helpers; RLS for both lists; widens the factory-update policy from admin-only to admin **or** manager |
| `0006_process_machine_flag.sql` | `factory_processes.has_machine boolean not null default false` |
| `0007_factory_employees.sql` | `profiles.invited_at` / `activated_at`; a `profiles_factory_read` policy so members can see their own factory's roster; `mark_profile_activated()` definer RPC; back-stamps existing users from `auth.users.last_sign_in_at` |
| `0008_factory_products.sql` | `factory_products` (batch_no, code, name, work_order, required_qty, active) + per-tenant unique index on `lower(batch_no)` and RLS |
| `0009_employee_default_shift.sql` | `shift_slot` enum (`morning｜afternoon｜both`), `profiles.default_shift`, and a **rewritten `handle_new_user()`** that reads `default_shift` from the invite metadata |
| `0010_factory_shift_times.sql` | `factory_shift_times` (slot, start/end, two breaks) with `slot <> 'both'`, 0–120-minute break checks, unique `(factory_id, slot)` and RLS |
| `0011_shift_log_entries.sql` | `shift_log_entries` — the first operational table; insert-only RLS, **no delete policy**, and a `shift_log_amend_guard` trigger enforcing amendments |
| `0012_shift_log_table.sql` | `shift_log_entries_expanded` — a `security_invoker` **view** flattening the unit/process/product names onto each entry and adding the running `accumulative` window total; plus `shift_log_stats()`, the aggregate RPC behind the data table's totals bar |

New dependency: **`@tanstack/react-query`** (`npm install` picks it up).

Employee invites send real email, so `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` (and optionally `SMTP_PORT`, `SMTP_FROM`) must be set in `.env.local` — see `src/lib/email/transport.ts`. Without them the account is still created and the roster shows a *Send invite* button; only delivery fails.

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

## 6. Processes — the machine flag

A process either runs on a machine (its downtime and OEE are machine-attributable) or is manual. That's one boolean, so `SetupListManager` was **generalized rather than forked**:

- `setup-queries.ts` maps a per-table optional boolean through a neutral `flag` field: `FLAG_COLUMN = { factory_processes: "has_machine" }`. `factory_units` never selects a column it doesn't have, and `SetupItem.flag` is `false` there.
- `SetupListManager` takes an optional `flag?: SetupFlagConfig` (`{ label, hint?, on, off }`). When present it renders a checkbox under the add input and a Machine/Manual pill per row (toggled optimistically); when absent the component is byte-for-byte the old Units panel.

**When the next list needs its own boolean**, add it to `FLAG_COLUMN` and pass a `flag` config — don't copy the component.

---

## 7. Employees tab

`?tab=employees` — the roster, plus two ways in: one-off add and CSV import. **Admin-only** (managers see the tab but not the panel); `page.tsx` passes `isAdmin={role === "admin" || role === "super_admin"}`.

### Trust boundary — different from Units/Processes

Everything that creates or deletes an **auth user** needs the service-role key, so it runs in a Server Action (`src/app/factory/[slug]/admin/employee-actions.ts`), not browser-direct. Reads stay browser-direct under the new `profiles_factory_read` RLS policy.

`requireFactoryAdmin(factoryId)` gates every write and is deliberately narrower than `canManage` — a manager can edit company settings but cannot mint accounts.

### How an invite actually works

```
generateLink({ type: 'invite', email, options: { data: { role, factory_id, full_name, default_shift } } })
   → creates the auth user; the handle_new_user trigger turns that metadata into a profile
   → returns properties.hashed_token (we deliver it ourselves; Supabase sends nothing)

/auth/confirm?token_hash=…&type=invite&next=/set-password?next=/factory/<slug>
```

The `next` chain is what makes the email land the person **on the dashboard of the factory they were enrolled in** after setting a password.

> `type: 'invite'` **fails for an email that already has an account.** The roster's *Send invite* / *Resend* button therefore uses `type: 'magiclink'`, not `invite`. Keep that split.

`set-password-form.tsx` calls the `mark_profile_activated()` RPC after the password update — that's what flips a row from *Invited* to *Active*. Status is derived, not stored: `activated_at` → Active, `invited_at` → Invited, otherwise Pending.

### Roles and shift

Only **Admin** and **Operator** are assignable here (`ASSIGNABLE_ROLES` in `admin/schemas.ts`) — manager/super_admin are not handed out from a factory screen. Every employee also carries a `default_shift` of `morning | afternoon | both` ("Rotating" in the UI), which pre-fills their shift log later.

> Migration 0009 **rewrites `handle_new_user()`**. Adding a profile column that arrives via invite metadata is not just an `alter table` — the trigger drops anything it doesn't explicitly read.

### CSV import

`src/lib/factory/employee-csv.ts` parses in the browser (RFC-4180-ish quoted fields, `,` or `;`), accepts a header row (`name,email,role,shift` in any order) or positional columns, and normalizes aliases (`rotating`→both, `pm`/`evening`/`night`→afternoon). It returns `{ rows, errors }` — bad lines are reported with their line number and the file still imports the good ones.

`employee-import-dialog.tsx` runs `pick → review → running → done`. The progress bar is **honest**: it chunks the parsed rows and calls `importEmployees` once per chunk, so the bar tracks real server work rather than an animation. Batch size depends on whether SMTP is in the loop (`3` with invites, `10` without) — invites are on by default, with a checkbox to create accounts silently.

Failure is isolated per row: a bounced email never loses the account. The action returns `{ ok: true, invited: false, reason }` in that case, and the roster's *Send invite* button is the retry. Duplicates come back as *"Already in this factory"* rather than an error.

Sample files for testing live in `docs/samples/` — `employees-sample.csv` (8 clean rows) and `employees-sample-messy.csv` (bad email, unknown role, duplicate, quoted comma) to exercise the error path.

### Guards worth keeping

`updateEmployee` blocks changing **your own role**; `removeEmployee` blocks removing yourself and blocks removing the **last admin** of a factory.

---

## 8. Products tab

`?tab=products` — a flat list, exactly like the prototype: one row per **batch**, carrying its own code, name, work order and required quantity. Browser-direct under RLS, same optimistic pattern as Units/Processes (`src/lib/factory/product-queries.ts`), with search, inline quantity edit, retire and delete.

`batch_no` is unique per factory (`lower(batch_no)`); `23505` is translated into `Batch B-1042 already exists.` Work order falls back to the batch number when left blank.

> **Known consequence of the flat model:** because each batch is its own row, per-product history across batches isn't directly queryable — you'd group on `code`. The additive fix, if it's ever needed, is a product catalogue table plus a nullable FK from `factory_products`; nothing here has to be rewritten first.

---

## 9. Shift times tab

`?tab=shift-times` — two cards (Morning, Afternoon), each with start, end and two optional breaks, and **one save button for both**.

- Reads: `fetchShiftTimes()` always resolves to a complete pair, **falling back to `DEFAULT_SHIFT_TIMES`** (the prototype's 06:45–15:15 / 15:05–23:35) so a factory that has never saved sees a sensible clock rather than an empty form.
- Writes: `updateShiftTimes` (Server Action) upserts both slots in one call with `onConflict: "factory_id,slot"` and nulls out cleared breaks. It shares the `requireManages()` helper extracted from `updateCompanySettings`.
- The clock maths (`minutesOfDay`, `shiftLengthMinutes`, `productiveMinutes`, `formatDuration`, `breakIsInsideShift`) lives in `shift-time-queries.ts` **on purpose** — OEE availability and the shift log must compute a shift's length the same way this form displays it. `shiftLengthMinutes` wraps past midnight, so a night shift doesn't come out negative.
- Overrunning shifts and breaks scheduled outside the shift window are **warnings, not errors** — only the factory knows its real pattern.

Times are validated with a shared `clockTime` schema (`HH:MM`, seconds tolerated and trimmed) because Postgres returns `06:45:00` while `<input type="time">` wants `06:45`.

---

## 10. Create factory — admin name

`createFactory` now takes a required **Admin name** alongside the email, validated by a shared `createFactorySchema` (`src/app/admin/schemas.ts`) that the Server Action re-parses out of the FormData.

The name goes into the invite metadata as `full_name`, so the `handle_new_user` trigger writes it onto the profile — which is what stops a factory's own admin showing as `—` in the Employees roster — and personalizes the invite email (`fullName` is optional in `factory-invite.ts`; without it the old wording is used).

`create-factory-dialog.tsx` was migrated to `react-hook-form` + `zodResolver` while being touched, per `CLAUDE.md`. The logo stays **outside** the form values as a `File` and is attached to the FormData at submit time, since the upload needs it that way.

> No migration for this one. Factories created before it still have a nameless admin and show `—`; there's no backfill.

---

## 11. Adding the next Admin tab

All six tabs are now `ready: true`. The recipe, for whatever comes after:

1. **Migration** — new table with `factory_id uuid not null references factories(id) on delete cascade`, RLS using the existing `can_manage_factory()` / `current_factory_id()` helpers.
2. **`admin-tabs.ts`** — add the tab with `ready: true`; add it to `TAB_TABLE` if it's a flat name list.
3. **Panel component** under `src/components/factory/admin/`:
   - a flat list → reuse `SetupListManager` with a new `SetupTable` value (plus a `flag` config if it needs one boolean);
   - anything richer → its own component, keeping the same shape: React Query for reads/mutations with optimistic updates, RLS as the trust boundary, `sonner` for errors.
4. **Mount it** in `admin-workspace.tsx` inside a `<Panel active={tab === "…"} lazy>` and add a prefetch branch for hover.

**Which trust boundary?** Browser-direct under RLS for ordinary tenant data — that's what makes optimistic updates cheap. A Server Action only when the write needs the service-role key (auth users) or must not be expressible from the client.

Forms follow the repo convention (`CLAUDE.md` → *Forms & validation*): one zod schema per form, shared between client and Server Action, `zodResolver`, errors from `formState`. Numbers use `z.number()` + `{ valueAsNumber: true }` — never `z.coerce.number()`, which breaks resolver typing in zod 4.

---

## 12. Shift log — Log entry

`/factory/[slug]/log?tab=entry`. **No role gate** — logging is the operator's job, and it's the first module that writes production data instead of configuring it. The sub-tabs (Log entry / Roster / CI ideas) reuse `AdminTabs` via `src/lib/factory/log-tabs.ts`; Roster and CI ideas are `ready: false`.

### One form, two shapes

The prototype decided which fields to show from a hardcoded `RUNNING_STAGES` list. We have that as data instead: **the selected process's `has_machine` flag** (Admin → Processes, migration 0006) drives it.

| Section | Machine process | Manual process |
|---|---|---|
| Where & when, times, duration | ✓ | ✓ |
| Equipment no. | ✓ | hidden |
| Batch + auto-fill, Output | ✓ | ✓ |
| Speed unit / target / actual | ✓ | hidden |
| Slow-run reason | required when actual < target | n/a |

The flag is mirrored into the form values as `hasMachine` so the schema's cross-field rules can see it — a `superRefine` in `app/factory/[slug]/log/schemas.ts` is what makes the reason mandatory, because no single field can express "required only when two *other* fields disagree".

> Speed columns are stored **null** for manual work, never `0`. OEE has to be able to tell "not applicable" from "stopped"; zeroes would quietly poison the performance average.

### Audit protection lives in Postgres, not the UI

This is the part to preserve when the module grows:

- **No delete policy at all.** RLS denies what it doesn't allow, so the omission *is* the enforcement.
- **Insert** requires `logged_by = auth.uid()` — you can only file entries as yourself.
- **Update** is limited to the author or a manager, and passes through `shift_log_amend_guard`, a `before update` trigger that rejects any change without an `amend_note`, stamps `amended_at` / `amended_by`, and forces `factory_id`, `logged_by` and `created_at` back to their original values.
- `unit_id` / `process_id` are `on delete restrict`: a room with shift history must be **retired**, not deleted.

Because the guard is in the database, even a service-role script can't quietly rewrite a shift record — worth testing that way once.

### Data flow

Reads and the insert go **straight from the browser** under RLS, the same as the setup lists. Nothing needs the service-role key, so there's no Server Action here.

- Units, processes, products, shift times and the roster are read with the **same React Query keys the Admin panels use**, so opening the log after Admin is cache-warm and vice versa.
- Batch auto-fill matches `batch_no` case-insensitively against the already-loaded catalogue — no request per keystroke.
- The **accumulative** total is a real query (`fetchBatchEntries`), summing every entry ever logged for that batch *and* activity across shifts. The prototype could only sum the current session.

### Time, shift and the working day

`resolveCurrentShift()` picks the shift whose window contains now, falling back to whichever starts next (the two windows don't tile the day). The banner shows elapsed time, ticking each minute, with a **"Log as afternoon"** switch for a late entry.

> **The midnight trap, twice.** An afternoon shift running to 23:35 crosses the calendar day. (1) The form now stamps the working day **at submit time**, not on mount — a tab left open overnight was filing entries under yesterday. (2) The feed has its own date picker defaulting to today, because an entry logged at 23:57 otherwise vanished from view at 00:00 and looked like a failed save. Any later module that buckets by day inherits both problems.

`durationMinutes()` wraps past midnight for the same reason. Overruns past the shift end are allowed — they're real, and blocking them would push operators into logging fiction.

### Operators

Two dropdowns off the roster, grouped **"On morning shift"** (matching `default_shift`, plus Rotating) then **"Other staff"**, with whoever is picked in one field removed from the other. **"Not on the list…"** reveals a text box — contractors and cover staff work real shifts without ever having a login.

The entry stores the operator's **name, not their profile id**: a shift record has to keep saying who ran the machine even if the account is renamed or deleted, and the free-text path has no id to store. The cost is that per-operator analytics would have to match on name; the additive fix is nullable `operator_1_id` / `operator_2_id` columns beside the names.

### Not built yet

`action_flag` is captured but nothing consumes it — the Actions module is where an entry becomes an action item. There's no timeline view of the feed, and Roster / CI ideas are placeholders. (Amending landed with the data table — see §13.)

---

## 13. Shift log — data table

`/factory/[slug]/data` ("Data table" in the sidebar, under Production). **No role gate**, matching the log itself: whoever files entries can read back what the factory logged.

### Amending an entry

The one write on this screen, and the only one the module has. It matches the prototype's model exactly: **the original entry is never edited and never deleted** — an amendment attaches a correction note beside it. Migration 0011 already had everything needed (`shift_log_amend_guard` refuses an update without a note and stamps `amended_at` / `amended_by`; there is no delete policy at all), so this is UI over rules that were already in the database.

- `amendLogEntry()` (`shift-log-queries.ts`) writes to **`shift_log_entries`**, never the view — a view carrying a window function isn't updatable.
- A second amendment **appends** to `amend_note` rather than overwriting it. It's one column and the guard resets `amended_at` on every write, so appending is what keeps the earlier correction readable.
- The Amend button appears only where `canManage || logged_by === userId` — the same test as the `shift_log_amend` policy. That's cosmetic; RLS is still the enforcement. It's why the view selects `logged_by`.
- Unlike the prototype there is **no "Amended by" field to type**. The prototype had no accounts so it asked; here the database stamps `amended_by` from `auth.uid()`, and a free-text name would be an unverified claim sitting in an audit record.

The same dialog (`amend-entry-dialog.tsx`) is reused by the shift log's activity feed, where the button appears on row hover.

### Postgres does the work, not the browser

This is the difference from the prototype, which rendered every entry into the DOM and re-filtered an in-memory array. A factory logs thousands of entries a month, so **filtering, sorting and paging are all server-side** (`src/lib/factory/shift-log-table-queries.ts`): the browser holds one page of rows and never the table.

Two queries back the screen and they answer different questions:

| Query | Returns | Why it can't be the other one |
|---|---|---|
| `fetchLogTablePage` | one `.range()` of rows + `count: "exact"` | the pager needs the total, not the page length |
| `fetchLogTableStats` → `shift_log_stats()` RPC | qty / rejected / duration / quality rate | summing 25 visible rows describes the page, not the filtered set |

`fetchLogTableExportRows` is the third: the CSV must be the **filtered set**, so it re-queries without the range, capped at `EXPORT_LIMIT` (5,000) with a toast when the cap is hit rather than a silently truncated file.

### Why migration 0012 is a view

Two things are impossible with PostgREST embeds:

- **Search across joined names.** The box searches product, room and activity as well as the entry's own columns. An embedded resource can't join a top-level `or` filter; a flattened column can.
- **`accumulative`.** It's a window function over every entry for that batch + activity — by definition it can't be computed from one page of rows. The prototype stored it per row; the view derives it, so it stays correct when an earlier entry is amended.

> ⚠ `with (security_invoker = true)` on the view is load-bearing. Without it the view runs as its owner and **every tenant sees every factory's shift log**. Same for `shift_log_stats()`: it is deliberately *not* `security definer`.

### Filter semantics live in one module

`LogTableFilters` is the contract, and both sides implement it identically — the page query in TypeScript, the stats RPC in SQL. They must agree, or the totals bar describes a different set than the rows below it. The one place that shows: free-text search leaves `%` and `_` in the term (they reach `ilike` as wildcards and only widen the match) precisely **because** the RPC interpolates the same term into the same `ilike`. Only PostgREST's grammar characters (`,()"\`) are stripped.

Sorting is a **whitelist** (`SORTABLE`), not free text — the value is passed to `.order()` as a raw column name. Every page query also carries a `created_at` tiebreaker: without one, two entries sharing a date and start time can appear on two pages while another appears on none.

### Cache reuse and pagination feel

- The room and activity dropdowns read the **same `setupKeys` caches** the Admin panels and the log form use, so arriving from either has them populated.
- `placeholderData: keepPreviousData` keeps the previous page on screen while the next loads — the table dims instead of collapsing to a spinner and back.
- Search debounces in the **change handler**, not an effect (no props-into-state mirroring). "Clear filters" resyncs the box by bumping a `key` that remounts the filter bar.

### Formatting

The table formats for a human (thousands separators, `31 Jul`, em-dashes for empty, tinted rows for flagged/rejected, performance % beside actual speed); `shift-log-csv.ts` does the opposite and writes raw ISO dates and unformatted numbers so a spreadsheet can sum them. Its `escape()` also prefixes a tab to any value starting `=`, `+`, `-` or `@` — otherwise a comment or batch number is executed as a formula when the file opens in Excel.

---

## 14. Seeding a factory for testing

```bash
node --env-file=.env.local scripts/seed-factory-setup.mjs <factory-slug> [--no-products]
```

Fills one factory's setup lists with the prototype's demo data: 25 rooms (named with that factory's own unit word), 25 process stages split **12 machine / 13 manual**, and 16 product batches. It reads what's already there and inserts only what's missing, so re-running after hand-editing a list is safe.

The machine/manual split is the point — it's what exercises both shapes of the log form. Sorting, Testing, Maintenance, Quality Issue, Idle and Ready are deliberately manual: the last four are machine *states*, where a speed number would be meaningless.

---

## 15. File map for this work

```
supabase/migrations/{0003…0012}_*.sql
scripts/{seed-super-admin.mjs,seed-factory-setup.mjs}

src/app/
├─ providers.tsx                      → QueryClientProvider
├─ admin/{actions.ts,schemas.ts}      → create/deleteFactory + schemas
└─ factory/[slug]/
   ├─ layout.tsx, loading.tsx, page.tsx
   ├─ {actions.ts,schemas.ts}         → completeOnboarding + unit presets
   ├─ log/{page.tsx,loading.tsx,schemas.ts}
   ├─ data/{page.tsx,loading.tsx}     → the shift-log data table
   └─ admin/
      ├─ page.tsx, loading.tsx
      ├─ actions.ts                   → updateCompanySettings, updateShiftTimes
      ├─ employee-actions.ts          → add/import/invite/update/remove (service role)
      └─ schemas.ts                   → every Admin-tab schema (company, employee,
                                         product, shift times) + role/shift constants

src/components/
├─ admin/{create-factory-dialog.tsx,delete-factory-dialog.tsx}
└─ factory/
   ├─ factory-shell.tsx, factory-sidebar.tsx, page-skeleton.tsx
   ├─ onboarding-wizard.tsx, setup-pending.tsx
   ├─ admin/
   │  ├─ admin-workspace.tsx, admin-tabs.tsx   ← tab strip is shared with /log
   │  ├─ company-settings-form.tsx, setup-list-manager.tsx
   │  ├─ employees-panel.tsx, add-employee-form.tsx, employee-import-dialog.tsx
   │  ├─ products-panel.tsx, add-product-form.tsx
   │  └─ shift-times-form.tsx
   ├─ log/
   │  ├─ log-workspace.tsx               → tabs + two-column layout
   │  ├─ log-entry-form.tsx              → the adaptive form
   │  ├─ log-fields.tsx                  → Field / FieldRow / SectionTitle
   │  ├─ shift-banner.tsx, batch-autofill.tsx, operator-picker.tsx
   │  └─ activity-feed.tsx               → today's entries, date-pickable
   └─ data/
      ├─ data-table-workspace.tsx        → filter/sort/page state + export
      ├─ data-table-filters.tsx          → the filter bar (debounced search)
      ├─ data-table-stats.tsx            → totals for the filtered set
      ├─ shift-log-table.tsx             → sortable, sticky-header table
      ├─ table-pagination.tsx            → page window + rows-per-page
      └─ amend-entry-dialog.tsx          → shared with the log's activity feed

src/lib/
├─ email/{transport.ts,factory-invite.ts}
└─ factory/{context.ts,nav.ts,admin-tabs.ts,log-tabs.ts,setup-queries.ts,
            employee-queries.ts,employee-csv.ts,product-queries.ts,
            shift-time-queries.ts,shift-log-queries.ts,
            shift-log-table-queries.ts,shift-log-csv.ts}

docs/samples/{employees-sample.csv,employees-sample-messy.csv}
```

---

## 16. Related docs

- `docs/PROGRESS.md` — running record of what's built and how to run it.
- `docs/ARCHITECTURE_FLOW.md` — product scope, role hierarchy, shift-based data model, build order.
- `CLAUDE.md` — repo conventions (component structure, forms, database workflow).
