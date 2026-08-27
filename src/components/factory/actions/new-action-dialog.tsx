"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ACTION_CATEGORIES,
  ACTION_PRIORITIES,
  createAction,
  type ActionPriority,
  type NewActionValues,
} from "@/lib/factory/action-queries";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import type { SetupItem } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-sunken px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface";

const EMPTY: NewActionValues = {
  title: "",
  unitId: "",
  category: "Quality",
  priority: "high",
  assignedTo: "",
  dueAt: "",
  notes: "",
  batchNo: "",
};

/**
 * Raise an action by hand — the half that doesn't come from a flagged shift
 * entry: a standing job, something spotted on a walk-round, a follow-up.
 *
 * The due date is optional and that is the point of the priority field: leave
 * it blank and the priority's own window sets the clock. An action with no
 * deadline can never be overdue and so can never escalate, which would quietly
 * defeat the one thing this module is for.
 */
export function NewActionDialog({
  factoryId,
  userId,
  units,
  onCreated,
}: {
  factoryId: string;
  userId: string;
  units: SetupItem[];
  unitWord?: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<NewActionValues>(EMPTY);

  function set<K extends keyof NewActionValues>(
    key: K,
    value: NewActionValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // The whole catalogue, matched in the browser — same as the shift log and
  // the maintenance form, and the reason typing a batch resolves instantly.
  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const matched = useMemo(() => {
    const term = values.batchNo.trim().toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, values.batchNo]);

  const create = useMutation({
    mutationFn: () =>
      createAction(factoryId, values, userId, matched?.id ?? null),
    onSuccess: () => {
      toast.success("Action created.");
      setValues(EMPTY);
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const window = ACTION_PRIORITIES.find((p) => p.value === values.priority);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValues(EMPTY);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        New action
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && create.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-ink">New action</DialogTitle>
            <DialogDescription>
              Issues flagged in the shift log create these automatically — this
              is for everything else.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="Title" htmlFor="na-title">
              <input
                id="na-title"
                autoFocus
                value={values.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Resolve capping issue — Room 15"
                className={CONTROL}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Room / unit" htmlFor="na-unit" note="(optional)">
                <select
                  id="na-unit"
                  value={values.unitId}
                  onChange={(e) => set("unitId", e.target.value)}
                  className={CONTROL}
                >
                  <option value="">Factory-wide</option>
                  {units
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Category" htmlFor="na-category">
                <select
                  id="na-category"
                  value={values.category}
                  onChange={(e) => set("category", e.target.value)}
                  className={CONTROL}
                >
                  {ACTION_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Priority" htmlFor="na-priority">
                <select
                  id="na-priority"
                  value={values.priority}
                  onChange={(e) =>
                    set("priority", e.target.value as ActionPriority)
                  }
                  className={CONTROL}
                >
                  {ACTION_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label} — due within {p.within}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Assign to" htmlFor="na-assignee" note="(optional)">
                <input
                  id="na-assignee"
                  value={values.assignedTo}
                  onChange={(e) => set("assignedTo", e.target.value)}
                  placeholder="Name"
                  className={CONTROL}
                />
              </Field>
            </div>

            {/* Optional, and typed rather than picked — the same field the
                shift log and a maintenance request use. An issue raised from
                a flagged entry arrives with this already filled in from the
                entry, so the two can never drift apart. */}
            <Field label="Affected batch" htmlFor="na-batch" note="(optional)">
              <input
                id="na-batch"
                value={values.batchNo}
                onChange={(e) => set("batchNo", e.target.value)}
                placeholder="Type a batch number"
                className={cn(CONTROL, "font-mono")}
              />
              <div className="mt-1.5">
                <BatchSummary factoryId={factoryId} batchNo={values.batchNo} />
              </div>
            </Field>

            <Field label="Due by" htmlFor="na-due" note="(optional)">
              <input
                id="na-due"
                type="datetime-local"
                value={values.dueAt}
                onChange={(e) => set("dueAt", e.target.value)}
                className={CONTROL}
              />
              <p className="mt-1 text-[11px] text-ink-5">
                Leave blank and it&rsquo;s due in {window?.within} — the{" "}
                {window?.label.toLowerCase()} window — escalating{" "}
                {window?.within} after that.
              </p>
            </Field>

            <Field label="Notes" htmlFor="na-notes" note="(optional)">
              <textarea
                id="na-notes"
                rows={3}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Context, root cause, what needs to happen…"
                className="w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:bg-surface"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={create.isPending}
                className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={create.isPending || !values.title.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
              >
                {create.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Create action
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  note,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-3">
        {label}
        {note && <span className="ml-1 text-[10px] text-ink-5">{note}</span>}
      </label>
      {children}
    </div>
  );
}
