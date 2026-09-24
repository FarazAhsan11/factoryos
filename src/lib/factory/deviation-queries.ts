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

export type DeviationType = "planned" | "unplanned" | "ncr";
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
 * The risk scales, as the reference system runs them.
 *
 * Likelihood and severity run low → high. **Detection runs the other way**:
 * 1 is "we would catch this every time", which makes the risk *lower*. That
 * is why a case scored Medium likelihood, High severity and High detection
 * concludes Low — 2 × 3 × 1 = 6.
 */
export const RISK_SCALES: Record<
  "likelihood" | "severity" | "detection",
  { label: string; options: { value: string; label: string }[] }
> = {
  likelihood: {
    label: "Likelihood",
    options: [
      { value: "1", label: "1 — Low" },
      { value: "2", label: "2 — Medium" },
      { value: "3", label: "3 — High" },
    ],
  },
  severity: {
    label: "Severity of impact",
    options: [
      { value: "1", label: "1 — Low" },
      { value: "2", label: "2 — Medium" },
      { value: "3", label: "3 — High" },
    ],
  },
  detection: {
    label: "Probability of detection",
    options: [
      { value: "1", label: "1 — High" },
      { value: "2", label: "2 — Medium" },
      { value: "3", label: "3 — Low" },
    ],
  },
};

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

  /** The CAPA this case is worked under, with its title and stage resolved. */
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
  created_at, age_days, days_to_sla, is_overdue, is_quarantining
`;

export const deviationKeys = {
  all: (factoryId: string) => ["deviations", factoryId] as const,
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
    // Sent only for an NCR; the table refuses one on a deviation.
    disposition: values.type === "ncr" ? values.disposition || null : null,
    action_id: values.actionId || null,
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
export function outstanding(deviation: Deviation): {
  tab: "containment" | "risk" | "investigation";
  what: string;
}[] {
  const gaps: { tab: "containment" | "risk" | "investigation"; what: string }[] =
    [];
  if (!deviation.immediate_action_date || !deviation.immediate_action) {
    gaps.push({ tab: "containment", what: "the immediate action and its date" });
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
  return gaps;
}
