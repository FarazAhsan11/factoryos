import { createClient } from "@/lib/supabase/client";

/**
 * A case's audit trail (migration 0066) — written by the database's triggers,
 * read here. Every change: who, when, what, before and after.
 */

export type AuditAction =
  | "raised"
  | "changed"
  | "assessment_signed"
  | "investigation_submitted"
  | "investigation_approved"
  | "investigation_returned"
  | "closeout_first_signed"
  | "closed"
  | "file_attached"
  | "file_removed"
  | "hold_placed"
  | "quarantine_placed"
  | "lot_released"
  | "lot_rejected"
  | "hold_restored"
  | "disposition_signed"
  | "disposition_reopened"
  | "converted"
  | "batch_released"
  | "batch_rejected"
  | "extension_requested"
  | "extension_approved"
  | "extension_rejected"
  | "capa_plan_approved"
  | "capa_effective"
  | "capa_not_effective"
  | "correction_added"
  | "correction_removed"
  | "capa_withdrawn";

export interface AuditEntry {
  id: number;
  at: string;
  actor: string | null;
  actor_name: string | null;
  action: AuditAction;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
}

/** Under the deviations prefix, so every Quality save refreshes it. */
export const auditKeys = {
  forCase: (factoryId: string, deviationId: string) =>
    ["deviations", factoryId, "audit", deviationId] as const,
};

export async function fetchAudit(deviationId: string): Promise<AuditEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_audit")
    .select("id, at, actor, actor_name, action, field, old_value, new_value, reason")
    .eq("deviation_id", deviationId)
    .order("at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEntry[];
}

/** How a column's stored text is shown. */
export type FieldKind =
  | "text"
  | "long"
  | "bool"
  | "date"
  | "datetime"
  | "money"
  | "department"
  | "capa"
  | "priority"
  | "disposition"
  | "cases"
  | "checks"
  | "mono"
  /** An NCR's qms-v12 disposition, concession and customer notification (0077). */
  | "ncrDisposition"
  | "concession"
  | "customerNotify";

/** Each column a person can change, as the screens label it. */
export const FIELD_LABELS: Record<string, { label: string; kind: FieldKind }> = {
  title: { label: "Title", kind: "text" },
  occurred_at: { label: "When it happened", kind: "datetime" },
  department_id: { label: "Department", kind: "department" },
  location: { label: "Location", kind: "text" },
  detection_point: { label: "Detected at", kind: "text" },
  batch_nos: { label: "Batches", kind: "mono" },
  batch_no: { label: "Batch", kind: "mono" },
  actual: { label: "What happened", kind: "long" },
  immediate_action: { label: "Immediate action", kind: "long" },
  immediate_action_date: { label: "Immediate action date", kind: "date" },
  hold_batch: { label: "Batch on hold", kind: "bool" },
  equipment_no: { label: "Equipment", kind: "mono" },
  procedure_name: { label: "Procedure name", kind: "text" },
  sop_number: { label: "Reference document / SOP", kind: "mono" },
  document_number: { label: "Document number", kind: "mono" },
  raised_by: { label: "Raised by", kind: "text" },
  supervisor_name: { label: "Supervisor", kind: "text" },
  qa_reviewer: { label: "QA reviewer", kind: "text" },
  origin: { label: "Origin", kind: "text" },
  customer_name: { label: "Customer", kind: "text" },
  customer_other: { label: "Customer others", kind: "text" },
  supplier_name: { label: "Supplier", kind: "text" },
  raw_material_code: { label: "Raw material code", kind: "mono" },
  raw_material_name: { label: "Raw material name", kind: "text" },
  packaging_material_code: { label: "Packaging material code", kind: "mono" },
  specification: { label: "Specification", kind: "long" },
  disposition: { label: "Disposition", kind: "disposition" },
  received_via: { label: "Received via", kind: "text" },
  adverse_reaction: { label: "Adverse reaction reported", kind: "bool" },
  action_id: { label: "Linked issue", kind: "mono" },

  // Assessment
  nc_category: { label: "Category / defect type", kind: "text" },
  owner_name: { label: "Case owner", kind: "text" },
  investigation_required: { label: "Investigation required", kind: "bool" },
  investigation_not_required_reason: {
    label: "Why no investigation",
    kind: "long",
  },
  red_flags: { label: "Red flags", kind: "text" },
  severity: { label: "Severity", kind: "text" },
  detection: { label: "Detection (control)", kind: "text" },
  likelihood: { label: "Likelihood", kind: "text" },
  previous_case_ids: { label: "Previous cases (likelihood evidence)", kind: "cases" },
  no_previous_found_at: {
    label: "Searched records — no previous case found",
    kind: "datetime",
  },
  no_previous_found_by_name: { label: "No previous case found — by", kind: "text" },
  previous_cases_external: {
    label: "Previous cases outside FactoryOS",
    kind: "text",
  },
  financial_impact: { label: "Financial impact", kind: "bool" },
  classification: { label: "Classification", kind: "text" },
  classification_reason: { label: "Why this class", kind: "long" },
  risk_description: { label: "Rationale", kind: "long" },
  priority: { label: "Priority", kind: "priority" },
  sla_date: { label: "Due date", kind: "date" },

  // Investigation
  other_batch_nos: { label: "Other batches affected", kind: "mono" },
  impact: { label: "Product impact assessment", kind: "long" },
  checks_reviewed: { label: "What was reviewed", kind: "text" },
  review_checks: { label: "What was reviewed", kind: "checks" },
  investigation_findings: { label: "Findings", kind: "long" },
  root_cause_categories: { label: "Root cause categories", kind: "text" },
  root_cause_category: { label: "Root cause category", kind: "text" },
  human_procedure_clear: { label: "Procedure clear and correct", kind: "bool" },
  human_trained: { label: "Person trained and assessed", kind: "bool" },
  human_preventable: {
    label: "Process could have prevented it",
    kind: "bool",
  },
  root_cause: { label: "Root cause", kind: "long" },
  root_cause_conclusion: { label: "Root cause conclusion", kind: "text" },
  rca_method: { label: "Analysis tool", kind: "text" },

  // Actions
  capa_needed: { label: "CAPA needed", kind: "bool" },
  capa_not_needed_reason: { label: "Correction / why no CAPA", kind: "long" },
  capa_id: { label: "Linked CAPA", kind: "capa" },
  ca_owner: { label: "CA owner", kind: "text" },
  ca_target_date: { label: "CA target date", kind: "date" },
  ca_closed_date: { label: "CA closed date", kind: "date" },
  ca_closed_by_name: { label: "CA closed by", kind: "text" },
  ca_description: { label: "Corrective action", kind: "long" },
  pa_owner: { label: "PA owner", kind: "text" },
  pa_target_date: { label: "PA target date", kind: "date" },
  pa_closed_date: { label: "PA closed date", kind: "date" },
  pa_closed_by_name: { label: "PA closed by", kind: "text" },
  pa_description: { label: "Preventive action", kind: "long" },

  // A non-conformance (0076, 0077)
  category_other: { label: "Defect (other), described", kind: "text" },
  lab_check: { label: "Lab error ruled out?", kind: "text" },
  lab_ref: { label: "Lab investigation reference", kind: "mono" },
  ncr_disposition: { label: "Disposition", kind: "ncrDisposition" },
  concession_scope: { label: "Scope of the concession", kind: "long" },
  disposition_reason: { label: "Why it can be used as is", kind: "long" },
  concession: { label: "Customer concession", kind: "concession" },
  concession_ref: { label: "Concession reference", kind: "text" },
  sort_ref: { label: "Sorting record", kind: "text" },
  sort_accepted: { label: "Quantity accepted", kind: "text" },
  sort_rejected: { label: "Quantity rejected", kind: "text" },
  rework_instruction: { label: "Rework instruction", kind: "text" },
  retest_result: { label: "Re-test result", kind: "text" },
  destruction_ref: { label: "Destruction record", kind: "text" },
  return_ref: { label: "Return note / RMA", kind: "text" },
  supplier_notified_on: { label: "Supplier notified on", kind: "date" },
  supplier_claim: { label: "Supplier claim or credit", kind: "text" },
  scar_requested: { label: "Corrective action requested (SCAR)", kind: "bool" },
  scar_not_reason: { label: "Why no corrective action request", kind: "long" },
  scar_ref: { label: "SCAR reference", kind: "mono" },
  scar_due: { label: "Supplier reply due", kind: "date" },
  scar_reply_on: { label: "Supplier reply received on", kind: "date" },
  scar_accepted: { label: "Supplier's root cause and fix accepted", kind: "bool" },
  tightened_inspection: { label: "Tightened inspection", kind: "bool" },
  tightened_lots: { label: "Tightened inspection — lots", kind: "text" },
  customer_notify: { label: "Customer (brand owner) notified", kind: "customerNotify" },
  customer_notified_on: { label: "Customer notified on", kind: "date" },
  customer_notify_reason: { label: "Why the customer is not notified", kind: "long" },

  // Close-out
  unresolved_risk: { label: "Unresolved product or patient risk", kind: "bool" },
  closing_note: { label: "Close-out summary", kind: "long" },
  status_reason: { label: "Reason for closing", kind: "text" },
  duplicate_of: { label: "Duplicate of", kind: "mono" },
  cost_of_quality: { label: "Cost of quality", kind: "money" },
  co_owner: { label: "CO owner", kind: "text" },
  co_target_date: { label: "CO target date", kind: "date" },
};

/** A column the map doesn't know: "root_cause" → "Root cause". */
export function fieldMeta(field: string | null): { label: string; kind: FieldKind } {
  if (!field) return { label: "", kind: "text" };
  return (
    FIELD_LABELS[field] ?? {
      label: field.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      kind: "text",
    }
  );
}

export const SECTION_LABELS: Record<string, string> = {
  details: "Details",
  assessment: "Assessment",
  investigation: "Investigation",
  actions: "Actions",
  closeout: "Close-out",
  disposition: "Disposition",
};
