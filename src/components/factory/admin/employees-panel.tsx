"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  removeEmployee,
  sendEmployeeInvite,
  updateEmployee,
} from "@/app/factory/[slug]/admin/employee-actions";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  SHIFT_LABELS,
  SHIFT_SLOTS,
  type AssignableRole,
  type ShiftSlot,
} from "@/app/factory/[slug]/admin/schemas";
import { AddEmployeeForm } from "@/components/factory/admin/add-employee-form";
import { EmployeeImportDialog } from "@/components/factory/admin/employee-import-dialog";
import {
  employeeKeys,
  employeeStatus,
  fetchEmployees,
  type Employee,
  type EmployeeStatus,
} from "@/lib/factory/employee-queries";
import { cn } from "@/lib/utils";

const STATUS: Record<
  EmployeeStatus,
  { label: string; className: string }
> = {
  active: { label: "Active", className: "bg-[#DCFCE7] text-[#15803D]" },
  invited: { label: "Invited", className: "bg-[#DBEAFE] text-[#1D4ED8]" },
  pending: { label: "Not invited", className: "bg-[#F1F5F9] text-[#64748B]" },
};

/**
 * Admin → Employees. A factory's people are its users, so this list is
 * `profiles`: read straight from Supabase under RLS, but every write goes
 * through a Server Action because auth users need the service-role key.
 *
 * `canManage` (manager and up) can see the roster; only a factory admin gets
 * the add / invite / remove controls, matching the action-side authorization.
 */
export function EmployeesPanel({
  factoryId,
  isAdmin,
}: {
  factoryId: string;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = employeeKeys.all(factoryId);

  const { data: employees = [], isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchEmployees(factoryId),
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const invite = useMutation({
    mutationFn: async (id: string) => {
      const result = await sendEmployeeInvite(id);
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    onSuccess: async (_r, id) => {
      const person = employees.find((e) => e.id === id);
      await refresh();
      toast.success(`Invite sent to ${person?.email ?? "them"}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: async (vars: {
      profileId: string;
      role?: AssignableRole;
      defaultShift?: ShiftSlot;
    }) => {
      const result = await updateEmployee(vars);
      if ("error" in result) throw new Error(result.error);
    },
    // Optimistic: the select shows the new value immediately.
    onMutate: async ({ profileId, role, defaultShift }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Employee[]>(queryKey);
      queryClient.setQueryData<Employee[]>(queryKey, (old) =>
        (old ?? []).map((e) =>
          e.id === profileId
            ? {
                ...e,
                ...(role ? { role } : {}),
                ...(defaultShift ? { default_shift: defaultShift } : {}),
              }
            : e
        )
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await removeEmployee(id);
      if ("error" in result) throw new Error(result.error);
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Employee[]>(queryKey);
      queryClient.setQueryData<Employee[]>(queryKey, (old) =>
        (old ?? []).filter((e) => e.id !== id)
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  const notInvited = employees.filter(
    (e) => employeeStatus(e) === "pending"
  ).length;

  return (
    <div className="space-y-5">
      {isAdmin && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[#64748B]">
              {employees.length} {employees.length === 1 ? "person" : "people"}
              {notInvited > 0 && ` · ${notInvited} not invited yet`}
            </p>
            <EmployeeImportDialog factoryId={factoryId} onImported={refresh} />
          </div>

          <AddEmployeeForm factoryId={factoryId} onAdded={refresh} />
        </>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          Could not load the team: {(error as Error).message}
        </p>
      ) : employees.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          Nobody here yet
          {isAdmin ? " — add your first teammate above." : "."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#E6EAF1] bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#EEF1F6] text-left text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Default shift</th>
                <th className="px-4 py-3">Status</th>
                {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((person) => {
                const status = employeeStatus(person);
                const assignable = ASSIGNABLE_ROLES.includes(
                  person.role as AssignableRole
                );
                const busy =
                  (invite.isPending && invite.variables === person.id) ||
                  (remove.isPending && remove.variables === person.id);

                return (
                  <tr
                    key={person.id}
                    className="border-b border-[#F5F7FA] last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-[#0F1B34]">
                      {person.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">{person.email}</td>
                    <td className="px-4 py-3">
                      {isAdmin && assignable ? (
                        <select
                          value={person.role}
                          aria-label={`Role for ${person.email}`}
                          onChange={(e) =>
                            edit.mutate({
                              profileId: person.id,
                              role: e.target.value as AssignableRole,
                            })
                          }
                          className="h-8 rounded-lg border border-[#E6EAF1] bg-white px-2 text-sm text-[#0F1B34] outline-none transition focus:border-[#2563EB]"
                        >
                          {ASSIGNABLE_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[#475569]">
                          {ROLE_LABELS[person.role] ?? person.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <select
                          value={person.default_shift}
                          aria-label={`Default shift for ${person.email}`}
                          onChange={(e) =>
                            edit.mutate({
                              profileId: person.id,
                              defaultShift: e.target.value as ShiftSlot,
                            })
                          }
                          className="h-8 rounded-lg border border-[#E6EAF1] bg-white px-2 text-sm text-[#0F1B34] outline-none transition focus:border-[#2563EB]"
                        >
                          {SHIFT_SLOTS.map((shift) => (
                            <option key={shift} value={shift}>
                              {SHIFT_LABELS[shift]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[#475569]">
                          {SHIFT_LABELS[person.default_shift] ??
                            person.default_shift}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS[status].className
                        )}
                      >
                        {STATUS[status].label}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {status !== "active" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => invite.mutate(person.id)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E6EAF1] px-2.5 text-xs font-medium text-[#475569] transition hover:bg-[#F8FAFC] disabled:opacity-60"
                            >
                              {busy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Mail className="size-3.5" />
                              )}
                              {status === "invited"
                                ? "Resend invite"
                                : "Send invite"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => remove.mutate(person.id)}
                            aria-label={`Remove ${person.email}`}
                            title={`Remove ${person.email}`}
                            className="rounded-md p-1.5 text-[#94A3B8] transition hover:bg-[#FEF2F2] hover:text-[#B91C1C] disabled:opacity-60"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && employees.length > 0 && (
        <p className="text-xs text-[#94A3B8]">
          Removing someone deletes their account and sign-in access. Anyone
          whose invite didn&rsquo;t go out shows as <strong>Not invited</strong>
          &mdash; send it from their row.
        </p>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-[#EEF1F6] p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-[#F8FAFC]" />
      ))}
    </div>
  );
}
