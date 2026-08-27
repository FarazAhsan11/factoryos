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
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12";

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

  const {
    data: equipment = [],
    isPending,
    isError,
    error,
  } = useQuery({
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
        (old ?? []).map((e) => (e.id === id ? { ...e, ...values } : e)),
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
        (old ?? []).filter((e) => e.id !== id),
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
        field.toLowerCase().includes(term),
      ),
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
        <div className="rounded-2xl border border-line bg-sunken p-4">
          <p className="mb-2.5 text-[13px] font-semibold text-ink">
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
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
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
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {add.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </button>
          </div>
          <p className="mt-2.5 text-xs text-ink-5">
            The number is what an operator types in the shift log; the name is
            what the log fills in for them.
          </p>
        </div>
      )}

      {equipment.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-5" />
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
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the equipment register: {(error as Error).message}
        </p>
      ) : equipment.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          No equipment yet
          {canManage ? " — add your first machine above." : "."}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          Nothing matches “{search}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs font-semibold uppercase tracking-wide text-ink-5">
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
                      "border-b border-sunken last:border-0",
                      !item.active && "bg-sunken text-ink-5",
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink">
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
                          className="h-8 w-32 rounded-lg border border-line px-2 font-mono text-[13px] outline-none focus:border-brand"
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
                          className="h-8 w-full max-w-sm rounded-lg border border-line px-2 text-sm outline-none focus:border-brand"
                        />
                      ) : (
                        <span
                          className={cn(
                            item.active ? "text-ink" : "line-through",
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
                                <Check className="size-4 text-teal" />
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
                                className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 transition hover:bg-line"
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
                                <Trash2 className="size-3.5 text-danger-deep" />
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
        <p className="text-xs text-ink-5">
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
      className="shrink-0 rounded-md p-1 text-ink-5 transition hover:bg-sunken-2 hover:text-ink-3"
    >
      {children}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-line-soft p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-sunken" />
      ))}
    </div>
  );
}
