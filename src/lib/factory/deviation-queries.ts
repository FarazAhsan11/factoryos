import type {
  CloseDeviationValues,
  DeviationValues,
} from "@/app/factory/[slug]/deviations/schemas";
import type { ActionStage } from "@/lib/factory/action-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Deviations & NCRs (migration 0044).
 *
 * Browser-direct under RLS, like every other tenant write. Three things the
 * client never sends: the number (stamped by `deviations_guard`, prefixed by
 * type), the product id (resolved there from the typed batch number, so a
 * quarantine can never miss its card), and the close timestamps.
 *
 * Nothing here moves the pipeline either. An open quarantine NCR holds its
 * batch through `deviations_hold_batch`, and the shift log refuses producing
 * work against it through `shift_log_quarantine_guard` — the page only has to
 * refresh the board after raising one.
 */

export type DeviationType = "planned" | "unplanned" | "ncr";
export type DeviationStatus = "open" | "closed";
export type NcrDisposition = "use_as_is" | "rework" | "reject" | "quarantine";

export const DEVIATION_TYPES: {
  value: DeviationType;
  label: string;
  short: string;
  hint: string;
  spine: string;
  pill: string;
}[] = [
  {
    value: "planned",
    label: "Planned deviation",
    short: "Planned",
    hint: "Known change with QA approval",
    spine: "var(--color-brand)",
    pill: "bg-brand-soft text-brand-deep",
  },
  {
    value: "unplanned",
    label: "Unplanned deviation",
    short: "Unplanned",
    hint: "Unexpected departure from process",
    spine: "var(--color-warn)",
    pill: "bg-warn-soft text-warn-deep",
  },
  {
    value: "ncr",
    label: "NCR",
    short: "NCR",
    hint: "Non-conforming material / product",
    spine: "var(--color-danger)",
    pill: "bg-danger-soft text-danger-deep",
  },
];

export const DISPOSITIONS: {
  value: NcrDisposition;
  label: string;
  hint: string;
  pill: string;
}[] = [
  {
    value: "use_as_is",
    label: "Use as is",
    hint: "Within acceptance criteria",
    pill: "bg-teal-soft text-teal-deep",
  },
  {
    value: "rework",
    label: "Rework",
    hint: "Can be brought to spec",
    pill: "bg-brand-soft text-brand-deep",
  },
  {
    value: "reject",
    label: "Reject",
    hint: "Destroy / return to supplier",
    pill: "bg-danger-soft text-danger-deep",
  },
  {
    value: "quarantine",
    label: "Quarantine",
    hint: "Hold the batch pending QA review",
    pill: "bg-warn-soft text-warn-deep",
  },
];

export const STATUS_LABELS: Record<DeviationStatus, string> = {
  open: "Open",
  closed: "Closed",
};

export const STATUS_PILL: Record<DeviationStatus, string> = {
  open: "bg-warn-soft text-warn-deep",
  closed: "bg-teal-soft text-teal-deep",
};

export interface Deviation {
  id: string;
  /** "DEV-2026-004" or "NCR-2026-001". */
  deviation_no: string;
  type: DeviationType;
  status: DeviationStatus;
  /** What was typed, kept even when it matched no product. */
  batch_no: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  specification: string | null;
  actual: string;
  impact: string | null;
  /** NCR only. */
  disposition: NcrDisposition | null;
  raised_by: string | null;
  qa_reviewer: string | null;
  /** The linked CAPA, with its title and stage resolved in the view. */
  action_id: string | null;
  action_title: string | null;
  action_status: ActionStage | null;
  closing_note: string | null;
  qa_sign_name: string | null;
  closed_at: string | null;
  created_at: string;
  /** An open quarantine NCR — what is holding its batch right now. */
  is_quarantining: boolean;
}

const COLUMNS = `
  id, deviation_no, type, status,
  batch_no, product_id, product_name, product_code,
  specification, actual, impact, disposition,
  raised_by, qa_reviewer,
  action_id, action_title, action_status,
  closing_note, qa_sign_name, closed_at, created_at,
  is_quarantining
`;

export const deviationKeys = {
  all: (factoryId: string) => ["deviations", factoryId] as const,
};

/** Every deviation for the factory, newest first. */
export async function fetchDeviations(factoryId: string): Promise<Deviation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations_expanded")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Deviation[];
}

export async function createDeviation(
  factoryId: string,
  values: DeviationValues,
  createdBy: string,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviations")
    .insert({
      factory_id: factoryId,
      type: values.type,
      batch_no: values.batchNo.trim() || null,
      specification: values.specification.trim() || null,
      actual: values.actual.trim(),
      impact: values.impact.trim() || null,
      // Sent only for an NCR; the table refuses one on a deviation.
      disposition: values.type === "ncr" ? values.disposition || null : null,
      raised_by: values.raisedBy.trim() || null,
      qa_reviewer: values.qaReviewer.trim() || null,
      action_id: values.actionId || null,
      created_by: createdBy,
      // `deviation_no` and `product_id` are deliberately absent — the trigger
      // stamps the one and resolves the other.
    })
    .select("deviation_no")
    .single();

  if (error) throw new Error(error.message);
  return (data as { deviation_no: string }).deviation_no;
}

/** The one gate: open → closed, with the QA signature and the outcome. */
export async function closeDeviation(
  deviation: Deviation,
  values: CloseDeviationValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("deviations")
    .update({
      status: "closed",
      closing_note: values.closingNote.trim(),
      qa_sign_name: values.qaSignName.trim(),
      action_id: values.actionId || null,
      ...(deviation.type === "ncr" ? { disposition: values.disposition } : {}),
    })
    .eq("id", deviation.id);

  if (error) throw new Error(error.message);
}

/* ── Display ──────────────────────────────────────────────────────────── */

export function typeMeta(type: DeviationType) {
  return DEVIATION_TYPES.find((t) => t.value === type) ?? DEVIATION_TYPES[1];
}

export function dispositionMeta(disposition: NcrDisposition) {
  return (
    DISPOSITIONS.find((d) => d.value === disposition) ?? DISPOSITIONS[3]
  );
}
