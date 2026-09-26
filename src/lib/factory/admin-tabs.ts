export interface AdminTab {
  value: string;
  label: string;
  /** False until the section is built; rendered disabled. */
  ready: boolean;
}

/**
 * Configuration's sections — chosen in the rail (Plant setup → Configuration),
 * checked against this array when read from `?tab=`. Lives in a plain module (no "use client") so the
 * server page and the client workspace can both read the real array — values
 * exported from a client module cross the boundary as references, not data.
 */
export const ADMIN_TABS: AdminTab[] = [
  { value: "company", label: "Company", ready: true },
  { value: "units", label: "Units", ready: true },
  { value: "processes", label: "Processes", ready: true },
  { value: "departments", label: "Departments", ready: true },
  { value: "shift-times", label: "Shift times", ready: true },
];

/** Falls back to Company for an unknown, unbuilt, or missing ?tab=. */
export function resolveAdminTab(tab: string | undefined): string {
  return ADMIN_TABS.find((t) => t.value === tab && t.ready)?.value ?? "company";
}
