import type { CorrectionValues } from "@/app/factory/[slug]/deviations/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * A case's corrections (migration 0074) — what was done to fix *this* case,
 * who did it and when, listed on its Actions tab (qms-v8). Supervisor and up,
 * while the case is open; added or removed, never edited. Each one is on the
 * case's audit trail.
 */

export interface Correction {
  id: string;
  what: string;
  who: string;
  done_on: string;
  created_at: string;
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
    .select("id, what, who, done_on, created_at")
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

export async function removeCorrection(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("deviation_corrections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
