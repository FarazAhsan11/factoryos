import { z } from "zod";

/**
 * Shift log → Log entry. Plain module (no "use server") so the form and any
 * future Server Action can share it.
 *
 * The form has **three** shapes, chosen by the selected stage's `category`
 * from Admin → Processes (migration 0030) — see `PROCESS_CATEGORIES` below.
 * Which fields exist, which are required, and what gets stored all follow
 * from it, and none of those rules fit on a single field, so they live in the
 * `superRefine` at the end.
 */

/**
 * The three kinds of stage a factory runs. One classification, replacing the
 * `has_machine` / `has_output` checkbox pair that used to imply it — four
 * combinations existed, only three were real, and neither flag said how the
 * output was *measured*.
 *
 * `machine` is not a fourth category: a production stage may be manual (hand
 * packing against a target), and that stays a tick in Admin.
 */
export const PROCESS_CATEGORIES = [
  {
    value: "downtime",
    label: "Downtime",
    /** Shown on the add row in Admin → Processes. */
    example: "Idle, Break, Set Up, cleaning, waiting on materials",
    hint: "Time lost. The log entry asks for the room, the activity, start and end, a batch number and comments — nothing else.",
  },
  {
    value: "preparatory",
    label: "Preparatory",
    example: "Mixing, Drying, Granulation, Sifting",
    hint: "Produces something, measured in the room's own units — batches, kg, litres, drums. One quantity and its unit, plus who ran it.",
  },
  {
    value: "production",
    label: "Production",
    example: "Encapsulation, Compression, Packing",
    hint: "The full record: speed against target, a derived shift target, actual and rejected quantities, and equipment when the stage runs on a machine.",
  },
] as const;

export type ProcessCategory = (typeof PROCESS_CATEGORIES)[number]["value"];

/** The three values as a zod-ready tuple, derived so the two can't drift. */
export const PROCESS_CATEGORY_VALUES = PROCESS_CATEGORIES.map(
  (c) => c.value,
) as unknown as [ProcessCategory, ...ProcessCategory[]];

/**
 * What a preparatory stage counts in.
 *
 * A fixed list, matching the `shift_log_entries_qty_unit_known` check in
 * migration 0030 — the browser writes this column directly under RLS, so a
 * value the form allows and the constraint refuses would be a legal-looking
 * submit that fails at the insert.
 */
export const QTY_UNITS = [
  "batches",
  "kg",
  "litres",
  "drums",
  "containers",
  "units",
] as const;

export type QtyUnit = (typeof QTY_UNITS)[number];

/** Downtime is the one shape that records no quantity at all. */
export function categoryHasOutput(category: ProcessCategory): boolean {
  return category !== "downtime";
}

/**
 * Speed, equipment, a derived target and a rejected count belong to a
 * production stage only. A preparatory stage produces in drums, not against
 * an RPM figure, and downtime produces nothing.
 */
export function categoryHasSpeed(category: ProcessCategory): boolean {
  return category === "production";
}

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

/**
 * What this entry *should* have produced: target speed × the time it ran.
 * 60 minutes at 10/min is 600; the same 10 read as /hr is 10.
 *
 * Returns null when the target can't be derived rather than guessing one:
 *
 * - **RPM / Batches** (`perTime: false`) aren't an output rate. Rotations per
 *   minute say nothing about capsules, and multiplying them by duration would
 *   invent a target that reads as real.
 * - **No speed recorded** — a manual stage that still produces output (Sorting)
 *   has no speed fields at all, and Quick mode clears them.
 *
 * The caller falls back to asking for the number in those cases.
 */
export function targetQtyFromSpeed(
  speedType: string | undefined,
  speedRate: SpeedRate | undefined,
  targetSpeed: number | undefined,
  durationMins: number,
): number | null {
  if (!speedType || !speedTypeTakesRate(speedType)) return null;
  if (!targetSpeed || !Number.isFinite(targetSpeed) || targetSpeed <= 0) {
    return null;
  }
  if (!durationMins || durationMins <= 0) return null;

  const perMinute = speedRate === "min" ? targetSpeed : targetSpeed / 60;
  return Math.round(perMinute * durationMins);
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
  .string({ error: "Enter a time as HH:MM." })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Enter a time as HH:MM.")
  .transform((v) => v.slice(0, 5));

const OPERATOR_REQUIRED = "Select who ran this — or use “Not on the list…”.";

/**
 * Not a product limit — no shift is run by twenty people — but the ceiling
 * the `shift_log_entries_operators_bounded` check enforces in the database
 * (migration 0014). The client writes this array directly under RLS, so the
 * two have to agree or a legal-looking form submits and the insert is refused.
 */
export const MAX_OPERATORS = 20;

/**
 * Everyone who ran the activity. No fixed ceiling below `MAX_OPERATORS`: a
 * line can be run by two, or by four plus a technician through a changeover,
 * and every one of those names is what Actions and handovers follow up on.
 *
 * Two shapes on purpose. The **input** is `{ name }[]` — react-hook-form's
 * `useFieldArray` needs objects to give each row a stable key, and a flat
 * array of strings re-mounts every field whenever one is removed. The
 * **output** is a plain `string[]` with the blanks dropped, which is what the
 * column stores.
 *
 * Whether *any* name is required is not decided here — see `operatorsRequired`
 * and the rule in the schema's `superRefine`. It depends on the selected
 * activity's flags, which this field can't see.
 *
 * Names, not ids. A shift record has to keep saying who ran the machine even
 * after that account is renamed or removed, and cover staff and contractors
 * work real shifts without ever having a login.
 */
const operatorList = z
  .array(
    z.object({
      // No `.min(1)`: an empty row is dropped by the transform below rather
      // than rejected, because on a waiting-time activity it is the correct
      // answer. The message on `z.string()` still covers a picker reporting
      // `undefined`, which would otherwise surface zod's own wording.
      name: z.string({ error: OPERATOR_REQUIRED }).trim().max(80),
    }),
  )
  .max(
    MAX_OPERATORS,
    `That's more than ${MAX_OPERATORS} people — check the entry.`,
  )
  .superRefine((rows, ctx) => {
    // The pickers already hide a name chosen in another row, but
    // "Not on the list…" is free text and can repeat one.
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const key = row.name.toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "name"],
          message: "Already added above.",
        });
      }
      seen.add(key);
    });
  })
  .transform((rows) => rows.map((row) => row.name).filter(Boolean));

/**
 * Does this activity need a name against it?
 *
 * No, on **downtime** — Manning, Set Up, Idle, Ready, waiting on materials.
 * Nobody is operating anything; the entry exists to account for shift time
 * that passed. Demanding a name there produces one of two bad outcomes: a
 * blocked entry, or an operator typing whoever comes to mind, which puts an
 * unearned name into an audit-protected record that Actions and handovers
 * then chase. The downtime form doesn't render the pickers at all.
 *
 * Yes on preparatory and production. Something was made — that is a thing a
 * person did, and nothing downstream can reconstruct who from the rest of the
 * row.
 */
export function operatorsRequired(category: ProcessCategory): boolean {
  return category !== "downtime";
}

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
    /**
     * Which planned stage this entry counts towards (migration 0033).
     *
     * Almost always absent, and that is correct: when a batch runs an activity
     * once, the database resolves it from the batch and the activity alone.
     * It is asked for only where a batch runs the same activity more than once
     * — three packing runs, or three work orders under one batch number —
     * which is exactly where the two would otherwise pool into one total.
     */
    batchStageId: z
      .union([z.uuid(), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    targetQty: optionalQty,
    qty: optionalQty,
    /**
     * What `qty` is counted in — preparatory stages only. "" is the unset
     * state a registered `<select>` submits, and it has to parse for the same
     * reason `actionFlag` does; the rule below is what makes it required
     * where it matters.
     */
    qtyUnit: z
      .union([z.enum(QTY_UNITS), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),
    qtyRejected: optionalQty,

    speedType: z.string().trim().max(20).optional(),
    speedRate: z.enum(["min", "hr"]).optional(),
    targetSpeed: optionalQty,
    actualSpeed: optionalQty,
    slowReason: z.string().trim().max(120).optional(),

    operators: operatorList,
    comment: z.string().trim().max(500).optional(),
    /**
     * "" is the "No — routine entry" option, and it has to parse. A bare
     * `z.enum(...).optional()` rejects it — `optional` means *absent*, and a
     * registered `<select>` submits an empty string, not `undefined`. That put
     * the form in a state where the default option failed validation against a
     * field with no visible error, so the submit button appeared dead until you
     * picked something else.
     */
    actionFlag: z
      .union([z.enum(ACTION_FLAGS), z.literal("")])
      .optional()
      .transform((v) => (v ? v : undefined)),

    /**
     * Mirrors the selected stage's `category`, so the rules below can see
     * which of the three shapes the form is currently in.
     */
    category: z.enum(PROCESS_CATEGORY_VALUES, {
      error: "Select an activity.",
    }),
    /**
     * Mirrors `has_machine` — meaningful on a production stage only, where it
     * decides whether equipment and speed are recorded. Forced false for the
     * other two categories by the database trigger in 0030, and by the form.
     */
    hasMachine: z.boolean(),
  })
  .superRefine((values, ctx) => {
    // Who did the work — required unless this is downtime. The issue is
    // pinned to the first picker rather than the array, so it renders inline
    // on the control the operator has to act on.
    if (operatorsRequired(values.category) && values.operators.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["operators", 0, "name"],
        message: OPERATOR_REQUIRED,
      });
    }

    // Downtime records time, not measurements. Nothing below applies, and the
    // form renders none of those fields — so returning here isn't just an
    // optimisation, it stops a stale value left over from a previous category
    // being validated against a control that is no longer on screen.
    if (values.category === "downtime") return;

    // A preparatory or production stage exists to produce something, so the
    // quantity it produced isn't optional — a blank there is an unfinished
    // entry, not a measurement. It stays `optionalQty` at the field level
    // because the *same* field must be absent on downtime; only this rule
    // knows which shape the form is currently in.
    //
    // `targetQty` is deliberately NOT required alongside it. It is derived
    // from target speed × duration and never typed, so there are entries for
    // which no target exists — an RPM-rated machine, a preparatory stage, a
    // Quick entry with no speed recorded. Demanding one would block those
    // outright; storing null says "no target applies", which is the truth and
    // keeps it out of every average.
    if (values.qty === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["qty"],
        message: "Enter how much this activity produced.",
      });
    }

    // A preparatory quantity without its unit is not a measurement — 3 of
    // what? Production doesn't ask: its unit is the speed unit, and the
    // number is whatever that counts.
    if (values.category === "preparatory") {
      if (!values.qtyUnit) {
        ctx.addIssue({
          code: "custom",
          path: ["qtyUnit"],
          message: "Pick what this is measured in.",
        });
      }
      return;
    }

    // ── Production only, from here ──────────────────────────────────────

    // Rejects can't exceed what was produced — a data-entry slip worth
    // catching before it skews the quality rate.
    if (
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

/**
 * Why a batch produced more than its work order required.
 *
 * Manager-only, and enforced by `shift_log_amend_guard` (migration 0023)
 * rather than here — this is the UX half. The minimum length is the same
 * argument as an amendment note: the flag exists because a number needs
 * accounting for, and "extra" accounts for nothing.
 */
export const explainOverrunSchema = z.object({
  note: z
    .string()
    .trim()
    .min(10, "Say why the extra was produced, and what happens to it.")
    .max(500, "Keep the note under 500 characters."),
});

export type ExplainOverrunValues = z.infer<typeof explainOverrunSchema>;

/* ── Shift log → Kaizen ─────────────────────────────────────────────────── */

/**
 * One improvement idea from the floor.
 *
 * There is no "submitted by" field, and its absence is the design: the person
 * is signed in, so the name is already known. A text box for it can be left
 * blank, misspelt, or filled in with somebody else's name — turning the one
 * piece of attribution that makes anyone bother submitting a second idea into
 * something the client asserts. It's stamped from the session instead.
 *
 * The 20-character floor is doing real work. "Move the press" is not an idea
 * anyone can act on a fortnight later, and the field's whole value is that it
 * says what the problem is well enough to be read by someone who wasn't there.
 */
export const kaizenIdeaSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(20, "Say a little more — what's the problem, and what would fix it?")
    .max(1000, "Keep it under 1000 characters."),
  category: z.string().min(1, "Pick a category."),
  impact: z.enum(["quick_win", "medium", "major"], {
    message: "Pick an expected impact.",
  }),
});

export type KaizenIdeaValues = z.infer<typeof kaizenIdeaSchema>;

/**
 * A reviewer's decision. The note is optional here and required by the form
 * when the decision is Decline — "no" with no reason is the fastest way to
 * stop the next idea ever being submitted.
 */
export const kaizenReviewSchema = z.object({
  note: z.string().trim().max(500, "Keep the note under 500 characters."),
});

export type KaizenReviewValues = z.infer<typeof kaizenReviewSchema>;
