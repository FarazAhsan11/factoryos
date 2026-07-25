import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for the Admin → setup lists (units, processes).
 * Reads and writes go straight to Supabase from the browser; RLS
 * (`can_manage_factory`) is the trust boundary, so there is no server hop.
 */

/** The two setup lists share a shape, so they share one component + hooks. */
export type SetupTable = "factory_units" | "factory_processes";

export interface SetupItem {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export const setupKeys = {
  all: (table: SetupTable, factoryId: string) => [table, factoryId] as const,
};

export async function fetchSetupItems(
  table: SetupTable,
  factoryId: string
): Promise<SetupItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .select("id, name, active, sort_order, created_at")
    .eq("factory_id", factoryId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as SetupItem[];
}

export async function createSetupItem(
  table: SetupTable,
  factoryId: string,
  name: string,
  sortOrder: number
): Promise<SetupItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({ factory_id: factoryId, name: name.trim(), sort_order: sortOrder })
    .select("id, name, active, sort_order, created_at")
    .single();

  if (error) {
    // 23505 = unique violation on (factory_id, lower(name)).
    throw new Error(
      error.code === "23505"
        ? `"${name.trim()}" already exists.`
        : error.message
    );
  }
  return data as SetupItem;
}

export async function updateSetupItem(
  table: SetupTable,
  id: string,
  patch: Partial<Pick<SetupItem, "name" | "active" | "sort_order">>
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) {
    throw new Error(
      error.code === "23505" ? "That name is already in use." : error.message
    );
  }
}

export async function deleteSetupItem(
  table: SetupTable,
  id: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
