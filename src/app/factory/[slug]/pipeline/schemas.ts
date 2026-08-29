import { z } from "zod";

/**
 * Pipeline → New batch. Plain module (no "use server") so the dialog and any
 * future Server Action can share it.
 *
 * The form has **three** shapes, chosen by the batch type picked in step one
 * — see `BATCH_TYPES`. Which extra fields appear and which of them are
 * required both follow from it, and neither rule fits on a single field, so
 * they live in the `superRefine` at the end. Same structure as
 * `logEntrySchema` in `../log/schemas.ts`, for the same reason.
 */

/**
 * The three kinds of batch a plant runs.
 *
 * `combined` is the default and describes every batch this application could
 * express before migration 0031 — manufactured and packed under one number.
 * The other two exist for the plant that gives its packing runs batch numbers
 * of their own, where the bulk and the fill are separately released, counted
 * and reported.
 */
export const BATCH_TYPES = [
  {
    value: "manufacturing",
    label: "Manufacturing",
    /** Shown on the type card in step one. */
    description:
      "Bulk production — mixing, encapsulation, compression, coating.",
    /** Shown once the type is chosen, above its own fields. */
    hint: "Its required quantity is the bulk target. Packing batches draw from it.",
  },
  {
    value: "packing",
    label: "Packing",
    description: "Fills finished goods from bulk — bottles, sachets, pouches.",
    hint: "Needs a pack size: the units of bulk per container is the only thing that converts one to the other.",
  },
  {
    value: "combined",
    label: "Combined",
    description: "Manufacturing and packing under one batch number.",
    hint: "The whole batch, start to finish, on one number — how every batch worked before batch families.",
  },
] as const;

export type BatchType = (typeof BATCH_TYPES)[number]["value"];

/** The three values as a zod-ready tuple, derived so the two can't drift. */
export const BATCH_TYPE_VALUES = BATCH_TYPES.map((t) => t.value) as unknown as [
  BatchType,
  ...BatchType[],
];

/**
 * What bulk is counted in on a manufacturing batch.
 *
 * Wider than the shift log's `QTY_UNITS` on purpose: bulk is counted in the
 * dose form (210,000 tablets), while a preparatory log entry is counted in
 * whatever the room handles it as (3 drums). They answer different questions
 * and are deliberately not the same list.
 */
export const BULK_UNITS = [
  "tablets",
  "capsules",
  "softgels",
  "sachets",
  "kg",
  "litres",
  "units",
] as const;

export type BulkUnit = (typeof BULK_UNITS)[number];

/** What finished goods are counted in on a packing batch. */
export const PACK_UNITS = [
  "bottles",
  "sachets",
  "pouches",
  "boxes",
  "units",
] as const;

export type PackUnit = (typeof PACK_UNITS)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** An optional number field: "" means "not recorded", not 0. */
const optionalQty = z
  .union([z.number(), z.nan()])
  .optional()
  .transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v))
  .refine((v) => v === undefined || v >= 0, "Enter a positive number.");

export const newBatchSchema = z
  .object({
    factoryId: z.uuid(),
    batchType: z.enum(BATCH_TYPE_VALUES, { error: "Pick a batch type." }),

    /**
     * The batch, picked from Admin → Products rather than typed.
     *
     * Everything identifying it — batch number, product name, code, work
     * order, required quantity — is read back from that row, so this dialog
     * carries only what the *pipeline* knows: what kind of batch it is, whose
     * bulk it draws on, and how it is packed. A batch typed here would be a
     * second place a product name can be spelt, and the shift log resolves
     * entries against the catalogue, not against the board.
     */
    productId: z.uuid("Pick the batch from the catalogue."),

    priority: z.enum(PRIORITIES),
    /** `YYYY-MM-DD`, the shape both the date input and Postgres speak. */
    dueDate: z.union([z.literal(""), z.iso.date()]).optional(),
    notes: z.string().trim().max(500, "Keep notes under 500 characters."),

    /* ── Manufacturing ─────────────────────────────────────────────────── */
    bulkUnit: z
      .union([z.enum(BULK_UNITS), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    /**
     * Deliberate overproduction — make a few percent extra so the packing
     * runs still have enough after losses to coating, set-up and QA samples.
     *
     * Not decoration: since migration 0032 it widens the threshold the shift
     * log's over-production flag measures against, so a batch told to make 4%
     * extra is not flagged for doing exactly that. Belongs to anything that
     * manufactures — a combined batch as much as a bulk one — and never to a
     * packing run, which fills what it was given.
     */
    overagePct: optionalQty,

    /* ── Packing ───────────────────────────────────────────────────────── */
    /** "" is "no parent — external bulk", which is a real answer. */
    parentJobId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    packSize: optionalQty,
    packUnit: z
      .union([z.enum(PACK_UNITS), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** Bulk physically handed over, when it differs from what pack size implies. */
    bulkQtyReceived: optionalQty,
    market: z.string().trim().max(40).optional(),
  })
  .superRefine((values, ctx) => {
    // Overage is a manufacturing idea, and a combined batch manufactures too.
    // A packing run never declares one — the database refuses it outright
    // (`pipeline_jobs_overage_belongs`, migration 0032).
    if (values.batchType === "packing" && values.overagePct) {
      ctx.addIssue({
        code: "custom",
        path: ["overagePct"],
        message: "A packing run fills what it was given — its bulk carries the overage.",
      });
    }

    if (values.batchType === "manufacturing") {
      // Bulk with no unit is not a measurement — 210,000 of what? The packing
      // children's allocation is read back in this unit.
      if (!values.bulkUnit) {
        ctx.addIssue({
          code: "custom",
          path: ["bulkUnit"],
          message: "Pick what the bulk is counted in.",
        });
      }
      return;
    }

    if (values.batchType !== "packing") return;

    // ── Packing only, from here ─────────────────────────────────────────
    //
    // How many containers this run is for is NOT checked here: it lives on
    // the catalogue row as `required_qty`, which this schema cannot see. The
    // dialog warns when the picked batch has none, and the fix is in Admin →
    // Products, where that number is owned.

    // The one conversion between bulk and finished goods there is. Required
    // whenever this run draws on a parent's bulk — the same rule the 0031
    // family guard enforces, so a legal-looking submit can't fail at the RPC.
    if (values.parentJobId && !values.packSize) {
      ctx.addIssue({
        code: "custom",
        path: ["packSize"],
        message: "Enter the pack size — it's what converts containers to bulk.",
      });
    }

    if (!values.packUnit) {
      ctx.addIssue({
        code: "custom",
        path: ["packUnit"],
        message: "Pick what's being filled.",
      });
    }
  });

export type NewBatchValues = z.input<typeof newBatchSchema>;
export type NewBatchParsed = z.output<typeof newBatchSchema>;

/**
 * How much bulk a packing run needs: containers × units per container.
 *
 * Null when either half is missing rather than 0 — "not worked out yet" and
 * "needs no bulk" are different, and the second is never true of a packing
 * run. Drives the live "bulk needed" readout in the dialog and the family
 * allocation bar, which must agree.
 */
export function bulkNeeded(
  containers: number | undefined,
  packSize: number | undefined,
): number | null {
  if (!containers || !packSize) return null;
  if (containers <= 0 || packSize <= 0) return null;
  return Math.ceil(containers * packSize);
}
