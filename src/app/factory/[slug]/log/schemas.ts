import { z } from "zod";

/**
 * Shift log → Log entry. Plain module (no "use server") so the form and any
 * future Server Action can share it.
 *
 * The form has two shapes driven by the selected process's `has_machine`
 * flag from Admin → Processes: a machine process also captures speed, and a
 * slow run has to say why. That rule can't live on a single field, so it's a
 * `superRefine` at the end.
 */

export const ACTION_FLAGS = [
  "Quality",
  "Maintenance",
  "Safety",
  "Process",
] as const;

export type ActionFlag = (typeof ACTION_FLAGS)[number];

export const ACTION_FLAG_LABELS: Record<ActionFlag, string> = {
  Quality: "Yes — Quality issue",
  Maintenance: "Yes — Maintenance needed",
  Safety: "Yes — Safety concern",
  Process: "Yes — Process deviation",
};

/**
 * Speed is a **unit type** plus a **rate**, composed into what's stored:
 * `Caps/hr`, `Caps/min`, `RPM`. Hardcoding `/hr` (as an earlier cut did) is
 * not cosmetic — a line measured per minute gets its number recorded against
 * an hour, so every downstream performance figure is out by 60×.
 *
 * RPM and Batches are `perTime: false`: they already carry their own period
 * or aren't a rate at all, so the /min–/hr choice is hidden for them.
 */
export const SPEED_TYPES = [
  { value: "RPM", label: "RPM (rotations)", perTime: false },
  { value: "Caps", label: "Capsules", perTime: true },
  { value: "Tabs", label: "Tablets", perTime: true },
  { value: "Bags", label: "Bags", perTime: true },
  { value: "Bottles", label: "Bottles", perTime: true },
  { value: "Units", label: "Units (generic)", perTime: true },
  { value: "Batches", label: "Batches", perTime: false },
] as const;

export type SpeedType = (typeof SPEED_TYPES)[number]["value"];
export type SpeedRate = "min" | "hr";

export function speedTypeTakesRate(type: string): boolean {
  return SPEED_TYPES.find((t) => t.value === type)?.perTime ?? false;
}

/** ("Caps", "hr") → "Caps/hr"; ("RPM", …) → "RPM". */
export function composeSpeedUnit(type: string, rate: SpeedRate): string {
  return speedTypeTakesRate(type) ? `${type}/${rate}` : type;
}

/** Why a machine ran below its target speed — feeds the OEE Pareto chart. */
export const SLOW_REASONS = [
  "Quality / weight issue — dosing adjustment",
  "Capping / sealing problem",
  "Equipment fault / mechanical issue",
  "Operator limitation",
  "Material / powder flow issue",
  "Testing / validation in progress",
  "Planned reduced speed — batch requirement",
  "Other (add in comments)",
] as const;

/** "06:45" or "06:45:00" → "06:45". Shared with the shift-times form. */
const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a time as HH:MM.")
  .transform((v) => v.slice(0, 5));

/** An optional number field: "" means "not recorded", not 0. */
const optionalQty = z
  .union([z.number(), z.nan()])
  .optional()
  .transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v))
  .refine((v) => v === undefined || v >= 0, "Enter a positive number.");

export const logEntrySchema = z
  .object({
    factoryId: z.uuid(),
    unitId: z.uuid("Select a unit."),
    processId: z.uuid("Select an activity."),
    shift: z.enum(["morning", "afternoon"]),
    startTime: clockTime,
    endTime: clockTime,
    equipmentNo: z.string().trim().max(40).optional(),

    batchNo: z.string().trim().max(60).optional(),
    targetQty: optionalQty,
    qty: optionalQty,
    qtyRejected: optionalQty,

    speedType: z.string().trim().max(20).optional(),
    speedRate: z.enum(["min", "hr"]).optional(),
    targetSpeed: optionalQty,
    actualSpeed: optionalQty,
    slowReason: z.string().trim().max(120).optional(),

    operator1: z.string().trim().max(80).optional(),
    operator2: z.string().trim().max(80).optional(),
    comment: z.string().trim().max(500).optional(),
    actionFlag: z.enum(ACTION_FLAGS).optional(),

    /** Mirrors the selected process's has_machine, so the rules below can see it. */
    hasMachine: z.boolean(),
    /**
     * Mirrors has_output. Independent of hasMachine: Sorting produces output
     * without a machine, Idle does neither.
     */
    hasOutput: z.boolean(),
  })
  .superRefine((values, ctx) => {
    // Rejects can't exceed what was produced — a data-entry slip worth catching
    // before it skews the quality rate.
    //
    // Only for an activity that produces something: a no-output stage stores
    // null quantities, so there is nothing to compare. Deliberately not an
    // early `return` — the speed rule below is about a different flag and must
    // still run for a machine stage that happens to produce no output.
    if (
      values.hasOutput &&
      values.qty !== undefined &&
      values.qtyRejected !== undefined &&
      values.qtyRejected > values.qty
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["qtyRejected"],
        message: "Rejects can't exceed the quantity produced.",
      });
    }

    if (!values.hasMachine) return;

    // Running below target is allowed — running below target *silently* isn't.
    const { targetSpeed, actualSpeed, slowReason } = values;
    const isSlow =
      targetSpeed !== undefined &&
      actualSpeed !== undefined &&
      targetSpeed > 0 &&
      actualSpeed < targetSpeed;
    if (isSlow && !slowReason) {
      ctx.addIssue({
        code: "custom",
        path: ["slowReason"],
        message: "Select a reason — this feeds the OEE Pareto chart.",
      });
    }
  });

export type LogEntryValues = z.input<typeof logEntrySchema>;
export type LogEntryParsed = z.output<typeof logEntrySchema>;

/**
 * An amendment to a filed entry. The original row is never rewritten and
 * never deleted — this only attaches a correction note, which is exactly what
 * `shift_log_amend_guard` (migration 0011) requires before it will stamp
 * `amended_at` / `amended_by`.
 *
 * The minimum length is deliberate: "typo" is not an audit trail. The note has
 * to say what was wrong and what the truth is, because the original numbers
 * stay in the row and only this text explains them.
 */
export const amendEntrySchema = z.object({
  note: z
    .string()
    .trim()
    .min(10, "Say what was incorrect and what the correct information is.")
    .max(500, "Keep the note under 500 characters."),
});

export type AmendEntryValues = z.infer<typeof amendEntrySchema>;
