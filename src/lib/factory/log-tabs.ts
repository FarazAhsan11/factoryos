import type { AdminTab } from "@/lib/factory/admin-tabs";

/**
 * Shift-log sub-tabs. Plain module (no "use client") for the same reason as
 * `admin-tabs.ts`: the server page resolves `?tab=` from this array, and a
 * value exported from a client module would reach it as a reference.
 *
 * The second tab is the Shift report — what the shift's entries add up to,
 * one click from the screen that files them. Kaizen, which used to sit here,
 * is its own page under Analytics: an improvement idea is not something
 * anyone has while filing a downtime record.
 */
export const LOG_TABS: AdminTab[] = [
  { value: "entry", label: "Log entry", ready: true },
  { value: "report", label: "Shift report", ready: true },
];

/**
 * The tabs this role may see. The report is the handover document — every
 * room side by side rather than the operator's own entries — so it is
 * supervisor and up, exactly as it was when it had its own nav item.
 */
export function logTabsFor(canReview: boolean): AdminTab[] {
  return canReview ? LOG_TABS : LOG_TABS.filter((t) => t.value !== "report");
}

/** Falls back to Log entry for an unknown, unbuilt, or missing ?tab=. */
export function resolveLogTab(tab: string | undefined, canReview = true) {
  return logTabsFor(canReview).find((t) => t.value === tab && t.ready)?.value ??
    "entry";
}

/**
 * The two ways the Log entry tab can be filled in.
 *
 * **Form** is one entry at a time, every field labelled — the right shape for
 * an operator in one room. **Grid** is every room at once, one line each — the
 * right shape for whoever is catching up the whole floor after a round.
 * Both write the same record through the same schema; only the layout differs.
 */
export const LOG_VIEWS = [
  { value: "form", label: "Form" },
  { value: "grid", label: "Grid" },
] as const;

export type LogView = (typeof LOG_VIEWS)[number]["value"];

/** Falls back to the form for an unknown or missing ?view=. */
export function resolveLogView(view: string | undefined): LogView {
  return LOG_VIEWS.find((v) => v.value === view)?.value ?? "form";
}
