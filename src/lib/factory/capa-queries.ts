import type {
  CapaDoneValues,
  CapaNewValues,
  CapaPlanActionValues,
  CapaPlanValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type {
  DeviationStatus,
  DeviationType,
} from "@/lib/factory/deviation-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * The CAPA register (migrations 0057, 0073).
 *
 * A CAPA is numbered CAPA-2026-001, may cover several cases, and runs through
 * three steps, as the reference QMS (qms-v6) has them:
 *
 *   1 · **CAPA plan** — the actions (what, who, due), how we will know it
 *       worked, when it is checked and by whom; then the plan is approved.
 *   2 · **Do** — each action marked done with its evidence.
 *   3 · **Effectiveness check** — worked (the CAPA closes) or didn't work
 *       (back to Do, for a new action, then checked again).
 *
 * The step is derived by `capas_expanded`, never stored. Browser-direct under
 * RLS; `capas_guard`, `capa_actions_guard` and `record_capa_check` own the
 * rules, and the database writes the history (`capa_audit`).
 */

export type CapaStatus = "open" | "effective";
export type CapaActionKind = "ca" | "pa";
export type CapaStep = "plan" | "do" | "check" | "closed";
export type CheckMode = "dated" | "at_implementation";

/** The steps as the stepper names them. */
export const CAPA_STEPS: { value: Exclude<CapaStep, "closed">; label: string }[] = [
  { value: "plan", label: "CAPA plan" },
  { value: "do", label: "Do" },
  { value: "check", label: "Effectiveness check" },
];

export const CAPA_STEP_LABEL: Record<CapaStep, string> = {
  plan: "CAPA plan",
  do: "Do",
  check: "Effectiveness check",
  closed: "Closed",
};

export const STEP_INDEX: Record<CapaStep, number> = {
  plan: 0,
  do: 1,
  check: 2,
  closed: 3,
};

export const ACTION_KINDS: {
  value: CapaActionKind;
  short: string;
  label: string;
  hint: string;
}[] = [
  {
    value: "ca",
    short: "CA",
    label: "Corrective action",
    hint: "Fixes this cause",
  },
  {
    value: "pa",
    short: "PA",
    label: "Preventive action",
    hint: "Stops it happening elsewhere",
  },
];

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
  /** Why the case earned a CAPA. */
  reason: string | null;
  target_date: string | null;
  root_cause: string | null;
  rca_method: string | null;

  /* ── 0073 ──────────────────────────────────────────────────────────── */
  check_mode: CheckMode;
  check_why: string | null;
  checker_name: string | null;
  plan_approved_at: string | null;
  plan_approved_by_name: string | null;
  plan_approval_note: string | null;
  /** The last check said it didn't work, and nothing has been added since. */
  reopened: boolean;
  step: CapaStep;
  /** The earliest due date of an action not yet done. */
  next_due: string | null;
  /** The latest due date of any action — what "+3 months" counts from. */
  last_due: string | null;
  last_done: string | null;
  check_count: number;
  first_check_effective: boolean | null;
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
  check_count, first_check_effective
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

/* ── Writing ──────────────────────────────────────────────────────────── */

const text = (value: string) => value.trim() || null;

/**
 * Create a CAPA from a case and link it, in one transaction (`initiate_capa`):
 * its title, owner and why, and optionally a first action (owned by the CAPA
 * owner, due in 30 days). It starts in the CAPA plan step. Returns its id.
 */
export async function createCapa(
  caseId: string,
  values: CapaNewValues,
  firstDue: string,
): Promise<string> {
  const supabase = createClient();
  const first = values.firstAction.trim();
  const { data, error } = await supabase.rpc("initiate_capa", {
    p_case: caseId,
    p_title: values.title.trim(),
    p_reason: values.reason,
    p_owner: values.owner.trim(),
    p_target: null,
    p_root_cause: null,
    p_rca_method: null,
    p_criteria: null,
    p_verify_by: null,
    p_actions: first
      ? [
          {
            kind: values.firstKind,
            description: first,
            owner_name: values.owner.trim(),
            target_date: firstDue,
            status: "open",
          },
        ]
      : [],
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function patchCapa(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("capas").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/** The plan's own answers — saved as they are; approving checks them all. */
export function saveCapaPlan(id: string, values: CapaPlanValues): Promise<void> {
  const dated = values.checkMode === "dated";
  return patchCapa(id, {
    title: values.title.trim(),
    owner_name: text(values.owner),
    effectiveness_criteria: text(values.effectivenessCriteria),
    check_mode: values.checkMode,
    verify_by: dated ? text(values.verifyBy) : null,
    check_why: dated ? null : text(values.checkWhy),
    checker_name: text(values.checker),
  });
}

/** Approve the CAPA plan — `capas_guard` checks every answer and stamps it. */
export function approveCapaPlan(id: string, byName: string, note: string): Promise<void> {
  return patchCapa(id, {
    plan_approved_at: new Date().toISOString(),
    plan_approved_by_name: byName,
    plan_approval_note: note.trim() || null,
  });
}

/** `created_by` is defaulted to the caller by the table and checked by RLS. */
export async function addCapaAction(
  factoryId: string,
  capaId: string,
  values: CapaPlanActionValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("capa_actions").insert({
    factory_id: factoryId,
    capa_id: capaId,
    kind: values.kind,
    description: values.description.trim(),
    owner_name: text(values.owner),
    target_date: text(values.targetDate),
    linked_record: text(values.linkedRecord),
  });
  if (error) throw new Error(error.message);
}

/** Change an action not yet done. */
export async function updateCapaAction(
  id: string,
  values: CapaPlanActionValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("capa_actions")
    .update({
      kind: values.kind,
      description: values.description.trim(),
      owner_name: text(values.owner),
      target_date: text(values.targetDate),
      linked_record: text(values.linkedRecord),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Remove an action — only from a plan not yet approved. */
export async function removeCapaAction(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("capa_actions").delete().eq("id", id);
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
      linked_record: text(values.linkedRecord),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Worked (the CAPA closes) or didn't work (back to Do). */
export async function recordCapaCheck(
  capaId: string,
  effective: boolean,
  findings: string,
  earlyReason: string,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("record_capa_check", {
    p_capa: capaId,
    p_effective: effective,
    p_findings: findings.trim(),
    p_early_reason: earlyReason.trim() || null,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
}

/* ── Display ──────────────────────────────────────────────────────────── */

export function actionKindMeta(kind: CapaActionKind) {
  return ACTION_KINDS.find((k) => k.value === kind) ?? ACTION_KINDS[0];
}

/** What the CAPA waits for next, and by when — the register's Next column. */
export function capaNext(c: Capa): { text: string; date: string | null } {
  switch (c.step) {
    case "plan":
      return {
        text: planMissing(c, null).length > 0 ? "Plan being written" : "Plan ready for approval",
        date: null,
      };
    case "do":
      return c.reopened
        ? { text: "Didn't work — add new actions", date: null }
        : c.next_due
          ? { text: "Next action due", date: c.next_due }
          : { text: "Add new actions", date: null };
    case "check":
      return c.check_mode === "at_implementation"
        ? { text: "Confirm it worked", date: null }
        : { text: "Effectiveness check", date: c.verify_by };
    default:
      return { text: "Closed — it worked", date: c.verified_at?.slice(0, 10) ?? null };
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
    out.push("who and due date on every action");
  }
  if (!c.effectiveness_criteria?.trim()) out.push("how you will know it worked");
  if (c.check_mode === "dated" && !c.verify_by) out.push("the check date");
  if (c.check_mode === "at_implementation" && !c.check_why?.trim()) {
    out.push("why no dated check is needed");
  }
  if (!c.checker_name?.trim()) out.push("who checks it");
  return out;
}
