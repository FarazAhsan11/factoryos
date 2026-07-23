# FactoryOS — Architecture & Flow

> Context document for what we've decided so far. Living doc — update as decisions get made.

## What FactoryOS is

A **multi-tenant SaaS platform** for factory / manufacturing operations management. Each factory is an isolated tenant. The full product is designed in the prototype at `factoryos_v7.html` (a ~3,000-line single-file HTML mockup using `localStorage`). We are rebuilding it as a real, production Next.js full-stack app.

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

Manager / Supervisor / Operator all live *inside* a single factory.

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

| Module | Roles | Notes |
|---|---|---|
| Dashboard | Supervisor, Manager | KPIs, at-risk items, actions summary |
| Pipeline | All | Production units grid + Kanban + Gantt scheduling |
| Shift log | All | Event feed / timeline logging |
| Actions | Supervisor, Manager | Task/issue tracking, priority + escalation |
| OEE & Downtime | Supervisor, Manager | Overall Equipment Effectiveness metrics |
| Quality | Supervisor, Manager | Defect tracking |
| Trends | Manager | Analytics over time |
| Admin & Settings | Admin, Manager | Manage units, processes, products |

**Core data entities:** factories, users, units, products, processes, log items, actions, CI (continuous-improvement) ideas, OEE/downtime records, quality defects, roster.

## Open decisions (to resolve before schema design)

1. **Data isolation** — Proposed: shared DB, every table has `factoryId`, all queries filter by it (row-level isolation). _Recommended._ → **PENDING CONFIRM**
2. **Super Admin** — One seeded account, or support multiple platform admins later? → **PENDING**
3. **User onboarding** — Email invites (needs email service) vs. manual account creation with temp passwords? → **PENDING**
4. **User ↔ Factory** — One factory per user (simple) vs. many-to-many (a person in multiple factories)? → **PENDING**
5. **Auth provider** — Clerk (recommended) vs. custom/self-hosted auth? → **PENDING**

## Reference

- Design prototype: `C:\Users\Dell\Downloads\factoryos_v7.html` (not in repo)
- Prototype uses `localStorage` keys: `fos_cfg`, `fos_prods`, `fos_log`, `fos_actions`, `fos_ci`

---

_Last updated: 2026-07-23_
