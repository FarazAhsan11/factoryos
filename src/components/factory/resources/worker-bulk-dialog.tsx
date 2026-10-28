"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download, FileUp, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  SHIFT_LABELS,
  SHIFT_SLOTS,
  type ShiftSlot,
} from "@/app/factory/[slug]/admin/schemas";
import { AREA, FIELD } from "@/components/factory/admin/settings-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { chunk } from "@/lib/factory/csv";
import type { SetupItem } from "@/lib/factory/setup-queries";
import {
  WORKER_CSV_TEMPLATE,
  parseWorkers,
  type WorkerDefaults,
} from "@/lib/factory/worker-csv";
import { createWorkers } from "@/lib/factory/worker-queries";
import { cn } from "@/lib/utils";

const LABEL = "text-xs font-medium text-ink-3";

const START: WorkerDefaults = {
  departmentId: "",
  shift: "morning",
  role: "Operator",
};

/** Rows per insert: a whole team in one or two round trips, not one each. */
const BATCH = 200;

/**
 * Workforce → Bulk add. Paste rows out of a spreadsheet or choose a CSV; the
 * preview underneath is re-read on every keystroke and is exactly what will be
 * written — nothing is saved until "Add" is pressed.
 *
 * The defaults fill whatever a row leaves blank, which is what makes the
 * common case one step: paste a column of thirty names, set Packing and
 * Afternoon once, add. Names already on the register, and rows that can't be
 * read, are listed with the reason and skipped.
 */
export function WorkerBulkDialog({
  factoryId,
  departments,
  existing,
  onAdded,
}: {
  factoryId: string;
  /** Departments still in use — what a row's department is matched against. */
  departments: SetupItem[];
  /** Names already on the register, so a re-paste skips them. */
  existing: string[];
  onAdded: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [defaults, setDefaults] = useState<WorkerDefaults>(START);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () => parseWorkers(text, { departments, existing, defaults }),
    [text, departments, existing, defaults],
  );
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  function reset() {
    setText("");
    setFileName("");
    setDefaults(START);
    if (fileRef.current) fileRef.current.value = "";
  }

  const save = useMutation({
    mutationFn: async () => {
      let added = 0;
      for (const rows of chunk(parsed.rows, BATCH)) {
        added += await createWorkers(factoryId, rows);
      }
      return added;
    },
    onSuccess: async (added) => {
      await onAdded();
      toast.success(
        `${added} ${added === 1 ? "person" : "people"} added to the workforce.`,
      );
      reset();
      setOpen(false);
    },
    // A later batch can fail after an earlier one landed. Refreshing the
    // register re-runs the preview against it, so whoever did land now reads
    // "Already on the workforce" and a second Add sends only the rest.
    onError: async (e: Error) => {
      await onAdded();
      toast.error(e.message);
    },
  });

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([WORKER_CSV_TEMPLATE], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "factoryos-workforce-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const count = parsed.rows.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink-3 transition hover:bg-sunken"
      >
        <Users className="size-4" />
        Bulk add
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Never abandon a save half-way by clicking outside.
          if (!next && save.isPending) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-ink">
              Bulk add to the workforce
            </DialogTitle>
            <DialogDescription>
              Paste rows straight from a spreadsheet, or choose a CSV. Columns:
              name, department, shift, role &mdash; only the name is required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <label htmlFor="wf-bulk-text" className={LABEL}>
                  People
                </label>
                <div className="flex items-center gap-4">
                  <label
                    htmlFor="wf-bulk-file"
                    className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    <FileUp className="size-3.5" />
                    {fileName || "Choose a CSV"}
                  </label>
                  <input
                    id="wf-bulk-file"
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setText(await file.text());
                      setFileName(file.name);
                    }}
                  />
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    <Download className="size-3.5" />
                    Template
                  </button>
                </div>
              </div>
              <textarea
                id="wf-bulk-text"
                rows={6}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName("");
                }}
                spellCheck={false}
                placeholder={
                  "name, department, shift, role\nThian Mang, Production, morning, Operator\n\n…or just one name per line"
                }
                className={cn(AREA, "resize-y font-mono text-[0.8125rem]")}
              />
            </div>

            <div className="rounded-2xl border border-line bg-surface p-3.5">
              <p className="mb-2.5 text-[0.6875rem] font-bold tracking-[0.07em] text-ink-4 uppercase">
                Where a row leaves it blank
              </p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <span className={LABEL}>Department</span>
                  <SelectField
                    value={defaults.departmentId}
                    onChange={(departmentId) =>
                      setDefaults((d) => ({ ...d, departmentId }))
                    }
                    ariaLabel="Department for rows that leave it blank"
                    placeholder="No department"
                    clearable
                    options={departments.map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className={LABEL}>Shift</span>
                  <SelectField
                    value={defaults.shift}
                    onChange={(shift) =>
                      setDefaults((d) => ({ ...d, shift: shift as ShiftSlot }))
                    }
                    ariaLabel="Shift for rows that leave it blank"
                    options={SHIFT_SLOTS.map((s) => ({
                      value: s,
                      label: SHIFT_LABELS[s],
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="wf-bulk-role" className={LABEL}>
                    Role
                  </label>
                  <input
                    id="wf-bulk-role"
                    value={defaults.role}
                    onChange={(e) =>
                      setDefaults((d) => ({ ...d, role: e.target.value }))
                    }
                    placeholder="Operator"
                    className={FIELD}
                  />
                </div>
              </div>
            </div>

            {parsed.errors.length > 0 && (
              <div className="rounded-xl border border-warn-line bg-warn-tint p-3 text-xs text-warn-ink">
                <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-3.5" />
                  {parsed.errors.length} row
                  {parsed.errors.length === 1 ? "" : "s"} will be skipped
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                  {parsed.errors.map((e) => (
                    <li key={`${e.line}-${e.value}`}>
                      <span className="font-medium">Line {e.line}</span>{" "}
                      {e.value && `(${e.value}) `}&mdash; {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {count > 0 && (
              // What each column was read as, row by row — a paste that came
              // across a column out shows here before anything is written.
              <div className="max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 border-b border-line bg-sunken-2 text-left text-[0.625rem] font-bold tracking-[0.07em] text-ink-3 uppercase">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((r) => (
                      <tr
                        key={r.fullName}
                        className="border-b border-sunken-2 last:border-0"
                      >
                        <td className="px-3 py-1.5 font-medium text-ink">
                          {r.fullName}
                        </td>
                        <td className="px-3 py-1.5 text-ink-3">
                          {departmentName.get(r.departmentId) ?? (
                            <span className="text-ink-5">&mdash;</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-3">
                          {SHIFT_LABELS[r.shift]}
                        </td>
                        <td className="px-3 py-1.5 text-ink-3">{r.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-ink-5">
              {count > 0
                ? `${count} ${count === 1 ? "person" : "people"} ready to add.`
                : "Nothing to add yet."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={save.isPending}
                className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={count === 0 || save.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Add {count > 0 ? count : ""}{" "}
                {count === 1 ? "person" : "people"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
