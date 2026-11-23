import {
  parseBatches,
  type ActionPlanValues,
  type CloseOutValues,
  type ContainmentValues,
  type AssessmentValues,
  type ComplaintInitiationValues,
  type MarketActionValues,
  type DeviationInitiationValues,
  type DevCloseOutValues,
  type DevInvestigationValues,
  type InitiationValues,
  type InvestigationValues,
  type NcrCustomerValues,
  type NcrDispositionValues,
  type NcrInitiationValues,
  type NcrSupplierValues,
  type RiskValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type { ActionStage } from "@/lib/factory/action-queries";
import { complaintRequiredChecks } from "@/lib/factory/complaint";
import {
  NCR_DETECTION_POINTS,
  dispositionLabel,
  forcedInvestigation,
  isMaterialItem,
  isQmsCase,
  parseLots,
  partyWord,
  requiredChecks,
  type LabCheck,
  type NcItem,
  type NcrDispositionValue,
  type SuppliedBy,
} from "@/lib/factory/ncr";
import { createClient } from "@/lib/supabase/client";
import { regulatorOf, reportTriggered } from "@/lib/factory/complaint";

/**
 * Deviations & NCRs — the QMS case (migrations 0044, 0045).
 *
 * Seven tabs over one row. Each tab saves itself, so the register is filled
 * as the facts arrive; only the close-out is a gate, and the database owns
 * it. Browser-direct under RLS, like every other tenant write.
 *
 * Three things the client never sends: the case number (stamped by
 * `deviations_guard`, prefixed by type), the product id (resolved there from
 * the typed batch, so a quarantine can never miss its card), and the
 * timestamps against each signature.
 */

export type DeviationType = "planned" | "unplanned" | "ncr" | "complaint";
export type DeviationStatus = "open" | "closed";
export type NcrDisposition = "use_as_is" | "rework" | "reject" | "quarantine";
export type DeviationPriority = "critical" | "high" | "medium" | "low";
export type RiskConclusion = "Low" | "Medium" | "High";

export const DEVIATION_TYPES: {
  value: DeviationType;
  label: string;
  short: string;
  hint: string;
  spine: string;
  pill: string;
}[] = [
  {
    value: "planned",
    label: "Planned deviation",
    short: "Planned",
    hint: "Known change with QA approval",
    spine: "var(--color-brand)",
    pill: "bg-brand-soft text-brand-deep",
  },
  {
    value: "unplanned",
    label: "Unplanned deviation",
    short: "Unplanned",
    hint: "Unexpected departure from process",
    spine: "var(--color-warn)",
    pill: "bg-warn-soft text-warn-deep",
  },
  {
    value: "ncr",
    label: "NCR",
    short: "NCR",
    hint: "Non-conforming material / product",
    spine: "var(--color-danger)",
    pill: "bg-danger-soft text-danger-deep",
  },
  {
    value: "complaint",
    label: "Customer complaint",
    short: "Complaint",
    hint: "A complaint from a customer or the market",
    spine: "var(--color-teal)",
    pill: "bg-teal-soft text-teal-deep",
  },
];

export const DISPOSITIONS: {
  value: NcrDisposition;
  label: string;
  hint: string;
  pill: string;
}[] = [
  {
    value: "use_as_is",
    label: "Use as is",
    hint: "Within acceptance criteria",
    pill: "bg-teal-soft text-teal-deep",
  },
  {
    value: "rework",
    label: "Rework",
    hint: "Can be brought to spec",
    pill: "bg-brand-soft text-brand-deep",
  },
  {
    value: "reject",
    label: "Reject",
    hint: "Destroy / return to supplier",
    pill: "bg-danger-soft text-danger-deep",
  },
  {
    value: "quarantine",
    label: "Quarantine",
    hint: "Hold the batch pending QA review",
    pill: "bg-warn-soft text-warn-deep",
  },
];

export const PRIORITIES: {
  value: DeviationPriority;
  label: string;
  pill: string;
}[] = [
  { value: "critical", label: "Critical", pill: "bg-danger-soft text-danger-deep" },
  { value: "high", label: "High", pill: "bg-warn-soft text-warn-deep" },
  { value: "medium", label: "Medium", pill: "bg-brand-soft text-brand-deep" },
  { value: "low", label: "Low", pill: "bg-sunken-2 text-ink-4" },
];

/**
 * The risk scales, 1–5, each point described (migration 0058) — the
 * reference QMS's scales under this application's names for them.
 *
 * Every scale runs low risk → high risk. For detection that means 1 is "an
 * existing check always catches it" and 5 is "it would not be caught".
 */
export const RISK_SCALES: Record<
  "likelihood" | "severity" | "detection",
  { label: string; options: { value: string; label: string }[] }
> = {
  likelihood: {
    label: "Likelihood",
    options: [
      { value: "1", label: "1 — Not seen before" },
      { value: "2", label: "2 — Once in several years" },
      { value: "3", label: "3 — About once a year" },
      { value: "4", label: "4 — Several times a year" },
      { value: "5", label: "5 — Monthly or more" },
    ],
  },
  severity: {
    label: "Severity of impact",
    options: [
      { value: "1", label: "1 — No impact on quality" },
      { value: "2", label: "2 — Minor, no effect on safety or efficacy" },
      { value: "3", label: "3 — Out of specification but recoverable" },
      { value: "4", label: "4 — Could affect efficacy or cause a complaint" },
      { value: "5", label: "5 — Could harm a patient or trigger a recall" },
    ],
  },
  detection: {
    label: "Probability of detection",
    options: [
      { value: "1", label: "1 — Always caught by an existing check" },
      { value: "2", label: "2 — Very likely caught" },
      { value: "3", label: "3 — May be caught" },
      { value: "4", label: "4 — Unlikely to be caught" },
      { value: "5", label: "5 — Would not be caught" },
    ],
  },
};

/**
 * Score and conclusion — the same arithmetic as `deviations_expanded`
 * (0058), so the form and the register cannot disagree. Score = severity ×
 * likelihood × detection (1–125); 20+ is Medium, 60+ is High, and a severity
 * of 5 is High whatever the other two are.
 */
export function riskOf(
  likelihood: number | null,
  severity: number | null,
  detection: number | null,
): { score: number; conclusion: RiskConclusion } | null {
  if (likelihood === null || severity === null || detection === null) {
    return null;
  }
  const score = likelihood * severity * detection;
  const conclusion: RiskConclusion =
    severity === 5 || score >= 60 ? "High" : score >= 20 ? "Medium" : "Low";
  return { score, conclusion };
}

export const RISK_PILL: Record<RiskConclusion, string> = {
  Low: "bg-teal-soft text-teal-deep",
  Medium: "bg-warn-soft text-warn-deep",
  High: "bg-danger-soft text-danger-deep",
};

export const STATUS_LABELS: Record<DeviationStatus, string> = {
  open: "Open",
  closed: "Closed",
};

export const STATUS_PILL: Record<DeviationStatus, string> = {
  open: "bg-warn-soft text-warn-deep",
  closed: "bg-teal-soft text-teal-deep",
};

export interface Deviation {
  id: string;
  /** "DEV-2026-004" or "NCR-2026-001". */
  deviation_no: string;
  type: DeviationType;
  status: DeviationStatus;
  status_reason: string | null;
  priority: DeviationPriority;
  title: string;
  origin: string | null;
  sla_date: string | null;

  /* ── Tab 1 · Initiation and identification ─────────────────────────── */
  /** What was typed, kept even when it matched no product. */
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  customer_name: string | null;
  customer_other: string | null;
  supplier_name: string | null;
  owner_name: string | null;
  supervisor_name: string | null;
  procedure_name: string | null;
  sop_number: string | null;
  document_number: string | null;
  raw_material_code: string | null;
  raw_material_name: string | null;
  packaging_material_code: string | null;
  equipment_no: string | null;
  /** From the machine register, when the typed number matched one. */
  equipment_name: string | null;
  nc_category: string | null;
  specification: string | null;
  /** The event description — the paragraph under the title. */
  actual: string;
  impact: string | null;
  /** NCR only. */
  disposition: NcrDisposition | null;
  raised_by: string | null;
  qa_reviewer: string | null;

  /* ── Tab 2 · Immediate / containment action ────────────────────────── */
  immediate_action_date: string | null;
  immediate_action: string | null;

  /* ── Tab 3 · Risk assessment ───────────────────────────────────────── */
  likelihood: number | null;
  severity: number | null;
  detection: number | null;
  financial_impact: boolean | null;
  risk_description: string | null;
  risk_assessed_at: string | null;
  /** Likelihood × severity × detection, computed in the view. */
  risk_score: number | null;
  risk_conclusion: RiskConclusion | null;

  /* ── Tab 4 · Investigation ─────────────────────────────────────────── */
  investigation_findings: string | null;
  investigated_at: string | null;
  /** Man / Method / Material / Machine / Environment (0058). */
  root_cause_category: string | null;
  /** Root cause analysis, on the Investigation tab (0061). */
  root_cause: string | null;
  rca_method: string | null;

  /* ── Tabs 5 & 6 · Corrective and preventive action ─────────────────── */
  ca_owner: string | null;
  ca_target_date: string | null;
  ca_closed_date: string | null;
  ca_closed_by_name: string | null;
  ca_description: string | null;
  pa_owner: string | null;
  pa_target_date: string | null;
  pa_closed_date: string | null;
  pa_closed_by_name: string | null;
  pa_description: string | null;

  /* ── Tab 7 · Close out ─────────────────────────────────────────────── */
  co_owner: string | null;
  co_target_date: string | null;
  /** The close-out description. */
  closing_note: string | null;
  /** CO closed by. */
  qa_sign_name: string | null;
  closed_at: string | null;

  /**
   * The Issues & CAPA issue a case was linked to before the CAPA register
   * (0044). No longer offered on the form; kept so an old link survives.
   */
  action_id: string | null;
  action_title: string | null;
  action_status: ActionStage | null;

  created_at: string;

  /* ── Case aging, computed in the view ──────────────────────────────── */
  age_days: number;
  days_to_sla: number | null;
  is_overdue: boolean;
  /** An open quarantine NCR — what is holding its batch right now. */
  is_quarantining: boolean;

  /* ── Customer complaints (0057) ────────────────────────────────────── */
  received_via: string | null;
  /** Null is unanswered — the close-out refuses it on a complaint. */
  adverse_reaction: boolean | null;

  /* ── The CAPA decision (0057) ──────────────────────────────────────── */
  /** Null is undecided — the close-out refuses it. */
  capa_needed: boolean | null;
  capa_not_needed_reason: string | null;
  capa_id: string | null;
  capa_no: string | null;
  capa_status: "open" | "effective" | "withdrawn" | null;
  capa_verified_at: string | null;

  /* ── A deviation's initiation (0062) ───────────────────────────────── */
  occurred_at: string | null;
  department_id: string | null;
  department_name: string | null;
  location: string | null;
  /** "Detected at" — where it was found. */
  detection_point: string | null;
  /** Every batch on the case, in the order typed; `batch_no` is the first. */
  batch_nos: string[];
  product_ids: string[];
  /** The products those batches resolve to, without repeats. */
  product_names: string[];
  /** Deviations only. Null on older cases and every other type. */
  hold_batch: boolean | null;

  /* ── A deviation's initial assessment (0063) ───────────────────────── */
  investigation_required: boolean | null;
  investigation_not_required_reason: string | null;
  red_flags: string[];
  classification: "Critical" | "Major" | "Minor" | null;
  classification_reason: string | null;
  /** Signed when set. */
  assessed_at: string | null;
  assessed_by_name: string | null;

  /* ── A deviation's investigation (0064) ────────────────────────────── */
  other_batch_nos: string[];
  checks_reviewed: string[];
  root_cause_categories: string[];
  human_procedure_clear: boolean | null;
  human_trained: boolean | null;
  human_preventable: boolean | null;
  root_cause_conclusion: string | null;
  investigation_submitted_at: string | null;
  investigation_submitted_by_name: string | null;
  investigation_returned_at: string | null;
  investigation_returned_by_name: string | null;
  investigation_return_reason: string | null;
  investigation_approved_at: string | null;
  investigation_approved_by_name: string | null;

  /* ── A deviation's close-out (0065) ────────────────────────────────── */
  unresolved_risk: boolean | null;
  duplicate_of: string | null;
  cost_of_quality: number | null;
  /** A Critical case's first of two close-out signatures. */
  close_first_signed_at: string | null;
  close_first_signed_by_name: string | null;
  /** The likelihood's evidence (0068): previous cases of the same problem. */
  previous_case_ids: string[];
  /** "Searched records — no previous case found", when ticked. */
  no_previous_found_at: string | null;
  no_previous_found_by_name: string | null;
  /** Previous cases kept outside FactoryOS — an old system, a paper log. */
  previous_cases_external: string | null;
  /** A deviation's batch holds (0069): still on hold, and all of them. */
  holds_on_hold: number;
  holds_total: number;
  /** What the investigation reviewed, and what each showed (0070). */
  review_checks: { item: string; finding: string }[];
  /** When the linked CAPA's plan was approved — the case closes on it (0075). */
  capa_plan_approved_at: string | null;
  /** How many cases the linked CAPA covers, this one included (0075). */
  capa_case_count: number | null;

  /* ── A non-conformance's initiation (0076) ─────────────────────────── */
  /** What is non-conforming. Null on an NCR raised before 0076 (and on every other type). */
  nc_item: NcItem | null;
  nc_item_other: string | null;
  /** A material's: supplier, or our customer (client-supplied). */
  supplied_by: SuppliedBy | null;
  material_code: string | null;
  /** A material's supplier (or customer) lot numbers — each quarantined on its own row. */
  supplier_lots: string[];
  qty_affected: string | null;
  /** Why the lot was not quarantined / the batch not held. */
  hold_not_reason: string | null;

  /* ── A non-conformance's case (0077) ───────────────────────────────── */
  /** An NCR's "Other" defect type, described. */
  category_other: string | null;
  lab_check: LabCheck | null;
  lab_ref: string | null;
  ncr_disposition: NcrDispositionValue | null;
  concession_scope: string | null;
  disposition_reason: string | null;
  concession: "not_needed" | "customer" | null;
  concession_ref: string | null;
  sort_ref: string | null;
  sort_accepted: string | null;
  sort_rejected: string | null;
  rework_instruction: string | null;
  retest_result: "Pass" | "Fail" | null;
  /** Signed with `sign_ncr_disposition`; it releases or rejects the holds. */
  disposition_signed_at: string | null;
  disposition_signed_by_name: string | null;
  disposition_reopen_reason: string | null;
  destruction_ref: string | null;
  return_ref: string | null;
  supplier_notified_on: string | null;
  supplier_claim: string | null;
  scar_requested: boolean | null;
  scar_not_reason: string | null;
  scar_ref: string | null;
  scar_due: string | null;
  scar_reply_on: string | null;
  scar_accepted: boolean | null;
  tightened_inspection: boolean | null;
  tightened_lots: string | null;
  customer_notify: "yes" | "not_needed" | null;
  customer_notified_on: string | null;
  customer_notify_reason: string | null;
  /** Closed as not a non-conformance — why. */
  not_case_reason: string | null;

  /* ── A customer complaint (0079) ───────────────────────────────────── */
  /** Due dates, the sponsor notification and the acknowledgement count from it. */
  received_on: string | null;
  complainant: string | null;
  complainant_contact: string | null;
  country: string | null;
  /** The product, when the batch is unknown. */
  product_label: string | null;
  /** Who the sponsor is — asked on the complaint for now. */
  sponsor: "us" | "customer" | null;
  artg_no: string | null;
  expiry: string | null;
  adverse_what: string | null;
  adverse_serious: boolean | null;
  sample: "Received" | "Requested" | "Not available" | null;
  sample_received_on: string | null;
  ack_on: string | null;
  ack_by_name: string | null;
  ack_how: string | null;
  stock_affected: "No" | "Yes" | "Unknown" | null;
  sponsor_notified_on: string | null;
  reportable: boolean | null;
  report_reason: string | null;
  report_type: "Serious adverse reaction" | "Other report" | null;
  report_due: string | null;
  reported_on: string | null;
  report_ref: string | null;
  scope: "Isolated unit(s)" | "Whole batch" | "Other batches too" | null;
  market_action: string | null;
  market_why: string | null;
  recall_class: string | null;
  recall_level: string | null;
  recall_ref: string | null;
  final_reply: string | null;
  reply_sent_on: string | null;
  resolution: "None" | "Replacement" | "Credit or refund" | null;
}

const COLUMNS = `
  id, deviation_no, type, status, status_reason, priority, title, origin, sla_date,
  batch_no, product_id, product_name, product_code,
  customer_name, customer_other, supplier_name,
  owner_name, supervisor_name,
  procedure_name, sop_number, document_number,
  raw_material_code, raw_material_name, packaging_material_code,
  equipment_no, equipment_name, nc_category,
  specification, actual, impact, disposition, raised_by, qa_reviewer,
  immediate_action_date, immediate_action,
  likelihood, severity, detection, financial_impact, risk_description,
  risk_assessed_at, risk_score, risk_conclusion,
  investigation_findings, investigated_at,
  ca_owner, ca_target_date, ca_closed_date, ca_closed_by_name, ca_description,
  pa_owner, pa_target_date, pa_closed_date, pa_closed_by_name, pa_description,
  co_owner, co_target_date, closing_note, qa_sign_name, closed_at,
  action_id, action_title, action_status,
  created_at, age_days, days_to_sla, is_overdue, is_quarantining,
  received_via, adverse_reaction,
  capa_needed, capa_not_needed_reason, capa_id, capa_no, capa_status, capa_verified_at,
  root_cause_category, root_cause, rca_method,
  occurred_at, department_id, department_name, location, detection_point,
  batch_nos, product_ids, product_names, hold_batch,
  investigation_required, investigation_not_required_reason, red_flags,
  classification, classification_reason, assessed_at, assessed_by_name,
  other_batch_nos, checks_reviewed, root_cause_categories,
  human_procedure_clear, human_trained, human_preventable, root_cause_conclusion,
  investigation_submitted_at, investigation_submitted_by_name,
  investigation_returned_at, investigation_returned_by_name,
  investigation_return_reason, investigation_approved_at,
  investigation_approved_by_name,
  unresolved_risk, duplicate_of, cost_of_quality,
  close_first_signed_at, close_first_signed_by_name,
  previous_case_ids, no_previous_found_at, no_previous_found_by_name,
  previous_cases_external, holds_on_hold, holds_total, review_checks,
  capa_plan_approved_at, capa_case_count,
  nc_item, nc_item_other, supplied_by, material_code, supplier_lots,
  qty_affected, hold_not_reason,
  category_other, lab_check, lab_ref, ncr_disposition, concession_scope,
  disposition_reason, concession, concession_ref, sort_ref, sort_accepted,
  sort_rejected, rework_instruction, retest_result, disposition_signed_at,
  disposition_signed_by_name, disposition_reopen_reason, destruction_ref,
  return_ref, supplier_notified_on, supplier_claim, scar_requested,
  scar_not_reason, scar_ref, scar_due, scar_reply_on, scar_accepted,
  tightened_inspection, tightened_lots, customer_notify, customer_notified_on,
  customer_notify_reason, not_case_reason,
  received_on, complainant, complainant_contact, country, product_label,
  sponsor, artg_no, expiry, adverse_what, adverse_serious, sample,
  sample_received_on, ack_on, ack_by_name, ack_how, stock_affected,
  sponsor_notified_on, reportable, report_reason, report_type, report_due,
  reported_on, report_ref, scope, market_action, market_why, recall_class,
  recall_level, recall_ref, final_reply, reply_sent_on, resolution
`;

/**
 * Everything Quality caches sits under `["deviations", factoryId]` — the
 * cases, the CAPA register (`capaKeys`) and the rail's counts — so one
 * `invalidateQueries(deviationKeys.all(...))` after any save refreshes the
 * lot. A case save changes what a CAPA covers, and the reverse.
 */
export const deviationKeys = {
  all: (factoryId: string) => ["deviations", factoryId] as const,
  railCounts: (factoryId: string) =>
    ["deviations", factoryId, "rail-counts"] as const,
};

/** Every case for the factory, newest first. */
export async function fetchDeviations(factoryId: string): Promise<Deviation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Deviation[];
}

/** Open cases by screen, and open CAPAs — the numbers beside the rail links. */
export interface QualityCounts {
  deviations: number;
  ncr: number;
  complaints: number;
  capa: number;
}

/**
 * Two light reads rather than the register itself: the rail mounts on every
 * page, and the counts are all it needs.
 */
export async function fetchQualityCounts(
  factoryId: string,
): Promise<QualityCounts> {
  const supabase = createClient();
  const [cases, capas] = await Promise.all([
    supabase
      .from("deviations")
      .select("type")
      .eq("factory_id", factoryId)
      .eq("status", "open"),
    supabase
      .from("capas")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", factoryId)
      .eq("status", "open"),
  ]);
  if (cases.error) throw new Error(cases.error.message);
  if (capas.error) throw new Error(capas.error.message);

  const types = (cases.data ?? []) as { type: DeviationType }[];
  return {
    deviations: types.filter(
      (c) => c.type === "planned" || c.type === "unplanned",
    ).length,
    ncr: types.filter((c) => c.type === "ncr").length,
    complaints: types.filter((c) => c.type === "complaint").length,
    capa: capas.count ?? 0,
  };
}

/* ── Writing ──────────────────────────────────────────────────────────── */

/** Blank is not an answer: every optional field stores null, never "". */
const text = (value: string) => value.trim() || null;

/** The initiation tab's columns — the same shape whether raised or edited. */
function initiationPatch(values: InitiationValues) {
  return {
    title: values.title.trim(),
    priority: values.priority,
    origin: text(values.origin),
    nc_category: text(values.ncCategory),
    sla_date: text(values.slaDate),
    batch_no: text(values.batchNo),
    customer_name: text(values.customerName),
    customer_other: text(values.customerOther),
    supplier_name: text(values.supplierName),
    owner_name: text(values.ownerName),
    raised_by: text(values.raisedBy),
    supervisor_name: text(values.supervisorName),
    qa_reviewer: text(values.qaReviewer),
    procedure_name: text(values.procedureName),
    sop_number: text(values.sopNumber),
    document_number: text(values.documentNumber),
    raw_material_code: text(values.rawMaterialCode),
    raw_material_name: text(values.rawMaterialName),
    packaging_material_code: text(values.packagingMaterialCode),
    equipment_no: text(values.equipmentNo),
    specification: text(values.specification),
    actual: values.actual.trim(),
    impact: text(values.impact),
    immediate_action_date: text(values.immediateActionDate),
    immediate_action: text(values.immediateAction),
    // Sent only for an NCR; the table refuses one on a deviation.
    disposition: values.type === "ncr" ? values.disposition || null : null,
    action_id: values.actionId || null,
    // Sent only for a complaint; the table refuses them on any other type.
    received_via:
      values.type === "complaint" ? values.receivedVia || null : null,
    adverse_reaction:
      values.type === "complaint" && values.adverseReaction !== ""
        ? values.adverseReaction === "yes"
        : null,
  };
}

export async function createDeviation(
  factoryId: string,
  values: InitiationValues,
  createdBy: string,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations")
    .insert({
      factory_id: factoryId,
      type: values.type,
      created_by: createdBy,
      ...initiationPatch(values),
      // `deviation_no` and `product_id` are deliberately absent — the trigger
      // stamps the one and resolves the other.
    })
    .select("deviation_no")
    .single();

  if (error) throw new Error(error.message);
  return (data as { deviation_no: string }).deviation_no;
}

/**
 * `YYYY-MM-DDTHH:mm` (local, from `DateTimeField`) ↔ the stored timestamptz.
 * Both directions go through the browser's own zone, which is the zone the
 * person typing it is standing in.
 */
export function localToIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

export function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A deviation's initiation columns (0062) — raised or edited, the same shape. */
function deviationInitiationPatch(values: DeviationInitiationValues) {
  return {
    title: values.title.trim(),
    occurred_at: localToIso(values.occurredAt),
    department_id: values.departmentId || null,
    location: text(values.location),
    detection_point: text(values.detectionPoint),
    // The trigger tidies and resolves the list, and mirrors its first into
    // `batch_no` / `product_id`.
    batch_nos: parseBatches(values.batches),
    actual: values.actual.trim(),
    immediate_action: text(values.immediateAction),
    hold_batch: values.hold === "" ? null : values.hold === "yes",
    equipment_no: text(values.equipmentNo),
    procedure_name: text(values.procedureName),
    sop_number: text(values.sopNumber),
  };
}

/** Raise a planned or unplanned deviation. Returns its id and number. */
export async function raiseDeviation(
  factoryId: string,
  values: DeviationInitiationValues,
  createdBy: string,
  raisedBy: string,
): Promise<{ id: string; deviation_no: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations")
    .insert({
      factory_id: factoryId,
      type: values.type,
      created_by: createdBy,
      raised_by: text(raisedBy),
      ...deviationInitiationPatch(values),
    })
    .select("id, deviation_no")
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string; deviation_no: string };
}

/**
 * Raise a non-conformance on the qms-v12 form (0076). What the item does not
 * ask is sent empty and cleared by `deviations_ncr_initiation_guard`; a Yes
 * quarantines each lot and holds each batch (`deviations_place_holds`).
 */
/** An NCR's raise answers as columns — raised or completed, the same shape. */
function ncrInitiationPatch(values: NcrInitiationValues) {
  const material = isMaterialItem(values.ncItem);
  return {
    nc_item: values.ncItem,
    nc_item_other: text(values.ncItemOther),
    title: values.title.trim(),
    supplied_by: material ? values.suppliedBy : null,
    material_code: material ? text(values.materialCode) : null,
    supplier_name: material ? text(values.supplierName) : null,
    supplier_lots: material ? parseLots(values.lots) : [],
    qty_affected: text(values.qtyAffected),
    batch_nos: values.ncItem === "Other" ? [] : parseBatches(values.batches),
    detection_point: text(values.detectionPoint),
    occurred_at: localToIso(values.occurredAt),
    department_id: values.departmentId || null,
    location: text(values.location),
    specification: text(values.specification),
    actual: values.actual.trim(),
    immediate_action: text(values.immediateAction),
    hold_batch: values.hold === "yes",
    hold_not_reason: values.hold === "no" ? text(values.holdNotReason) : null,
    equipment_no: material ? null : text(values.equipmentNo),
    sop_number: text(values.sopNumber),
  };
}

/**
 * Raise a non-conformance on the qms-v12 form (0076). What the item does not
 * ask is sent empty and cleared by `deviations_ncr_initiation_guard`; a Yes
 * quarantines each lot and holds each batch (`deviations_place_holds`).
 */
export async function raiseNcr(
  factoryId: string,
  values: NcrInitiationValues,
  createdBy: string,
  raisedBy: string,
): Promise<{ id: string; deviation_no: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations")
    .insert({
      factory_id: factoryId,
      type: "ncr",
      created_by: createdBy,
      raised_by: text(raisedBy),
      ...ncrInitiationPatch(values),
    })
    .select("id, deviation_no")
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string; deviation_no: string };
}

/**
 * Complete an NCR raised before the qms-v12 form (0078): its raise answers,
 * saved on the case. Only while open and not yet assessed — the assessment's
 * signature demands them. A hold answered Yes is placed by the caller.
 */
export function completeNcrInitiation(id: string, values: NcrInitiationValues): Promise<void> {
  return patch(id, ncrInitiationPatch(values));
}

/** The form's values for an NCR's raise answers, as it stands. */
export function ncrInitiationValues(d: Deviation): NcrInitiationValues {
  return {
    ncItem: d.nc_item ?? "Other",
    ncItemOther: d.nc_item_other ?? "",
    title: d.title,
    suppliedBy: d.supplied_by ?? "supplier",
    materialCode: d.material_code ?? "",
    supplierName: d.supplier_name ?? "",
    lots: d.supplier_lots.join(", "),
    qtyAffected: d.qty_affected ?? "",
    batches: d.batch_nos.join(", "),
    detectionPoint: (NCR_DETECTION_POINT_SET.has(d.detection_point ?? "")
      ? d.detection_point
      : "") as NcrInitiationValues["detectionPoint"],
    // Not recorded before: the raise date is the best first guess, shown to be checked.
    occurredAt: isoToLocal(d.occurred_at ?? d.created_at),
    departmentId: d.department_id ?? "",
    location: d.location ?? "",
    specification: d.specification ?? "",
    actual: d.actual,
    immediateAction: d.immediate_action ?? "",
    // Unanswered on the earlier form: Yes, as the raise form starts (No needs a reason).
    hold: d.hold_batch === false ? "no" : "yes",
    holdNotReason: d.hold_not_reason ?? "",
    equipmentNo: d.equipment_no ?? "",
    sopNumber: d.sop_number ?? "",
  };
}

const NCR_DETECTION_POINT_SET = new Set<string>(NCR_DETECTION_POINTS);

/**
 * An open NCR raised before the qms-v12 form, still missing raise answers the
 * initial assessment demands (0078).
 */
export function ncrNeedsDetails(d: Deviation): boolean {
  return (
    d.type === "ncr" &&
    d.status === "open" &&
    !d.assessed_at &&
    (!d.occurred_at ||
      !d.department_id ||
      !NCR_DETECTION_POINT_SET.has(d.detection_point ?? "") ||
      !(d.specification ?? "").trim() ||
      !(d.immediate_action ?? "").trim() ||
      d.hold_batch === null)
  );
}

/* ── The initial assessment (0063) ────────────────────────────────────── */

/**
 * The form's values for a deviation. `cases` is the cached case list, which
 * gives each picked previous case its raise date.
 */
export function assessmentValues(
  deviation: Deviation,
  cases: readonly Deviation[],
): AssessmentValues {
  const yn = (b: boolean | null) => (b === null ? "" : b ? "yes" : "no");
  const sc = (n: number | null) =>
    (n === null ? "" : String(n)) as AssessmentValues["severity"];
  const raisedAt = new Map(cases.map((c) => [c.id, c.created_at]));
  return {
    category: (deviation.nc_category ?? "") as AssessmentValues["category"],
    categoryOther: deviation.category_other ?? "",
    ownerName: deviation.owner_name ?? "",
    // Found after receipt, an NCR's investigation cannot be skipped (0077).
    investigationRequired: forcedInvestigation(deviation)
      ? "yes"
      : yn(deviation.investigation_required),
    investigationNotRequiredReason:
      deviation.investigation_not_required_reason ?? "",
    redFlags: deviation.red_flags as AssessmentValues["redFlags"],
    severity: sc(deviation.severity),
    // A draft from before 0068 may hold 4 or 5; the new scale stops at 3.
    likelihood:
      deviation.likelihood !== null && deviation.likelihood <= 3
        ? (String(deviation.likelihood) as AssessmentValues["likelihood"])
        : "",
    raisedAt: deviation.created_at,
    previousCases: deviation.previous_case_ids.map((id) => ({
      id,
      raisedAt: raisedAt.get(id) ?? deviation.created_at,
    })),
    noPreviousFound: deviation.no_previous_found_at !== null,
    previousCasesExternal: deviation.previous_cases_external ?? "",
    classification: (deviation.classification ??
      "") as AssessmentValues["classification"],
    classificationReason: deviation.classification_reason ?? "",
    rationale: deviation.risk_description ?? "",
    ncr: deviation.type === "ncr",
    forcedInvestigation: forcedInvestigation(deviation),
    complaint: deviation.type === "complaint",
    adverse: deviation.adverse_reaction === true,
    departmentId: deviation.department_id ?? "",
    stockAffected: deviation.stock_affected ?? "",
    sponsorNotifiedOn: deviation.sponsor_notified_on ?? "",
    reportable: yn(deviation.reportable),
    reportReason: deviation.report_reason ?? "",
    reportType: deviation.report_type ?? "",
    reportDue: deviation.report_due ?? "",
    reportedOn: deviation.reported_on ?? "",
    reportRef: deviation.report_ref ?? "",
  };
}

function assessmentPatch(v: AssessmentValues, by: string) {
  const num = (s: string) => (s ? Number(s) : null);
  const noneFound = v.noPreviousFound && v.previousCases.length === 0;
  return {
    nc_category: text(v.category),
    // Only an NCR's or a complaint's "Other" is described.
    category_other:
      (v.ncr || v.complaint) && v.category === "Other" ? text(v.categoryOther) : null,
    // A complaint's market impact and reporting (0079).
    ...(v.complaint
      ? {
          department_id: v.investigationRequired === "yes" ? v.departmentId || null : null,
          stock_affected: v.stockAffected || null,
          sponsor_notified_on: v.sponsorNotifiedOn || null,
          reportable: v.reportable === "" ? null : v.reportable === "yes",
          report_reason: v.reportable === "no" ? text(v.reportReason) : null,
          report_type: v.reportable === "yes" ? v.reportType || null : null,
          report_due: v.reportable === "yes" ? v.reportDue || null : null,
          reported_on: v.reportable === "yes" ? v.reportedOn || null : null,
          report_ref: v.reportable === "yes" ? text(v.reportRef) : null,
        }
      : {}),
    owner_name: text(v.ownerName),
    investigation_required: v.forcedInvestigation
      ? true
      : v.investigationRequired === ""
        ? null
        : v.investigationRequired === "yes",
    investigation_not_required_reason:
      v.investigationRequired === "no"
        ? text(v.investigationNotRequiredReason)
        : null,
    red_flags: v.redFlags,
    severity: num(v.severity),
    likelihood: num(v.likelihood),
    // Detection is not asked of a deviation since 0068.
    detection: null,
    previous_case_ids: v.previousCases.map((c) => c.id),
    // The database keeps the first time it was ticked, and stamps it.
    no_previous_found_at: noneFound ? new Date().toISOString() : null,
    no_previous_found_by_name: noneFound ? by.trim() || null : null,
    previous_cases_external: text(v.previousCasesExternal),
    classification: text(v.classification),
    classification_reason: text(v.classificationReason),
    risk_description: text(v.rationale),
  };
}

/** Save the assessment as it stands, unsigned. */
export function saveAssessment(
  id: string,
  v: AssessmentValues,
  by: string,
): Promise<void> {
  return patch(id, assessmentPatch(v, by));
}

/**
 * Sign it. The database re-checks everything, stamps the time and signer,
 * and sets the due date and priority from the class.
 */
export function signAssessment(
  id: string,
  v: AssessmentValues,
  signedBy: string,
): Promise<void> {
  return patch(id, {
    ...assessmentPatch(v, signedBy),
    assessed_at: new Date().toISOString(),
    assessed_by_name: signedBy.trim(),
  });
}

/* ── A deviation's investigation (0064) ───────────────────────────────── */

export function devInvestigationValues(d: Deviation): DevInvestigationValues {
  const yn = (b: boolean | null) => (b === null ? "" : b ? "yes" : "no");
  return {
    otherBatches: d.other_batch_nos.join(", "),
    impact: d.impact ?? "",
    reviewChecks: d.review_checks.map((c) => ({
      item: c.item,
      finding: c.finding ?? "",
    })),
    findings: d.investigation_findings ?? "",
    rootCauseCategories:
      d.root_cause_categories as DevInvestigationValues["rootCauseCategories"],
    humanProcedureClear: yn(d.human_procedure_clear),
    humanTrained: yn(d.human_trained),
    humanPreventable: yn(d.human_preventable),
    rootCause: d.root_cause ?? "",
    conclusion: (d.root_cause_conclusion ??
      "") as DevInvestigationValues["conclusion"],
    method: (d.rca_method ?? "") as DevInvestigationValues["method"],
    labCheck: d.lab_check ?? "",
    labRef: d.lab_ref ?? "",
    labRequired: d.type === "ncr" && d.detection_point === "QC testing",
    requiredChecks: d.type === "complaint" ? complaintRequiredChecks(d) : requiredChecks(d),
    scope: d.scope ?? "",
    complaint: d.type === "complaint",
  };
}

function devInvestigationPatch(v: DevInvestigationValues) {
  const yn = (s: string) => (s === "" ? null : s === "yes");
  const human = v.rootCauseCategories.includes("Man (people)");
  return {
    other_batch_nos: parseBatches(v.otherBatches),
    impact: text(v.impact),
    review_checks: v.reviewChecks.map((c) => ({
      item: c.item.trim(),
      finding: c.finding.trim(),
    })),
    investigation_findings: text(v.findings),
    root_cause_categories: v.rootCauseCategories,
    // Only asked when "Man (people)" is ticked; cleared when it is not.
    human_procedure_clear: human ? yn(v.humanProcedureClear) : null,
    human_trained: human ? yn(v.humanTrained) : null,
    human_preventable: human ? yn(v.humanPreventable) : null,
    root_cause: text(v.rootCause),
    root_cause_conclusion: text(v.conclusion),
    rca_method: text(v.method),
    // Asked only of an NCR found at QC testing.
    ...(v.labRequired
      ? { lab_check: v.labCheck || null, lab_ref: text(v.labRef) }
      : {}),
    // A complaint is scoped, not impact-assessed (0079).
    ...(v.complaint ? { scope: v.scope || null } : {}),
  };
}

export function saveDevInvestigation(
  id: string,
  v: DevInvestigationValues,
): Promise<void> {
  return patch(id, devInvestigationPatch(v));
}

/** Hand it to QA. The database re-checks every answer and stamps the time. */
export function submitDevInvestigation(
  id: string,
  v: DevInvestigationValues,
  by: string,
): Promise<void> {
  return patch(id, {
    ...devInvestigationPatch(v),
    investigation_submitted_at: new Date().toISOString(),
    investigation_submitted_by_name: by.trim(),
  });
}

export function approveDevInvestigation(id: string, by: string): Promise<void> {
  return patch(id, {
    investigation_approved_at: new Date().toISOString(),
    investigation_approved_by_name: by.trim(),
  });
}

export function sendBackDevInvestigation(
  id: string,
  reason: string,
  by: string,
): Promise<void> {
  return patch(id, {
    investigation_submitted_at: null,
    investigation_return_reason: reason.trim(),
    investigation_returned_by_name: by.trim(),
  });
}

/* ── A deviation's close-out (0065) ───────────────────────────────────── */

export function devCloseOutValues(d: Deviation): DevCloseOutValues {
  const reasons = ["Resolved", "No action required", "Duplicate"];
  return {
    unresolvedRisk:
      d.unresolved_risk === null ? "" : d.unresolved_risk ? "yes" : "no",
    summary: d.closing_note ?? "",
    reason: (d.status_reason && reasons.includes(d.status_reason)
      ? d.status_reason
      : "") as DevCloseOutValues["reason"],
    duplicateOf: d.duplicate_of ?? "",
    cost: d.cost_of_quality === null ? "" : String(d.cost_of_quality),
    finalReply: d.final_reply ?? "",
    replySentOn: d.reply_sent_on ?? "",
    resolution: d.resolution ?? "",
    complaint: d.type === "complaint",
  };
}

function devCloseOutPatch(v: DevCloseOutValues) {
  return {
    unresolved_risk: v.unresolvedRisk === "" ? null : v.unresolvedRisk === "yes",
    closing_note: text(v.summary),
    status_reason: text(v.reason),
    // One or the other, as the form shows them.
    duplicate_of: v.reason === "Duplicate" ? text(v.duplicateOf) : null,
    cost_of_quality:
      v.reason !== "Duplicate" && v.cost ? Number(v.cost) : null,
    // A complaint's final reply (0079).
    ...(v.complaint
      ? {
          final_reply: text(v.finalReply),
          reply_sent_on: v.replySentOn || null,
          resolution: v.resolution || null,
        }
      : {}),
  };
}

export function saveDevCloseOut(id: string, v: DevCloseOutValues): Promise<void> {
  return patch(id, devCloseOutPatch(v));
}

/** A Critical case's first signature — the case stays open. */
export function firstSignDevCloseOut(
  id: string,
  v: DevCloseOutValues,
  by: string,
): Promise<void> {
  return patch(id, {
    ...devCloseOutPatch(v),
    close_first_signed_at: new Date().toISOString(),
    close_first_signed_by_name: by.trim(),
  });
}

/**
 * The closing signature. After a first signature the close-out is fixed, so
 * only the status and the name are sent.
 */
export function closeDevCase(
  d: Deviation,
  v: DevCloseOutValues,
  by: string,
): Promise<void> {
  return patch(d.id, {
    ...(d.close_first_signed_at ? {} : devCloseOutPatch(v)),
    status: "closed",
    qa_sign_name: by.trim(),
  });
}

/* ── A customer complaint (0079) ───────────────────────────────────────── */

/** Raise a complaint. A serious reaction is made a red flag by the database. */
export async function raiseComplaint(
  factoryId: string,
  values: ComplaintInitiationValues,
  createdBy: string,
  raisedBy: string,
): Promise<{ id: string; deviation_no: string }> {
  const adverse = values.adverse === "yes";
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations")
    .insert({
      factory_id: factoryId,
      type: "complaint",
      created_by: createdBy,
      raised_by: text(raisedBy),
      title: values.title.trim(),
      received_on: values.receivedOn,
      received_via: values.receivedVia || null,
      complainant: values.complainant || null,
      complainant_contact: text(values.contact),
      country: values.country,
      batch_nos: parseBatches(values.batches),
      product_label: text(values.productLabel),
      customer_name: text(values.customerName),
      sponsor: values.sponsor || null,
      artg_no: text(values.artg),
      expiry: text(values.expiry),
      qty_affected: text(values.unitsAffected),
      actual: values.actual.trim(),
      adverse_reaction: adverse,
      adverse_what: adverse ? text(values.adverseWhat) : null,
      adverse_serious: adverse ? values.serious === "yes" : null,
      sample: values.sample || null,
      sample_received_on:
        values.sample === "Received" ? values.sampleReceivedOn || null : null,
      immediate_action: text(values.immediateAction),
    })
    .select("id, deviation_no")
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; deviation_no: string };
}

/** "Mark acknowledged" — today, by whom, and how (with why, when late). */
export function acknowledgeComplaint(id: string, how: string, by: string): Promise<void> {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return patch(id, {
    ack_on: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
    ack_by_name: by.trim(),
    ack_how: text(how),
  });
}

/** A requested complaint sample, marked received today. */
export function markSampleReceived(id: string): Promise<void> {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return patch(id, {
    sample: "Received",
    sample_received_on: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`,
  });
}

export function marketActionValues(d: Deviation): MarketActionValues {
  return {
    market: (d.market_action ?? "") as MarketActionValues["market"],
    recallClass: (d.recall_class ?? "") as MarketActionValues["recallClass"],
    recallLevel: (d.recall_level ?? "") as MarketActionValues["recallLevel"],
    recallRef: d.recall_ref ?? "",
    why: d.market_why ?? "",
  };
}

export function saveMarketAction(id: string, v: MarketActionValues): Promise<void> {
  const recall = v.market === "Recall";
  return patch(id, {
    market_action: v.market || null,
    recall_class: recall ? v.recallClass || null : null,
    recall_level: recall ? v.recallLevel || null : null,
    recall_ref: recall ? text(v.recallRef) : null,
    market_why: text(v.why),
  });
}

/** The sponsor notified, or a regulator report made — dates set on the Assessment after it is signed. */
export function saveComplaintReporting(
  id: string,
  v: { sponsorNotifiedOn: string; reportedOn: string; reportRef: string },
): Promise<void> {
  return patch(id, {
    sponsor_notified_on: v.sponsorNotifiedOn || null,
    reported_on: v.reportedOn || null,
    report_ref: text(v.reportRef),
  });
}

/** `YYYY-MM-DD` plus days. */
function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day the complaint counts from: received, else raised. */
export const complaintStart = (d: Deviation) => d.received_on ?? d.created_at.slice(0, 10);

/** Acknowledge by: received + the settings' days. */
export const ackDue = (d: Deviation, ackDays: number) => plusDays(complaintStart(d), ackDays);

/** Notify the sponsor by: received + 1 day if urgent, else the settings' days. */
export const notifyDue = (d: Deviation, days: { urgent: number; other: number }) =>
  plusDays(
    complaintStart(d),
    d.adverse_reaction === true || d.red_flags.length > 0 ? days.urgent : days.other,
  );

/** The report's due date for a type: received + the settings' days. */
export const reportDueFor = (
  d: Deviation,
  type: string,
  days: { serious: number; other: number },
) => plusDays(complaintStart(d), type === "Serious adverse reaction" ? days.serious : days.other);

/** The sponsor is told by us — the customer is the sponsor. */
export const viaSponsor = (d: Deviation) => d.type === "complaint" && d.sponsor === "customer";

/** The market action, with its rationale (and a recall's class and level). */
export const marketDone = (d: Deviation) =>
  Boolean(d.market_action && (d.market_why ?? "").trim()) &&
  (d.market_action !== "Recall" || Boolean(d.recall_class && d.recall_level));

/** The regulator: TGA, Medsafe… */
export const regulatorFor = (d: Deviation) => regulatorOf(d.country);

/** A complaint whose assessment decided a regulator report is needed. */
export const reportNeeded = (d: Deviation) => d.reportable === true && reportTriggered(d);

/* ── A non-conformance's actions (0077) ───────────────────────────────── */

export function ncrDispositionValues(d: Deviation): NcrDispositionValues {
  return {
    disposition: d.ncr_disposition ?? "",
    concessionScope: d.concession_scope ?? "",
    dispositionReason: d.disposition_reason ?? "",
    concession: d.concession ?? "",
    concessionRef: d.concession_ref ?? "",
    sortRef: d.sort_ref ?? "",
    sortAccepted: d.sort_accepted ?? "",
    sortRejected: d.sort_rejected ?? "",
    reworkInstruction: d.rework_instruction ?? "",
    retest: d.retest_result ?? "",
  };
}

/** The decision's fields — only those of the chosen disposition are kept. */
function ncrDispositionPatch(v: NcrDispositionValues) {
  const is = (x: string) => v.disposition === x;
  return {
    ncr_disposition: v.disposition || null,
    concession_scope: is("use_as_is") ? text(v.concessionScope) : null,
    disposition_reason: is("use_as_is") ? text(v.dispositionReason) : null,
    concession: is("use_as_is") ? v.concession || null : null,
    concession_ref:
      is("use_as_is") && v.concession === "customer" ? text(v.concessionRef) : null,
    sort_ref: is("sort") ? text(v.sortRef) : null,
    sort_accepted: is("sort") ? text(v.sortAccepted) : null,
    sort_rejected: is("sort") ? text(v.sortRejected) : null,
    rework_instruction: is("rework") ? text(v.reworkInstruction) : null,
    retest_result: is("rework") ? v.retest || null : null,
  };
}

export function saveNcrDisposition(id: string, v: NcrDispositionValues): Promise<void> {
  return patch(id, ncrDispositionPatch(v));
}

/**
 * Record the disposition: the fields are saved, then QA's signature —
 * `sign_ncr_disposition` re-checks them, and releases or rejects the holds.
 */
export async function signNcrDisposition(
  id: string,
  v: NcrDispositionValues,
  by: string,
): Promise<void> {
  await patch(id, ncrDispositionPatch(v));
  const supabase = createClient();
  const { error } = await supabase.rpc("sign_ncr_disposition", {
    p_case: id,
    p_by_name: by,
  });
  if (error) throw new Error(error.message);
}

/** Change a signed disposition — with a reason; its holds go back on hold. */
export async function reopenNcrDisposition(
  id: string,
  reason: string,
  by: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("reopen_ncr_disposition", {
    p_case: id,
    p_reason: reason,
    p_by_name: by,
  });
  if (error) throw new Error(error.message);
}

/** The disposition's follow-up record — destruction record or return note / RMA. */
export function saveNcrFollowUp(d: Deviation, ref: string): Promise<void> {
  return patch(
    d.id,
    d.ncr_disposition === "destroy"
      ? { destruction_ref: text(ref) }
      : { return_ref: text(ref) },
  );
}

export function ncrSupplierValues(d: Deviation): NcrSupplierValues {
  const yn = (b: boolean | null) => (b === null ? "" : b ? "yes" : "no");
  return {
    notifiedOn: d.supplier_notified_on ?? "",
    claim: d.supplier_claim ?? "",
    scar: yn(d.scar_requested),
    scarNotReason: d.scar_not_reason ?? "",
    scarRef: d.scar_ref ?? "",
    scarDue: d.scar_due ?? "",
    scarReplyOn: d.scar_reply_on ?? "",
    scarAccepted: yn(d.scar_accepted),
    tightened: yn(d.tightened_inspection),
    tightenedLots: d.tightened_lots ?? "",
  };
}

export function saveNcrSupplier(id: string, v: NcrSupplierValues): Promise<void> {
  const yn = (s: string) => (s === "" ? null : s === "yes");
  const scar = v.scar === "yes";
  return patch(id, {
    supplier_notified_on: v.notifiedOn || null,
    supplier_claim: text(v.claim),
    scar_requested: yn(v.scar),
    scar_not_reason: v.scar === "no" ? text(v.scarNotReason) : null,
    scar_ref: scar ? text(v.scarRef) : null,
    scar_due: scar ? v.scarDue || null : null,
    scar_reply_on: scar ? v.scarReplyOn || null : null,
    scar_accepted: scar ? yn(v.scarAccepted) : null,
    tightened_inspection: yn(v.tightened),
    tightened_lots: v.tightened === "yes" ? text(v.tightenedLots) : null,
  });
}

export function ncrCustomerValues(d: Deviation): NcrCustomerValues {
  return {
    notify: d.customer_notify ?? "",
    notifiedOn: d.customer_notified_on ?? "",
    reason: d.customer_notify_reason ?? "",
  };
}

export function saveNcrCustomer(id: string, v: NcrCustomerValues): Promise<void> {
  return patch(id, {
    customer_notify: v.notify || null,
    customer_notified_on: v.notify === "yes" ? v.notifiedOn || null : null,
    customer_notify_reason: v.notify === "not_needed" ? text(v.reason) : null,
  });
}

/** Close as not a non-conformance — before the assessment, or after a lab error. */
export async function closeNcrNotACase(id: string, reason: string, by: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("close_ncr_not_a_case", {
    p_case: id,
    p_reason: reason,
    p_by_name: by,
  });
  if (error) throw new Error(error.message);
}

/** May it still be closed as not a non-conformance? */
export const canCloseNotACase = (d: Deviation) =>
  d.status === "open" &&
  ((d.type === "ncr" && d.nc_item !== null && (!d.assessed_at || d.lab_check === "No")) ||
    (d.type === "complaint" && !d.assessed_at));

/** The disposition's own fields are complete — `ncr_disposition_missing()` as a yes / no. */
function dispositionComplete(d: Deviation): boolean {
  switch (d.ncr_disposition) {
    case "use_as_is":
      return Boolean(
        d.concession_scope &&
          d.disposition_reason &&
          d.concession &&
          (d.concession !== "customer" || d.concession_ref),
      );
    case "sort":
      return Boolean(d.sort_ref && d.sort_accepted && d.sort_rejected);
    case "rework":
      return Boolean(d.rework_instruction && d.retest_result === "Pass");
    case "destroy":
    case "return":
      return true;
    default:
      return false;
  }
}

/** The destruction record or return note the disposition still waits for, or null. */
export function dispositionFollowUp(d: Deviation): "destruction record" | "return note" | null {
  if (d.ncr_disposition === "destroy" && !d.destruction_ref) return "destruction record";
  if (d.ncr_disposition === "return" && !d.return_ref) return "return note";
  return null;
}

/** The disposition, signed, complete, and its follow-up recorded. */
export const dispositionDone = (d: Deviation) =>
  Boolean(d.disposition_signed_at) && dispositionComplete(d) && !dispositionFollowUp(d);

/** A material's supplier (or customer) follow-up — `ncr_supplier_missing()`. */
export function supplierDone(d: Deviation): boolean {
  if (!isMaterialItem(d.nc_item)) return true;
  if (!d.supplier_notified_on || d.tightened_inspection === null) return false;
  if (d.tightened_inspection && !d.tightened_lots) return false;
  if (d.scar_requested === false) return Boolean(d.scar_not_reason);
  if (d.scar_requested === true) {
    return Boolean(
      d.scar_ref &&
        d.scar_reply_on &&
        (d.scar_accepted === true || (d.scar_accepted === false && d.capa_needed === true)),
    );
  }
  return false;
}

/** A finished product's customer notification, or why it is not needed. */
export const customerDone = (d: Deviation) =>
  d.nc_item !== "Finished product" ||
  (d.customer_notify === "yes" && Boolean(d.customer_notified_on)) ||
  (d.customer_notify === "not_needed" && Boolean(d.customer_notify_reason));

/** An NCR's actions besides the CAPA decision, done — a deviation has none. */
export const typeActsDone = (d: Deviation) =>
  d.type === "complaint"
    ? marketDone(d) && Boolean(d.ack_on)
    : d.type !== "ncr" || (dispositionDone(d) && supplierDone(d) && customerDone(d));

/** What an NCR's Actions still need, in words — "disposition, supplier reply". */
export function actsMissing(d: Deviation): string[] {
  const m: string[] = [];
  if (!(d.capa_needed === false || (d.capa_needed === true && d.capa_id))) {
    m.push("CAPA decision");
  }
  if (d.type === "ncr") {
    const party = partyWord(d.supplied_by);
    if (!d.disposition_signed_at) m.push("disposition");
    else if (dispositionFollowUp(d)) m.push(dispositionFollowUp(d)!);
    if (!supplierDone(d)) {
      m.push(
        !d.supplier_notified_on
          ? `${party} notification`
          : d.scar_requested && !d.scar_reply_on
            ? `${party} reply`
            : `${party} follow-up`,
      );
    }
    if (!customerDone(d)) m.push("customer notification");
  }
  if (d.type === "complaint") {
    if (!marketDone(d)) m.push("market action");
    if (!d.ack_on) m.push("acknowledgement");
  }
  return m;
}

/** How many QA signatures the close-out needs. */
export const signaturesNeeded = (d: Deviation) =>
  d.classification === "Critical" ? 2 : 1;

/** One line of the close-out checklist; `here` — a field of the close-out form itself. */
export interface ChecklistItem {
  label: string;
  done: boolean;
  here?: boolean;
}

/**
 * The close-out checklist, as the reference QMS draws it — each item and
 * whether it is done. The sign button waits for every one.
 */
export function devChecklist(d: Deviation): ChecklistItem[] {
  const list: ChecklistItem[] = [
    { label: "Initial assessment signed", done: Boolean(d.assessed_at) },
    d.investigation_required === false
      ? { label: "Investigation not required (reason recorded)", done: true }
      : { label: "Investigation approved", done: Boolean(d.investigation_approved_at) },
    // A complaint's immediate action is optional (0079).
    ...(d.type === "complaint"
      ? []
      : [
          {
            label: "Immediate action recorded",
            done: Boolean((d.immediate_action ?? "").trim()),
          },
        ]),
    // Only when the case has held a batch (0069).
    ...(d.holds_total > 0
      ? [
          {
            label: "Every batch hold released or rejected",
            done: d.holds_on_hold === 0,
          },
        ]
      : []),
    {
      label: "CAPA decision made",
      done:
        (d.capa_needed === false &&
          (d.capa_not_needed_reason ?? "").trim().length >= 10) ||
        (d.capa_needed === true && Boolean(d.capa_id)),
    },
  ];
  // The case closes once its CAPA's plan is approved; the CAPA's
  // effectiveness is tracked on the CAPA, on its own dates (0075).
  if (d.capa_needed) {
    list.push({
      label: `${d.capa_no ?? "CAPA"} plan approved`,
      done: Boolean(d.capa_plan_approved_at),
    });
  }
  // A complaint's communication, notification, report and market action (0079).
  if (d.type === "complaint") {
    list.push({ label: "Complainant acknowledged", done: Boolean(d.ack_on) });
    if (viaSponsor(d)) {
      list.push({
        label: `Sponsor (${d.customer_name || "customer"}) notified`,
        done: Boolean(d.sponsor_notified_on),
      });
    }
    if (reportNeeded(d)) {
      list.push({
        label: `Reported to the ${regulatorFor(d)}`,
        done: Boolean(d.reported_on),
      });
    }
    list.push({ label: "Market action decided, with rationale", done: marketDone(d) });
    list.push({
      label: "Final reply sent",
      done: Boolean((d.final_reply ?? "").trim() && d.reply_sent_on),
      here: true,
    });
  }
  // A non-conformance's own actions (0077).
  if (d.type === "ncr") {
    list.push({
      label: d.disposition_signed_at
        ? `Disposition (${dispositionLabel(d.ncr_disposition)}) and its record`
        : "Disposition recorded",
      done: dispositionDone(d),
    });
    if (isMaterialItem(d.nc_item)) {
      list.push({
        label:
          d.supplied_by === "customer"
            ? "Customer (material owner) notified and its corrective action closed"
            : "Supplier notified and its corrective action closed",
        done: supplierDone(d),
      });
    }
    if (d.nc_item === "Finished product") {
      list.push({
        label: "Customer (brand owner) notified, or not needed with a reason",
        done: customerDone(d),
      });
    }
  }
  // The close-out's own fields: checked when it is signed, beside each field,
  // not listed again above them (P1).
  list.push(
    { label: "No unresolved product or patient risk", done: d.unresolved_risk === false, here: true },
    {
      here: true,
      label: "Close-out summary and reason",
      done:
        (d.closing_note ?? "").trim().length >= 10 &&
        Boolean(d.status_reason) &&
        (d.status_reason !== "Duplicate" || Boolean((d.duplicate_of ?? "").trim())),
    },
  );
  return list;
}

/* ── The root cause a CAPA works on (0075) ─────────────────────────────── */

/** A deviation (planned / unplanned), not an NCR or a complaint. */
export const isDeviationCase = (d: Pick<Deviation, "type">) =>
  d.type === "planned" || d.type === "unplanned";

/**
 * The case's root cause once it counts: a deviation's after QA has approved
 * its investigation; an NCR's or complaint's as written. Otherwise null.
 */
export function approvedRootCause(d: Deviation): string | null {
  const root = d.root_cause?.trim();
  if (!root) return null;
  return d.investigation_approved_at !== null || !isQmsCase(d) ? root : null;
}

/**
 * Whether a CAPA covering this case must wait for its investigation before
 * the plan is approved — the rule `capas_guard` applies.
 */
export function investigationPending(d: Deviation): boolean {
  return (
    isQmsCase(d) &&
    d.investigation_required !== false &&
    d.investigation_approved_at === null
  );
}

/* ── A deviation's risk (0068) ────────────────────────────────────────── */

/**
 * Whether a deviation was scored on the old scale — severity × likelihood ×
 * detection, 1–125. Only assessments signed before 0068 carry a detection.
 */
export const isLegacyRisk = (d: Deviation) => d.detection !== null;

/**
 * A deviation's risk as the header and the register show it: "S3 · L2" —
 * severity and likelihood, read against the table. A case scored on the
 * old scale shows its 1–125 score.
 */
export function devRiskLabel(d: Deviation): string | null {
  if (d.severity === null || d.likelihood === null) return null;
  if (isLegacyRisk(d)) return d.risk_score === null ? null : String(d.risk_score);
  return `S${d.severity} · L${d.likelihood}`;
}

/* ── A deviation's stage, as the reference QMS names it ───────────────── */

export type DevStage =
  | "Awaiting assessment"
  | "Investigating"
  | "Awaiting approval"
  | "Actions"
  | "Awaiting CAPA"
  | "Batches on hold"
  | "Ready to close"
  | "Awaiting 2nd signature"
  | "Closed"
  | "Closed — not a case";

export type CaseSection =
  | "details"
  | "assessment"
  | "investigation"
  | "actions"
  | "closeout"
  | "history";

/** A deviation, or an NCR on the qms-v12 form — scored, investigated and closed alike. */
const isDeviation = (d: Deviation) => isQmsCase(d);

/** Read from what the case holds — never stored. */
export function devStage(d: Deviation): DevStage {
  if (d.status === "closed") {
    return d.status_reason === "Not a non-conformance" ||
      d.status_reason === "Not a quality complaint"
      ? "Closed — not a case"
      : "Closed";
  }
  if (!d.assessed_at) return "Awaiting assessment";
  if (d.investigation_required !== false && !d.investigation_approved_at) {
    return d.investigation_submitted_at ? "Awaiting approval" : "Investigating";
  }
  if (d.capa_needed === null || (d.capa_needed && !d.capa_id) || !typeActsDone(d)) {
    return "Actions";
  }
  // Waiting for the CAPA's plan to be approved (0075) — not its effectiveness.
  if (d.capa_needed && !d.capa_plan_approved_at) return "Awaiting CAPA";
  // A batch still on hold is decided before the case closes (0069).
  if (d.holds_on_hold > 0) return "Batches on hold";
  return d.close_first_signed_at ? "Awaiting 2nd signature" : "Ready to close";
}

/** What happens next, and the tab it happens on. */
export function nextStep(d: Deviation): { text: string; tab: CaseSection } | null {
  const owner = d.owner_name || "Owner";
  switch (devStage(d)) {
    case "Awaiting assessment":
      return {
        text: "QA: initial assessment — classify, score risk, set the owner.",
        tab: "assessment",
      };
    case "Investigating":
      return {
        text: `${owner}: complete the investigation and submit it.`,
        tab: "investigation",
      };
    case "Awaiting approval":
      return {
        text: "QA: approve the investigation, or send it back.",
        tab: "investigation",
      };
    case "Actions":
      return {
        text:
          d.type === "ncr" || d.type === "complaint"
            ? `${owner}: still to do — ${actsMissing(d).join(", ")}.`
            : `${owner}: decide on a CAPA, or resolve directly.`,
        tab: "actions",
      };
    case "Awaiting CAPA":
      return {
        text: `Waiting for ${d.capa_no ?? "the CAPA"}'s plan to be approved.`,
        tab: "actions",
      };
    case "Batches on hold":
      return {
        text: "QA: release or reject each batch still on hold, then sign the close-out.",
        tab: "details",
      };
    case "Ready to close":
      return { text: "QA: sign the close-out.", tab: "closeout" };
    case "Awaiting 2nd signature":
      return {
        text: "A second QA approver signs (Critical case).",
        tab: "closeout",
      };
    default:
      return null;
  }
}

export const DEV_STAGE_DOT: Record<DevStage, string> = {
  "Awaiting assessment": "bg-violet",
  Investigating: "bg-brand",
  "Awaiting approval": "bg-violet",
  Actions: "bg-warn",
  "Awaiting CAPA": "bg-warn",
  "Batches on hold": "bg-danger",
  "Ready to close": "bg-teal",
  "Awaiting 2nd signature": "bg-violet",
  Closed: "bg-ink-5",
  "Closed — not a case": "bg-ink-5",
};

async function patch(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("deviations").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tab 1. The type is absent: it is part of the number, and fixed. */
export function saveInitiation(
  id: string,
  values: InitiationValues,
): Promise<void> {
  return patch(id, initiationPatch(values));
}

/** Tab 2. */
export function saveContainment(
  id: string,
  values: ContainmentValues,
): Promise<void> {
  return patch(id, {
    immediate_action_date: text(values.immediateActionDate),
    immediate_action: text(values.immediateAction),
  });
}

/** Tab 3. The score and its conclusion are computed by the view, not sent. */
export function saveRisk(id: string, values: RiskValues): Promise<void> {
  return patch(id, {
    likelihood: values.likelihood ? Number(values.likelihood) : null,
    severity: values.severity ? Number(values.severity) : null,
    detection: values.detection ? Number(values.detection) : null,
    financial_impact:
      values.financialImpact === "" ? null : values.financialImpact === "yes",
    risk_description: text(values.riskDescription),
  });
}

/** Tab 4. */
export function saveInvestigation(
  id: string,
  values: InvestigationValues,
): Promise<void> {
  return patch(id, {
    investigation_findings: text(values.investigationFindings),
    root_cause_category: text(values.rootCauseCategory),
    root_cause: text(values.rootCause),
    rca_method: text(values.rcaMethod),
  });
}

/** Tabs 5 and 6 — the same five fields, two sets of columns. */
export function saveActionPlan(
  id: string,
  kind: "ca" | "pa",
  values: ActionPlanValues,
): Promise<void> {
  return patch(id, {
    [`${kind}_owner`]: text(values.owner),
    [`${kind}_target_date`]: text(values.targetDate),
    [`${kind}_closed_date`]: text(values.closedDate),
    [`${kind}_closed_by_name`]: text(values.closedBy),
    [`${kind}_description`]: text(values.description),
  });
}

/**
 * The case's CAPA decision. Saying No unlinks any CAPA — the table refuses
 * "not needed" beside a linked one.
 */
export function saveCapaDecision(
  id: string,
  needed: boolean | null,
  reason: string,
): Promise<void> {
  return patch(id, {
    capa_needed: needed,
    capa_not_needed_reason: needed === false ? text(reason) : null,
    ...(needed === false ? { capa_id: null } : {}),
  });
}

/** Link the case to an open CAPA; the decision is Yes by definition. */
export function linkCapa(id: string, capaId: string): Promise<void> {
  return patch(id, {
    capa_id: capaId,
    capa_needed: true,
    capa_not_needed_reason: null,
  });
}

/** Unlink, leaving the decision at Yes — a CAPA is still needed, just not that one. */
export function unlinkCapa(id: string): Promise<void> {
  return patch(id, { capa_id: null });
}

/** Tab 7, without closing — the close-out owner and target date. */
export function saveCloseOutPlan(
  id: string,
  values: { owner: string; targetDate: string },
): Promise<void> {
  return patch(id, {
    co_owner: text(values.owner),
    co_target_date: text(values.targetDate),
  });
}

/** The gate. Refused unless the starred fields of tabs 2, 3, 4 and 7 are in. */
export function closeDeviation(
  deviation: Deviation,
  values: CloseOutValues,
): Promise<void> {
  return patch(deviation.id, {
    status: "closed",
    status_reason: values.statusReason,
    co_owner: text(values.owner),
    co_target_date: text(values.targetDate),
    closing_note: values.description.trim(),
    qa_sign_name: values.closedBy.trim(),
    ...(deviation.type === "ncr" ? { disposition: values.disposition } : {}),
  });
}

/* ── Display ──────────────────────────────────────────────────────────── */

export type CaseStage = "open" | "awaiting_capa" | "ready" | "closed";

export const CASE_STAGES: Record<
  CaseStage,
  { label: string; dot: string }
> = {
  open: { label: "Open", dot: "bg-brand" },
  awaiting_capa: { label: "Awaiting CAPA", dot: "bg-warn" },
  ready: { label: "Ready to close", dot: "bg-teal" },
  closed: { label: "Closed", dot: "bg-ink-5" },
};

/**
 * Where an open case stands, read from what it already holds — not a second
 * status column. It still has one gate, Open → Closed; this only says what
 * it is waiting on: its CAPA's plan to be approved, nothing (ready to close),
 * or the work itself.
 */
export function caseStage(deviation: Deviation): CaseStage {
  if (deviation.status === "closed") return "closed";
  if (
    deviation.capa_needed &&
    deviation.capa_id &&
    !deviation.capa_plan_approved_at
  ) {
    return "awaiting_capa";
  }
  return outstanding(deviation).length === 0 ? "ready" : "open";
}

export const RISK_TEXT: Record<RiskConclusion, string> = {
  Low: "text-teal-deep",
  Medium: "text-warn-deep",
  High: "font-semibold text-danger-deep",
};

export function typeMeta(type: DeviationType) {
  return DEVIATION_TYPES.find((t) => t.value === type) ?? DEVIATION_TYPES[1];
}

export function dispositionMeta(disposition: NcrDisposition) {
  return DISPOSITIONS.find((d) => d.value === disposition) ?? DISPOSITIONS[3];
}

export function priorityMeta(priority: DeviationPriority) {
  return PRIORITIES.find((p) => p.value === priority) ?? PRIORITIES[2];
}

/** The label a 1–3 score carries on its own scale ("1 — High" for detection). */
export function scaleLabel(
  scale: keyof typeof RISK_SCALES,
  value: number | null,
): string | null {
  if (value === null) return null;
  return (
    RISK_SCALES[scale].options.find((o) => o.value === String(value))?.label ??
    String(value)
  );
}

/**
 * Everything the close-out gate will demand and hasn't got yet, as the tab
 * it lives on. Read by the tab strip (a dot against what is outstanding) and
 * by the close-out form, so the register never hides why Close is refused.
 */
export type OutstandingTab =
  | "initiation"
  | "assessment"
  | "containment"
  | "risk"
  | "investigation"
  | "capa";

export function outstanding(deviation: Deviation): {
  tab: OutstandingTab;
  what: string;
}[] {
  const gaps: { tab: OutstandingTab; what: string }[] = [];
  if (deviation.type === "complaint" && deviation.adverse_reaction === null) {
    gaps.push({
      tab: "initiation",
      what: "whether an injury or adverse reaction was reported",
    });
  }
  if (!(deviation.immediate_action ?? "").trim()) {
    // On the initiation tab since the Containment tab was folded into it.
    // Its date is no longer demanded (0062).
    gaps.push({ tab: "initiation", what: "the immediate action" });
  }
  if (isDeviation(deviation)) {
    // Scored and classified at the initial assessment (0063); no financial
    // impact asked.
    if (!deviation.assessed_at) {
      gaps.push({ tab: "assessment", what: "the signed initial assessment" });
    }
  } else if (
    deviation.likelihood === null ||
    deviation.severity === null ||
    deviation.detection === null ||
    deviation.financial_impact === null
  ) {
    gaps.push({ tab: "risk", what: "the risk assessment" });
  }
  if (isDeviation(deviation)) {
    // Submitted and approved (0064), unless the assessment said none needed.
    if (
      deviation.investigation_required !== false &&
      !deviation.investigation_approved_at
    ) {
      gaps.push({ tab: "investigation", what: "the approved investigation" });
    }
  } else if ((deviation.investigation_findings ?? "").trim().length < 10) {
    gaps.push({ tab: "investigation", what: "the investigation findings" });
  }
  if (deviation.capa_needed === null) {
    gaps.push({
      tab: "capa",
      what: "how it is resolved — directly, or through a CAPA",
    });
  } else if (deviation.capa_needed && !deviation.capa_id) {
    gaps.push({ tab: "capa", what: "a linked CAPA" });
  } else if (deviation.capa_needed && !deviation.capa_plan_approved_at) {
    gaps.push({
      tab: "capa",
      what: `${deviation.capa_no}'s plan to be approved`,
    });
  }
  return gaps;
}
