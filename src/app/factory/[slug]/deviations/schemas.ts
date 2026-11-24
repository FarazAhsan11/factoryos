import { z } from "zod";

import {
  COMPLAINANTS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  COMPLAINT_RED_FLAGS,
  COUNTRIES,
  MARKET_ACTIONS,
  RECALL_CLASSES,
  RECALL_LEVELS,
  REPORT_TYPES,
  RESOLUTIONS,
  SAMPLE_STATES,
  SCOPES,
  STOCK_AFFECTED,
} from "@/lib/factory/complaint";

import {
  LAB_CHECK,
  NCR_CATEGORIES,
  NCR_DETECTION_POINTS,
  NCR_RED_FLAGS,
  NC_ITEMS,
  batchRequired,
  isMaterialItem,
  isProductItem,
  parseLots,
  partyWord,
} from "@/lib/factory/ncr";

/**
 * Deviations & NCRs — the QMS case, as seven forms over one row.
 *
 * Client-side validation for UX; `deviations_guard` (migrations 0044, 0045)
 * and the table's check constraints are the authority and say the same
 * things. The tabs are filled as the facts arrive, so **only the close-out
 * form demands anything**: every other schema takes blanks, because a case
 * raised at 6am legitimately has nothing in its investigation tab yet.
 *
 * Optional text fields are plain strings that may be empty rather than
 * `.optional()` — `.optional().default("")` gives zod an input type that
 * differs from its output, and `zodResolver` then refuses the form's value
 * type. The queries turn blank into null on the way in.
 */

export const DEVIATION_TYPE_VALUES = [
  "planned",
  "unplanned",
  "ncr",
  "complaint",
] as const;
export const DISPOSITION_VALUES = [
  "use_as_is",
  "rework",
  "reject",
  "quarantine",
] as const;
export const PRIORITY_VALUES = ["critical", "high", "medium", "low"] as const;

/** Mirrors `deviations_origin_known` in migration 0045. */
export const ORIGINS = [
  "Internal inspection",
  "Shift log",
  "Customer complaint",
  "Supplier",
  "Audit",
  "Email",
  "Phone",
  "Other",
] as const;

/**
 * What went wrong (the root cause is why) — the reference QMS's (qms-v5)
 * categories for deviations and NCRs. Mirrors `deviations_nc_category_known`
 * (0067).
 */
export const NC_CATEGORIES = [
  "Formulation / batch formula",
  "Dispensing / weighing",
  "Manufacturing process",
  "Equipment",
  "Facility & utilities",
  "Cleaning / line clearance",
  "Environmental monitoring",
  "Materials (raw / packaging)",
  "Labelling & packaging",
  "Laboratory testing (OOS / OOT)",
  "Documentation & data integrity",
  "Storage & distribution",
  "Other",
] as const;

/** Mirrors `deviations_rca_method_known` (0061) — how the root cause was found. */
export const RCA_METHODS = [
  "5-Why",
  "Fishbone (Ishikawa)",
  "Fault tree",
  "FMEA",
] as const;

/** Mirrors `deviations_root_cause_category_known` in migration 0058. */
export const ROOT_CAUSE_CATEGORIES = [
  "Man",
  "Method",
  "Material",
  "Machine",
  "Environment",
] as const;

/** Mirrors `deviations_received_via_known` in migration 0057. */
export const RECEIVED_VIA = [
  "Email",
  "Phone",
  "Distributor",
  "Website",
  "Other",
] as const;

/** Mirrors `deviations_status_reason_known`. */
export const STATUS_REASONS = [
  "Problem solved",
  "Information provided",
  "No action required",
  "Cancelled",
] as const;

const optional = (max: number) => z.string().trim().max(max);
/** `YYYY-MM-DD` from `DateField`, or "" — never a partial date. */
const date = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date.");

/* ── Tab 1 · Initiation and identification ────────────────────────────── */

/**
 * Raising a case, and the same form again on the Initiation tab.
 *
 * The type is a **dropdown**, not three cards: it is one of the case's
 * fifteen identifying facts, and giving it a third of the form's height said
 * it was the most important one.
 */
export const initiationSchema = z
  .object({
    type: z.enum(DEVIATION_TYPE_VALUES, {
      message: "What kind of case is this?",
    }),
    title: z
      .string()
      .trim()
      .min(3, "Give the case a title — what it is, in a line.")
      .max(160, "Keep the title under 160 characters."),
    priority: z.enum(PRIORITY_VALUES),
    origin: z.union([z.enum(ORIGINS), z.literal("")]),
    ncCategory: z.union([z.enum(NC_CATEGORIES), z.literal("")]),
    slaDate: date,

    batchNo: optional(60),
    customerName: optional(120),
    customerOther: optional(120),
    supplierName: optional(120),

    ownerName: optional(80),
    raisedBy: optional(80),
    supervisorName: optional(80),
    qaReviewer: optional(80),

    procedureName: optional(120),
    sopNumber: optional(60),
    documentNumber: optional(60),
    rawMaterialCode: optional(60),
    rawMaterialName: optional(120),
    packagingMaterialCode: optional(60),
    equipmentNo: optional(40),

    specification: optional(500),
    actual: z
      .string()
      .trim()
      .min(10, "Describe the event — what actually happened.")
      .max(2000, "Keep the event description under 2000 characters."),
    impact: optional(1000),

    // Immediate / containment action — on the initiation tab since the
    // Containment tab was folded into it. Optional here; the close-out
    // demands both.
    immediateActionDate: date,
    immediateAction: optional(2000),

    disposition: z.union([z.enum(DISPOSITION_VALUES), z.literal("")]),
    actionId: z.string(),

    // Customer complaints only (migration 0057). Blank on every other type.
    receivedVia: z.union([z.enum(RECEIVED_VIA), z.literal("")]),
    // Tri-state: "" is unanswered, which the close-out refuses.
    adverseReaction: z.union([z.enum(["yes", "no"]), z.literal("")]),
  })
  .refine((v) => v.type !== "complaint" || v.receivedVia !== "", {
    path: ["receivedVia"],
    message: "How was the complaint received?",
  })
  .refine((v) => v.type !== "ncr" || v.disposition !== "", {
    path: ["disposition"],
    message: "An NCR needs a disposition decision.",
  })
  .refine(
    (v) =>
      v.type !== "ncr" || v.disposition !== "quarantine" || v.batchNo.length > 0,
    {
      path: ["batchNo"],
      message: "Quarantine holds a batch — say which one.",
    },
  );

export type InitiationValues = z.infer<typeof initiationSchema>;

/* ── A deviation's initiation (migration 0062) ────────────────────────── */

/** Mirrors `deviations_detection_point_known` — where it was found. */
export const DETECTION_POINTS = [
  "Incoming inspection",
  "In-process",
  "QC testing",
  "Warehouse",
  "Audit",
  "Customer",
  "Other",
] as const;

/**
 * "46686, 46690" → ["46686", "46690"]: split on commas, semicolons and
 * whitespace, blanks and repeats (any case) dropped, first spelling kept. The
 * trigger tidies the list the same way; this is so the form shows what will
 * be stored.
 */
export function parseBatches(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const b = raw.trim();
    if (!b || seen.has(b.toLowerCase())) continue;
    seen.add(b.toLowerCase());
    out.push(b);
  }
  return out;
}

/** `YYYY-MM-DDTHH:mm` from `DateTimeField`, or "". */
const dateTime = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "Pick a date and time.");

/**
 * Raising a planned or unplanned deviation — the page at `/deviations/new`,
 * and the same form again on the case's Initiation tab.
 *
 * The fields are the reference QMS's (qms-v4): title, planned or unplanned,
 * when it happened, department, location, detected at, batches, what
 * happened, the immediate action, whether to hold the batch, equipment,
 * procedure and reference document. Category, owner, class and due date are
 * not asked here: they are the initial assessment's (`assessmentSchema`).
 */
export const deviationInitiationSchema = z
  .object({
    type: z.enum(["planned", "unplanned"]),
    title: z
      .string()
      .trim()
      .min(3, "Give the deviation a title — what it is, in a line.")
      .max(160, "Keep the title under 160 characters."),
    occurredAt: dateTime.refine((v) => v !== "", "When did it happen?"),
    departmentId: z.string().min(1, "Which department did it happen in?"),
    location: optional(120),
    detectionPoint: z.union([z.enum(DETECTION_POINTS), z.literal("")]),
    /** Typed as one line; `parseBatches` reads it. */
    batches: optional(400),
    actual: z
      .string()
      .trim()
      .min(10, "Say what happened — what, how much, how it was found.")
      .max(2000, "Keep it under 2000 characters."),
    immediateAction: z
      .string()
      .trim()
      .min(2, "Say what was done straight away, or “None needed”.")
      .max(2000, "Keep it under 2000 characters."),
    // "" is unanswered, and refused: holding a batch is not a default.
    hold: z.union([z.enum(["yes", "no"]), z.literal("")]),
    equipmentNo: optional(40),
    procedureName: optional(120),
    sopNumber: optional(60),
  })
  .refine((v) => v.detectionPoint !== "", {
    path: ["detectionPoint"],
    message: "Where was it detected?",
  })
  .refine((v) => v.hold !== "", {
    path: ["hold"],
    message: "Say whether the batch goes on hold.",
  })
  .refine((v) => v.hold !== "yes" || parseBatches(v.batches).length > 0, {
    path: ["batches"],
    message: "Holding a batch needs its number.",
  })
  // Read in validation, not in render — a submit is an event.
  .refine((v) => !v.occurredAt || new Date(v.occurredAt).getTime() <= Date.now() + 5 * 60_000, {
    path: ["occurredAt"],
    message: "When it happened can't be in the future.",
  });

export type DeviationInitiationValues = z.infer<
  typeof deviationInitiationSchema
>;

/* ── A non-conformance's initiation (migration 0076) ──────────────────── */

/**
 * Raising a non-conformance — the page at `/deviations/new?type=ncr`, the
 * reference QMS's NCR form (qms-v12). "What is non-conforming?" decides the
 * rest: a material asks who supplied it, its code, the supplier (or
 * customer), the lot(s) and quantity, and the batch it was found in when it
 * was found after receipt; bulk or finished product asks its batches and
 * quantity; other asks what it is. Requirement and description are both
 * required (an NCR is a failed requirement). Quarantine starts at Yes; No
 * needs a reason. `deviations_ncr_initiation_guard` says the same.
 */
export const ncrInitiationSchema = z
  .object({
    ncItem: z.enum(NC_ITEMS),
    ncItemOther: optional(160),
    title: z
      .string()
      .trim()
      .min(3, "Give the non-conformance a title — what it is, in a line.")
      .max(160, "Keep the title under 160 characters."),
    suppliedBy: z.enum(["supplier", "customer"]),
    materialCode: optional(60),
    supplierName: optional(120),
    /** Typed as one line; `parseLots` reads it. */
    lots: optional(400),
    qtyAffected: optional(120),
    /** Typed as one line; `parseBatches` reads it. */
    batches: optional(400),
    detectionPoint: z.union([z.enum(NCR_DETECTION_POINTS), z.literal("")]),
    occurredAt: dateTime.refine((v) => v !== "", "When was it found?"),
    departmentId: z.string().min(1, "Which department found it?"),
    location: optional(120),
    specification: z
      .string()
      .trim()
      .min(3, "Give the requirement or specification — spec and limit.")
      .max(2000, "Keep it under 2000 characters."),
    actual: z
      .string()
      .trim()
      .min(10, "Describe the non-conformance — what was found against the limit.")
      .max(2000, "Keep it under 2000 characters."),
    immediateAction: z
      .string()
      .trim()
      .min(2, "Say what was done straight away, or “None needed”.")
      .max(2000, "Keep it under 2000 characters."),
    hold: z.enum(["yes", "no"]),
    holdNotReason: optional(400),
    equipmentNo: optional(40),
    sopNumber: optional(60),
  })
  .superRefine((v, ctx) => {
    const need = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const material = isMaterialItem(v.ncItem);
    const product = isProductItem(v.ncItem);
    const party = partyWord(v.suppliedBy);

    if (v.ncItem === "Other" && !v.ncItemOther) need("ncItemOther", "What is it?");
    if (material) {
      if (!v.materialCode) need("materialCode", "Give the material code.");
      if (!v.supplierName) need("supplierName", `Name the ${party}.`);
      if (parseLots(v.lots).length === 0) need("lots", `Give the ${party} lot number(s).`);
      if (!v.qtyAffected) need("qtyAffected", "Give the quantity affected.");
      if (batchRequired(v.ncItem, v.detectionPoint) && parseBatches(v.batches).length === 0) {
        need("batches", `Found during ${v.detectionPoint.toLowerCase()}, so the batch is known.`);
      }
    }
    if (product) {
      if (parseBatches(v.batches).length === 0) need("batches", "Give the batches affected.");
      if (!v.qtyAffected) need("qtyAffected", "Give the quantity affected.");
    }
    if (v.detectionPoint === "") need("detectionPoint", "Where was it detected?");
    if (v.hold === "no" && !v.holdNotReason) {
      need(
        "holdNotReason",
        material ? "Say why the lot is not quarantined." : "Say why the batch is not put on hold.",
      );
    }
    // Read in validation, not in render — a submit is an event.
    if (v.occurredAt && new Date(v.occurredAt).getTime() > Date.now() + 5 * 60_000) {
      need("occurredAt", "The date found can't be in the future.");
    }
  });

export type NcrInitiationValues = z.infer<typeof ncrInitiationSchema>;

/* ── Tab 2 · Immediate / containment action ───────────────────────────── */

export const containmentSchema = z.object({
  immediateActionDate: date,
  immediateAction: optional(2000),
});

export type ContainmentValues = z.infer<typeof containmentSchema>;

/* ── Tab 3 · Risk assessment ──────────────────────────────────────────── */

/**
 * Three 1–5 scores (migration 0058) and a yes/no. Held as strings because
 * that is what a `SelectField` and a radio group deal in; `""` is *not
 * assessed yet*, which is a real state right up until the close-out gate
 * refuses it.
 */
const score = z.union([z.enum(["1", "2", "3", "4", "5"]), z.literal("")]);

export const riskSchema = z.object({
  likelihood: score,
  severity: score,
  detection: score,
  financialImpact: z.union([z.enum(["yes", "no"]), z.literal("")]),
  riskDescription: optional(1000),
});

export type RiskValues = z.infer<typeof riskSchema>;

/* ── Tab 4 · Investigation ────────────────────────────────────────────── */

export const investigationSchema = z.object({
  investigationFindings: optional(4000),
  rootCauseCategory: z.union([z.enum(ROOT_CAUSE_CATEGORIES), z.literal("")]),
  // Root cause analysis — on the case since 0061 (it was asked when a CAPA
  // was initiated).
  rootCause: optional(2000),
  rcaMethod: z.union([z.enum(RCA_METHODS), z.literal("")]),
});

export type InvestigationValues = z.infer<typeof investigationSchema>;

/* ── Tabs 5 & 6 · Corrective and preventive action ────────────────────── */

/**
 * One schema for both. They are the same five fields — owner, target date,
 * closed date, closed by, description — and the only difference is which
 * columns they are written to, which is the query's business.
 */
export const actionPlanSchema = z
  .object({
    owner: optional(80),
    targetDate: date,
    closedDate: date,
    closedBy: optional(80),
    description: optional(2000),
  })
  // A date it was closed on, with nothing recorded as done, is a tick in a
  // box. The database does not demand the pair, because a case may be closed
  // out with no CAPA at all — but if one is being recorded, it says what.
  .refine((v) => v.closedDate === "" || v.description.length > 0, {
    path: ["description"],
    message: "Say what was done before recording it as closed.",
  });

export type ActionPlanValues = z.infer<typeof actionPlanSchema>;

/* ── CAPA (migration 0057) ────────────────────────────────────────────── */

/**
 * The case's CAPA decision. "" is undecided — a real state until the
 * close-out, which refuses it. Saying No takes a reason, because "no CAPA"
 * with nothing beside it is indistinguishable from "nobody thought about it".
 */
export const capaDecisionSchema = z
  .object({
    needed: z.union([z.enum(["yes", "no"]), z.literal("")]),
    reason: optional(1000),
  })
  .refine((v) => v.needed !== "no" || v.reason.length >= 10, {
    path: ["reason"],
    message: "Say why no CAPA is needed.",
  });

export type CapaDecisionValues = z.infer<typeof capaDecisionSchema>;

/** Mirrors `capas_reason_known` in migration 0059 — why a case earns a CAPA. */
export const CAPA_REASONS = [
  "Critical / Major impact",
  "Recurring issue",
  "Systemic",
  "Regulatory / customer impact",
] as const;


/* ── The case's Actions tab and the CAPA (qms-v8, migration 0074) ───── */

/** "Is a CAPA required?" No — why the corrections are enough. */
export const capaNotNeededSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say why the corrections are enough — at least a sentence.")
    .max(1000, "Keep it under 1000 characters."),
});

export type CapaNotNeededValues = z.infer<typeof capaNotNeededSchema>;

/** A correction — what was done to fix this case, who did it, and when. */
export const correctionSchema = z.object({
  what: z
    .string()
    .trim()
    .min(3, "Describe what was done.")
    .max(1000, "Keep it under 1000 characters."),
  who: z
    .string()
    .trim()
    .min(1, "Say who did it.")
    .max(80, "Keep the name under 80 characters."),
  doneOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was done."),
});

export type CorrectionValues = z.infer<typeof correctionSchema>;

/** Removing a correction — why (0075; EU GMP Annex 11 §9). */
export const correctionRemoveSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Say why it is removed — at least a few words.")
    .max(500, "Keep it under 500 characters."),
});

export type CorrectionRemoveValues = z.infer<typeof correctionRemoveSchema>;

/** An action added once the plan is approved (Implement). */
export const capaActionAddSchema = z.object({
  description: z
    .string()
    .trim()
    .min(3, "Describe the action.")
    .max(2000, "Keep the description under 2000 characters."),
  owner: z
    .string()
    .trim()
    .min(1, "Choose the owner.")
    .max(80, "Keep the name under 80 characters."),
  targetDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the target date."),
});

export type CapaActionAddValues = z.infer<typeof capaActionAddSchema>;

/** Marking an action done — the completion evidence and the date. */
export const capaDoneSchema = z.object({
  evidence: z
    .string()
    .trim()
    .min(3, "Add the completion evidence — what was done and where it is recorded.")
    .max(1000, "Keep the evidence under 1000 characters."),
  // The date it was done, not the day it is recorded (0075). Any date (0081).
  doneOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was done."),
});

export type CapaDoneValues = z.infer<typeof capaDoneSchema>;

/** Withdraw a CAPA still in Plan — why (0075). */
export const capaWithdrawSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Say why the CAPA is withdrawn — at least a sentence.")
    .max(1000, "Keep it under 1000 characters."),
});

export type CapaWithdrawValues = z.infer<typeof capaWithdrawSchema>;

/**
 * Verify effectiveness — Effective closes the CAPA; Not effective needs the
 * date the check is repeated on. `record_capa_check` re-checks all of it.
 */
export const capaCheckSchema = z
  .object({
    result: z.enum(["effective", "not_effective"]),
    findings: z
      .string()
      .trim()
      .min(10, "Add the findings — what you checked and what you found.")
      .max(2000, "Keep it under 2000 characters."),
    nextCheck: z.string().trim(),
  })
  .refine((v) => v.result === "effective" || /^\d{4}-\d{2}-\d{2}$/.test(v.nextCheck), {
    path: ["nextCheck"],
    message: "Set the next check date.",
  });

export type CapaCheckValues = z.infer<typeof capaCheckSchema>;

/* ── Tab 7 · Close out ────────────────────────────────────────────────── */

/**
 * The one gate. Everything the seven tabs marked with a `*` is re-checked
 * here so the refusal arrives beside the field rather than as a toast from
 * the database — which is also why it carries the other tabs' answers.
 */
export const closeOutSchema = z
  .object({
    isNcr: z.boolean(),
    disposition: z.union([z.enum(DISPOSITION_VALUES), z.literal("")]),
    owner: optional(80),
    targetDate: date,
    description: z
      .string()
      .trim()
      .min(10, "Record the close-out — what was decided and what was done.")
      .max(2000, "Keep the close-out under 2000 characters."),
    statusReason: z.enum(STATUS_REASONS, {
      message: "Say why the case is being closed.",
    }),
    closedBy: z
      .string()
      .trim()
      .min(1, "Closing needs a name against it.")
      .max(80, "Keep the name under 80 characters."),
  })
  .refine((v) => !v.isNcr || v.disposition !== "", {
    path: ["disposition"],
    message: "What happened to the material? Choose a final disposition.",
  })
  .refine((v) => !v.isNcr || v.disposition !== "quarantine", {
    path: ["disposition"],
    message:
      "Quarantine is a hold, not an outcome — choose use as is, rework or reject.",
  });

export type CloseOutValues = z.infer<typeof closeOutSchema>;

/* ── A deviation's initial assessment (migration 0063) ────────────────── */

/** Mirrors `deviations_red_flags_known`. Any one means severity 5. */
export const RED_FLAGS = [
  "Product mix-up",
  "Wrong identity or strength",
  "Suspected contamination",
  "Potential recall",
  "Data integrity concern",
] as const;

export const CLASSES = ["Critical", "Major", "Minor"] as const;
export type CaseClass = (typeof CLASSES)[number];

const yesNo = z.union([z.enum(["yes", "no"]), z.literal("")]);

/* ── The risk, as the reference QMS scores it (0068) ── */

/**
 * Severity — the outcome for the product, not the cause. The key question is
 * whether it was contained before release (3) or reached the market (4).
 */
export const DEV_SEVERITY = [
  "No product impact — documentation or GMP procedure slip",
  "Product within specification — process outside its normal limits or settings",
  "Product out of specification, contained before release — rework, reprocess or reject",
  "Defect may have reached the market — released or shipped product affected",
  "Risk to patient safety — wrong product or strength, contamination, recall likely",
] as const;

/** An example of each severity, shown under the field once one is picked. */
export const DEV_SEVERITY_EXAMPLES = [
  "e.g. late or missing entry corrected, wrong form version, line clearance signed late",
  "e.g. powder sticking to punches but tablets pass; hardness drifting near the limit; extra mixing time with passing results",
  "e.g. hardness or weight out of specification at IPC; dented capsules above AQL; batch reworked or rejected",
  "e.g. released batch later fails stability; wrong lot number found on shipped labels",
  "e.g. two products mixed up; metal contamination; wrong active ingredient",
] as const;

/** Likelihood — how often has this happened? 1–3. */
export const DEV_LIKELIHOOD = [
  "First known occurrence",
  "Happened before",
  "Recurring",
] as const;

/** What each likelihood means, in previous cases. */
export const DEV_LIKELIHOOD_HELP = [
  "No previous case found in the last 24 months",
  "1–3 previous cases in the last 24 months",
  "4 or more previous cases, or 2 within 90 days",
] as const;

/** The search window for previous cases, and the "recurring fast" window. */
export const PREVIOUS_WINDOW_MONTHS = 24;
export const RECURRING_FAST_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * The likelihood the picked previous cases suggest — the same rule as
 * `deviations_assessment_guard`: 4 or more, or 2 raised within 90 days of
 * this case, is 3 (recurring); any is 2; none is 1.
 */
export function suggestedLikelihood(
  raisedAt: string,
  previous: readonly { raisedAt: string }[],
): 1 | 2 | 3 {
  const from = new Date(raisedAt).getTime();
  const fast = previous.filter(
    (p) => Math.abs(new Date(p.raisedAt).getTime() - from) <= RECURRING_FAST_DAYS * DAY_MS,
  ).length;
  if (previous.length >= 4 || fast >= 2) return 3;
  return previous.length > 0 ? 2 : 1;
}

/** Severity 1–2, 3–4, 5 → the risk table's row (0, 1, 2). */
export function severityRow(severity: number): 0 | 1 | 2 {
  return severity >= 5 ? 2 : severity >= 3 ? 1 : 0;
}

/** The risk table's rows, as the table labels them. */
export const SEVERITY_ROWS = [
  "1–2 · no product impact / within spec",
  "3–4 · out of spec / may have reached market",
  "5 · patient safety, mix-up, recall",
] as const;

/** Severity row × likelihood → class. */
export const RISK_MATRIX: readonly (readonly CaseClass[])[] = [
  ["Minor", "Minor", "Major"],
  ["Major", "Major", "Critical"],
  ["Critical", "Critical", "Critical"],
];

/**
 * The class the scores propose — the same rule as the database. Any red flag
 * is Critical; otherwise read from the table. Null until both are scored.
 */
export function proposedClass(v: {
  redFlags: readonly string[];
  severity: string;
  likelihood: string;
}): CaseClass | null {
  if (v.redFlags.length > 0) return "Critical";
  if (!v.severity || !v.likelihood) return null;
  return RISK_MATRIX[severityRow(Number(v.severity))][Number(v.likelihood) - 1];
}

/**
 * The assessment as a draft: anything may be blank, so QA can save half of
 * it and come back. `assessmentSignSchema` is the same form, demanding what
 * the signature does.
 *
 * `raisedAt` and each previous case's `raisedAt` are carried so the
 * suggested likelihood can be checked here; only the ids are saved.
 */
export const assessmentSchema = z.object({
  /** A deviation's category, or an NCR's defect type (0077). */
  category: z.union([
    z.enum(NC_CATEGORIES),
    z.enum(NCR_CATEGORIES),
    z.enum(COMPLAINT_CATEGORIES),
    z.literal(""),
  ]),
  /** An NCR's "Other" defect, described. */
  categoryOther: optional(160),
  ownerName: optional(80),
  investigationRequired: yesNo,
  investigationNotRequiredReason: optional(1000),
  redFlags: z.array(
    z.union([z.enum(RED_FLAGS), z.enum(NCR_RED_FLAGS), z.enum(COMPLAINT_RED_FLAGS)]),
  ),
  severity: score,
  likelihood: z.union([z.enum(["1", "2", "3"]), z.literal("")]),
  raisedAt: z.string(),
  previousCases: z.array(z.object({ id: z.string().uuid(), raisedAt: z.string() })),
  noPreviousFound: z.boolean(),
  previousCasesExternal: optional(300),
  classification: z.union([z.enum(CLASSES), z.literal("")]),
  classificationReason: optional(1000),
  rationale: optional(1000),
  /** Context, not saved: the case is an NCR. */
  ncr: z.boolean(),
  /** Context, not saved: an NCR found after receipt — the investigation cannot be skipped. */
  forcedInvestigation: z.boolean(),

  /* ── A complaint's assessment (0079) ── */
  /** Context, not saved: the case is a complaint. */
  complaint: z.boolean(),
  /** Context, not saved: the complaint reports an adverse reaction. */
  adverse: z.boolean(),
  /** The investigating department, when an investigation is required. */
  departmentId: z.string(),
  stockAffected: z.union([z.enum(STOCK_AFFECTED), z.literal("")]),
  sponsorNotifiedOn: z.string(),
  reportable: yesNo,
  reportReason: optional(1000),
  reportType: z.union([z.enum(REPORT_TYPES), z.literal("")]),
  reportDue: z.string(),
  reportedOn: z.string(),
  reportRef: optional(80),
});

export type AssessmentValues = z.infer<typeof assessmentSchema>;

export const assessmentSignSchema = assessmentSchema.superRefine((v, ctx) => {
  const need = (path: keyof AssessmentValues, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (!v.category) need("category", v.ncr ? "Choose the defect type." : "Choose the category.");
  if ((v.ncr || v.complaint) && v.category === "Other" && v.categoryOther.length < 2) {
    need("categoryOther", v.complaint ? "Describe the complaint type." : "Describe the defect.");
  }
  if (v.complaint) {
    if (v.investigationRequired === "yes" && !v.departmentId) {
      need("departmentId", "Which department investigates?");
    }
    if (!v.stockAffected) need("stockAffected", "Could released stock be affected?");
    const triggered =
      v.adverse || v.redFlags.length > 0 || v.category === "Suspected counterfeit or tampering";
    if (triggered) {
      if (!v.reportable) need("reportable", "Is a report to the regulator needed?");
      if (v.reportable === "no" && v.reportReason.length < 2) {
        need("reportReason", "Say why no report is needed.");
      }
      if (v.reportable === "yes") {
        if (!v.reportType) need("reportType", "Choose the report type.");
        if (!v.reportDue) need("reportDue", "When is the report due?");
      }
    }
  }
  if (v.forcedInvestigation && v.investigationRequired !== "yes") {
    need(
      "investigationRequired",
      "Required: found after receipt, so batches may already contain the material.",
    );
  }
  if (!v.ownerName) need("ownerName", "Name the case owner.");
  if (!v.investigationRequired) {
    need("investigationRequired", "Is an investigation required?");
  }
  if (
    v.investigationRequired === "no" &&
    v.investigationNotRequiredReason.length < 5
  ) {
    need("investigationNotRequiredReason", "Say why no investigation is needed.");
  }
  if (!v.severity) need("severity", "Score the severity.");
  if (!v.likelihood) need("likelihood", "How often has this happened?");
  if (
    v.likelihood === "1" &&
    v.previousCases.length === 0 &&
    !v.noPreviousFound
  ) {
    need(
      "likelihood",
      "Tick \"Searched records — no previous case found\", or pick the previous cases.",
    );
  }
  if (
    (v.likelihood === "2" || v.likelihood === "3") &&
    v.previousCases.length === 0 &&
    !v.previousCasesExternal
  ) {
    need(
      "likelihood",
      "Pick the previous cases (or record the ones kept outside FactoryOS) as evidence.",
    );
  }
  if (!v.classification) need("classification", "Classify the case.");
  const proposed = proposedClass(v);
  if (
    v.classification &&
    proposed &&
    v.classification !== proposed &&
    v.classificationReason.length < 5
  ) {
    need(
      "classificationReason",
      `Say why it is ${v.classification}, not ${proposed}.`,
    );
  }
  const suggested = suggestedLikelihood(v.raisedAt, v.previousCases);
  if (v.rationale.length < 5) {
    if (v.classification === "Critical" || v.classification === "Major") {
      need("rationale", `A ${v.classification} case needs the rationale.`);
    } else if (v.likelihood && Number(v.likelihood) < suggested) {
      need(
        "rationale",
        `The picked cases suggest likelihood ${suggested} — explain the lower choice.`,
      );
    }
  }
});

/* ── A deviation's investigation (migration 0064) ─────────────────────── */

/**
 * What the investigation usually looks at — the list the form offers (qms-v5).
 * Since 0070 each ticked item carries what it showed, and other items may be
 * added; the database no longer limits the list.
 */
export const CHECKS_REVIEWED = [
  "Batch record",
  "Equipment history",
  "Previous similar cases",
  "Environmental data",
  "Raw material or packaging changes",
  "Training records",
  "Other batches",
] as const;

/** The 6M — `deviations_root_cause_categories_known`. Several may be ticked. */
export const ROOT_CAUSE_6M = [
  "Man (people)",
  "Machine",
  "Method",
  "Material",
  "Measurement",
  "Environment",
] as const;

/** `deviations_root_cause_conclusion_known`. */
export const RC_CONCLUSIONS = ["Confirmed", "Probable", "Not confirmed"] as const;

/** `deviations_rca_method_known` since 0064 — "Simple review" for minor cases. */
export const DEV_RCA_METHODS = ["Simple review", ...RCA_METHODS] as const;

/**
 * The investigation as a draft — anything may be blank while it is written.
 * `devInvestigationSubmitSchema` demands what submitting does.
 */
export const devInvestigationSchema = z.object({
  otherBatches: optional(400),
  impact: optional(2000),
  reviewChecks: z.array(
    z.object({
      item: z.string().trim().min(1).max(120),
      finding: optional(1000),
    }),
  ),
  findings: optional(4000),
  rootCauseCategories: z.array(z.enum(ROOT_CAUSE_6M)),
  humanProcedureClear: yesNo,
  humanTrained: yesNo,
  humanPreventable: yesNo,
  rootCause: optional(2000),
  conclusion: z.union([z.enum(RC_CONCLUSIONS), z.literal("")]),
  method: z.union([z.enum(DEV_RCA_METHODS), z.literal("")]),
  /** An NCR found at QC testing (0077): lab error ruled out? */
  labCheck: z.union([z.enum(LAB_CHECK), z.literal("")]),
  labRef: optional(80),
  /** Context, not saved: the laboratory check is asked. */
  labRequired: z.boolean(),
  /** Context, not saved: the items the investigation must cover. */
  requiredChecks: z.array(z.string()),
  /** A complaint's scope instead of a product impact assessment (0079). */
  scope: z.union([z.enum(SCOPES), z.literal("")]),
  /** Context, not saved: the case is a complaint. */
  complaint: z.boolean(),
});

export type DevInvestigationValues = z.infer<typeof devInvestigationSchema>;

export const devInvestigationSubmitSchema = devInvestigationSchema.superRefine(
  (v, ctx) => {
    const need = (path: keyof DevInvestigationValues, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.labRequired) {
      if (!v.labCheck) need("labCheck", "Was a lab error ruled out?");
      else if (v.labCheck === "No") {
        need("labCheck", "A lab error was found: close the case as not a non-conformance.");
      } else if (v.labCheck === "In progress") {
        need("labCheck", "Finish the lab investigation first.");
      }
      if (!v.labRef) need("labRef", "Give the lab investigation reference.");
    }
    const ticked = new Set(v.reviewChecks.map((c) => c.item.toLowerCase()));
    const notCovered = v.requiredChecks.filter((r) => !ticked.has(r.toLowerCase()));
    if (notCovered.length > 0) {
      need("reviewChecks", `Also review: ${notCovered.join(", ")}.`);
    }
    if (v.complaint) {
      if (!v.scope) need("scope", "How far does the problem go?");
      if (v.scope === "Other batches too" && !v.otherBatches) {
        need("otherBatches", "Name the other batches affected.");
      }
    } else if (v.impact.length < 5) {
      need("impact", "Assess the impact on the product.");
    }
    const blank = v.reviewChecks.filter((c) => !c.finding).map((c) => c.item);
    if (blank.length > 0 && notCovered.length === 0) {
      need(
        "reviewChecks",
        `Write what each reviewed item showed — ${blank.join(", ")} ${blank.length === 1 ? "has" : "have"} no finding yet.`,
      );
    }
    if (v.findings.length < 10) need("findings", "Record what the investigation found.");
    if (v.rootCauseCategories.length === 0) {
      need("rootCauseCategories", "Tick at least one category.");
    }
    if (v.rootCauseCategories.includes("Man (people)")) {
      if (!v.humanProcedureClear) need("humanProcedureClear", "Answer this.");
      if (!v.humanTrained) need("humanTrained", "Answer this.");
      if (!v.humanPreventable) need("humanPreventable", "Answer this.");
    }
    if (v.rootCause.length < 5) need("rootCause", "State the root cause.");
    if (!v.conclusion) {
      need("conclusion", v.complaint ? "Is the complaint confirmed?" : "Confirmed, probable or not confirmed?");
    }
    if (!v.method) need("method", "Choose the analysis tool.");
  },
);

/* ── A customer complaint (migration 0079) ─────────────────────────────── */

/**
 * Raising a complaint — the page at `/deviations/new?type=complaint`, the
 * reference QMS's complaint form (qms-v12 "v11"): title; date received and
 * via; complainant and contact; market; batch(es), or the product when the
 * batch is unknown; brand owner; who the sponsor is and the ARTG (asked here
 * for now); expiry and units affected; the description; an adverse reaction
 * (what, and whether serious); the complaint sample; immediate action.
 * `deviations_complaint_guard` says the same.
 */
export const complaintInitiationSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Give the complaint a title — what it is, in a line.")
      .max(160, "Keep the title under 160 characters."),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "When was it received?"),
    receivedVia: z.union([z.enum(COMPLAINT_CHANNELS), z.literal("")]),
    complainant: z.union([z.enum(COMPLAINANTS), z.literal("")]),
    contact: optional(160),
    country: z.enum(COUNTRIES),
    batches: optional(400),
    productLabel: optional(160),
    customerName: optional(160),
    expiry: optional(20),
    unitsAffected: optional(120),
    actual: z
      .string()
      .trim()
      .min(10, "Describe the complaint — what they found, how many, when.")
      .max(2000, "Keep it under 2000 characters."),
    adverse: z.union([z.enum(["yes", "no"]), z.literal("")]),
    adverseWhat: optional(1000),
    serious: z.union([z.enum(["yes", "no"]), z.literal("")]),
    sample: z.union([z.enum(SAMPLE_STATES), z.literal("")]),
    sampleReceivedOn: z.string(),
    immediateAction: optional(2000),
  })
  .superRefine((v, ctx) => {
    const need = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (!v.receivedVia) need("receivedVia", "How was it received?");
    if (!v.complainant) need("complainant", "Who made the complaint?");
    if (parseBatches(v.batches).length === 0 && !v.productLabel) {
      need("productLabel", "Needed when the batch is unknown.");
    }
    if (!v.adverse) need("adverse", "Was an injury or adverse reaction reported?");
    if (v.adverse === "yes") {
      if (!v.adverseWhat) need("adverseWhat", "What reaction, and when?");
      if (!v.serious) need("serious", "Is it serious?");
    }
    if (!v.sample) need("sample", "Is there a complaint sample?");
    if (v.sample === "Received" && !v.sampleReceivedOn) {
      need("sampleReceivedOn", "When was the sample received?");
    }
    // Read in validation, not in render — a submit is an event.
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const todayKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    if (v.receivedOn && v.receivedOn > todayKey) {
      need("receivedOn", "The date received can't be in the future.");
    }
  });

export type ComplaintInitiationValues = z.infer<typeof complaintInitiationSchema>;

/** "Mark acknowledged": how — and, when late, why. */
export const ackSchema = z.object({
  how: optional(400),
});

/** The market action — first on a complaint's Actions tab. */
export const marketActionSchema = z
  .object({
    market: z.union([z.enum(MARKET_ACTIONS), z.literal("")]),
    recallClass: z.union([z.enum(RECALL_CLASSES), z.literal("")]),
    recallLevel: z.union([z.enum(RECALL_LEVELS), z.literal("")]),
    recallRef: optional(80),
    why: optional(2000),
  })
  .superRefine((v, ctx) => {
    const need = (path: keyof typeof v, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (!v.market) need("market", "Choose the market action.");
    if (v.market === "Recall") {
      if (!v.recallClass) need("recallClass", "Which recall class?");
      if (!v.recallLevel) need("recallLevel", "Which recall level?");
    }
    if (v.why.length < 2) need("why", "Give the decision and its rationale.");
  });

export type MarketActionValues = z.infer<typeof marketActionSchema>;

/* ── A non-conformance's actions (migration 0077) ─────────────────────── */

/**
 * The disposition — QA's decision on the non-conforming material or product,
 * and what that decision needs. `ncrDispositionSignSchema` demands it all,
 * as `ncr_disposition_missing()` does before `sign_ncr_disposition`.
 */
export const ncrDispositionSchema = z.object({
  disposition: z.union([
    z.enum(["use_as_is", "sort", "rework", "destroy", "return"]),
    z.literal(""),
  ]),
  concessionScope: optional(300),
  dispositionReason: optional(1000),
  concession: z.union([z.enum(["not_needed", "customer"]), z.literal("")]),
  concessionRef: optional(200),
  sortRef: optional(200),
  sortAccepted: optional(80),
  sortRejected: optional(80),
  reworkInstruction: optional(300),
  retest: z.union([z.enum(["Pass", "Fail"]), z.literal("")]),
});

export type NcrDispositionValues = z.infer<typeof ncrDispositionSchema>;

export const ncrDispositionSignSchema = ncrDispositionSchema.superRefine((v, ctx) => {
  const need = (path: keyof NcrDispositionValues, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (!v.disposition) need("disposition", "Choose the disposition.");
  if (v.disposition === "use_as_is") {
    if (!v.concessionScope) need("concessionScope", "Which lot and how much.");
    if (!v.dispositionReason) need("dispositionReason", "Say why it can be used as is.");
    if (!v.concession) need("concession", "Is a customer concession needed?");
    if (v.concession === "customer" && !v.concessionRef) {
      need("concessionRef", "Give the customer's approval reference.");
    }
  }
  if (v.disposition === "sort") {
    if (!v.sortRef) need("sortRef", "Give the sorting record.");
    if (!v.sortAccepted) need("sortAccepted", "How many were accepted?");
    if (!v.sortRejected) need("sortRejected", "How many were rejected?");
  }
  if (v.disposition === "rework") {
    if (!v.reworkInstruction) need("reworkInstruction", "Give the rework instruction.");
    if (v.retest === "Fail") {
      need("retest", "The re-test failed — choose Reject or Return to supplier.");
    } else if (v.retest !== "Pass") {
      need("retest", "Record the re-test result.");
    }
  }
});

/** "" or `YYYY-MM-DD`. */
const day = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date.");

/**
 * A material's supplier (or, client-supplied, customer) follow-up. Saved as
 * it is filled; closing needs it complete (`ncr_supplier_missing()`).
 */
export const ncrSupplierSchema = z
  .object({
    notifiedOn: day,
    claim: optional(200),
    scar: yesNo,
    scarNotReason: optional(400),
    scarRef: optional(80),
    scarDue: day,
    scarReplyOn: day,
    scarAccepted: yesNo,
    tightened: yesNo,
    tightenedLots: optional(80),
  });

export type NcrSupplierValues = z.infer<typeof ncrSupplierSchema>;

/** A finished-product NCR: the customer (brand owner) told, or why not. */
export const ncrCustomerSchema = z.object({
  notify: z.union([z.enum(["yes", "not_needed"]), z.literal("")]),
  notifiedOn: day,
  reason: optional(400),
});

export type NcrCustomerValues = z.infer<typeof ncrCustomerSchema>;

/** Closing an NCR as not a non-conformance — the reason. */
export const notACaseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Say why — at least a few words.")
    .max(1000, "Keep it under 1000 characters."),
});

export type NotACaseValues = z.infer<typeof notACaseSchema>;

/* ── Attachments (migration 0064) ─────────────────────────────────────── */

/** 10 MB — the `case-files` bucket's own limit, which is the real one. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The bucket's `allowed_mime_types`, with the extensions a picker offers. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg,.jpeg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
  "text/plain": ".txt",
};

/* ── A deviation's close-out (migration 0065) ─────────────────────────── */

/** The reasons a deviation closes for — `deviations_status_reason_known`. */
export const DEV_CLOSE_REASONS = [
  "Resolved",
  "No action required",
  "Duplicate",
] as const;

/** The close-out as a draft; `devCloseOutSignSchema` demands the signature's. */
export const devCloseOutSchema = z.object({
  /** A complaint's final reply to the complainant (0079). */
  finalReply: optional(2000),
  replySentOn: z.string(),
  resolution: z.union([z.enum(RESOLUTIONS), z.literal("")]),
  /** Context, not saved: the case is a complaint. */
  complaint: z.boolean(),
  unresolvedRisk: yesNo,
  summary: optional(2000),
  reason: z.union([z.enum(DEV_CLOSE_REASONS), z.literal("")]),
  duplicateOf: optional(40),
  /** Typed as text, e.g. "1250.50"; blank is not recorded. */
  cost: z
    .string()
    .trim()
    .regex(/^(\d{1,10}(\.\d{1,2})?)?$/, "A sum in dollars, e.g. 1250.50."),
});

export type DevCloseOutValues = z.infer<typeof devCloseOutSchema>;

export const devCloseOutSignSchema = devCloseOutSchema.superRefine((v, ctx) => {
  if (v.complaint) {
    if (v.finalReply.length < 2) {
      ctx.addIssue({ code: "custom", path: ["finalReply"], message: "What was the complainant told?" });
    }
    if (!v.replySentOn) {
      ctx.addIssue({ code: "custom", path: ["replySentOn"], message: "When was the reply sent?" });
    }
  }
  const need = (path: keyof DevCloseOutValues, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (v.unresolvedRisk === "") {
    need("unresolvedRisk", "Is any product or patient risk unresolved?");
  }
  if (v.unresolvedRisk === "yes") {
    need(
      "unresolvedRisk",
      "The case cannot close while risk remains. Keep it open or raise a new case.",
    );
  }
  if (v.summary.length < 10) {
    need("summary", "Record what was decided, what was done, and any risk that remains.");
  }
  if (!v.reason) need("reason", "Why is the case being closed?");
  if (v.reason === "Duplicate" && !v.duplicateOf) {
    need("duplicateOf", "Which case does it duplicate?");
  }
});

/**
 * Asking to extend a deviation's due date (migration 0072): a later date and
 * the reason. Built from the current due date, so the date error names it;
 * `request_due_extension` re-checks both.
 */
export function dueExtensionSchema(currentDue: string) {
  return z.object({
    toDate: z
      .string()
      .min(1, { error: "Pick the new due date." })
      .refine((v) => v > currentDue, {
        error: "Pick a date after the current due date.",
      }),
    reason: z
      .string()
      .trim()
      .min(5, { error: "Give the reason more time is needed." })
      .max(1000),
  });
}

export type DueExtensionValues = z.infer<ReturnType<typeof dueExtensionSchema>>;
