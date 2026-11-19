import { createClient } from "@/lib/supabase/client";

/**
 * A deviation's batch holds (migration 0069) — one per batch, each decided by
 * QA on its own: released (safe while the case stays open) or rejected.
 *
 * Read browser-direct under RLS; written only through the database's
 * `place_batch_holds` and `decide_batch_hold`, which check who may and what
 * must be recorded first.
 */

export type HoldStatus = "on_hold" | "released" | "rejected";

export interface BatchHold {
  id: string;
  deviation_id: string;
  batch_no: string;
  product_id: string | null;
  status: HoldStatus;
  placed_at: string;
  placed_by_name: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  reason: string | null;
}

export const HOLD_STATUS_LABEL: Record<HoldStatus, string> = {
  on_hold: "On hold",
  released: "Released",
  rejected: "Rejected",
};

/** Under the deviations prefix, so any Quality save refreshes it too. */
export const holdKeys = {
  forCase: (factoryId: string, deviationId: string) =>
    ["deviations", factoryId, "holds", deviationId] as const,
};

export async function fetchHolds(deviationId: string): Promise<BatchHold[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_batch_holds")
    .select(
      "id, deviation_id, batch_no, product_id, status, placed_at, placed_by_name, decided_at, decided_by_name, reason",
    )
    .eq("deviation_id", deviationId)
    .order("placed_at", { ascending: true })
    // Holds placed together (at raise) keep a steady order.
    .order("batch_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BatchHold[];
}

/** Put batches on hold; returns how many new holds were placed. */
export async function placeHolds(
  deviationId: string,
  batchNos: string[],
  byName: string,
): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("place_batch_holds", {
    p_case: deviationId,
    p_batch_nos: batchNos,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function decideHold(
  holdId: string,
  decision: "released" | "rejected",
  reason: string,
  byName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("decide_batch_hold", {
    p_hold: holdId,
    p_decision: decision,
    p_reason: reason,
    p_by_name: byName,
  });
  if (error) throw new Error(error.message);
}
