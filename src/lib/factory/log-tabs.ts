import type { AdminTab } from "@/lib/factory/admin-tabs";

/**
 * Shift-log sub-tabs. Plain module (no "use client") for the same reason as
 * `admin-tabs.ts`: the server page resolves `?tab=` from this array, and a
 * value exported from a client module would reach it as a reference.
 */
export const LOG_TABS: AdminTab[] = [
  { value: "entry", label: "Log entry", ready: true },
  { value: "roster", label: "Roster", ready: false },
  { value: "ci", label: "CI ideas", ready: false },
];

/** Falls back to Log entry for an unknown, unbuilt, or missing ?tab=. */
export function resolveLogTab(tab: string | undefined): string {
  return LOG_TABS.find((t) => t.value === tab && t.ready)?.value ?? "entry";
}
