import { createClient } from "@/lib/supabase/client";

/**
 * Client-side reads for Admin → Employees. Reads go straight to Supabase (the
 * `profiles_factory_read` policy scopes them to the viewer's tenant); every
 * write is a Server Action, because creating and deleting auth users needs the
 * service-role key.
 */

export interface Employee {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  invited_at: string | null;
  activated_at: string | null;
  created_at: string;
}

/** Where the person is in the account lifecycle. */
export type EmployeeStatus = "active" | "invited" | "pending";

export function employeeStatus(employee: Employee): EmployeeStatus {
  if (employee.activated_at) return "active";
  return employee.invited_at ? "invited" : "pending";
}

export const employeeKeys = {
  all: (factoryId: string) => ["employees", factoryId] as const,
};

export async function fetchEmployees(factoryId: string): Promise<Employee[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, invited_at, activated_at, created_at")
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Employee[];
}
