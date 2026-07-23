# FactoryOS — Architecture & Flow

> Context document for what we've decided so far. Living doc — update as decisions get made.

## What FactoryOS is

A **multi-tenant SaaS platform** for factory / manufacturing operations management. Each factory is an isolated tenant. The full product is designed in the prototype at `factoryos_v8_final.html` (a ~4,100-line single-file HTML mockup using `localStorage`). We are rebuilding it as a real, production Next.js full-stack app.

The prototype itself is **single-factory** — it opens on a "Start your shift" login (Operator / Supervisor / Manager) and a quick onboarding screen. The multi-tenant layer (Super Admin, Factory tenant, invitations) is **our addition** on top of it, not present in the mockup.

**Goal:** Real production app · Real database from the start · Built phase-by-phase, reviewed at each step.

## Tech stack

| Layer | Choice | Status |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 | ✅ scaffolded |
| UI | shadcn/ui + Tailwind v4 | ✅ scaffolded |
| Toasts | sonner | ✅ installed |
| Database | Postgres (Neon via Vercel Marketplace) | ⏳ to provision |
| ORM | TBD (Drizzle or Prisma) | ⏳ decide |
| Auth | TBD — likely Clerk (native Vercel, RBAC, invites) | ⏳ decide |
| Deployment | Vercel | ⏳ later |

## Role hierarchy

```
SUPER ADMIN (platform owner — us)
   │  creates factories, creates each factory's first Admin
   ▼
FACTORY (tenant) ← all data isolated per factory
   │
   ADMIN (factory owner) ← runs onboarding, invites users
   │
   ├─ MANAGER      ┐
   ├─ SUPERVISOR   ├─ the 3 operational roles from the prototype
   └─ OPERATOR     ┘
```

Two tiers of admin:
- **Super Admin** — platform-level, sees ALL factories.
- **Factory Admin** — tenant-level, sees only their own factory.

Manager / Supervisor / Operator all live *inside* a single factory. These are **access/permission roles** (what a person can see and do in the app).

Note: employee records in the prototype also carry a **workforce job title** (e.g. Operator, Team Leader) used for rostering — this is descriptive HR data and is separate from the access role above. The schema should treat them as distinct fields.

## Shift-based operating model (cross-cutting — new in v8)

Everything operational in v8 is scoped to a **shift on a date**, not just a factory. This is a core concept the schema must bake in from the start:

- Each factory defines **shift templates** — v8 ships **Morning** (06:45–15:15) and **Afternoon** (15:05–23:35), each with configurable start/end and two breaks. Configurable under **Admin → Shift times**.
- The UI has a global **shift toggle** (Morning/Afternoon) + **date navigation**; nearly every module filters by the selected shift+date.
- Metrics distinguish **per-shift** values from **accumulative totals across all shifts**.
- At shift end, a **handover report** is generated (OEE, log entries, open actions, quality flags) and saved to history for the incoming shift.

**Implication for the data model:** most operational tables need a `shift` + `date` (or a `shiftInstanceId`) alongside `factoryId`.

## Core flow (the sequence we agreed on)

1. **Super Admin logs in** → sees list of all factories + "Create Factory".
2. **Create Factory** → Super Admin enters factory details and creates that factory's **first Admin account**.
3. **Factory Admin logs in** → lands on **onboarding wizard** (define units, processes, products — ported from the prototype).
4. **Onboarding complete** → Admin invites users and assigns roles.
5. **Operational modules unlock** → scoped to that factory.

## Build order

| Step | What | Rationale |
|---|---|---|
| **0** | Auth + database + tenant model (`Factory`, `User` with `factoryId` + `role`) | Foundation everything hangs off; hardest to retrofit |
| **1** | Super Admin dashboard — CRUD factories, create factory admins | Platform entry point |
| **2** | Factory onboarding wizard (port from prototype) | Admin's first experience |
| **3** | User invitations + role assignment | Populate a factory |
| **4** | Operational modules, one at a time | Actual product value |

## Operational modules (from the prototype, built in Step 4+)

Scoped per factory, gated by role:

Sidebar groups in v8: **Production** (Dashboard, Pipeline, Shift log) · **Accountability** (Actions) · **Analytics** (OEE & Downtime, Quality, Trends) · **Setup** (Admin & Settings).

| Module | Roles | Notes |
|---|---|---|
| Dashboard | Supervisor, Manager | Shift KPIs, shift timeline (Gantt), at-risk items, actions summary |
| Pipeline | All | Production units grid + Kanban + Gantt scheduling |
| Shift log | All | **Tabbed:** Log Entry · **Roster** · CI Ideas. Entry supports per-shift + accumulative totals |
| ↳ Roster (Shift log tab) | All | **Shift attendance check-in** — tap each employee to set status; auto-saves per shift |
| Actions | Supervisor, Manager | Task/issue tracking, priority + auto-escalation (overdue → escalated after N hours) |
| OEE & Downtime | Supervisor, Manager | Overall Equipment Effectiveness, per-shift |
| Quality | Supervisor, Manager | Defect/issue tracking; issues logged in shift log auto-create actions |
| Trends | Manager | Analytics over time (OEE per shift, units vs target, issues per shift) |
| Shift handover | Supervisor, Manager | Generate + save end-of-shift handover report; handover history |
| Admin & Settings | Admin, Manager | **Tabbed:** Company · Units · Processes · Products · **Employees** · **Shift times** |

**Core data entities:** factories, users, **shift templates / shift instances**, units, products, processes, log items, actions, CI (continuous-improvement) ideas, OEE/downtime records, quality defects, **employees**, **attendance records**, **handover reports**.

## Open decisions (to resolve before schema design)

1. **Data isolation** — Proposed: shared DB, every table has `factoryId`, all queries filter by it (row-level isolation). _Recommended._ → **PENDING CONFIRM**
2. **Super Admin** — One seeded account, or support multiple platform admins later? → **PENDING**
3. **User onboarding** — Email invites (needs email service) vs. manual account creation with temp passwords? → **PENDING**
4. **User ↔ Factory** — One factory per user (simple) vs. many-to-many (a person in multiple factories)? → **PENDING**
5. **Auth provider** — Clerk (recommended) vs. custom/self-hosted auth? → **PENDING**

## Reference

- Design prototype: `C:\Users\Dell\Downloads\factoryos_v8_final.html` (~4,100 lines, not in repo). Supersedes `factoryos_v7.html`.
- Prototype `localStorage` keys:
  - `fos_cfg` — company/site config, unit label, **`shiftTimes`** (morning/afternoon start·end·breaks)
  - `fos_prods` — products / batches
  - `fos_log` — shift log entries
  - `fos_actions` — actions / issues
  - `fos_ci` — continuous-improvement ideas
  - `fos_employees` — employee database (name, workforce role, default shift) — **new in v8**
  - `fos_attendance` — per-shift attendance check-in state — **new in v8**
  - `fos_handovers` — saved shift-handover reports — **new in v8**

---

_Last updated: 2026-07-23 (synced to prototype `factoryos_v8_final.html`)_
