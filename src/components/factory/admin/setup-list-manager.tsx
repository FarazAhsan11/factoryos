"use client";

import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Cog, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  createSetupItem,
  deleteSetupItem,
  fetchSetupItems,
  setupKeys,
  updateSetupItem,
  type SetupItem,
  type SetupTable,
} from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const FIELD =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12";

/**
 * Optional boolean attribute a list can carry (Processes: "includes a
 * machine"). Purely labels — the column it maps to lives in setup-queries.
 */
export interface SetupFlagConfig {
  /** Checkbox label on the add row. */
  label: string;
  /** One-liner under the checkbox. */
  hint?: string;
  /** Pill text when the flag is on / off. */
  on: string;
  off: string;
}

/**
 * Add / rename / retire / delete manager for a factory's flat setup lists
 * (production units, process stages). One React Query cache key per list, so
 * switching Admin tabs re-renders from cache instead of refetching.
 */
export function SetupListManager({
  table,
  factoryId,
  singular,
  plural,
  placeholder,
  canManage,
  flag,
}: {
  table: SetupTable;
  factoryId: string;
  singular: string;
  plural: string;
  placeholder: string;
  canManage: boolean;
  flag?: SetupFlagConfig;
}) {
  const queryClient = useQueryClient();
  const queryKey = setupKeys.all(table, factoryId);
  const [draft, setDraft] = useState("");
  const [draftFlag, setDraftFlag] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: items = [], isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchSetupItems(table, factoryId),
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const add = useMutation({
    mutationFn: ({ name, withFlag }: { name: string; withFlag: boolean }) =>
      createSetupItem(table, factoryId, name, items.length, withFlag),
    onSuccess: async (created) => {
      setDraft("");
      setDraftFlag(false);
      await refresh();
      toast.success(`${created.name} added.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateSetupItem(table, id, { name: name.trim() }),
    // Optimistic: the row updates the moment you hit save.
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).map((i) => (i.id === id ? { ...i, name: name.trim() } : i))
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
    onSuccess: () => setEditingId(null),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateSetupItem(table, id, { active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).map((i) => (i.id === id ? { ...i, active } : i))
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  const toggleFlag = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      updateSetupItem(table, id, { flag: value }),
    onMutate: async ({ id, value }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).map((i) => (i.id === id ? { ...i, flag: value } : i))
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
    mutationFn: (id: string) => deleteSetupItem(table, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).filter((i) => i.id !== id)
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  function submitDraft() {
    const name = draft.trim();
    if (!name) return;
    add.mutate({ name, withFlag: Boolean(flag) && draftFlag });
  }

  return (
    <div className="space-y-5">
      {/* add row */}
      {canManage && (
        <div className="rounded-2xl border border-[#E6EAF1] bg-[#FBFCFE] p-4">
          <p className="mb-2.5 text-[13px] font-semibold text-[#0F1B34]">
            Add {singular.toLowerCase()}
          </p>
          <div className="flex gap-2.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder={placeholder}
              aria-label={`New ${singular.toLowerCase()} name`}
              className={FIELD}
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={add.isPending || !draft.trim()}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {add.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </button>
          </div>

          {flag && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-[#0F1B34]">
              <input
                type="checkbox"
                checked={draftFlag}
                onChange={(e) => setDraftFlag(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-[#CBD5E1] accent-[#2563EB]"
              />
              <span>
                {flag.label}
                {flag.hint && (
                  <span className="mt-0.5 block text-xs text-[#94A3B8]">
                    {flag.hint}
                  </span>
                )}
              </span>
            </label>
          )}
        </div>
      )}

      {/* list */}
      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          Could not load {plural.toLowerCase()}: {(error as Error).message}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          No {plural.toLowerCase()} yet
          {canManage ? " — add your first one above." : "."}
        </p>
      ) : (
        <ul
          className={cn(
            "grid gap-2.5 sm:grid-cols-2",
            // The flag pill needs the extra width, so stay at two columns.
            !flag && "lg:grid-cols-3"
          )}
        >
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <li
                key={item.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-[#E6EAF1] bg-white px-3.5 py-2.5",
                  !item.active && "bg-[#F8FAFC]"
                )}
              >
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editValue.trim())
                          rename.mutate({ id: item.id, name: editValue });
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      aria-label={`Rename ${item.name}`}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-[#E6EAF1] px-2 text-sm outline-none focus:border-[#2563EB]"
                    />
                    <IconButton
                      label="Save"
                      onClick={() =>
                        editValue.trim() &&
                        rename.mutate({ id: item.id, name: editValue })
                      }
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
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        item.active
                          ? "text-[#0F1B34]"
                          : "text-[#94A3B8] line-through"
                      )}
                    >
                      {item.name}
                    </span>

                    {flag &&
                      (canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            toggleFlag.mutate({
                              id: item.id,
                              value: !item.flag,
                            })
                          }
                          aria-pressed={item.flag}
                          title={item.flag ? flag.on : flag.off}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                            item.flag
                              ? "bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/16"
                              : "bg-[#F1F5F9] text-[#94A3B8] hover:bg-[#E2E8F0]"
                          )}
                        >
                          <Cog className="size-3" />
                          {item.flag ? flag.on : flag.off}
                        </button>
                      ) : (
                        item.flag && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-[11px] font-medium text-[#2563EB]">
                            <Cog className="size-3" />
                            {flag.on}
                          </span>
                        )
                      ))}

                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            toggleActive.mutate({
                              id: item.id,
                              active: !item.active,
                            })
                          }
                          className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-medium text-[#475569] transition hover:bg-[#E2E8F0]"
                        >
                          {item.active ? "Active" : "Retired"}
                        </button>
                        <IconButton
                          label={`Rename ${item.name}`}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditValue(item.name);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${item.name}`}
                          onClick={() => remove.mutate(item.id)}
                        >
                          <Trash2 className="size-3.5 text-[#B91C1C]" />
                        </IconButton>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && items.length > 0 && (
        <p className="text-xs text-[#94A3B8]">
          Retire a {singular.toLowerCase()} to keep its history but hide it from
          new entries. Delete removes it entirely.
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

function ListSkeleton() {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-[46px] animate-pulse rounded-xl border border-[#EEF1F6] bg-[#F8FAFC]"
        />
      ))}
    </ul>
  );
}
