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
    label: "Bulk Production",
    /** Shown on the type card in step one. */
    description:
      "Bulk only — mixing, encapsulation, compression, coating. Finished lots draw from it.",
    /** Shown once the type is chosen, above its own fields. */
    hint: "Its required quantity is the bulk target. Finished lots draw from it.",
  },
  {
    value: "packing",
    label: "Finished Lot",
    description: "Fills finished goods from bulk — bottles, sachets, pouches.",
    hint: "Needs a pack size: the units of bulk per container is the only thing that converts one to the other.",
  },
  {
    value: "combined",
    label: "Single Batch",
    description: "Made and packed under one batch number.",
    hint: "The whole batch, start to finish, on one number — how every batch worked before batch families.",
  },
] as const;

/**
 * The stored values are **not** the labels, and deliberately so. `manufacturing
 * | packing | combined` are what `pipeline_jobs_batch_type_known` (0031) checks
 * and what every query, guard and view in the database reads; "Bulk Production
 * | Finished Lot | Single Batch" are what this plant calls them. Renaming the
 * label is a wording change; renaming a value is a migration plus every row
 * ever written.
 */
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

/**
 * An optional percentage. Mirrors the 0..100 checks the database carries on
 * both tolerance columns (`pipeline_jobs_tolerance_range`,
 * `batch_stages_tolerance_range`, migration 0037) — a tolerance over 100% says
 * a stage may produce more than twice its target, which is not a tolerance but
 * a target nobody wrote down.
 */
const optionalPct = optionalQty.refine(
  (v) => v === undefined || v <= 100,
  "A tolerance is a few percent, not more than 100.",
);

/**
 * Everything the *pipeline* knows about a batch, shared by New batch and Edit
 * batch.
 *
 * Split out so the two cannot drift: a rule that only the creating form
 * enforces is a rule an edit can walk straight past, and the database would
 * then be the first thing to say no — after the dialog said yes.
 */
const batchFields = {
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

    /* ── Every batch type ──────────────────────────────────────────────── */
    /**
     * How far past a planned stage's target the shift log will accept before
     * it refuses the entry (migration 0037).
     *
     * Not a second name for `overagePct`, and the two are worth keeping
     * straight because they sit in the same dialog:
     *
     *   Overage    Extra this batch deliberately *makes*, against the whole
     *              work order. Widens the over-production flag's threshold and
     *              asks for a sentence when crossed. Manufacturing only.
     *   Tolerance  How far past *one stage's* target an entry may be recorded.
     *              Blocks the write. Every batch type — a packing stage has a
     *              target like any other.
     *
     * Lives on the batch and is inherited by every stage in its plan; a stage
     * that needs its own overrides it on the Pipeline.
     */
    tolerancePct: optionalPct,

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
};

/**
 * The cross-field rules, shared by both forms for the reason above. Each one
 * mirrors a constraint the database also enforces, so a form that passes
 * cannot fail at the insert.
 */
function refineBatch(
  values: {
    batchType: BatchType;
    bulkUnit?: string;
    packUnit?: string;
    packSize?: number;
    parentJobId?: string;
    overagePct?: number;
  },
  ctx: z.RefinementCtx,
) {
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
}

/** New batch: the shared fields, plus the catalogue row it is raised for. */
export const newBatchSchema = z
  .object({
    ...batchFields,
    factoryId: z.uuid(),
    /**
     * The batch, picked from Admin → Products rather than typed.
     *
     * Everything identifying it — batch number, product name, code, work
     * order, required quantity — is read back from that row, so this dialog
     * carries only what the *pipeline* knows. A batch typed here would be a
     * second place a product name can be spelt, and the shift log resolves
     * entries against the catalogue, not against the board.
     */
    productId: z.uuid("Pick the batch from the catalogue."),
  })
  .superRefine(refineBatch);

/**
 * Edit batch: the same fields, for a job that already exists.
 *
 * There is no `productId` — which batch a card is for is not editable, and
 * never was. Changing it would silently re-point every logged entry's meaning
 * at a different product.
 */
export const editBatchSchema = z
  .object({ ...batchFields })
  .superRefine(refineBatch);

export type NewBatchValues = z.input<typeof newBatchSchema>;
export type NewBatchParsed = z.output<typeof newBatchSchema>;
export type EditBatchValues = z.input<typeof editBatchSchema>;
export type EditBatchParsed = z.output<typeof editBatchSchema>;

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

/* ── Plan stages ─────────────────────────────────────────────────────────
   The route of one batch: Dispensing 500 kg → Compression 210,000 tablets →
   Coating 210,000 tablets → Packing 1,000 bottles. One row per stage that
   produces something; downtime is never planned (migration 0033). */

/**
 * What a stage target can be counted in.
 *
 * Deliberately the union of the bulk and pack lists plus the room units: a
 * plan crosses all three in four rows — kilos dispensed, tablets compressed,
 * bottles packed — and a stage that cannot name its own unit is a number
 * nobody can read back.
 */
export const STAGE_UNITS = [
  "tablets",
  "capsules",
  "softgels",
  "bottles",
  "sachets",
  "pouches",
  "boxes",
  "units",
  "kg",
  "litres",
  "drums",
  "containers",
  "batches",
] as const;

export type StageUnit = (typeof STAGE_UNITS)[number];

/**
 * One stage of a batch's plan.
 *
 * `targetQty` is optional *here* and required to issue the batch — the two are
 * different moments. A planner adds four stages and then fills in the numbers,
 * and refusing the first of those would make the form impossible to use in the
 * order people actually work.
 */
export const stageSchema = z.object({
  processId: z.uuid("Pick the activity."),
  /**
   * The room this stage is planned to run in — the prototype's "assigned
   * room". Optional: a plan is often written before the rooms are settled, and
   * refusing the stage until one is chosen would push people to pick any room
   * to get past the form. Advisory once set; the shift log records where the
   * work actually happened and does not have to agree.
   */
  unitId: z.union([z.uuid(), z.literal("")]).optional(),
  /**
   * May this stage start before the one before it has finished?
   *
   * The prototype's `canRunParallel`. Three packing runs off one bulk start
   * together, and labelling overlaps the packing feeding it — without this the
   * only way to express that is to lie about the order, which moves the final
   * tag and so changes which stage completes the order.
   */
  canRunParallel: z.boolean().optional(),
  /**
   * The day this stage is planned to run — `YYYY-MM-DD`, the shape both
   * `DateField` and Postgres speak, exactly like the batch's `dueDate`.
   *
   * Optional for the same reason `unitId` is: a route is written before the
   * days are settled, and refusing the stage until one is picked would only
   * teach planners to type any date to get past the form. Advisory once set —
   * the shift log records when the work actually happened and does not have
   * to agree.
   */
  plannedDate: z.union([z.literal(""), z.iso.date()]).optional(),
  targetQty: optionalQty,
  targetUnit: z.enum(STAGE_UNITS, { error: "Pick a unit." }),
  /**
   * This stage's own tolerance, overriding the batch's.
   *
   * Left empty — the ordinary case — the stage inherits `tolerance_pct` from
   * its batch. Worth overriding where one stage is genuinely looser or tighter
   * than the rest of the route: a dispensing step weighed on a floor scale
   * against a compression step counted by the machine.
   */
  tolerancePct: optionalPct,
  /** "Packing 30's" — only needed when the batch runs the activity twice. */
  label: z.string().trim().max(60, "Keep the label under 60 characters.").optional(),
  /** The same distinction, where a plant uses work orders. */
  workOrder: z.string().trim().max(40).optional(),
  packSize: optionalQty,
});

export type StageValues = z.input<typeof stageSchema>;
export type StageParsed = z.output<typeof stageSchema>;

/**
 * One stage, edited from the Schedule.
 *
 * The plan dialog edits a stage three fields at a time, inline, because that
 * is what planning a route needs — add, target, reorder, next. A planner
 * working a room queue has the opposite shape of question: one stage, all of
 * it, because they are deciding when it runs and what to tell the floor about
 * it. Same row, same rules, a different form over it.
 *
 * `processId` is absent, and that is the point: which activity a stage *is*
 * is not editable. Changing it would silently re-point every shift-log entry
 * already filed against the stage at a different process, and the sanctioned
 * way to that answer is removing the stage and adding the right one — which
 * the database refuses once anything has been logged, exactly as it should.
 */
export const stageEditSchema = z
  .object({
    unitId: z.union([z.uuid(), z.literal("")]).optional(),
    plannedDate: z.union([z.literal(""), z.iso.date()]).optional(),
    /** The planner's estimate of when it comes off the room (migration 0040). */
    estFinishDate: z.union([z.literal(""), z.iso.date()]).optional(),
    canRunParallel: z.boolean().optional(),
    targetQty: optionalQty,
    targetUnit: z.enum(STAGE_UNITS, { error: "Pick a unit." }),
    label: z
      .string()
      .trim()
      .max(60, "Keep the label under 60 characters.")
      .optional(),
    workOrder: z.string().trim().max(40).optional(),
    packSize: optionalQty,
    /** The queue's comment column — why this line sits where it does. */
    planningNote: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters.")
      .optional(),
  })
  /**
   * A stage cannot come off the room before it goes on.
   *
   * Checked here and deliberately *not* in the database (see migration 0040):
   * as a constraint it would refuse the wrong field — a planner pulling a
   * start date forward past a stale estimate would have the start rejected,
   * when the estimate is the thing that is out of date. As a form rule it
   * lands on the two fields together, where the person can see both.
   */
  .refine(
    (v) => !v.plannedDate || !v.estFinishDate || v.estFinishDate >= v.plannedDate,
    {
      message: "The estimated finish is before the planned start.",
      path: ["estFinishDate"],
    },
  );

export type StageEditValues = z.input<typeof stageEditSchema>;
export type StageEditParsed = z.output<typeof stageEditSchema>;

/**
 * A supervisor's sign-off on a finished stage.
 *
 * No "signed off by" field, and its absence is the design — the same argument
 * as `kaizenIdeaSchema` in the log's schemas. The person is signed in, so the
 * name is already known; a text box for it can be left blank, misspelt, or
 * filled in with somebody else's name, which turns the one piece of
 * accountability that makes a sign-off mean anything into something the client
 * asserts. The trigger stamps it from the session.
 *
 * A yield that isn't acceptable costs an explanation. "No" with no reason is
 * an alarm nobody can act on, and it is the answer that matters most.
 */
export const stageSignOffSchema = z
  .object({
    yieldAcceptable: z.boolean({ error: "Say whether the yield is acceptable." }),
    notes: z.string().trim().max(500, "Keep the note under 500 characters."),
  })
  .refine((v) => v.yieldAcceptable || v.notes.length >= 10, {
    message: "Say what was wrong with the yield — this is the record of it.",
    path: ["notes"],
  });

export type StageSignOffValues = z.input<typeof stageSignOffSchema>;
export type StageSignOffParsed = z.output<typeof stageSignOffSchema>;
