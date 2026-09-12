import type { AdminTab } from "@/lib/factory/admin-tabs";

/**
 * Sub-tab config for Resources — the two registers the rest of the plant
 * names things from: the machines and the people. Same shape as ADMIN_TABS
 * and rendered by the same strip; kept in a plain module (no "use client") so
 * the server page and the client workspace both read the real array rather
 * than a reference across the boundary.
 *
 * Products was the third tab; it is its own page now, under Pipeline, and
 * `?tab=products` is redirected there by the Resources page.
 */
export const RESOURCE_TABS: AdminTab[] = [
  { value: "equipment", label: "Equipment", ready: true },
  { value: "employees", label: "Employees", ready: true },
];

/** Falls back to Equipment for an unknown, unbuilt, or missing ?tab=. */
export function resolveResourceTab(tab: string | undefined): string {
  return (
    RESOURCE_TABS.find((t) => t.value === tab && t.ready)?.value ?? "equipment"
  );
}
