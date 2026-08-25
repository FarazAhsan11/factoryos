import type {
  MaintenanceAssignValues,
  MaintenanceQaValues,
  MaintenanceWorkValues,
} from "@/app/factory/[slug]/maintenance/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Maintenance requests — the whole Breakdown Maintenance Request.
 *
 * Three sections on the paper form, five statuses underneath (0024 declared
 * them, 0029 made them reachable), and four gates between them. Every write
 * that moves a request sends the new status together with the evidence that
 * gate demands, because `maintenance_stage_transition` reads them together.
 *
 * Browser-direct under RLS, like every other tenant write. Two things the
 * client never sends: the request number, stamped by a trigger so it cannot
 * be chosen or duplicated, and the timestamps against each signature.
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

/** The five statuses in the order the trigger walks them. */
export const MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "reported",
  "assigned",
  "in_progress",
  "completed",
  "verified",
];

/**
 * What each status is *called on screen*, which is not what it is called in
 * the enum.
 *
 * `completed` in the database means "Section 2 is signed" — the fitter is
 * done, QA has not looked at it. On a row that read as finished, and people
 * stopped chasing requests that still needed a review. So it says what it is
 * waiting for instead.
 *
 * `verified` is the end of the document, and "Verified" is a QA word for a
 * state everyone else calls done. The enum keeps its name because the trigger
 * and the migrations are written in it; the label does not have to.
 */
export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  reported: "Reported",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Awaiting QA",
  verified: "Completed",
};

export const STATUS_PILL: Record<MaintenanceStatus, string> = {
  reported: "bg-[#FEF3C7] text-[#B45309]",
  assigned: "bg-[#DBEAFE] text-[#1D4ED8]",
  in_progress: "bg-[#E0E7FF] text-[#4338CA]",
  completed: "bg-[#CFFAFE] text-[#0E7490]",
  verified: "bg-[#DCFCE7] text-[#15803D]",
};

/**
 * Which of the paper form's three sections a status is sitting in.
 *
 * The sections are phases of one document, not departments with logins —
 * FactoryOS has no engineer or QA role, and the migration says why. This is
 * the map the tabs are drawn from.
 */
export type MaintenancePhase = "initiation" | "engineering" | "qa";

export const PHASE_OF: Record<MaintenanceStatus, MaintenancePhase> = {
  reported: "initiation",
  assigned: "engineering",
  in_progress: "engineering",
  completed: "qa",
  verified: "qa",
};

export const MAINTENANCE_PHASES: MaintenancePhase[] = [
  "initiation",
  "engineering",
  "qa",
];

export const PHASE_LABELS: Record<MaintenancePhase, string> = {
  initiation: "Initiation",
  engineering: "Engineering",
  qa: "QA review",
};

/**
 * The tray, as chips.
 *
 * Nearly the three sections — except the last one splits. A request whose
 * work is signed and a request QA has finished with are both "in Section 3",
 * and filing them together makes the chip useless: the finished ones pile up
 * forever and bury the one that is actually waiting for a review. So the
 * question each chip answers is *who is holding it*, and nobody is holding a
 * finished request.
 *
 * `match` reads the status rather than the phase for that reason — a filter
 * is a different question from a tab, and `PHASE_OF` still answers the tab's.
 */
export const MAINTENANCE_FILTERS: {
  key: string;
  label: string;
  hint: string;
  match: (status: MaintenanceStatus) => boolean;
}[] = [
  {
    key: "initiation",
    label: "Initiation",
    hint: "Raised, waiting for someone to take it",
    match: (s) => s === "reported",
  },
  {
    key: "engineering",
    label: "Engineering",
    hint: "Assigned, or the work is under way",
    match: (s) => s === "assigned" || s === "in_progress",
  },
  {
    key: "qa",
    label: "QA review",
    hint: "Work signed off — waiting on QA",
    match: (s) => s === "completed",
  },
  {
    key: "done",
    label: "Completed",
    hint: "QA has reviewed it; the request is closed out",
    match: (s) => s === "verified",
  },
];

export interface MaintenanceRequest {
  id: string;
  request_no: string;
  equipment_no: string;
  /** From the machine register, when the typed number matched one. */
  equipment_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  /** The department needed to do the work. */
  department_id: string | null;
  department_name: string | null;
  /** The department that raised it — "Production" on the paper form. */
  initiating_department_id: string | null;
  initiating_department_name: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  description: string;
  /** What was typed, kept even when it matched no product in the catalogue. */
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  reported_by: string | null;
  created_at: string;

  /* ── Section 2 · Engineering ───────────────────────────────────────── */
  assigned_to: string | null;
  assigned_at: string | null;
  work_started_at: string | null;
  work_details: string | null;
  cleaning_required: boolean | null;
  cleaning_note: string | null;
  production_review_required: boolean | null;
  production_review_by: string | null;
  production_review_at: string | null;
  completed_at: string | null;

  /* ── Section 3 · QA review ─────────────────────────────────────────── */
  change_control_required: boolean | null;
  change_control_no: string | null;
  deviation_raised: boolean | null;
  deviation_no: string | null;
  qa_remarks: string | null;
  qa_sign_name: string | null;
  verified_at: string | null;

  /* ── Computed by the view, never stored ────────────────────────────── */
  /** Tools-down to work-signed, in minutes. Null while the machine is off. */
  downtime_minutes: number | null;
  /** Raised to picked up, in minutes. Null while nobody has taken it. */
  response_minutes: number | null;
}

const COLUMNS = `
  id, request_no, equipment_no, equipment_name, unit_id, unit_name,
  department_id, department_name, initiating_department_id,
  initiating_department_name, priority, status, description,
  batch_no, product_id, product_name, product_code,
  reported_by, created_at,
  assigned_to, assigned_at, work_started_at, work_details,
  cleaning_required, cleaning_note,
  production_review_required, production_review_by, production_review_at,
  completed_at,
  change_control_required, change_control_no,
  deviation_raised, deviation_no, qa_remarks, qa_sign_name, verified_at,
  downtime_minutes, response_minutes
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
  initiatingDepartmentId: string;
  priority: MaintenancePriority;
  description: string;
  batchNo: string;
  reportedBy: string;
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
    initiating_department_id: values.initiatingDepartmentId || null,
    priority: values.priority,
    description: values.description.trim(),
    // Both are stored. The text is what someone will search for later and
    // survives a batch that was never added to the catalogue; the id is the
    // resolution when there is one, not a requirement.
    batch_no: values.batchNo.trim() || null,
    product_id: productId,
    reported_by: values.reportedBy.trim() || null,
    created_by: createdBy,
    // `request_no` is deliberately absent — the trigger stamps it.
    // So is `assigned_to`: naming the fitter is Section 2 on the paper form,
    // and here it is the price of the move out of Reported.
  });

  if (error) throw new Error(error.message);
}

/* ── Moving through the phases ────────────────────────────────────────── */
/**
 * Four writes, one per gate. Every one of them sends the new status *with*
 * the evidence that stage is named after, in a single update, because the
 * trigger reads them together: sending the status first and the evidence
 * after would be refused, and sending the evidence first would leave a
 * half-filled section if the second call never happened.
 *
 * None of them re-checks anything. `maintenance_stage_transition` is the
 * authority on what a move costs, and duplicating its rules here would only
 * produce two answers that drift apart.
 */

async function moveRequest(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/** Section 2 opens: a name on it, and the department that is needed. */
export function assignMaintenance(
  id: string,
  values: MaintenanceAssignValues
): Promise<void> {
  return moveRequest(id, {
    status: "assigned",
    assigned_to: values.assignedTo.trim(),
    department_id: values.departmentId,
  });
}

/** Tools down. The only move that costs nothing — and starts the clock. */
export function startMaintenanceWork(id: string): Promise<void> {
  return moveRequest(id, { status: "in_progress" });
}

/** Section 2 is signed. */
export function completeMaintenanceWork(
  id: string,
  values: MaintenanceWorkValues
): Promise<void> {
  const review = values.productionReviewRequired === "yes";
  return moveRequest(id, {
    status: "completed",
    work_details: values.workDetails.trim(),
    cleaning_required: values.cleaningRequired === "yes",
    cleaning_note: values.cleaningNote.trim() || null,
    production_review_required: review,
    // Sent as null when the answer is no; the trigger clears it either way,
    // and sending a stale name would be asking to be corrected.
    production_review_by: review ? values.productionReviewBy.trim() : null,
  });
}

/** Section 3 is signed, and the request is closed out. */
export function verifyMaintenance(
  id: string,
  values: MaintenanceQaValues
): Promise<void> {
  const change = values.changeControlRequired === "yes";
  const deviation = values.deviationRaised === "yes";
  return moveRequest(id, {
    status: "verified",
    change_control_required: change,
    change_control_no: change ? values.changeControlNo.trim() : null,
    deviation_raised: deviation,
    deviation_no: deviation ? values.deviationNo.trim() : null,
    qa_remarks: values.qaRemarks.trim() || null,
    qa_sign_name: values.qaSignName.trim(),
  });
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

/**
 * "8 Apr 2026, 05:20 pm" — with the year, because every signature on the
 * paper form carries a full date next to it and a record read a year later
 * has to say which April it means.
 */
export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "1h 42m" — minutes are how it is stored, hours are how it is read. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes < 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Minutes between an instant and now — the clock that is still running. */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
