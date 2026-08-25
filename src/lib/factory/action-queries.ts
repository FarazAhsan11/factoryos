import type { FactoryRole } from "@/lib/factory/context";
import { createClient } from "@/lib/supabase/client";

/**
 * Issues & CAPAs. Reads the `actions_expanded` view (migrations 0017, 0020,
 * 0027), where both clocks are computed on every read rather than stored — so
 * an issue escalates at 2am whether or not anyone has the app open.
 *
 * The stage flow is `open → investigating → action_taken → verification →
 * closed`, one step at a time, each move paid for with the evidence that stage
 * exists to produce — and, since 0027, each stage collecting the thing it is
 * actually named after: the root cause under Investigating, the corrective
 * action under Action taken, the sign-off under Verification. Nothing in this
 * file enforces that: the `actions_stage_transition`
 * trigger does. Issues are written browser-direct under RLS, so a rule that
 * lives only here is a rule anyone with a session can PATCH straight past.
 * What is here is the UI's half — knowing which move is available next so the
 * form for the wrong one is never rendered in the first place.
 */

export type ActionStage =
  | "open"
  | "investigating"
  | "action_taken"
  | "verification"
  | "closed";
export type ActionPriority = "critical" | "high" | "medium" | "low";

export const ACTION_CATEGORIES = [
  "Quality",
  "Maintenance",
  "Safety",
  "Process",
  "Manning",
  "Other",
] as const;

export const ACTION_PRIORITIES: {
  value: ActionPriority;
  label: string;
  /** The due window, echoed from `action_window()` so the form can say it. */
  within: string;
}[] = [
  { value: "critical", label: "Critical", within: "2 hours" },
  { value: "high", label: "High", within: "4 hours" },
  { value: "medium", label: "Medium", within: "8 hours" },
  { value: "low", label: "Low", within: "24 hours" },
];

/** Hours each priority gets — mirrors `action_window()` in migration 0017. */
const DUE_HOURS: Record<ActionPriority, number> = {
  critical: 2,
  high: 4,
  medium: 8,
  low: 24,
};

/* ── The stages ───────────────────────────────────────────────────────── */

/** Declaration order is comparison order, here and in the Postgres enum. */
export const ACTION_STAGES: ActionStage[] = [
  "open",
  "investigating",
  "action_taken",
  "verification",
  "closed",
];

export const STAGE_LABELS: Record<ActionStage, string> = {
  open: "Open",
  investigating: "Investigating",
  action_taken: "Action taken",
  verification: "Verification",
  closed: "Closed",
};

/**
 * What the stage is *for* — shown under each step of the timeline.
 *
 * Each one is phrased as the question that stage answers, because that is
 * what its form asks for and the two should not be able to drift apart again.
 */
export const STAGE_BLURBS: Record<ActionStage, string> = {
  open: "Raised and waiting for an owner.",
  investigating: "Someone owns it and is finding the cause.",
  action_taken: "The cause is known — now the fix.",
  verification: "The fix is in, waiting on sign-off.",
  closed: "Verified and signed off.",
};

export function stageIndex(stage: ActionStage): number {
  return ACTION_STAGES.indexOf(stage);
}

/** The one stage this issue can move forward to, or null at the end. */
export function nextStage(stage: ActionStage): ActionStage | null {
  return ACTION_STAGES[stageIndex(stage) + 1] ?? null;
}

/**
 * Was this closed without ever being investigated — the short road?
 *
 * Read off the view rather than re-derived here, because the label on the
 * closed evidence hangs on it: an issue that took the short road recorded a
 * *resolution*, and calling that a verification says a fix was tested when
 * nobody tested anything.
 */
export function tookShortRoad(action: FactoryAction): boolean {
  return action.resolved_direct;
}

/** What to call the text in `verification` for this issue. */
export function verificationLabel(action: FactoryAction): string {
  return action.resolved_direct ? "Resolution" : "Verification";
}

/**
 * A stage this issue went *past* without entering — only ever the middle
 * three, and only on an issue resolved straight out of Open.
 *
 * Shared by the stepper and the timeline so the two can't disagree about what
 * happened. A tick under "Action taken" on an issue nobody investigated would
 * be the UI inventing a CAPA.
 */
export function isStageSkipped(
  action: FactoryAction,
  stage: ActionStage | undefined
): boolean {
  if (!stage || !action.resolved_direct) return false;
  return (
    stage === "investigating" ||
    stage === "action_taken" ||
    stage === "verification"
  );
}

/**
 * The one stage it can go back to — `verification → action_taken` when the fix
 * didn't hold, `action_taken → investigating` when the cause was wrong,
 * `closed → open` to re-open. There is deliberately no `investigating → open`:
 * un-assigning is what that means, and it is a field on the issue, not a stage
 * change.
 */
export function prevStage(stage: ActionStage): ActionStage | null {
  if (stage === "verification") return "action_taken";
  if (stage === "action_taken") return "investigating";
  if (stage === "closed") return "open";
  return null;
}

/** What going back from here is called, in the words of what it undoes. */
export const REVERT_LABELS: Record<string, string> = {
  verification: "Send the fix back",
  action_taken: "Send back to investigating",
  closed: "Re-open",
};

const REVIEWER_ROLES: FactoryRole[] = [
  "super_admin",
  "admin",
  "manager",
  "supervisor",
];

/**
 * Supervisor and up, mirroring `can_review_factory()` in migration 0019.
 * Closing an issue is a review, and so is undoing one.
 */
export function canReview(role: FactoryRole): boolean {
  return REVIEWER_ROLES.includes(role);
}

export interface FactoryAction {
  id: string;
  title: string;
  unit_id: string | null;
  unit_name: string | null;
  category: string;
  priority: ActionPriority;
  status: ActionStage;
  assigned_to: string | null;
  due_at: string;
  notes: string | null;
  shift_log_entry_id: string | null;
  created_at: string;

  /* The affected batch. Both stored — the text survives a batch that was
     never added to the catalogue, the id is the resolution when there is
     one. Filled straight off the entry when the shift log raised it. */
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;

  /** What each stage produced. Null until the issue has been through it. */
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification: string | null;
  investigating_at: string | null;
  /** When the root cause landed — the issue became somebody's fix to make. */
  action_taken_at: string | null;
  /** When the corrective action landed — the sign-off clock starts here. */
  verification_at: string | null;
  closed_at: string | null;

  /** Derived in the view, never stored. */
  is_overdue: boolean;
  is_escalated: boolean;
  escalates_at: string;
  /** Null unless the issue is actually waiting on a sign-off. */
  verify_due_at: string | null;
  is_verify_overdue: boolean;
  note_count: number;

  /**
   * Closed without ever being investigated — the short road, for issues that
   * genuinely needed no CAPA. When true, `verification` holds an account of
   * what was done rather than a verification of a corrective action.
   */
  resolved_direct: boolean;
}

export interface ActionNote {
  id: string;
  note: string;
  is_system: boolean;
  created_at: string;
}

const COLUMNS = `
  id, title, unit_id, unit_name, category, priority, status,
  assigned_to, due_at, notes, shift_log_entry_id, created_at,
  batch_no, product_id, product_name, product_code,
  root_cause, corrective_action, preventive_action, verification,
  investigating_at, action_taken_at, verification_at, closed_at,
  is_overdue, is_escalated, escalates_at,
  verify_due_at, is_verify_overdue, note_count, resolved_direct
`;

export const actionKeys = {
  all: (factoryId: string) => ["actions", factoryId] as const,
  notes: (actionId: string) => ["action_notes", actionId] as const,
};

/**
 * Every issue for the factory, most urgent first.
 *
 * Ordered in Postgres by what actually demands attention: unclosed before
 * closed, then by due time. An escalated issue is by definition the most
 * overdue, so it rises to the top without a separate sort key.
 */
export async function fetchActions(
  factoryId: string
): Promise<FactoryAction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("actions_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("closed_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FactoryAction[];
}

export async function fetchActionNotes(
  actionId: string
): Promise<ActionNote[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("action_notes")
    .select("id, note, is_system, created_at")
    .eq("action_id", actionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ActionNote[];
}

export interface NewActionValues {
  title: string;
  unitId: string;
  category: string;
  priority: ActionPriority;
  assignedTo: string;
  /** `datetime-local` value, or "" to derive one from the priority. */
  dueAt: string;
  notes: string;
  /** Typed, optional, never validated against the catalogue. */
  batchNo: string;
}

/** Now + the priority's window, as an ISO timestamp. */
export function defaultDueAt(priority: ActionPriority): string {
  return new Date(Date.now() + DUE_HOURS[priority] * 3600_000).toISOString();
}

export async function createAction(
  factoryId: string,
  values: NewActionValues,
  createdBy: string,
  /** Resolved from the typed batch number, or null when it matched nothing. */
  productId: string | null = null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("actions").insert({
    factory_id: factoryId,
    title: values.title.trim(),
    unit_id: values.unitId || null,
    category: values.category,
    priority: values.priority,
    assigned_to: values.assignedTo.trim() || null,
    // A blank due date isn't "no deadline" — an issue with no clock can never
    // be overdue and so never escalates, which is the one thing this module
    // exists to prevent. The priority's own window stands in.
    due_at: values.dueAt
      ? new Date(values.dueAt).toISOString()
      : defaultDueAt(values.priority),
    notes: values.notes.trim() || null,
    batch_no: values.batchNo.trim() || null,
    product_id: productId,
    created_by: createdBy,
  });

  if (error) throw new Error(error.message);
}

/* ── Moving through the stages ────────────────────────────────────────── */

/** What each forward move has to carry. Everything else is stage-specific. */
export interface AdvancePayload {
  /** → investigating. Blank means "keep whoever is already assigned". */
  assignedTo?: string;
  /** → action_taken. The investigation's one output. */
  rootCause?: string;
  /** → verification. What was actually done, and what stops a repeat. */
  correctiveAction?: string;
  preventiveAction?: string;
  /**
   * → closed. Doubles as the account of what was done on the short road,
   * `open → closed` — same column, same boundary, and `resolved_direct` is
   * what tells the two apart afterwards.
   */
  verification?: string;
}

/**
 * Moves an issue forward, carrying that stage's evidence.
 *
 * One stage at a time, with a single exception: an open issue may go straight
 * to closed when it needs no CAPA. That is the only legal skip, it costs a
 * written account and supervisor standing, and — like everything else here —
 * the trigger is what enforces it.
 *
 * Evidence and status go up in a **single** update, and they have to: the
 * `actions_evidence_follows_stage` constraint refuses a row holding a
 * corrective action while still open, so writing the text first and the
 * status second is not a sequence the database will accept. Which is the
 * point — it is exactly the "fill in the fix without investigating" path.
 */
export async function advanceAction(
  actionId: string,
  to: ActionStage,
  payload: AdvancePayload = {}
): Promise<void> {
  const supabase = createClient();

  const patch: Record<string, string | null> = { status: to };

  if (to === "investigating" && payload.assignedTo?.trim()) {
    patch.assigned_to = payload.assignedTo.trim();
  }
  if (to === "action_taken") {
    patch.root_cause = payload.rootCause?.trim() ?? null;
  }
  if (to === "verification") {
    patch.corrective_action = payload.correctiveAction?.trim() ?? null;
    patch.preventive_action = payload.preventiveAction?.trim() || null;
  }
  if (to === "closed") {
    patch.verification = payload.verification?.trim() ?? null;
  }

  const { error } = await supabase
    .from("actions")
    .update(patch)
    .eq("id", actionId);
  if (error) throw new Error(error.message);
}

/**
 * Moves an issue back a stage, with the reason attached.
 *
 * Through the `revert_action` RPC rather than a plain update, because a
 * backward move without a recorded reason should not be *expressible*. The
 * function writes the reason into the thread and flips the stage in one
 * statement; a direct update to an earlier stage is rejected by the trigger.
 */
export async function revertAction(
  actionId: string,
  to: ActionStage,
  reason: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("revert_action", {
    p_action: actionId,
    p_to: to,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

/** Reassigns an issue. Empty string clears it back to unassigned. */
export async function assignAction(
  actionId: string,
  assignedTo: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("actions")
    .update({ assigned_to: assignedTo.trim() || null })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
}

/**
 * Saves the root cause without moving the issue on.
 *
 * An investigation is rarely one sitting, and the alternative is retyping it
 * from a scrap of paper when the answer finally lands. Allowed at
 * `investigating` and beyond by the evidence constraint, which is exactly the
 * window where it makes sense.
 */
export async function saveRootCause(
  actionId: string,
  rootCause: string
): Promise<void> {
  return updateEvidence(actionId, "root_cause", rootCause);
}

/** The four fields a stage records, and what to call them to someone. */
export const EVIDENCE_FIELDS = {
  root_cause: "Root cause",
  corrective_action: "Corrective action",
  preventive_action: "Preventive action",
  verification: "Verification",
} as const;

export type EvidenceField = keyof typeof EVIDENCE_FIELDS;

/**
 * Corrects what a stage recorded, in place.
 *
 * Amendable but never silently: `actions_stage_transition` writes the previous
 * text into the thread on every change, refuses to let a stage already passed
 * be emptied, and requires a reviewer once the issue is closed. Same bargain
 * the shift log strikes — the record can be fixed, but not quietly re-authored.
 */
export async function updateEvidence(
  actionId: string,
  field: EvidenceField,
  value: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("actions")
    .update({ [field]: value.trim() || null })
    .eq("id", actionId);
  if (error) throw new Error(error.message);
}

/**
 * Whether this viewer may correct a recorded field right now.
 *
 * Only the closed case is restricted, and the UI mirrors the trigger rather
 * than inventing its own rule: amending a closed issue rewrites something a
 * supervisor signed, so it takes the standing that signing it took.
 */
export function canAmend(action: FactoryAction, role: FactoryRole): boolean {
  return action.status !== "closed" || canReview(role);
}

export async function addActionNote(
  factoryId: string,
  actionId: string,
  note: string,
  createdBy: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("action_notes").insert({
    factory_id: factoryId,
    action_id: actionId,
    note: note.trim(),
    created_by: createdBy,
  });
  if (error) throw new Error(error.message);
}

/* ── Display helpers ──────────────────────────────────────────────────── */

/** "8 Aug, 06:46 pm" — the prototype's format, which reads well in a list. */
export function formatDue(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "in 40m" / "3h ago" — the relative half of a due date.
 *
 * The absolute time says when; this says whether that is a problem, which is
 * the thing someone scanning a list actually needs.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / (60 * 24))}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/**
 * The tabs across the top: one per stage, and nothing else.
 *
 * Escalated is deliberately *not* a fifth tab. An escalated issue is already
 * sitting in Open or Investigating, so a tab for it would show the same rows
 * twice and make the counts lie. It is a toggle that cuts across all five —
 * see `escalatedOnly` in the workspace.
 */
export function stageCounts(
  actions: FactoryAction[]
): Record<ActionStage, number> {
  const counts: Record<ActionStage, number> = {
    open: 0,
    investigating: 0,
    action_taken: 0,
    verification: 0,
    closed: 0,
  };
  for (const action of actions) counts[action.status] += 1;
  return counts;
}

/**
 * Needs someone's attention right now: escalated while the fix is outstanding,
 * or sat past its sign-off window. One toggle, both clocks — from the floor's
 * point of view "this has been ignored too long" is a single idea.
 */
export function needsAttention(action: FactoryAction): boolean {
  return action.is_escalated || action.is_verify_overdue;
}
