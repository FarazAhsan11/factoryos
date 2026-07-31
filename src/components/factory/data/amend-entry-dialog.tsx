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
      // Both readers of this row: the data table's pages and the log feed.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: logTableKeys.all(factoryId) }),
        queryClient.invalidateQueries({ queryKey: logKeys.factory(factoryId) }),
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
          <DialogTitle className="text-[#0F1B34]">Amend log entry</DialogTitle>
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

        <div className="flex items-start gap-2 rounded-xl bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            The original entry is preserved for audit. You are adding a
            correction note only — the recorded numbers do not change.
          </p>
        </div>

        {entry?.amend_note && (
          <div className="rounded-xl border border-[#E6EAF1] bg-[#F8FAFC] p-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
              Existing amendments
            </p>
            <p className="whitespace-pre-line text-xs text-[#475569]">
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
              className="block text-xs font-medium text-[#475569]"
            >
              Reason for amendment
            </label>
            <textarea
              id="amend-note"
              rows={3}
              autoFocus
              aria-invalid={Boolean(errors.note)}
              className={cn(
                "w-full rounded-xl border bg-[#FBFCFE] px-3.5 py-2.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/12",
                errors.note
                  ? "border-[#FCA5A5] focus:border-[#DC2626]"
                  : "border-[#E6EAF1] focus:border-[#2563EB]"
              )}
              placeholder="What was incorrect and what the correct information is…"
              {...register("note")}
            />
            {errors.note && (
              <p className="text-xs text-[#B91C1C]">{errors.note.message}</p>
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
              className="h-10 flex-1 rounded-xl border border-[#E6EAF1] text-sm font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-70"
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
