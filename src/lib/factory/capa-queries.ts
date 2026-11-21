import type {
  CapaActionAddValues,
  CapaDoneValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type {
  DeviationStatus,
  DeviationType,
} from "@/lib/factory/deviation-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * The CAPA register (migrations 0057, 0073, 0074).
 *
 * A CAPA is numbered CAPA-2026-001, may cover several cases, and runs
 * Plan → Implement → Verify → Closed, as the reference QMS (qms-v8) has it:
 *
 *   1 · **Plan** — corrective and preventive actions (what, owner, target
 *       date), the effectiveness criteria, when the check is due and who
 *       verifies; then the plan is approved.
 *   2 · **Implement** — each action marked done with its completion evidence.
 *   3 · **Verify** — effective (the CAPA closes) or not effective (back to
 *       Implement for new actions, with a new check date).
 *
 * A closed CAPA is never reopened: when its problem comes back, a follow-up
 * CAPA records the recurrence (`recurrence_of`).
 *
 * The database names the steps plan / do / check / closed; the screens say
 * Plan / Implement / Verify / Closed. The step is derived by
 * `capas_expanded`, never stored. Browser-direct under RLS; `capas_guard`,
 * `capa_actions_guard`, `create_capa_plan` and `record_capa_check` own the
 * rules, and the database writes the history (`capa_audit`).
 */

export type CapaStatus = "open" | "effective";
export type CapaActionKind = "ca" | "pa";
export type CapaStep = "plan" | "do" | "check" | "closed";
export type CheckMode = "dated" | "at_implementation";

/** The steps as the stepper names them. */
export const CAPA_STEPS: { value: Exclude<CapaStep, "closed">; label: string }[] = [
  { value: "plan", label: "Plan" },
  { value: "do", label: "Implement" },
  { value: "check", label: "Verify" },
];

export const STEP_INDEX: Record<CapaStep, number> = {
  plan: 0,
  do: 1,
  check: 2,
  closed: 3,
};

/** A case the CAPA covers, as the view aggregates it. */
export interface CapaCase {
  id: string;
  deviation_no: string;
  type: DeviationType;
  status: DeviationStatus;
}

export interface Capa {
  id: string;
  /** "CAPA-2026-001". */
  capa_no: string;
  title: string;
  owner_name: string | null;
  status: CapaStatus;
  effectiveness_criteria: string | null;
  verify_by: string | null;
  verification: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  created_at: string;
  action_count: number;
  actions_closed: number;
  /** Open actions past their due date. */
  actions_overdue: number;
  cases: CapaCase[];
  reason: string | null;
  target_date: string | null;
  /** Only when the case it came from had none recorded (0074). */
  root_cause: string | null;
  rca_method: string | null;

  /* ── 0073 ──────────────────────────────────────────────────────────── */
  check_mode: CheckMode;
  check_why: string | null;
  checker_name: string | null;
  plan_approved_at: string | null;
  plan_approved_by_name: string | null;
  plan_approval_note: string | null;
  /** The last check was not effective, and nothing has been added since. */
  reopened: boolean;
  step: CapaStep;
  /** The earliest target date of an action not yet done. */
  next_due: string | null;
  /** The latest target date of any action — what "+3 months" counts from. */
  last_due: string | null;
  last_done: string | null;
  check_count: number;
  first_check_effective: boolean | null;

  /* ── 0074 ──────────────────────────────────────────────────────────── */
  /** The closed CAPA this one follows up — its problem came back. */
  recurrence_of: string | null;
  recurrence_of_no: string | null;
  /** Follow-ups started from this CAPA, oldest first. */
  recurred_by: { id: string; capa_no: string; created_at: string; case_no: string | null }[];
  created_by_name: string | null;
  /** Everyone who owns an action, A–Z. */
  action_owners: string[];
}

export interface CapaAction {
  id: string;
  capa_id: string;
  kind: CapaActionKind;
  description: string;
  owner_name: string | null;
  target_date: string | null;
  /** Done: the date, who, and the evidence. */
  closed_date: string | null;
  closed_by_name: string | null;
  evidence: string | null;
  linked_record: string | null;
  created_at: string;
}

export interface CapaCheck {
  id: string;
  result: "effective" | "not_effective";
  findings: string;
  /** "Verified before the planned date (…)", when it was. */
  early_reason: string | null;
  checked_at: string;
  checked_by_name: string;
}

export interface CapaAuditEntry {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
}

const COLUMNS = `
  id, capa_no, title, owner_name, status,
  effectiveness_criteria, verify_by, verification, verified_by_name, verified_at,
  created_at, action_count, actions_closed, actions_overdue, cases,
  reason, target_date, root_cause, rca_method,
  check_mode, check_why, checker_name, plan_approved_at, plan_approved_by_name,
  plan_approval_note, reopened, step, next_due, last_due, last_done,
  check_count, first_check_effective,
  recurrence_of, recurrence_of_no, recurred_by, created_by_name, action_owners
`;

const ACTION_COLUMNS = `
  id, capa_id, kind, description, owner_name, target_date,
  closed_date, closed_by_name, evidence, linked_record, created_at
`;

/** Under the deviations prefix — see `deviationKeys`. */
export const capaKeys = {
  all: (factoryId: string) => ["deviations", factoryId, "capas"] as const,
  actions: (factoryId: string, capaId: string) =>
    ["deviations", factoryId, "capas", capaId, "actions"] as const,
  checks: (factoryId: string, capaId: string) =>
    ["deviations", factoryId, "capas", capaId, "checks"] as const,
  audit: (factoryId: string, capaId: string) =>
    ["deviations", factoryId, "capas", capaId, "audit"] as const,
};

/** Every CAPA for the factory, newest first. */
export async function fetchCapas(factoryId: string): Promise<Capa[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capas_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Capa[];
}

/** One CAPA's actions, in the order they were raised. */
export async function fetchCapaActions(capaId: string): Promise<CapaAction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capa_actions")
    .select(ACTION_COLUMNS)
    .eq("capa_id", capaId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CapaAction[];
}

/** Every effectiveness check, oldest first. */
export async function fetchCapaChecks(capaId: string): Promise<CapaCheck[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capa_checks")
    .select("id, result, findings, early_reason, checked_at, checked_by_name")
    .eq("capa_id", capaId)
    .order("checked_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CapaCheck[];
}

/** The CAPA's history, newest first. */
export async function fetchCapaAudit(capaId: string): Promise<CapaAuditEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("capa_audit")
    .select("id, at, actor_name, action, field, old_value, new_value, reason")
    .eq("capa_id", capaId)
    .order("at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CapaAuditEntry[];
}

/* ── The plan, as it is written (v8's plan editor) ─────────────────────── */

/** One row of the plan's action tables. `id` is set once it is saved. */
export interface DraftAction {
  /** Stable React key. */
  key: string;
  id?: string;
  kind: CapaActionKind;
  text: string;
  owner: string;
  due: string;
}

/** The plan being written: on a case's Actions tab, or on the CAPA page. */
export interface PlanDraft {
  actions: DraftAction[];
  criteria: string;
  checkMode: CheckMode;
  verifyBy: string;
  checker: string;
}

// Row keys for unsaved actions. A counter, not `crypto.randomUUID()`, which
// a browser only offers on HTTPS or localhost.
let draftSeq = 0;

export function blankAction(kind: CapaActionKind): DraftAction {
  draftSeq += 1;
  return { key: `new-${draftSeq}`, kind, text: "", owner: "", due: "" };
}

/** A fresh plan for a case — one empty corrective action. */
export function newPlanDraft(classification: string | null): PlanDraft {
  return {
    actions: [blankAction("ca")],
    criteria: "",
    // A Minor case is usually a simple fix: verified when the actions are done.
    checkMode: classification === "Minor" ? "at_implementation" : "dated",
    verifyBy: "",
    checker: "",
  };
}

/** The saved plan, as the editor holds it. */
export function planDraftOf(c: Capa, actions: CapaAction[]): PlanDraft {
  return {
    actions: actions.map((a) => ({
      key: a.id,
      id: a.id,
      kind: a.kind,
      text: a.description,
      owner: a.owner_name ?? "",
      due: a.target_date ?? "",
    })),
    criteria: c.effectiveness_criteria ?? "",
    checkMode: c.check_mode,
    verifyBy: c.verify_by ?? "",
    checker: c.checker_name ?? "",
  };
}

/** What the plan still needs before it can be sent or approved (v8's list). */
export function draftMissing(d: PlanDraft): string[] {
  const out: string[] = [];
  if (d.actions.length === 0) out.push("at least one action");
  if (d.actions.some((a) => !a.text.trim() || !a.owner.trim() || !a.due)) {
    out.push("action, owner and target date on every row");
  }
  if (!d.criteria.trim()) out.push("effectiveness criteria");
  if (d.checkMode === "dated" && !d.verifyBy) out.push("check due date");
  if (!d.checker.trim()) out.push("verifier");
  return out;
}

/** Whether the editor's plan differs from what is saved. */
export function draftChanged(a: PlanDraft, b: PlanDraft): boolean {
  const norm = (d: PlanDraft) =>
    JSON.stringify({
      ...d,
      actions: d.actions.map(({ id, kind, text, owner, due }) => ({ id, kind, text, owner, due })),
    });
  return norm(a) !== norm(b);
}

/**
 * v8's "Create CAPA and send for approval" — the CAPA, its actions and its
 * effectiveness check in one transaction (`create_capa_plan`), linked to the
 * case. Returns the new CAPA's id.
 */
export async function createCapaPlan(
  caseId: string,
  title: string,
  rootCause: string,
  d: PlanDraft,
  recurrenceOf: string | null,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_capa_plan", {
    p_case: caseId,
    p_title: title.trim(),
    p_root_cause: rootCause.trim() || null,
    p_actions: d.actions.map((a) => ({
      kind: a.kind,
      description: a.text.trim(),
      owner_name: a.owner.trim(),
      target_date: a.due,
    })),
    p_criteria: d.criteria.trim(),
    p_check_mode: d.checkMode,
    p_verify_by: d.checkMode === "dated" ? d.verifyBy || null : null,
    p_checker: d.checker.trim(),
    p_recurrence_of: recurrenceOf,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function patchCapa(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("capas").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Save an edited plan (before approval): the CAPA's own answers, then each
 * action added, changed or removed. The database writes the history.
 */
export async function savePlanDraft(
  factoryId: string,
  capa: Capa,
  saved: CapaAction[],
  d: PlanDraft,
): Promise<void> {
  await patchCapa(capa.id, {
    effectiveness_criteria: d.criteria.trim() || null,
    check_mode: d.checkMode,
    verify_by: d.checkMode === "dated" ? d.verifyBy || null : null,
    checker_name: d.checker.trim() || null,
  });

  const supabase = createClient();
  const kept = new Set(d.actions.map((a) => a.id).filter(Boolean));
  for (const a of saved) {
    if (!kept.has(a.id)) {
      const { error } = await supabase.from("capa_actions").delete().eq("id", a.id);
      if (error) throw new Error(error.message);
    }
  }
  for (const a of d.actions) {
    const row = {
      kind: a.kind,
      description: a.text.trim(),
      owner_name: a.owner.trim() || null,
      target_date: a.due || null,
    };
    if (!a.id) {
      // An empty new row is not saved.
      if (!row.description) continue;
      const { error } = await supabase
        .from("capa_actions")
        .insert({ factory_id: factoryId, capa_id: capa.id, ...row });
      if (error) throw new Error(error.message);
      continue;
    }
    const was = saved.find((s) => s.id === a.id);
    if (
      was &&
      (was.kind !== row.kind ||
        was.description !== row.description ||
        was.owner_name !== row.owner_name ||
        was.target_date !== row.target_date)
    ) {
      const { error } = await supabase.from("capa_actions").update(row).eq("id", a.id);
      if (error) throw new Error(error.message);
    }
  }
}

/**
 * The root cause the CAPA works on, when its case's investigation is not
 * approved (or was not done). Blank clears it.
 */
export function setCapaRootCause(id: string, rootCause: string): Promise<void> {
  return patchCapa(id, { root_cause: rootCause.trim() || null });
}

/** Rename the CAPA — useful when it covers several cases. */
export function renameCapa(id: string, title: string): Promise<void> {
  return patchCapa(id, { title: title.trim() });
}

/** Approve the CAPA plan — `capas_guard` checks every answer and stamps it. */
export function approveCapaPlan(id: string, byName: string, note: string): Promise<void> {
  return patchCapa(id, {
    plan_approved_at: new Date().toISOString(),
    plan_approved_by_name: byName,
    plan_approval_note: note.trim() || null,
  });
}

/** An action added once the plan is approved — the history marks it so. */
export async function addCapaAction(
  factoryId: string,
  capaId: string,
  kind: CapaActionKind,
  values: CapaActionAddValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("capa_actions").insert({
    factory_id: factoryId,
    capa_id: capaId,
    kind,
    description: values.description.trim(),
    owner_name: values.owner.trim(),
    target_date: values.targetDate,
  });
  if (error) throw new Error(error.message);
}

/** Mark an action done — today, by the signed-in person, with its evidence. */
export async function markCapaActionDone(
  id: string,
  values: CapaDoneValues,
  doneOn: string,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("capa_actions")
    .update({
      closed_date: doneOn,
      closed_by_name: byName,
      evidence: values.evidence.trim(),
      linked_record: values.linkedRecord.trim() || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Effective (the CAPA closes) or not effective (with the next check date). */
export async function recordCapaCheck(
  capaId: string,
  effective: boolean,
  findings: string,
  nextCheck: string | null,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("record_capa_check", {
    p_capa: capaId,
    p_effective: effective,
    p_findings: findings.trim(),
    p_next_check: effective ? null : nextCheck,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
}

/* ── Display ──────────────────────────────────────────────────────────── */

/** Where the CAPA stands, in a few words — v8's status. */
export function stepLabel(c: Capa): string {
  switch (c.step) {
    case "plan":
      return planMissing(c, null).length > 0 ? "Plan incomplete" : "Awaiting plan approval";
    case "do":
      return c.reopened ? "Not effective — new actions" : "Implementing";
    case "check":
      return "Verification due";
    default:
      return "Closed — effective";
  }
}

/** What the CAPA waits for next, and by when — the register's Next column. */
export function capaNext(c: Capa): { text: string; date: string | null } {
  switch (c.step) {
    case "plan":
      return { text: stepLabel(c), date: null };
    case "do":
      return c.next_due
        ? { text: "Next action due", date: c.next_due }
        : { text: "Add new actions", date: null };
    case "check":
      return c.check_mode === "at_implementation"
        ? { text: "Verify on completion", date: null }
        : { text: "Effectiveness check due", date: c.verify_by };
    default:
      return { text: "Closed — effective", date: c.verified_at?.slice(0, 10) ?? null };
  }
}

/**
 * What the plan still needs before it can be approved — the same list
 * `capas_guard` checks. `actions` may be null (the register), in which case
 * only the counts the view carries are used.
 */
export function planMissing(c: Capa, actions: CapaAction[] | null): string[] {
  const out: string[] = [];
  if ((actions ? actions.length : c.action_count) === 0) out.push("at least one action");
  if (actions && actions.some((a) => !a.owner_name?.trim() || !a.target_date)) {
    out.push("action, owner and target date on every row");
  }
  if (!c.effectiveness_criteria?.trim()) out.push("effectiveness criteria");
  if (c.check_mode === "dated" && !c.verify_by) out.push("check due date");
  if (!c.checker_name?.trim()) out.push("verifier");
  return out;
}

/** "When the actions are done", or the check date. */
export function checkText(
  c: { check_mode: CheckMode; verify_by: string | null },
  fmt: (d: string) => string,
): string {
  if (c.check_mode === "at_implementation") return "When the actions are done";
  return c.verify_by ? fmt(c.verify_by) : "—";
}
