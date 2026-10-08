---
paths:
  - "src/lib/factory/nav*.ts"
  - "src/components/factory/sidebar-context.tsx"
  - "src/components/factory/navigation-frame.tsx"
  - "src/components/factory/page-skeleton.tsx"
  - "src/app/**/loading.tsx"
  - "src/components/factory/**/*tabs*.tsx"
---

# Navigation and perceived speed

- **The rail switches screens of an open page with `history.pushState`** — no round trip, nothing remounted, so half-filled forms survive. The workspace reads the tab with `useSearchParams` and its `resolve…Tab()`.
- **Rail clicks don't wait for the server.** `navigate()` in `sidebar-context.tsx` runs the push in a transition. While pending, the rail highlights the destination and `NavigationFrame` (inside `<main>`) hides the old page and draws the destination's skeleton. A new module needs a case in `NavigationFrame`'s switch, or it falls back to the generic skeleton.
- **Sidebar hover warms React Query:** `prefetchModule` in `src/lib/factory/nav-prefetch.ts` loads a module's lists with the page's own keys and fetchers. Add a new module's queries there, keyed by the full href. Leave out anything whose page `queryFn` has a side effect (the pipeline board promotes scheduled batches).
- **The client router cache holds a visited page for 30s** (`experimental.staleTimes.dynamic`). A Server Action that changes what a page's server payload holds must `revalidatePath`.
- **Tab strips switch in a transition:** `AdminTabs` and `LogViewToggle` use `useTransition` + `useOptimistic`, so the pill moves at once while the panel renders. Panels shown and hidden by class fade in with `animate-in fade-in-0`.
- **Each route's `loading.tsx` uses a skeleton shaped like its page** (`page-skeleton.tsx`), so the swap doesn't jump — keep its width in step with the page's.
- **Pages that fill the workspace frame** (data table, customer orders) use `lg:flex lg:min-h-0 lg:flex-1 lg:flex-col` down to the scroll box, so the table scrolls inside one box with a sticky header and a pager below it.
