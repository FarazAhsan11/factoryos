"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12";

/**
 * A boolean attribute a list can carry. Processes have two — "runs on a
 * machine" and "is the final stage".
 *
 * Purely labels and an icon; the column each key maps to lives in
 * setup-queries, so this component never learns a table's schema.
 */
export interface SetupFlagConfig {
  /** Neutral key matching `SetupItem.flags` (e.g. "machine", "final"). */
  key: string;
  /** Checkbox label on the add row. */
  label: string;
  /** One-liner under the checkbox. */
  hint?: string;
  /** Pill text when the flag is on / off. */
  on: string;
  off: string;
  icon?: typeof Cog;
  /** Ticked by default on the add row. */
  defaultOn?: boolean;
  /**
   * Categories this flag applies to. Omitted means "all of them".
   *
   * Not cosmetic: since migration 0030 the database *derives* the flags a
   * category implies, so a checkbox offered outside its categories would be
   * a control that silently snaps back on the next read.
   */
  showFor?: string[];
}

/**
 * A one-of-N attribute — currently only a process stage's kind. Unlike a
 * flag it is a choice, so it renders as a radio group rather than a tick, and
 * the flags above are filtered by whichever member is selected.
 */
export interface SetupCategoryConfig {
  value: string;
  label: string;
  /** Two or three real stage names, so the choice is obvious at a glance. */
  example?: string;
  /** What picking this one changes about the shift-log entry form. */
  hint?: string;
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
  flags,
  categories,
  categoryLabel = "Type",
  defaultCategory,
}: {
  table: SetupTable;
  factoryId: string;
  singular: string;
  plural: string;
  placeholder: string;
  canManage: boolean;
  flags?: SetupFlagConfig[];
  categories?: SetupCategoryConfig[];
  /** Heading above the radio group on the add row. */
  categoryLabel?: string;
  /** Which member the add row opens on. Falls back to the first. */
  defaultCategory?: string;
}) {
  const flagList = useMemo(() => flags ?? [], [flags]);
  const categoryList = useMemo(() => categories ?? [], [categories]);
  const initialCategory = defaultCategory ?? categoryList[0]?.value ?? null;
  const flagDefaults = useMemo(
    () =>
      Object.fromEntries(flagList.map((f) => [f.key, Boolean(f.defaultOn)])),
    [flagList],
  );
  const queryClient = useQueryClient();
  const queryKey = setupKeys.all(table, factoryId);
  const [draft, setDraft] = useState("");
  const [draftFlags, setDraftFlags] =
    useState<Record<string, boolean>>(flagDefaults);
  const [draftCategory, setDraftCategory] = useState<string | null>(
    initialCategory,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  /** The flags that apply to one category — see `SetupFlagConfig.showFor`. */
  function flagsFor(category: string | null): SetupFlagConfig[] {
    return flagList.filter(
      (f) => !f.showFor || (category != null && f.showFor.includes(category)),
    );
  }

  const {
    data: items = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => fetchSetupItems(table, factoryId),
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const add = useMutation({
    mutationFn: ({
      name,
      withFlags,
      withCategory,
    }: {
      name: string;
      withFlags: Record<string, boolean>;
      withCategory: string | null;
    }) =>
      createSetupItem(
        table,
        factoryId,
        name,
        items.length,
        withFlags,
        withCategory,
      ),
    onSuccess: async (created) => {
      setDraft("");
      setDraftFlags(flagDefaults);
      setDraftCategory(initialCategory);
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
        (old ?? []).map((i) => (i.id === id ? { ...i, name: name.trim() } : i)),
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
        (old ?? []).map((i) => (i.id === id ? { ...i, active } : i)),
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
    mutationFn: ({
      id,
      key,
      value,
    }: {
      id: string;
      key: string;
      value: boolean;
    }) => updateSetupItem(table, id, { flags: { [key]: value } }),
    onMutate: async ({ id, key, value }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).map((i) =>
          i.id === id ? { ...i, flags: { ...i.flags, [key]: value } } : i,
        ),
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  /**
   * Re-classifying a stage. The optimistic patch also drops the flags the new
   * category doesn't carry, because the *database* drops them
   * (`factory_process_category_sync`, migration 0030) — showing a "Machine"
   * pill on a stage that has just become Downtime would be a lie the next
   * refetch quietly corrects, which is worse than no pill at all.
   */
  const setCategory = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      updateSetupItem(table, id, { category }),
    onMutate: async ({ id, category }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SetupItem[]>(queryKey);
      const kept = new Set(flagsFor(category).map((f) => f.key));
      queryClient.setQueryData<SetupItem[]>(queryKey, (old) =>
        (old ?? []).map((i) =>
          i.id === id
            ? {
                ...i,
                category,
                flags: Object.fromEntries(
                  Object.entries(i.flags).map(([key, on]) => [
                    key,
                    kept.has(key) && on,
                  ]),
                ),
              }
            : i,
        ),
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
        (old ?? []).filter((i) => i.id !== id),
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
    // Only the flags this category carries — the rest would be overwritten by
    // the database trigger anyway, and sending them makes the insert claim
    // something it isn't going to store.
    const keys = new Set(flagsFor(draftCategory).map((f) => f.key));
    add.mutate({
      name,
      withFlags: Object.fromEntries(
        Object.entries(draftFlags).filter(([key]) => keys.has(key)),
      ),
      withCategory: draftCategory,
    });
  }

  return (
    <div className="space-y-5">
      {/* add row */}
      {canManage && (
        <div className="rounded-2xl border border-line bg-sunken p-4">
          <p className="mb-2.5 text-[13px] font-semibold text-ink">
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
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {add.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add
            </button>
          </div>

          {/* The kind of stage, first — it decides which ticks below even
              exist, and which shape the shift-log form takes. */}
          {categoryList.length > 0 && (
            <fieldset className="mt-3.5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-4">
                {categoryLabel}
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {categoryList.map((c) => {
                  const on = draftCategory === c.value;
                  return (
                    <label
                      key={c.value}
                      className={cn(
                        "cursor-pointer rounded-xl border p-3 transition",
                        on
                          ? "border-brand bg-brand-soft ring-4 ring-brand/10"
                          : "border-line bg-surface hover:border-ink-6",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`${table}-category`}
                          value={c.value}
                          checked={on}
                          onChange={() => setDraftCategory(c.value)}
                          className="size-4 shrink-0 cursor-pointer accent-brand"
                        />
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            on ? "text-brand-deep" : "text-ink",
                          )}
                        >
                          {c.label}
                        </span>
                      </span>
                      {c.example && (
                        <span className="mt-1 block text-xs text-ink-4">
                          {c.example}
                        </span>
                      )}
                      {c.hint && (
                        <span className="mt-1 block text-[11px] leading-snug text-ink-5">
                          {c.hint}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {flagsFor(draftCategory).map((f) => (
            <label
              key={f.key}
              className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-ink"
            >
              <input
                type="checkbox"
                checked={Boolean(draftFlags[f.key])}
                onChange={(e) =>
                  setDraftFlags((current) => ({
                    ...current,
                    [f.key]: e.target.checked,
                  }))
                }
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-ink-6 accent-brand"
              />
              <span>
                {f.label}
                {f.hint && (
                  <span className="mt-0.5 block text-xs text-ink-5">
                    {f.hint}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* list */}
      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load {plural.toLowerCase()}: {(error as Error).message}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          No {plural.toLowerCase()} yet
          {canManage ? " — add your first one above." : "."}
        </p>
      ) : (
        <ul
          className={cn(
            "grid gap-2.5 sm:grid-cols-2",
            // The category control and flag pills need the extra width, so a
            // list carrying either stays at two columns.
            flagList.length === 0 &&
              categoryList.length === 0 &&
              "lg:grid-cols-3",
          )}
        >
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <li
                key={item.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5",
                  !item.active && "bg-sunken",
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
                      className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm outline-none focus:border-brand"
                    />
                    <IconButton
                      label="Save"
                      onClick={() =>
                        editValue.trim() &&
                        rename.mutate({ id: item.id, name: editValue })
                      }
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
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        item.active ? "text-ink" : "text-ink-5 line-through",
                      )}
                    >
                      {item.name}
                    </span>

                    {/* Compact on the row, unlike the radio cards on the add
                        form: here it is a correction, not a decision being
                        made for the first time. */}
                    {categoryList.length > 0 &&
                      (canManage ? (
                        <select
                          value={item.category ?? ""}
                          onChange={(e) =>
                            setCategory.mutate({
                              id: item.id,
                              category: e.target.value,
                            })
                          }
                          aria-label={`${categoryLabel} of ${item.name}`}
                          className="h-7 shrink-0 rounded-full border border-line bg-sunken px-2 text-[11px] font-medium text-ink-3 outline-none transition hover:border-ink-6 focus:border-brand"
                        >
                          {categoryList.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">
                          {categoryList.find((c) => c.value === item.category)
                            ?.label ?? item.category}
                        </span>
                      ))}

                    {flagsFor(item.category).map((f) => {
                      const on = Boolean(item.flags[f.key]);
                      const Icon = f.icon ?? Cog;
                      if (!canManage) {
                        return on ? (
                          <span
                            key={f.key}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"
                          >
                            <Icon className="size-3" />
                            {f.on}
                          </span>
                        ) : null;
                      }
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() =>
                            toggleFlag.mutate({
                              id: item.id,
                              key: f.key,
                              value: !on,
                            })
                          }
                          aria-pressed={on}
                          title={on ? f.on : f.off}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                            on
                              ? "bg-brand/10 text-brand hover:bg-brand/16"
                              : "bg-sunken-2 text-ink-5 hover:bg-line",
                          )}
                        >
                          <Icon className="size-3" />
                          {on ? f.on : f.off}
                        </button>
                      );
                    })}

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
                          className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 transition hover:bg-line"
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
                          <Trash2 className="size-3.5 text-danger-deep" />
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
        <p className="text-xs text-ink-5">
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
      className="shrink-0 rounded-md p-1 text-ink-5 transition hover:bg-sunken-2 hover:text-ink-3"
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
          className="h-[46px] animate-pulse rounded-xl border border-line-soft bg-sunken"
        />
      ))}
    </ul>
  );
}
