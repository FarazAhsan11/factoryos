import { z } from "zod";

/**
 * Deviations & NCRs.
 *
 * Client-side validation for UX; `deviations_guard` (migration 0044) and the
 * table's check constraints are the authority, and say the same things.
 *
 * Optional text fields are plain strings that may be empty rather than
 * `.optional()`, for the reason the maintenance schemas give: the form always
 * supplies "" from its defaults, and the queries turn blank into null.
 */

export const DEVIATION_TYPE_VALUES = ["planned", "unplanned", "ncr"] as const;
export const DISPOSITION_VALUES = [
  "use_as_is",
  "rework",
  "reject",
  "quarantine",
] as const;

export const deviationSchema = z
  .object({
    // No default in the form: which kind of record this is decides its number,
    // and a pre-selected answer is one nobody gave.
    type: z.enum(DEVIATION_TYPE_VALUES, {
      message: "Is this a planned deviation, an unplanned one, or an NCR?",
    }),

    // Typed, like everywhere else a batch is referenced. The database resolves
    // it to a product — which is what lets a quarantine hold the right card.
    batchNo: z.string().trim().max(60),

    specification: z
      .string()
      .trim()
      .max(500, "Keep the specification under 500 characters."),

    actual: z
      .string()
      .trim()
      .min(10, "Describe what actually happened.")
      .max(2000, "Keep the description under 2000 characters."),

    impact: z
      .string()
      .trim()
      .max(1000, "Keep the impact under 1000 characters."),

    // "" until chosen; only an NCR asks for one.
    disposition: z.union([z.enum(DISPOSITION_VALUES), z.literal("")]),

    raisedBy: z.string().trim().max(80),
    qaReviewer: z.string().trim().max(80),
    actionId: z.string(),
  })
  .refine((v) => v.type !== "ncr" || v.disposition !== "", {
    path: ["disposition"],
    message: "An NCR needs a disposition decision.",
  })
  // A quarantine without a batch holds nothing, and says it does.
  .refine(
    (v) =>
      v.type !== "ncr" || v.disposition !== "quarantine" || v.batchNo.length > 0,
    {
      path: ["batchNo"],
      message: "Quarantine holds a batch — say which one.",
    },
  );

export type DeviationValues = z.infer<typeof deviationSchema>;

/**
 * Closing a deviation: the QA signature and the outcome, and for an NCR the
 * final disposition — which may not be quarantine, because quarantine is a
 * hold while QA decides, not the decision.
 */
export const closeDeviationSchema = z
  .object({
    isNcr: z.boolean(),
    disposition: z.union([z.enum(DISPOSITION_VALUES), z.literal("")]),
    closingNote: z
      .string()
      .trim()
      .min(10, "Record the outcome — what was decided and what was done.")
      .max(2000, "Keep the closing note under 2000 characters."),
    qaSignName: z
      .string()
      .trim()
      .min(1, "Closing needs a QA reviewer's name against it.")
      .max(80, "Keep the name under 80 characters."),
    actionId: z.string(),
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

export type CloseDeviationValues = z.infer<typeof closeDeviationSchema>;
