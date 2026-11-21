import type { CorrectionValues } from "@/app/factory/[slug]/deviations/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * A case's corrections (migration 0074) — what was done to fix *this* case,
 * who did it and when, listed on its Actions tab (qms-v8). Supervisor and up,
 * while the case is open; added or removed, never edited. Removing keeps the
 * row, with who removed it, when and why (0075, EU GMP Annex 11 §9). Each one
 * is on the case's audit trail.
 */

export interface Correction {
  id: string;
  what: string;
  who: string;
  done_on: string;
  created_at: string;
  removed_at: string | null;
  removed_by_name: string | null;
  removed_reason: string | null;
}

/** Under the deviations prefix, so any Quality save refreshes it too. */
export const correctionKeys = {
  forCase: (factoryId: string, deviationId: string) =>
    ["deviations", factoryId, "corrections", deviationId] as const,
};

export async function fetchCorrections(deviationId: string): Promise<Correction[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_corrections")
    .select("id, what, who, done_on, created_at, removed_at, removed_by_name, removed_reason")
    .eq("deviation_id", deviationId)
    .order("done_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Correction[];
}

export async function addCorrection(
  factoryId: string,
  deviationId: string,
  userId: string,
  values: CorrectionValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("deviation_corrections").insert({
    factory_id: factoryId,
    deviation_id: deviationId,
    what: values.what.trim(),
    who: values.who.trim(),
    done_on: values.doneOn,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
}

/** Remove a correction with a reason — the row stays, struck through. */
export async function removeCorrection(id: string, reason: string, byName: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("deviation_corrections")
    .update({ removed_reason: reason.trim(), removed_by_name: byName.trim() || null })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  // RLS refuses an update by updating nothing, not by erroring.
  if (!data || data.length === 0) {
    throw new Error("Only a supervisor or QA can remove a correction, while the case is open.");
  }
}
