import type { EquipmentValues } from "@/app/factory/[slug]/admin/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for Admin → Equipment, the machine register.
 *
 * Same shape as the products and setup-list modules: reads and writes go
 * straight from the browser to Supabase and RLS (`can_manage_factory`) is the
 * trust boundary, which is what makes the optimistic updates in the panel
 * cheap. Migration 0028.
 */

export interface Equipment {
  id: string;
  equipment_no: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

const COLUMNS = "id, equipment_no, name, active, sort_order, created_at";

export const equipmentKeys = {
  all: (factoryId: string) => ["factory_equipment", factoryId] as const,
};

/** Turns a Postgres error into something an operator can act on. */
function toMessage(
  error: { code?: string; message: string },
  equipmentNo?: string,
): string {
  if (error.code === "23505") {
    return equipmentNo
      ? `Equipment ${equipmentNo} already exists.`
      : "That equipment number is already in use.";
  }
  return error.message;
}

export async function fetchEquipment(factoryId: string): Promise<Equipment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_equipment")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("sort_order", { ascending: true })
    .order("equipment_no", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Equipment[];
}

export async function createEquipment(
  factoryId: string,
  values: EquipmentValues,
  sortOrder: number,
): Promise<Equipment> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_equipment")
    .insert({
      factory_id: factoryId,
      equipment_no: values.equipmentNo,
      name: values.name,
      sort_order: sortOrder,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(toMessage(error, values.equipmentNo));
  return data as Equipment;
}

export async function updateEquipment(
  id: string,
  patch: Partial<Pick<Equipment, "equipment_no" | "name" | "active">>,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_equipment")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(toMessage(error, patch.equipment_no ?? undefined));
}

export async function deleteEquipment(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_equipment")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Resolves a typed equipment number against the register, case- and
 * whitespace-insensitively — the same forgiveness the batch lookup gives,
 * because "eq383 " off a keyboard is the same machine as "EQ383".
 */
export function findEquipment(
  list: Equipment[],
  typed: string | undefined,
): Equipment | null {
  const term = (typed ?? "").trim().toLowerCase();
  if (!term) return null;
  return list.find((e) => e.equipment_no.trim().toLowerCase() === term) ?? null;
}
