"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import type { SetupItem } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white";

const EMPTY: NewActionValues = {
  title: "",
  unitId: "",
  category: "Quality",
  priority: "high",
  assignedTo: "",
  dueAt: "",
  notes: "",
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
    value: NewActionValues[K]
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const create = useMutation({
    mutationFn: () => createAction(factoryId, values, userId),
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
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06]"
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
            <DialogTitle className="text-[#0F1B34]">New action</DialogTitle>
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

            <Field label="Due by" htmlFor="na-due" note="(optional)">
              <input
                id="na-due"
                type="datetime-local"
                value={values.dueAt}
                onChange={(e) => set("dueAt", e.target.value)}
                className={CONTROL}
              />
              <p className="mt-1 text-[11px] text-[#94A3B8]">
                Leave blank and it&rsquo;s due in {window?.within} — the{" "}
                {window?.label.toLowerCase()} window — escalating {window?.within}{" "}
                after that.
              </p>
            </Field>

            <Field label="Notes" htmlFor="na-notes" note="(optional)">
              <textarea
                id="na-notes"
                rows={3}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Context, root cause, what needs to happen…"
                className="w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 py-2.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={create.isPending}
                className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={create.isPending || !values.title.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
              >
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
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
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-[#475569]"
      >
        {label}
        {note && <span className="ml-1 text-[10px] text-[#94A3B8]">{note}</span>}
      </label>
      {children}
    </div>
  );
}
