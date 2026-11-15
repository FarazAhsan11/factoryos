import type {
  ActionPlanValues,
  CloseOutValues,
  ContainmentValues,
  InitiationValues,
  InvestigationValues,
  RiskValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type { ActionStage } from "@/lib/factory/action-queries";
import { createClient } from "@/lib/supabase/client";

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
  capa_status: "open" | "effective" | null;
  capa_verified_at: string | null;
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
  root_cause_category
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
 * it is waiting on: its CAPA to be verified, nothing (ready to close), or the
 * work itself.
 */
export function caseStage(deviation: Deviation): CaseStage {
  if (deviation.status === "closed") return "closed";
  if (
    deviation.capa_needed &&
    deviation.capa_id &&
    deviation.capa_status !== "effective"
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
  if (!deviation.immediate_action_date || !deviation.immediate_action) {
    // On the initiation tab since the Containment tab was folded into it.
    gaps.push({ tab: "initiation", what: "the immediate action and its date" });
  }
  if (
    deviation.likelihood === null ||
    deviation.severity === null ||
    deviation.detection === null ||
    deviation.financial_impact === null
  ) {
    gaps.push({ tab: "risk", what: "the risk assessment" });
  }
  if ((deviation.investigation_findings ?? "").trim().length < 10) {
    gaps.push({ tab: "investigation", what: "the investigation findings" });
  }
  if (deviation.capa_needed === null) {
    gaps.push({
      tab: "capa",
      what: "how it is resolved — directly, or through a CAPA",
    });
  } else if (deviation.capa_needed && !deviation.capa_id) {
    gaps.push({ tab: "capa", what: "a linked CAPA" });
  } else if (deviation.capa_needed && deviation.capa_status !== "effective") {
    gaps.push({
      tab: "capa",
      what: `${deviation.capa_no} to be verified as effective`,
    });
  }
  return gaps;
}
