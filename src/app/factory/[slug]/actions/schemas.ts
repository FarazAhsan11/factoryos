import { z } from "zod";

/**
 * One schema per stage boundary.
 *
 * These are for the person typing, not for the database — the
 * `actions_stage_transition` trigger re-checks every one of them and is the
 * only thing that actually cannot be bypassed. Their job here is to say what
 * is missing *before* a round-trip, and to keep the minimums honest: a root
 * cause of "broken" and a verification of "ok" pass any not-blank check and
 * tell the next person nothing.
 */

const required = (min: number, message: string) =>
  z.string().trim().min(min, message);

/** open → investigating. The stage's whole content is that it has an owner. */
export const investigateSchema = z.object({
  assignedTo: required(2, "Who is looking into this?"),
});

/**
 * investigating → action_taken. The investigation's one output.
 *
 * The corrective action deliberately is not here. Asking for it on this
 * boundary is what put a "what was done about it" box under a stepper reading
 * INVESTIGATING — a fix demanded for a cause the person was still typing.
 */
export const rootCauseSchema = z.object({
  rootCause: required(8, "Say what actually caused it, not just what broke."),
});

/** action_taken → verification. The C and the P of CAPA. */
export const correctiveActionSchema = z.object({
  correctiveAction: required(8, "Describe what was done about it."),
  // The P in CAPA, and the only optional field: not every issue has a
  // generalisable fix, and a mandatory box with nothing to say fills up with
  // "N/A" until it means nothing.
  preventiveAction: z.string().trim().optional(),
});

/** verification → closed. Supervisor and up; the trigger enforces the role. */
export const closeSchema = z.object({
  verification: required(8, "How do you know the fix worked?"),
});

/**
 * open → closed — the short road, for issues that need no CAPA.
 *
 * Same column as `closeSchema`, deliberately different wording: nothing has
 * been verified here, because there was no corrective action to verify. What
 * is being recorded is what was done about it, which for the issues this path
 * exists for is the entire story.
 */
export const resolveDirectSchema = z.object({
  verification: required(8, "Say what was actually done about it."),
});

/** Any backward move. The reason is the price of undoing someone's work. */
export const revertSchema = z.object({
  reason: required(8, "Say why this is going back."),
});

/** Saving an investigation in progress, without moving the issue on. */
export const rootCauseDraftSchema = z.object({
  rootCause: z.string().trim().optional(),
});

export type InvestigateValues = z.infer<typeof investigateSchema>;
export type RootCauseValues = z.infer<typeof rootCauseSchema>;
export type CorrectiveActionValues = z.infer<typeof correctiveActionSchema>;
export type CloseValues = z.infer<typeof closeSchema>;
export type ResolveDirectValues = z.infer<typeof resolveDirectSchema>;
export type RevertValues = z.infer<typeof revertSchema>;
