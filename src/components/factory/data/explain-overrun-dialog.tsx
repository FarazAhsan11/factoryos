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
  /** Required plus the batch's declared overage — the threshold actually crossed. */
  allowed_qty: number | null;
  overage_pct: number;
  overrun_qty: number | null;
  overrun_note: string | null;
}

/**
 * Explain an overproduction, which is what clears its flag.
 *
 * The entry itself is untouched — the units were produced and the log says so.
 * What was missing is the reason there are more of them than the batch was
 * *allowed* to make, and until a manager writes it down the entry carries a
 * flag on every screen that shows it.
 *
 * "Allowed" is the work order plus whatever overage the batch declared
 * (migration 0032). A planner who says "make 4% extra" has already accounted
 * for that 4%; asking them to account for it a second time, every entry, is
 * what teaches everyone to clear these without reading them.
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
        queryClient.invalidateQueries({
          queryKey: logTableKeys.all(factoryId),
        }),
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
          <DialogTitle className="flex items-center gap-2 text-ink">
            <TrendingUp className="size-4 text-warn-deep" />
            Explain the overproduction
          </DialogTitle>
          <DialogDescription>
            The entry stays exactly as filed. This records why the batch went
            past its work order — and only that clears the flag.
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <dl className="space-y-1.5 rounded-xl border border-warn-line bg-warn-tint p-3.5 text-sm">
            <Row label="Batch">
              {entry.batch_no ?? "—"}
              {entry.product_name && (
                <span className="ml-1.5 text-ink-4">
                  · {entry.product_name}
                </span>
              )}
            </Row>
            <Row label="Where">
              {entry.unit_name ?? "—"} · {entry.process_name ?? "—"}
            </Row>
            <Row label="Produced">
              <span className="font-mono">{fmt(entry.accumulative)}</span>
              <span className="mx-1 text-ink-5">of</span>
              <span className="font-mono">{fmt(entry.required_qty)}</span>
              <span className="ml-1 text-ink-4">required</span>
            </Row>
            {/* Only when there is one. On a batch with no declared overage the
                allowance and the requirement are the same number, and showing
                it twice invites the reader to look for a difference. */}
            {entry.overage_pct > 0 && (
              <Row label="Allowed">
                <span className="font-mono">{fmt(entry.allowed_qty)}</span>
                <span className="ml-1 text-ink-4">
                  (+{entry.overage_pct}% overage)
                </span>
              </Row>
            )}
            <Row label="Over by">
              <span className="font-mono font-semibold text-warn-deep">
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
              className="block text-xs font-medium text-ink-3"
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
                "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand",
                errors.note ? "border-danger-line" : "border-line",
              )}
              {...register("note")}
            />
            {errors.note && (
              <p role="alert" className="text-xs text-danger">
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
              className="h-10 rounded-xl px-4 text-sm font-medium text-ink-3 transition hover:bg-sunken-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-warn-deep px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
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
      <dt className="text-xs text-warn-ink">{label}</dt>
      <dd className="text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}
