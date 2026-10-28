import type { AdminTab } from "@/lib/factory/admin-tabs";

/**
 * Sub-tab config for Resources — the two registers the rest of the plant
 * names things from: the machines and the people who work them. Same shape as
 * ADMIN_TABS; kept in a plain module (no "use client") so the server page and
 * the client workspace both read the real array rather than a reference
 * across the boundary.
 *
 * Products was the third tab; it is its own page now, under Pipeline, and
 * `?tab=products` is redirected there by the Resources page. `employees` was
 * the logins, which are Configuration → Users now (`?tab=employees` redirects
 * there); the people are `workforce` — `factory_workers`, migration 0053.
 */
export const RESOURCE_TABS: AdminTab[] = [
  { value: "equipment", label: "Equipment", ready: true },
  { value: "workforce", label: "Workforce", ready: true },
];

/** Falls back to Equipment for an unknown, unbuilt, or missing ?tab=. */
export function resolveResourceTab(tab: string | undefined): string {
  return (
    RESOURCE_TABS.find((t) => t.value === tab && t.ready)?.value ?? "equipment"
  );
}
