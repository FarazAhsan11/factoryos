import { z } from "zod";

import { todayKey } from "@/lib/factory/dates";

/**
 * How the company numbers a batch — `factories.batch_model` (migration 0042).
 *
 * `single`: manufacturing and packing share one number, so Pipeline → New
 * batch asks for no type — every batch is a Single Batch. `split`: the bulk
 * and the packed lot are
 * numbered separately, so New batch asks for Bulk Production or Finished Lot,
 * as two tabs, and never offers a Single Batch.
 */
export const BATCH_MODEL_VALUES = ["single", "split"] as const;
export type BatchModel = (typeof BATCH_MODEL_VALUES)[number];

export const BATCH_MODELS: {
  value: BatchModel;
  label: string;
  description: string;
}[] = [
  {
    value: "single",
    label: "Single batch",
    description: "Manufacturing and packing share one batch number.",
  },
  {
    value: "split",
    label: "Split batch",
    description: "Manufacturing and packing use separate batch numbers.",
  },
];

/**
 * Where a work order number is recorded — `factories.work_order_mode` (0043).
 *
 * `none`: nowhere — neither New batch nor stage planning asks. `batch`: one
 * per batch, asked in New batch and saved on the batch's row in Products
 * (`factory_products.work_order`). `stage`: one per planned stage
 * (`batch_stages.work_order`), asked when a stage is planned, never in New
 * batch.
 */
export const WORK_ORDER_MODE_VALUES = ["none", "batch", "stage"] as const;
export type WorkOrderMode = (typeof WORK_ORDER_MODE_VALUES)[number];

export const WORK_ORDER_MODES: {
  value: WorkOrderMode;
  label: string;
  description: string;
}[] = [
  {
    value: "none",
    label: "No work orders",
    description: "Batches and stages are known by batch number alone.",
  },
  {
    value: "batch",
    label: "Work order per batch",
    description: "New batch asks for one work order, saved on the batch.",
  },
  {
    value: "stage",
    label: "Work order per stage",
    description: "Every stage planned on the pipeline gets its own work order.",
  },
];

/** Admin → Company. Shared by the form and the Server Action. */
export const companySettingsSchema = z.object({
  factoryId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(2, "Enter your company or site name.")
    .max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280).optional(),
  unitLabel: z.string().trim().min(2, "Name your production units.").max(40),
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
  batchModel: z.enum(BATCH_MODEL_VALUES, {
    error: "Pick a batch number model.",
  }),
  workOrderMode: z.enum(WORK_ORDER_MODE_VALUES, {
    error: "Pick how work orders are tracked.",
  }),
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

/* ── Products ──────────────────────────────────────────────────── */

/** How far ahead a batch may be scheduled. A year is already generous. */
const MAX_PLAN_DAYS = 365;

/**
 * The day a batch is due to start, as `YYYY-MM-DD` — the shape both
 * `<input type="date">` and a Postgres `date` speak, so it needs no parsing
 * in either direction.
 *
 * Optional, and empty means optional: a batch with no date is added to the
 * pipeline by hand from New job, which is how every batch worked before this
 * field existed.
 *
 * **Never in the past.** A date that has gone by is not a schedule, and the
 * promotion in migration 0018 runs on `planned_for <= current_date` — so
 * backdating one wouldn't sit quietly in the catalogue, it would put the batch
 * straight onto the board the next time anyone opened it. Compared against the
 * *browser's* local day, which is the calendar the planner is looking at; the
 * database keeps a one-day-wider floor so no real timezone is refused.
 */
export const plannedForField = z
  .union([z.literal(""), z.iso.date("Enter the date as YYYY-MM-DD.")])
  .optional()
  .refine((v) => !v || v >= todayKey(), {
    message: "A planned date can't be in the past.",
  })
  .refine(
    (v) => {
      if (!v) return true;
      const limit = new Date();
      limit.setDate(limit.getDate() + MAX_PLAN_DAYS);
      return v <= todayKey(limit);
    },
    { message: `Schedule within the next ${MAX_PLAN_DAYS} days.` },
  );

/** A text field that may be left blank. Blank is stored as null. */
function optionalText(max: number, what: string) {
  return z
    .string()
    .trim()
    .max(max, `Keep the ${what} under ${max} characters.`)
    .optional();
}

/**
 * A date that may be left blank, as `YYYY-MM-DD`. Unlike `plannedForField`
 * these may be in the past — an order received last year, a start the sheet
 * already missed — because they record or estimate, and trigger nothing.
 */
const optionalDate = z
  .union([z.literal(""), z.iso.date("Enter the date as YYYY-MM-DD.")])
  .optional();

/**
 * A money figure that may be left blank. An empty number input arrives as
 * NaN under `valueAsNumber`, and that is "not recorded" — never 0, because an
 * order nobody priced is not an order worth nothing.
 */
const optionalMoney = z
  .union([z.number(), z.nan()])
  .optional()
  .transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v))
  .refine((v) => v === undefined || v >= 0, "An order value can't be negative.")
  // numeric(14, 2): twelve digits before the point.
  .refine(
    (v) => v === undefined || v < 1_000_000_000_000,
    "That value looks too large.",
  );

/**
 * One batch in the catalogue. Batch number and product name are the only
 * required fields — the rest often isn't known when a batch is first raised,
 * exactly as in the prototype.
 *
 * The second half is the sales order the batch is made against (migration
 * 0041): the columns of the planning sheet production never needed, but that
 * whoever answers "where is my order?" does. All optional.
 */
const productFields = {
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
  plannedFor: plannedForField,

  customerCode: optionalText(40, "customer code"),
  customerName: optionalText(120, "customer name"),
  salesOrderNo: optionalText(40, "sales order number"),
  salesRep: optionalText(80, "rep's name"),
  orderValue: optionalMoney,
  orderedOn: optionalDate,
  dueDate: optionalDate,
  expectedStart: optionalDate,
  expectedFinish: optionalDate,
};

/**
 * Finish before start is refused here and not in the database, for the reason
 * migration 0040 gives for a stage's estimate: as a constraint it would reject
 * whichever of the two dates was saved second, not the one that is wrong.
 */
function refineProduct(
  values: { expectedStart?: string; expectedFinish?: string },
  ctx: z.RefinementCtx,
) {
  if (
    values.expectedStart &&
    values.expectedFinish &&
    values.expectedFinish < values.expectedStart
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["expectedFinish"],
      message: `Finish (${values.expectedFinish}) is before the expected start (${values.expectedStart}).`,
    });
  }
}

export const productSchema = z.object(productFields).superRefine(refineProduct);

export type ProductValues = z.infer<typeof productSchema>;
/** What the fields hold before zod has run — an empty order value is NaN. */
export type ProductInput = z.input<typeof productSchema>;

/**
 * The same batch, edited. One rule differs: a planned date that has since gone
 * by may be *kept*. Migration 0018 refuses setting a past date, never keeping
 * one — and without this, every batch already promoted to the board would
 * fail validation on a change to its customer's name.
 *
 * The date is checked in the refinement rather than as a union with the kept
 * value, because a failed union reports "Invalid input" and loses the message
 * saying *why* the date was refused.
 */
export function productEditSchema(keepPlannedFor: string | null) {
  return z
    .object({ ...productFields, plannedFor: z.string().optional() })
    .superRefine((values, ctx) => {
      if ((values.plannedFor ?? "") !== (keepPlannedFor ?? "")) {
        const check = plannedForField.safeParse(values.plannedFor);
        if (!check.success) {
          ctx.addIssue({
            code: "custom",
            path: ["plannedFor"],
            message: check.error.issues[0]?.message ?? "Invalid date.",
          });
        }
      }
      refineProduct(values, ctx);
    });
}

/* ── Admin → Equipment ───────────────────────────────────── */

/**
 * One machine in the register. Both fields are required: a number with no
 * name resolves to nothing useful in the shift log, and a name with no number
 * can never be typed off the machine.
 */
export const equipmentSchema = z.object({
  equipmentNo: z
    .string()
    .trim()
    .min(1, "Enter the equipment number.")
    .max(40, "Keep the equipment number under 40 characters."),
  name: z
    .string()
    .trim()
    .min(2, "Enter the machine name.")
    .max(120, "Keep the name under 120 characters."),
});

export type EquipmentValues = z.infer<typeof equipmentSchema>;

/* ── Admin → Shift times ───────────────────────────────────────────────── */

/** `<input type="time">` gives "HH:MM"; Postgres `time` gives "HH:MM:SS". */
const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a time as HH:MM.")
  .transform((v) => v.slice(0, 5));

const breakMinutes = z
  .number({ message: "Enter a break length in minutes." })
  .int()
  .min(0, "A break can't be negative.")
  .max(120, "Keep breaks under two hours.");

/**
 * One shift's clock. Breaks are optional — a factory that doesn't schedule a
 * second break just leaves it blank — but a break start with no duration (or
 * the reverse) is a half-filled row, so they're validated as a pair.
 */
const shiftClockSchema = z
  .object({
    startTime: clockTime,
    endTime: clockTime,
    break1Start: z.union([clockTime, z.literal("")]).optional(),
    break1Minutes: breakMinutes,
    break2Start: z.union([clockTime, z.literal("")]).optional(),
    break2Minutes: breakMinutes,
    // Printed on the shift report. Optional — a factory that hasn't filled it
    // in gets a report with no name on it, not a form it can't save.
    supervisorName: z
      .string()
      .trim()
      .max(80, "Keep the name under 80 characters.")
      .optional(),
  })
  .refine((v) => v.startTime !== v.endTime, {
    message: "Start and end can't be the same time.",
    path: ["endTime"],
  })
  .refine((v) => !v.break1Start || v.break1Minutes > 0, {
    message: "Give the break a length, or clear its start time.",
    path: ["break1Minutes"],
  })
  .refine((v) => !v.break2Start || v.break2Minutes > 0, {
    message: "Give the break a length, or clear its start time.",
    path: ["break2Minutes"],
  });

export const shiftTimesSchema = z.object({
  factoryId: z.uuid(),
  morning: shiftClockSchema,
  afternoon: shiftClockSchema,
});

export type ShiftClockValues = z.infer<typeof shiftClockSchema>;
export type ShiftTimesValues = z.infer<typeof shiftTimesSchema>;

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
