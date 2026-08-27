"use client";

import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  amendEntrySchema,
  type AmendEntryValues,
} from "@/app/factory/[slug]/log/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import { amendLogEntry, logKeys } from "@/lib/factory/shift-log-queries";
import { logTableKeys } from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

/** The entry being amended — only what the dialog has to show or send. */
export interface AmendTarget {
  id: string;
  log_date: string;
  unit_name: string | null;
  process_name: string | null;
  batch_no: string | null;
  amend_note: string | null;
}

/**
 * Amend a filed shift-log entry.
 *
 * The original entry is never edited and never deleted — an amendment
 * attaches a correction note beside it, which is the whole audit model:
 * `shift_log_amend_guard` refuses an update without a note and stamps who
 * and when, and there is no delete policy at all.
 *
 * Unlike the prototype there is no "Amended by" field to type. The prototype
 * had no accounts, so it asked. Here the signed-in user *is* the answer, and
 * the database stamps `amended_by` from `auth.uid()` — a free-text name would
 * be an unverified claim sitting in an audit record.
 */
export function AmendEntryDialog({
  entry,
  factoryId,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that entry. */
  entry: AmendTarget | null;
  factoryId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AmendEntryValues>({
    resolver: zodResolver(amendEntrySchema),
    defaultValues: { note: "" },
  });

  const amend = useMutation({
    mutationFn: (values: AmendEntryValues) => {
      if (!entry) throw new Error("No entry selected.");
      return amendLogEntry(entry.id, values.note, entry.amend_note);
    },
    onSuccess: async () => {
      // Every reader of this row: the data table's pages, the log feed, and
      // the pipeline board — an amendment re-runs the status trigger, so a
      // corrected flag can release a hold.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: logTableKeys.all(factoryId),
        }),
        queryClient.invalidateQueries({ queryKey: logKeys.factory(factoryId) }),
        queryClient.invalidateQueries({
          queryKey: pipelineKeys.all(factoryId),
        }),
      ]);
      toast.success("Amendment recorded — the original entry is unchanged.");
      reset({ note: "" });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          reset({ note: "" });
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-ink">Amend log entry</DialogTitle>
          <DialogDescription>
            {entry && (
              <>
                {entry.unit_name ?? "—"} · {entry.process_name ?? "—"}
                {entry.batch_no && ` · batch ${entry.batch_no}`} ·{" "}
                {entry.log_date}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-xl bg-warn-tint p-3 text-xs text-warn-ink">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            The original entry is preserved for audit. You are adding a
            correction note only — the recorded numbers do not change.
          </p>
        </div>

        {entry?.amend_note && (
          <div className="rounded-xl border border-line bg-sunken p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.6px] text-ink-5">
              Existing amendments
            </p>
            <p className="whitespace-pre-line text-xs text-ink-3">
              {entry.amend_note}
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit((values) => amend.mutateAsync(values))}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="amend-note"
              className="block text-xs font-medium text-ink-3"
            >
              Reason for amendment
            </label>
            <textarea
              id="amend-note"
              rows={3}
              autoFocus
              aria-invalid={Boolean(errors.note)}
              className={cn(
                "w-full rounded-xl border bg-sunken px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:bg-surface focus:ring-4 focus:ring-brand/12",
                errors.note
                  ? "border-danger-line focus:border-danger"
                  : "border-line focus:border-brand",
              )}
              placeholder="What was incorrect and what the correct information is…"
              {...register("note")}
            />
            {errors.note && (
              <p className="text-xs text-danger-deep">{errors.note.message}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                reset({ note: "" });
                onClose();
              }}
              disabled={isSubmitting}
              className="h-10 flex-1 rounded-xl border border-line text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting ? "Saving…" : "Save amendment"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
