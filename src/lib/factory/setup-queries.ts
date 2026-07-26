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
  /**
   * The list's optional boolean attribute, if it has one (processes:
   * `has_machine`). Exposed under a neutral name so one component can drive
   * every list; `false` for tables without a flag column.
   */
  flag: boolean;
}

/** Which column, per table, backs `SetupItem.flag`. */
const FLAG_COLUMN: Partial<Record<SetupTable, string>> = {
  factory_processes: "has_machine",
};

const BASE_COLUMNS = "id, name, active, sort_order, created_at";

function columns(table: SetupTable): string {
  const flag = FLAG_COLUMN[table];
  return flag ? `${BASE_COLUMNS}, ${flag}` : BASE_COLUMNS;
}

function toItem(table: SetupTable, row: Record<string, unknown>): SetupItem {
  const flag = FLAG_COLUMN[table];
  return {
    id: row.id as string,
    name: row.name as string,
    active: row.active as boolean,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string,
    flag: flag ? Boolean(row[flag]) : false,
  };
}

/** Translates the neutral `flag` key back to the table's real column. */
function toRow(
  table: SetupTable,
  patch: SetupPatch
): Record<string, unknown> {
  const { flag, ...rest } = patch;
  const column = FLAG_COLUMN[table];
  if (flag === undefined || !column) return rest;
  return { ...rest, [column]: flag };
}

export type SetupPatch = Partial<
  Pick<SetupItem, "name" | "active" | "sort_order" | "flag">
>;

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
    .select(columns(table))
    .eq("factory_id", factoryId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    toItem(table, row as unknown as Record<string, unknown>)
  );
}

export async function createSetupItem(
  table: SetupTable,
  factoryId: string,
  name: string,
  sortOrder: number,
  flag = false
): Promise<SetupItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({
      factory_id: factoryId,
      sort_order: sortOrder,
      ...toRow(table, { name: name.trim(), flag }),
    })
    .select(columns(table))
    .single();

  if (error) {
    // 23505 = unique violation on (factory_id, lower(name)).
    throw new Error(
      error.code === "23505"
        ? `"${name.trim()}" already exists.`
        : error.message
    );
  }
  return toItem(table, data as unknown as Record<string, unknown>);
}

export async function updateSetupItem(
  table: SetupTable,
  id: string,
  patch: SetupPatch
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(table)
    .update(toRow(table, patch))
    .eq("id", id);
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
