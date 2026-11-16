import type {
  CapaActionCloseValues,
  CapaActionValues,
  CapaCreateValues,
  CapaHeaderValues,
  CapaInitiateValues,
  CapaVerifyValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type {
  DeviationStatus,
  DeviationType,
} from "@/lib/factory/deviation-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * The CAPA register (migration 0057).
 *
 * A CAPA is a plan of its own — numbered CAPA-2026-001, with an owner, a list
 * of corrective and preventive actions, and a verification that it worked —
 * and one CAPA may cover several cases. Each action carries the five fields
 * the case's old CA / PA tabs had: owner, target date, actual closed date,
 * closed by, description.
 *
 * Browser-direct under RLS, like the cases. `capas_guard` and
 * `capa_actions_guard` own the rules: an effective CAPA is frozen, it cannot
 * be verified until every action is closed, and a closed action is frozen.
 */

export type CapaStatus = "open" | "effective";
export type CapaActionKind = "ca" | "pa";
/** Stored while the action is worked; "closed" is the close itself. */
export type CapaActionStatus = "open" | "in_progress";

export const ACTION_STATUS_LABELS: Record<CapaActionStatus | "closed", string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};

export const CAPA_STATUS_LABELS: Record<CapaStatus, string> = {
  open: "Open",
  effective: "Effective",
};

export const CAPA_STATUS_PILL: Record<CapaStatus, string> = {
  open: "bg-warn-soft text-warn-deep",
  effective: "bg-teal-soft text-teal-deep",
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
    hint: "Fixes the cause in front of you",
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

  /* ── Computed in `capas_expanded` ──────────────────────────────────── */
  action_count: number;
  actions_closed: number;
  /** Open actions past their target date. */
  actions_overdue: number;
  /** Open, and past its verify-by date. */
  is_verify_overdue: boolean;
  cases: CapaCase[];

  /* ── 0059 ──────────────────────────────────────────────────────────── */
  /** Why the case earned a CAPA. */
  reason: string | null;
  /** When the CAPA is meant to be complete (not when it is verified). */
  target_date: string | null;
  root_cause: string | null;
  rca_method: string | null;
  /** Open, and past its target date. */
  is_overdue: boolean;
}

export interface CapaAction {
  id: string;
  capa_id: string;
  kind: CapaActionKind;
  description: string;
  owner_name: string | null;
  target_date: string | null;
  closed_date: string | null;
  closed_by_name: string | null;
  status: CapaActionStatus;
  created_at: string;
}

const COLUMNS = `
  id, capa_no, title, owner_name, status,
  effectiveness_criteria, verify_by, verification, verified_by_name, verified_at,
  created_at, action_count, actions_closed, actions_overdue, is_verify_overdue, cases,
  reason, target_date, root_cause, rca_method, is_overdue
`;

const ACTION_COLUMNS = `
  id, capa_id, kind, description, owner_name, target_date,
  closed_date, closed_by_name, status, created_at
`;

/** Under the deviations prefix — see `deviationKeys`. */
export const capaKeys = {
  all: (factoryId: string) => ["deviations", factoryId, "capas"] as const,
  actions: (factoryId: string, capaId: string) =>
    ["deviations", factoryId, "capas", capaId, "actions"] as const,
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

/* ── Writing ──────────────────────────────────────────────────────────── */

const text = (value: string) => value.trim() || null;

/**
 * Raise a CAPA from a case and link it, in one transaction
 * (`create_capa_for_case`). Returns the new CAPA's id.
 */
export async function createCapaForCase(
  caseId: string,
  values: CapaCreateValues,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_capa_for_case", {
    p_case: caseId,
    p_title: values.title.trim(),
    p_owner: values.owner.trim(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Initiate a CAPA from a case — the CAPA, its first actions and the case's
 * link, in one transaction (`initiate_capa`, 0059). Returns the new id.
 */
export async function initiateCapa(
  caseId: string,
  values: CapaInitiateValues,
): Promise<string> {
  const supabase = createClient();
  // Only the actions are asked for. A blank title takes the case's title in
  // `initiate_capa` (0061); the rest is filled in from the register.
  const { data, error } = await supabase.rpc("initiate_capa", {
    p_case: caseId,
    p_title: "",
    p_reason: null,
    p_owner: null,
    p_target: null,
    p_root_cause: null,
    p_rca_method: null,
    p_criteria: null,
    p_verify_by: null,
    p_actions: values.actions
      .filter((a) => a.description.trim())
      .map((a) => ({
        kind: a.kind,
        description: a.description.trim(),
        owner_name: a.owner.trim() || null,
        target_date: a.targetDate || null,
        status: a.status,
      })),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

async function patchCapa(id: string, values: Record<string, unknown>) {
  const supabase = createClient();
  const { error } = await supabase.from("capas").update(values).eq("id", id);
  if (error) throw new Error(error.message);
}

/** The header — title, owner, criteria, verify-by. Open CAPAs only. */
export function saveCapaHeader(
  id: string,
  values: CapaHeaderValues,
): Promise<void> {
  return patchCapa(id, {
    title: values.title.trim(),
    owner_name: text(values.owner),
    reason: text(values.reason),
    target_date: text(values.targetDate),
    effectiveness_criteria: text(values.effectivenessCriteria),
    verify_by: text(values.verifyBy),
  });
}

/** Open → effective. Refused until every action is closed. */
export function verifyCapa(id: string, values: CapaVerifyValues): Promise<void> {
  return patchCapa(id, {
    status: "effective",
    effectiveness_criteria: values.effectivenessCriteria.trim(),
    verification: values.verification.trim(),
    verified_by_name: values.verifiedBy.trim(),
  });
}

/** `created_by` is defaulted to the caller by the table and checked by RLS. */
export async function addCapaAction(
  factoryId: string,
  capaId: string,
  values: CapaActionValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("capa_actions").insert({
    factory_id: factoryId,
    capa_id: capaId,
    kind: values.kind,
    description: values.description.trim(),
    owner_name: text(values.owner),
    target_date: text(values.targetDate),
    status: values.status,
  });
  if (error) throw new Error(error.message);
}

/** Correct an open action. A closed one is frozen. */
export async function updateCapaAction(
  id: string,
  values: CapaActionValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("capa_actions")
    .update({
      kind: values.kind,
      description: values.description.trim(),
      owner_name: text(values.owner),
      target_date: text(values.targetDate),
      status: values.status,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Close an action — its actual closed date and who closed it. */
export async function closeCapaAction(
  id: string,
  values: CapaActionCloseValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("capa_actions")
    .update({
      closed_date: values.closedDate,
      closed_by_name: values.closedBy.trim(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ── Display ──────────────────────────────────────────────────────────── */

export function actionKindMeta(kind: CapaActionKind) {
  return ACTION_KINDS.find((k) => k.value === kind) ?? ACTION_KINDS[0];
}
