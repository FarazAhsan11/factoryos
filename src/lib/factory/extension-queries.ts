import { createClient } from "@/lib/supabase/client";

/**
 * A deviation's due date extensions (migration 0072) — a new date asked for
 * with a reason, then approved (the case's due date moves) or rejected.
 *
 * Read browser-direct under RLS; written only through the database's
 * `request_due_extension` and `decide_due_extension`, which check who may,
 * the case's state, and that the new date is later.
 */

export type ExtensionStatus = "requested" | "approved" | "rejected";

export interface DueExtension {
  id: string;
  deviation_id: string;
  from_date: string;
  to_date: string;
  reason: string;
  status: ExtensionStatus;
  requested_at: string;
  requested_by_name: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  note: string | null;
}

/** Under the deviations prefix, so any Quality save refreshes it too. */
export const extensionKeys = {
  forCase: (factoryId: string, deviationId: string) =>
    ["deviations", factoryId, "extensions", deviationId] as const,
};

export async function fetchExtensions(deviationId: string): Promise<DueExtension[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_due_extensions")
    .select(
      "id, deviation_id, from_date, to_date, reason, status, requested_at, requested_by_name, decided_at, decided_by_name, note",
    )
    .eq("deviation_id", deviationId)
    .order("requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DueExtension[];
}

export async function requestExtension(
  deviationId: string,
  toDate: string,
  reason: string,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("request_due_extension", {
    p_case: deviationId,
    p_to: toDate,
    p_reason: reason,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
}

export async function decideExtension(
  extensionId: string,
  approve: boolean,
  note: string,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("decide_due_extension", {
    p_extension: extensionId,
    p_approve: approve,
    p_note: note,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
}
