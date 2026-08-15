import { createClient } from "@/lib/supabase/client";

/**
 * Maintenance requests — raising one.
 *
 * Only the raising half is built. `status` carries the whole vocabulary the
 * workflow will need (migration 0024), but nothing here moves a request past
 * `reported`, and no column is invented ahead of knowing what the work step
 * has to record.
 *
 * Browser-direct under RLS, like every other tenant write. The request number
 * is the one thing the client never sends — a trigger stamps it, so it can't
 * be chosen, skipped or duplicated.
 */

export type MaintenancePriority = "urgent" | "routine" | "planned";
export type MaintenanceStatus =
  | "reported"
  | "assigned"
  | "in_progress"
  | "completed"
  | "verified";

export const MAINTENANCE_PRIORITIES: {
  value: MaintenancePriority;
  label: string;
  hint: string;
  dot: string;
  pill: string;
}[] = [
  {
    value: "urgent",
    label: "Urgent",
    hint: "stop production",
    dot: "#DC2626",
    pill: "bg-[#FEE2E2] text-[#B91C1C]",
  },
  {
    value: "routine",
    label: "Routine",
    hint: "next available",
    dot: "#F59E0B",
    pill: "bg-[#FEF3C7] text-[#B45309]",
  },
  {
    value: "planned",
    label: "Planned",
    hint: "scheduled",
    dot: "#2563EB",
    pill: "bg-[#DBEAFE] text-[#1D4ED8]",
  },
];

export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  reported: "Reported",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  verified: "Verified",
};

export interface MaintenanceRequest {
  id: string;
  request_no: string;
  equipment_no: string;
  unit_id: string | null;
  unit_name: string | null;
  department_id: string | null;
  department_name: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  description: string;
  /** What was typed, kept even when it matched no product in the catalogue. */
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  created_at: string;
}

const COLUMNS = `
  id, request_no, equipment_no, unit_id, unit_name,
  department_id, department_name, priority, status, description,
  batch_no, product_id, product_name, product_code,
  reported_by, assigned_to, created_at
`;

export const maintenanceKeys = {
  all: (factoryId: string) => ["maintenance_requests", factoryId] as const,
};

/** Every request for the factory, newest first. */
export async function fetchMaintenanceRequests(
  factoryId: string
): Promise<MaintenanceRequest[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("maintenance_requests_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MaintenanceRequest[];
}

export interface NewMaintenanceValues {
  equipmentNo: string;
  unitId: string;
  departmentId: string;
  priority: MaintenancePriority;
  description: string;
  batchNo: string;
  reportedBy: string;
  assignedTo: string;
}

export async function createMaintenanceRequest(
  factoryId: string,
  values: NewMaintenanceValues,
  createdBy: string,
  /** Resolved from the typed batch number, or null when it matched nothing. */
  productId: string | null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("maintenance_requests").insert({
    factory_id: factoryId,
    equipment_no: values.equipmentNo.trim(),
    unit_id: values.unitId || null,
    department_id: values.departmentId || null,
    priority: values.priority,
    description: values.description.trim(),
    // Both are stored. The text is what someone will search for later and
    // survives a batch that was never added to the catalogue; the id is the
    // resolution when there is one, not a requirement.
    batch_no: values.batchNo.trim() || null,
    product_id: productId,
    reported_by: values.reportedBy.trim() || null,
    assigned_to: values.assignedTo.trim() || null,
    created_by: createdBy,
    // `request_no` is deliberately absent — the trigger stamps it.
  });

  if (error) throw new Error(error.message);
}

/* ── Display ──────────────────────────────────────────────────────────── */

export function priorityMeta(priority: MaintenancePriority) {
  return (
    MAINTENANCE_PRIORITIES.find((p) => p.value === priority) ??
    MAINTENANCE_PRIORITIES[1]
  );
}

/** "8 Aug, 06:46 pm" — the same format the rest of the workspace uses. */
export function formatRaised(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
