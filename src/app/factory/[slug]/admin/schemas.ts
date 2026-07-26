import { z } from "zod";

/** Admin → Company. Shared by the form and the Server Action. */
export const companySettingsSchema = z.object({
  factoryId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(2, "Enter your company or site name.")
    .max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280).optional(),
  unitLabel: z
    .string()
    .trim()
    .min(2, "Name your production units.")
    .max(40),
  unitLabelPlural: z
    .string()
    .trim()
    .min(2, "Give the plural form too.")
    .max(40),
  // Registered with { valueAsNumber: true }, so these arrive as numbers.
  oeeTarget: z
    .number({ message: "Enter an OEE target." })
    .int()
    .min(50, "OEE target must be at least 50%.")
    .max(100, "OEE target can't exceed 100%."),
  escalateHours: z
    .number({ message: "Enter an escalation window." })
    .int()
    .min(1, "Escalate after at least 1 hour.")
    .max(48, "Escalation caps at 48 hours."),
});

export type CompanySettingsValues = z.infer<typeof companySettingsSchema>;

/* ── Admin → Employees ─────────────────────────────────────────────────── */

/**
 * Roles a factory admin may hand out. The `user_role` enum is wider
 * (manager / supervisor exist for later modules); the console deliberately
 * offers only these two until those roles have screens of their own.
 */
export const ASSIGNABLE_ROLES = ["admin", "operator"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  operator: "Operator",
};

const fullName = z
  .string()
  .trim()
  .min(2, "Enter the person's full name.")
  .max(80, "Keep the name under 80 characters.");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter an email address.")
  .pipe(z.email("Enter a valid email address."));

const role = z.enum(ASSIGNABLE_ROLES, { message: "Pick a role." });

/** Which shift someone normally works. Mirrors the `shift_slot` enum. */
export const SHIFT_SLOTS = ["morning", "afternoon", "both"] as const;
export type ShiftSlot = (typeof SHIFT_SLOTS)[number];

export const SHIFT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  both: "Rotating",
};

const defaultShift = z.enum(SHIFT_SLOTS, { message: "Pick a shift." });

/** Add one employee — creates the account and emails the invite. */
export const addEmployeeSchema = z.object({
  factoryId: z.uuid(),
  fullName,
  email,
  role,
  defaultShift,
});
export type AddEmployeeValues = z.infer<typeof addEmployeeSchema>;

/** One parsed CSV row. Same rules as the single-add form. */
export const employeeRowSchema = z.object({
  fullName,
  email,
  role,
  defaultShift,
});
export type EmployeeRow = z.infer<typeof employeeRowSchema>;

/**
 * One chunk of a CSV import. The client slices the file into batches and
 * calls the action per batch, which is what makes the progress bar honest —
 * each resolved call is real rows written, not an animation.
 */
export const importEmployeesSchema = z.object({
  factoryId: z.uuid(),
  rows: z
    .array(employeeRowSchema)
    .min(1, "Nothing to import.")
    .max(25, "Import in batches of 25 or fewer."),
  /**
   * Email each imported person as their account is created. Sending is far
   * slower than the insert (one SMTP round-trip per row), which is why the
   * client uses small batches when this is on — the progress panel then moves
   * per person instead of stalling.
   */
  sendInvites: z.boolean(),
});
export type ImportEmployeesValues = z.infer<typeof importEmployeesSchema>;

export const employeeIdSchema = z.object({ profileId: z.uuid() });

/* ── Admin → Products ──────────────────────────────────────────────────── */

/**
 * One batch in the catalogue. Batch number and product name are the only
 * required fields — the rest often isn't known when a batch is first raised,
 * exactly as in the prototype.
 */
export const productSchema = z.object({
  batchNo: z
    .string()
    .trim()
    .min(1, "Enter the batch or work-order number.")
    .max(40, "Keep the batch number under 40 characters."),
  code: z.string().trim().max(40, "Keep the code under 40 characters."),
  name: z
    .string()
    .trim()
    .min(2, "Enter the product name.")
    .max(120, "Keep the name under 120 characters."),
  workOrder: z.string().trim().max(40).optional(),
  // Registered with { valueAsNumber: true }, so this arrives as a number.
  requiredQty: z
    .number({ message: "Enter a required quantity." })
    .min(0, "Quantity can't be negative.")
    .max(1_000_000_000, "That quantity looks too large."),
});

export type ProductValues = z.infer<typeof productSchema>;

/** Row-level edits on the roster. Send only the field being changed. */
export const updateEmployeeSchema = z
  .object({
    profileId: z.uuid(),
    role: role.optional(),
    defaultShift: defaultShift.optional(),
  })
  .refine((v) => v.role !== undefined || v.defaultShift !== undefined, {
    message: "Nothing to update.",
  });
export type UpdateEmployeeValues = z.infer<typeof updateEmployeeSchema>;
