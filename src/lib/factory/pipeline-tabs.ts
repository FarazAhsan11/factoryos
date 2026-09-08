import type { AdminTab } from "@/lib/factory/admin-tabs";

/**
 * Pipeline sub-tabs. Plain module (no "use client") for the same reason as
 * `admin-tabs.ts` and `log-tabs.ts`: the server page resolves `?tab=` from
 * this array, and a value exported from a client module would reach it as a
 * reference rather than data.
 *
 * The unready tabs are listed rather than omitted so the shape of the module
 * is visible on screen — the same choice the sidebar makes in `nav.ts`.
 */
export const PIPELINE_TABS: AdminTab[] = [
  { value: "board", label: "Kanban board", ready: true },
  { value: "schedule", label: "Schedule", ready: true },
  { value: "families", label: "Batch families", ready: true },
  { value: "gantt", label: "Gantt", ready: false },
  { value: "archive", label: "Archive", ready: false },
];

/** Falls back to the board for an unknown, unbuilt, or missing ?tab=. */
export function resolvePipelineTab(tab: string | undefined): string {
  return (
    PIPELINE_TABS.find((t) => t.value === tab && t.ready)?.value ?? "board"
  );
}
