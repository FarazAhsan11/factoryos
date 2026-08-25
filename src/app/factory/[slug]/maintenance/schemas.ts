import { z } from "zod";

/**
 * Raising a maintenance request.
 *
 * Client-side validation for UX; the database re-checks what matters — the
 * equipment number is `not blank` and the description has a `>= 10` check
 * constraint, both in migration 0024.
 *
 * The optional fields are typed as plain required strings that may be empty
 * rather than `.optional()`, because `.optional().default("")` gives zod an
 * input type that differs from its output and react-hook-form refuses the
 * resolver. The form always supplies "" from its defaults, so "optional" here
 * means "may be blank", and the queries turn blank into null on the way in.
 */
export const maintenanceRequestSchema = z.object({
  equipmentNo: z
    .string()
    .trim()
    .min(1, "Which machine? Give its equipment number.")
    .max(40, "Keep the equipment number under 40 characters."),

  // Optional: a facility fault — compressed air, a leaking roof — belongs to
  // no one room, and forcing a choice would put it in the wrong one.
  unitId: z.string(),

  // Also optional. A factory that hasn't set its departments up yet must still
  // be able to raise a request; the form says so rather than blocking. It
  // stops being optional at the point of assigning the work — that gate is in
  // `maintenance_stage_transition`, where routing actually depends on it.
  departmentId: z.string(),

  // "Initiating Department" on the paper form — who is raising it, as opposed
  // to who is needed. Optional for the same reason as above.
  initiatingDepartmentId: z.string(),

  priority: z.enum(["urgent", "routine", "planned"]),

  description: z
    .string()
    .trim()
    .min(10, "Describe the fault — what was happening, and when it started.")
    .max(1000, "Keep the description under 1000 characters."),

  // Typed, not picked, and never validated against the catalogue: a fault can
  // be raised against a batch nobody has added yet, and refusing it would only
  // teach people to leave the field empty.
  batchNo: z.string().trim().max(60),

  reportedBy: z.string().trim().max(80),
});

export type MaintenanceRequestValues = z.infer<typeof maintenanceRequestSchema>;

/* ── Section 2 · Engineering ──────────────────────────────────────────── */

/**
 * Opening Section 2 — "Work assigned to", plus the department that will do it.
 *
 * Both are required here and both are re-demanded by the trigger, because
 * this is the move that turns a report into somebody's job: a request with
 * nobody's name on it and no department is one that will still be open next
 * week and nobody will know whose fault that is.
 */
export const maintenanceAssignSchema = z.object({
  assignedTo: z
    .string()
    .trim()
    .min(1, "Who is taking this? Name the fitter or contractor.")
    .max(80, "Keep the name under 80 characters."),

  departmentId: z.string().min(1, "Which department is needed?"),
});

export type MaintenanceAssignValues = z.infer<typeof maintenanceAssignSchema>;

/**
 * Signing Section 2 off.
 *
 * The two yes/no questions are radio groups rather than checkboxes, and there
 * is no default: on the paper form they are "delete one", and a checkbox
 * nobody touched would print as a confident "no" to a question nobody was
 * asked. `"yes" | "no"` rather than a boolean for the same reason — an unset
 * radio group is simply invalid, and zod says so.
 */
export const maintenanceWorkSchema = z
  .object({
    workDetails: z
      .string()
      .trim()
      .min(10, "Record what was done — and why it broke, if it is known.")
      .max(2000, "Keep the work record under 2000 characters."),

    cleaningRequired: z.enum(["yes", "no"], {
      message: "Does cleaning have to be arranged after this work?",
    }),
    cleaningNote: z.string().trim().max(300),

    productionReviewRequired: z.enum(["yes", "no"], {
      message: "Does Production have to review this work?",
    }),
    productionReviewBy: z.string().trim().max(80),
  })
  // A review that is required but unsigned is the gap the paper form leaves
  // and this one does not.
  .refine(
    (v) => v.productionReviewRequired === "no" || v.productionReviewBy.length > 0,
    {
      path: ["productionReviewBy"],
      message: "Production review is required — record who signed it off.",
    }
  );

export type MaintenanceWorkValues = z.infer<typeof maintenanceWorkSchema>;

/* ── Section 3 · QA review ────────────────────────────────────────────── */

/**
 * The two questions that make this a controlled document: did the fix change
 * anything that is under change control, and did it produce a deviation.
 * Each takes a reference number when the answer is yes — checked here, in the
 * trigger, and by a table constraint, because a "yes" with no number against
 * it is a cross-reference to nothing.
 */
export const maintenanceQaSchema = z
  .object({
    changeControlRequired: z.enum(["yes", "no"], {
      message: "Is change control required?",
    }),
    changeControlNo: z.string().trim().max(60),

    deviationRaised: z.enum(["yes", "no"], {
      message: "Was a deviation raised?",
    }),
    deviationNo: z.string().trim().max(60),

    qaRemarks: z.string().trim().max(1000),

    qaSignName: z
      .string()
      .trim()
      .min(1, "A QA review needs a name against it.")
      .max(80, "Keep the name under 80 characters."),
  })
  .refine(
    (v) => v.changeControlRequired === "no" || v.changeControlNo.length > 0,
    {
      path: ["changeControlNo"],
      message: "Change control is required — record its number.",
    }
  )
  .refine((v) => v.deviationRaised === "no" || v.deviationNo.length > 0, {
    path: ["deviationNo"],
    message: "A deviation was raised — record its number.",
  });

export type MaintenanceQaValues = z.infer<typeof maintenanceQaSchema>;
