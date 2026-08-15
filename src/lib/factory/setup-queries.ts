import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for the Admin → setup lists (units, processes,
 * departments).
 * Reads and writes go straight to Supabase from the browser; RLS
 * (`can_manage_factory`) is the trust boundary, so there is no server hop.
 */

/** The flat setup lists share a shape, so they share one component + hooks. */
export type SetupTable =
  | "factory_units"
  | "factory_processes"
  // Which trades a factory has is a property of that factory, not something
  // this application can guess — so departments are a managed list like the
  // rest, not a hard-coded dropdown. Carries no flags.
  | "factory_departments";

export interface SetupItem {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  /**
   * The list's optional boolean attributes, keyed by a neutral name so one
   * component can drive every list without knowing any table's columns.
   * Processes carry two: `machine` and `output`. Empty for tables with none.
   */
  flags: Record<string, boolean>;
}

/**
 * Which columns, per table, back `SetupItem.flags` — neutral key → real
 * column. Processes have three booleans. `machine` and `output` are
 * independent: an activity can produce output without running a machine
 * (Sorting, Testing) or run neither (Idle, Break).
 *
 * `final` is different in kind — it is a *choice between* processes, not a
 * property of one. At most one per factory may hold it, enforced by a partial
 * unique index, and setting it demotes the previous holder through a trigger
 * (migration 0016). That is why the client only ever sends "make this one
 * final" and never has to clear the other.
 */
const FLAG_COLUMNS: Partial<Record<SetupTable, Record<string, string>>> = {
  factory_processes: {
    machine: "has_machine",
    output: "has_output",
    final: "is_final_stage",
  },
};

const BASE_COLUMNS = "id, name, active, sort_order, created_at";

function columns(table: SetupTable): string {
  const extra = Object.values(FLAG_COLUMNS[table] ?? {});
  return extra.length ? `${BASE_COLUMNS}, ${extra.join(", ")}` : BASE_COLUMNS;
}

function toItem(table: SetupTable, row: Record<string, unknown>): SetupItem {
  const flags: Record<string, boolean> = {};
  for (const [key, column] of Object.entries(FLAG_COLUMNS[table] ?? {})) {
    flags[key] = Boolean(row[column]);
  }
  return {
    id: row.id as string,
    name: row.name as string,
    active: row.active as boolean,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string,
    flags,
  };
}

/** Translates neutral flag keys back to the table's real columns. */
function toRow(
  table: SetupTable,
  patch: SetupPatch
): Record<string, unknown> {
  const { flags, ...rest } = patch;
  const columnFor = FLAG_COLUMNS[table] ?? {};
  const row: Record<string, unknown> = { ...rest };
  for (const [key, value] of Object.entries(flags ?? {})) {
    // Silently skips a key this table has no column for, so a caller can pass
    // a whole flag set without knowing which list it is talking to.
    const column = columnFor[key];
    if (column) row[column] = value;
  }
  return row;
}

export type SetupPatch = Partial<
  Pick<SetupItem, "name" | "active" | "sort_order" | "flags">
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
  flags: Record<string, boolean> = {}
): Promise<SetupItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({
      factory_id: factoryId,
      sort_order: sortOrder,
      ...toRow(table, { name: name.trim(), flags }),
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
