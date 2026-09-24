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

export const DEVIATION_TYPE_VALUES = ["planned", "unplanned", "ncr"] as const;
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
      message: "Planned deviation, unplanned deviation, or NCR?",
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

    disposition: z.union([z.enum(DISPOSITION_VALUES), z.literal("")]),
    actionId: z.string(),
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

/* ── Tab 2 · Immediate / containment action ───────────────────────────── */

export const containmentSchema = z.object({
  immediateActionDate: date,
  immediateAction: optional(2000),
});

export type ContainmentValues = z.infer<typeof containmentSchema>;

/* ── Tab 3 · Risk assessment ──────────────────────────────────────────── */

/**
 * Three 1–3 scores and a yes/no. Held as strings because that is what a
 * `SelectField` and a radio group deal in; `""` is *not assessed yet*, which
 * is a real state right up until the close-out gate refuses it.
 */
export const riskSchema = z.object({
  likelihood: z.union([z.enum(["1", "2", "3"]), z.literal("")]),
  severity: z.union([z.enum(["1", "2", "3"]), z.literal("")]),
  detection: z.union([z.enum(["1", "2", "3"]), z.literal("")]),
  financialImpact: z.union([z.enum(["yes", "no"]), z.literal("")]),
  riskDescription: optional(1000),
});

export type RiskValues = z.infer<typeof riskSchema>;

/* ── Tab 4 · Investigation ────────────────────────────────────────────── */

export const investigationSchema = z.object({
  investigationFindings: optional(4000),
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
