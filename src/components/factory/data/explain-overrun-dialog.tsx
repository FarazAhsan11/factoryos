"use client";

import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import {
  explainOverrunSchema,
  type ExplainOverrunValues,
} from "@/app/factory/[slug]/log/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { explainOverrun, logKeys } from "@/lib/factory/shift-log-queries";
import { logTableKeys } from "@/lib/factory/shift-log-table-queries";
import { cn } from "@/lib/utils";

/** The entry being explained — only what the dialog shows or sends. */
export interface OverrunTarget {
  id: string;
  log_date: string;
  unit_name: string | null;
  process_name: string | null;
  batch_no: string | null;
  product_name: string | null;
  accumulative: number | null;
  required_qty: number | null;
  overrun_qty: number | null;
  overrun_note: string | null;
}

/**
 * Explain an overproduction, which is what clears its flag.
 *
 * The entry itself is untouched — the units were produced and the log says so.
 * What was missing is the reason there are more of them than the work order
 * asked for, and until a manager writes it down the entry carries a flag on
 * every screen that shows it.
 *
 * Manager-only, and the check is not here: `shift_log_amend_guard` refuses the
 * write outright and stamps who explained it. This dialog is simply not
 * offered to anyone who would be refused.
 */
export function ExplainOverrunDialog({
  entry,
  factoryId,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that entry. */
  entry: OverrunTarget | null;
  factoryId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExplainOverrunValues>({
    resolver: zodResolver(explainOverrunSchema),
    defaultValues: { note: "" },
  });

  const explain = useMutation({
    mutationFn: (values: ExplainOverrunValues) => {
      if (!entry) throw new Error("No entry selected.");
      return explainOverrun(entry.id, values.note);
    },
    onSuccess: async () => {
      // Both readers of the flag: the data table pages, and the log feed's
      // separate per-day overrun query.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: logTableKeys.all(factoryId) }),
        queryClient.invalidateQueries({ queryKey: logKeys.factory(factoryId) }),
      ]);
      reset();
      onClose();
      toast.success("Overproduction explained — flag cleared.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : Number(n).toLocaleString();

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#0F1B34]">
            <TrendingUp className="size-4 text-[#B45309]" />
            Explain the overproduction
          </DialogTitle>
          <DialogDescription>
            The entry stays exactly as filed. This records why the batch went
            past its work order — and only that clears the flag.
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <dl className="space-y-1.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-sm">
            <Row label="Batch">
              {entry.batch_no ?? "—"}
              {entry.product_name && (
                <span className="ml-1.5 text-[#64748B]">
                  · {entry.product_name}
                </span>
              )}
            </Row>
            <Row label="Where">
              {entry.unit_name ?? "—"} · {entry.process_name ?? "—"}
            </Row>
            <Row label="Produced">
              <span className="font-mono">{fmt(entry.accumulative)}</span>
              <span className="mx-1 text-[#94A3B8]">of</span>
              <span className="font-mono">{fmt(entry.required_qty)}</span>
            </Row>
            <Row label="Over by">
              <span className="font-mono font-semibold text-[#B45309]">
                {fmt(entry.overrun_qty)}
              </span>
            </Row>
          </dl>
        )}

        <form
          onSubmit={handleSubmit((values) => explain.mutate(values))}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="overrun-note"
              className="block text-xs font-medium text-[#475569]"
            >
              Reason for the extra quantity
            </label>
            <textarea
              id="overrun-note"
              rows={4}
              autoFocus
              aria-invalid={Boolean(errors.note)}
              placeholder="e.g. Overfill allowance on the filler; 100 units held as retention samples."
              className={cn(
                "w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB]",
                errors.note ? "border-[#FCA5A5]" : "border-[#E6EAF1]"
              )}
              {...register("note")}
            />
            {errors.note && (
              <p role="alert" className="text-xs text-[#DC2626]">
                {errors.note.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={isSubmitting}
              className="h-10 rounded-xl px-4 text-sm font-medium text-[#475569] transition hover:bg-[#F1F5F9] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#B45309] px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Save &amp; clear flag
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-[#92400E]">{label}</dt>
      <dd className="text-right text-[13px] text-[#0F1B34]">{children}</dd>
    </div>
  );
}
