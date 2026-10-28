import { useQuery } from "@tanstack/react-query";

import type { WorkerValues } from "@/app/factory/[slug]/admin/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for Resources → Workforce (`factory_workers`,
 * migration 0053): the people who perform and are assigned work, apart from
 * the accounts that sign in (`profiles`, Configuration → Users).
 *
 * The equipment register's shape: reads and writes go straight from the
 * browser to Supabase, and RLS (`can_manage_factory` to write, the whole
 * tenant to read) is the trust boundary — nothing here needs the service-role
 * key, so there is no Server Action.
 */

export interface Worker {
  id: string;
  full_name: string;
  department_id: string | null;
  /** `shift_slot`: morning, afternoon, or both (shown as Rotating). */
  shift: string;
  role: string;
  created_at: string;
}

const COLUMNS = "id, full_name, department_id, shift, role, created_at";

export const workerKeys = {
  all: (factoryId: string) => ["factory_workers", factoryId] as const,
};

/** The row as the table spells it, from the form's values. */
function toRow(factoryId: string, values: WorkerValues) {
  return {
    factory_id: factoryId,
    full_name: values.fullName,
    department_id: values.departmentId || null,
    shift: values.shift,
    role: values.role,
  };
}

/** Turns a Postgres error into something a manager can act on. */
function toMessage(error: { code?: string; message: string }, name?: string) {
  if (error.code === "23505") {
    return name
      ? `${name} is already on the workforce.`
      : "Someone with that name is already on the workforce.";
  }
  return error.message;
}

export async function fetchWorkers(factoryId: string): Promise<Worker[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_workers")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Worker[];
}

/**
 * The workforce list under its one key — what every picker that names a
 * person reads. Shared so the shift log, maintenance, issues and deviations
 * all hit the same cache entry the register keeps fresh.
 */
export function useWorkers(factoryId: string) {
  return useQuery({
    queryKey: workerKeys.all(factoryId),
    queryFn: () => fetchWorkers(factoryId),
  });
}

export async function createWorker(
  factoryId: string,
  values: WorkerValues,
): Promise<Worker> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_workers")
    .insert(toRow(factoryId, values))
    .select(COLUMNS)
    .single();

  if (error) throw new Error(toMessage(error, values.fullName));
  return data as Worker;
}

/**
 * Bulk add: one insert for the lot. All or nothing — the dialog has already
 * dropped names the register holds, so a refusal here is a race with someone
 * else adding the same person, and is reported rather than half-applied.
 */
export async function createWorkers(
  factoryId: string,
  rows: WorkerValues[],
): Promise<number> {
  const supabase = createClient();
  const { error, count } = await supabase
    .from("factory_workers")
    .insert(
      rows.map((r) => toRow(factoryId, r)),
      { count: "exact" },
    );

  if (error) throw new Error(toMessage(error));
  return count ?? rows.length;
}

export async function updateWorker(
  id: string,
  values: WorkerValues,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_workers")
    .update({
      full_name: values.fullName,
      department_id: values.departmentId || null,
      shift: values.shift,
      role: values.role,
    })
    .eq("id", id);
  if (error) throw new Error(toMessage(error, values.fullName));
}

export async function deleteWorker(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_workers")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** The form's values for an existing row — what the row edit starts from. */
export function workerValues(worker: Worker): WorkerValues {
  return {
    fullName: worker.full_name,
    departmentId: worker.department_id ?? "",
    shift: worker.shift as WorkerValues["shift"],
    role: worker.role,
  };
}
