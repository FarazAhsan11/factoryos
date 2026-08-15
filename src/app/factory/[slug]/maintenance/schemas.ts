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
  // be able to raise a request; the form says so rather than blocking.
  departmentId: z.string(),

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
  assignedTo: z.string().trim().max(80),
});

export type MaintenanceRequestValues = z.infer<typeof maintenanceRequestSchema>;
