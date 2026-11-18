import { z } from "zod";

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

/** Mirrors `deviations_nc_category_known`. */
export const NC_CATEGORIES = [
  "Raw material",
  "Packaging",
  "Labelling",
  "Process",
  "Equipment",
  "Documentation",
  "Product quality",
  "Storage & handling",
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


/**
 * Resolve directly — a correction and no CAPA. Stored as the case's "reason
 * no CAPA is needed", which is what the close-out reads.
 */
export const resolveDirectSchema = z.object({
  correction: z
    .string()
    .trim()
    .min(10, "Say what was done to correct it, and why no CAPA is needed.")
    .max(1000, "Keep it under 1000 characters."),
});

export type ResolveDirectValues = z.infer<typeof resolveDirectSchema>;

/** An action's status while it is being worked; closing is its own step. */
export const ACTION_STATUSES = ["open", "in_progress"] as const;

/**
 * Initiate a CAPA from a case — only its actions: each CA / PA with a target
 * (due) date, a status and an owner. The CAPA takes the case's title; its
 * reason, owner, dates and verification are filled in later from the
 * register. Rows with no description are dropped rather than refused — the
 * form opens with one CA and one PA row, and a case with only a corrective
 * action leaves the PA row blank — but at least one action is needed.
 */
export const capaInitiateSchema = z.object({
  actions: z
    .array(
      z.object({
        kind: z.enum(["ca", "pa"]),
        description: optional(2000),
        owner: optional(80),
        targetDate: date,
        status: z.enum(ACTION_STATUSES),
      }),
    )
    .refine((rows) => rows.some((r) => r.description.length > 0), {
      message: "Add at least one corrective or preventive action.",
    }),
});

export type CapaInitiateValues = z.infer<typeof capaInitiateSchema>;

/** Raising a CAPA from a case — the title and its owner; the rest follows. */
export const capaCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the CAPA a title — what it fixes, in a line.")
    .max(160, "Keep the title under 160 characters."),
  owner: optional(80),
});

export type CapaCreateValues = z.infer<typeof capaCreateSchema>;

/** The CAPA's own header, editable while it is open. */
export const capaHeaderSchema = capaCreateSchema.extend({
  reason: z.union([z.enum(CAPA_REASONS), z.literal("")]),
  targetDate: date,
  effectivenessCriteria: optional(1000),
  verifyBy: date,
});

export type CapaHeaderValues = z.infer<typeof capaHeaderSchema>;

/**
 * One action on a CAPA — the five fields the old CA / PA tabs had, plus which
 * of the two it is. Closing it is a separate step (`capaActionCloseSchema`),
 * because a closed action is frozen.
 */
export const capaActionSchema = z.object({
  kind: z.enum(["ca", "pa"]),
  description: z
    .string()
    .trim()
    .min(5, "Describe the action.")
    .max(2000, "Keep the description under 2000 characters."),
  owner: optional(80),
  targetDate: date,
  status: z.enum(ACTION_STATUSES),
});

export type CapaActionValues = z.infer<typeof capaActionSchema>;

export const capaActionCloseSchema = z.object({
  closedDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was closed."),
  closedBy: z
    .string()
    .trim()
    .min(1, "Closing an action needs a name against it.")
    .max(80, "Keep the name under 80 characters."),
});

export type CapaActionCloseValues = z.infer<typeof capaActionCloseSchema>;

/** Open → effective. `capas_guard` re-checks all of it, plus the actions. */
export const capaVerifySchema = z.object({
  effectivenessCriteria: z
    .string()
    .trim()
    .min(5, "Say what would show the CAPA worked.")
    .max(1000, "Keep the criteria under 1000 characters."),
  verification: z
    .string()
    .trim()
    .min(10, "Record the verification — what was checked and what it showed.")
    .max(2000, "Keep the verification under 2000 characters."),
  verifiedBy: z
    .string()
    .trim()
    .min(1, "Verifying needs a name against it.")
    .max(80, "Keep the name under 80 characters."),
});

export type CapaVerifyValues = z.infer<typeof capaVerifySchema>;

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

/** Days from raising to the due date, by class — `deviations_assessment_guard`. */
export const CLASS_DUE_DAYS: Record<CaseClass, number> = {
  Critical: 15,
  Major: 30,
  Minor: 60,
};

const yesNo = z.union([z.enum(["yes", "no"]), z.literal("")]);

/**
 * The assessment as a draft: anything may be blank, so QA can save half of
 * it and come back. `assessmentSignSchema` is the same form, demanding what
 * the signature does.
 */
export const assessmentSchema = z.object({
  category: z.union([z.enum(NC_CATEGORIES), z.literal("")]),
  ownerName: optional(80),
  investigationRequired: yesNo,
  investigationNotRequiredReason: optional(1000),
  redFlags: z.array(z.enum(RED_FLAGS)),
  severity: score,
  detection: score,
  likelihood: score,
  classification: z.union([z.enum(CLASSES), z.literal("")]),
  classificationReason: optional(1000),
  rationale: optional(1000),
});

export type AssessmentValues = z.infer<typeof assessmentSchema>;

/**
 * The class the scores propose — the same rule as the database. Any red flag
 * is Critical; then High → Critical, Medium (or severity 4) → Major, else
 * Minor. Null until all three scores are in.
 */
export function proposedClass(v: {
  redFlags: readonly string[];
  severity: string;
  detection: string;
  likelihood: string;
}): CaseClass | null {
  if (v.redFlags.length > 0) return "Critical";
  if (!v.severity || !v.detection || !v.likelihood) return null;
  const sev = Number(v.severity);
  const n = sev * Number(v.detection) * Number(v.likelihood);
  if (sev === 5 || n >= 60) return "Critical";
  if (n >= 20 || sev === 4) return "Major";
  return "Minor";
}

export const assessmentSignSchema = assessmentSchema.superRefine((v, ctx) => {
  const need = (path: keyof AssessmentValues, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (!v.category) need("category", "Choose the category.");
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
  if (!v.detection) need("detection", "Which control would catch it?");
  if (!v.likelihood) need("likelihood", "Score the likelihood.");
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
  if (
    (v.classification === "Critical" || v.classification === "Major") &&
    v.rationale.length < 5
  ) {
    need("rationale", `A ${v.classification} case needs the rationale.`);
  }
});
