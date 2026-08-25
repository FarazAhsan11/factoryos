"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  equipmentSchema,
  type EquipmentValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  createEquipment,
  deleteEquipment,
  equipmentKeys,
  fetchEquipment,
  updateEquipment,
  type Equipment,
} from "@/lib/factory/equipment-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12";

/**
 * Admin → Equipment: the machine register. One row per asset — the number
 * painted on it and the name people call it by — which is what the shift log
 * resolves an equipment number against, exactly as it resolves a batch number
 * against the product catalogue.
 *
 * Not a `SetupListManager` list: that component knows one column (`name`), and
 * the whole point here is the pair. Modelled on the products panel instead.
 */
export function EquipmentPanel({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = equipmentKeys.all(factoryId);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<EquipmentValues>({
    equipmentNo: "",
    name: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EquipmentValues>({
    equipmentNo: "",
    name: "",
  });

  const { data: equipment = [], isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchEquipment(factoryId),
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const add = useMutation({
    mutationFn: (values: EquipmentValues) =>
      createEquipment(factoryId, values, equipment.length),
    onSuccess: async (created) => {
      setDraft({ equipmentNo: "", name: "" });
      await refresh();
      toast.success(`${created.equipment_no} — ${created.name} added.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Shared optimistic patch for the row-level edits. */
  const patch = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<Equipment> }) =>
      updateEquipment(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Equipment[]>(queryKey);
      queryClient.setQueryData<Equipment[]>(queryKey, (old) =>
        (old ?? []).map((e) => (e.id === id ? { ...e, ...values } : e))
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSuccess: () => setEditingId(null),
    onSettled: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEquipment(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Equipment[]>(queryKey);
      queryClient.setQueryData<Equipment[]>(queryKey, (old) =>
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

  // A plant runs to hundreds of machines, so filter in the client — the
  // register is already loaded and cached.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return equipment;
    return equipment.filter((e) =>
      [e.equipment_no, e.name].some((field) =>
        field.toLowerCase().includes(term)
      )
    );
  }, [equipment, search]);

  /** Same schema every other entry point validates this shape with. */
  function validate(values: EquipmentValues): EquipmentValues | null {
    const parsed = equipmentSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the fields.");
      return null;
    }
    return parsed.data;
  }

  function submitDraft() {
    const parsed = validate(draft);
    if (parsed) add.mutate(parsed);
  }

  function saveEdit(item: Equipment) {
    const parsed = validate(edit);
    if (!parsed) return;
    if (parsed.equipmentNo === item.equipment_no && parsed.name === item.name) {
      setEditingId(null);
      return;
    }
    patch.mutate({
      id: item.id,
      values: { equipment_no: parsed.equipmentNo, name: parsed.name },
    });
  }

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4">
          <p className="mb-2.5 text-[13px] font-semibold text-[#0F1B34]">
            Add equipment
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <input
              value={draft.equipmentNo}
              onChange={(e) =>
                setDraft((d) => ({ ...d, equipmentNo: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder="e.g. EQ383"
              aria-label="New equipment number"
              className={cn(FIELD, "font-mono sm:w-44")}
            />
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder="e.g. Bosch GKF 1500 Encapsulator"
              aria-label="New equipment name"
              className={FIELD}
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={add.isPending}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {add.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </button>
          </div>
          <p className="mt-2.5 text-xs text-[#94A3B8]">
            The number is what an operator types in the shift log; the name is
            what the log fills in for them.
          </p>
        </div>
      )}

      {equipment.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by equipment number or name…"
            aria-label="Search the equipment register"
            className={cn(FIELD, "pl-10")}
          />
        </div>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          Could not load the equipment register: {(error as Error).message}
        </p>
      ) : equipment.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          No equipment yet
          {canManage ? " — add your first machine above." : "."}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          Nothing matches “{search}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#E6EAF1] bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-[#EEF1F6] text-left text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
                <th className="px-4 py-3">Equipment no.</th>
                <th className="px-4 py-3">Machine name</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const editing = editingId === item.id;
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-[#F5F7FA] last:border-0",
                      !item.active && "bg-[#FBFCFE] text-[#94A3B8]"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-[#0F1B34]">
                      {editing ? (
                        <input
                          autoFocus
                          value={edit.equipmentNo}
                          onChange={(e) =>
                            setEdit((v) => ({
                              ...v,
                              equipmentNo: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(item);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          aria-label={`Equipment number for ${item.name}`}
                          className="h-8 w-32 rounded-lg border border-[#E6EAF1] px-2 font-mono text-[13px] outline-none focus:border-[#2563EB]"
                        />
                      ) : (
                        item.equipment_no
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <input
                          value={edit.name}
                          onChange={(e) =>
                            setEdit((v) => ({ ...v, name: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(item);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          aria-label={`Name for ${item.equipment_no}`}
                          className="h-8 w-full max-w-sm rounded-lg border border-[#E6EAF1] px-2 text-sm outline-none focus:border-[#2563EB]"
                        />
                      ) : (
                        <span
                          className={cn(
                            item.active ? "text-[#0F1B34]" : "line-through"
                          )}
                        >
                          {item.name}
                        </span>
                      )}
                    </td>

                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {editing ? (
                            <>
                              <IconButton
                                label="Save"
                                onClick={() => saveEdit(item)}
                              >
                                <Check className="size-4 text-[#16A34A]" />
                              </IconButton>
                              <IconButton
                                label="Cancel"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="size-4" />
                              </IconButton>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  patch.mutate({
                                    id: item.id,
                                    values: { active: !item.active },
                                  })
                                }
                                className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-medium text-[#475569] transition hover:bg-[#E2E8F0]"
                              >
                                {item.active ? "Active" : "Retired"}
                              </button>
                              <IconButton
                                label={`Edit ${item.equipment_no}`}
                                onClick={() => {
                                  setEditingId(item.id);
                                  setEdit({
                                    equipmentNo: item.equipment_no,
                                    name: item.name,
                                  });
                                }}
                              >
                                <Pencil className="size-3.5" />
                              </IconButton>
                              <IconButton
                                label={`Delete ${item.equipment_no}`}
                                onClick={() => remove.mutate(item.id)}
                              >
                                <Trash2 className="size-3.5 text-[#B91C1C]" />
                              </IconButton>
                            </>
                          )}
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

      {canManage && equipment.length > 0 && (
        <p className="text-xs text-[#94A3B8]">
          Retire a decommissioned machine to keep its shift history but hide it
          from new entries. Delete removes it from the register entirely —
          entries that named its number keep the number, but stop resolving to a
          name.
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md p-1 text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#475569]"
    >
      {children}
    </button>
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
