"use client";

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  stageSignOffSchema,
  type StageSignOffParsed,
  type StageSignOffValues,
} from "@/app/factory/[slug]/pipeline/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  signOffStage,
  stageName,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { cn } from "@/lib/utils";

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Signing a stage off — the moment a batch's route actually advances.
 *
 * Three numbers and one question. The numbers are read back rather than typed:
 * accumulated comes from the shift log, the target from the plan, and the
 * yield is the arithmetic over them, computed by the database at sign-off. A
 * typed yield would be a third number free to disagree with the two it comes
 * from, and it is the one that ends up on a handover sheet.
 *
 * There is no "signed off by" box either. The person is signed in; a text box
 * for their name can be left blank, misspelt, or filled in with somebody
 * else's, which turns the only piece of accountability a sign-off carries into
 * something the client asserts.
 *
 * On the **last** stage of the plan this also completes the order — said out
 * loud here, because it is the one press with a consequence beyond the stage.
 */
export function StageSignOffDialog({
  stage,
  onDone,
  onClose,
}: {
  stage: BatchStage | null;
  onDone: () => void | Promise<void>;
  onClose: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StageSignOffValues, unknown, StageSignOffParsed>({
    resolver: zodResolver(stageSignOffSchema),
    defaultValues: { yieldAcceptable: true, notes: "" },
  });

  useEffect(() => {
    if (stage) reset({ yieldAcceptable: true, notes: "" });
  }, [stage, reset]);

  const sign = useMutation({
    mutationFn: (values: StageSignOffParsed) => signOffStage(stage!.id, values),
    onSuccess: async () => {
      toast.success(
        stage?.is_final
          ? `${stageName(stage)} signed off — the batch is finished.`
          : `${stageName(stage!)} signed off.`,
      );
      await onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const target = Number(stage?.target_qty ?? 0);
  const made = Number(stage?.accumulated_qty ?? 0);
  const yieldPct = target > 0 ? Math.round((made / target) * 1000) / 10 : null;
  // `useWatch`, not `watch()`: the latter returns a fresh function on every
  // render, which makes the React Compiler skip memoizing the whole component.
  const acceptable = useWatch({ control, name: "yieldAcceptable" });

  return (
    <Dialog
      open={stage !== null}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="size-4 text-teal" />
            Sign off {stage ? stageName(stage) : "stage"}
          </DialogTitle>
          <DialogDescription>
            {stage?.is_final
              ? "This is the last stage in the plan — signing it off completes the order."
              : "Records that this stage is done and what it yielded. The entries underneath it are untouched."}
          </DialogDescription>
        </DialogHeader>

        {stage && (
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-sunken px-3.5 py-3 text-center">
            <Figure label="Accumulated" value={fmt(made)} tone="text-brand" />
            <Figure
              label="Stage target"
              value={target ? fmt(target) : "—"}
              tone="text-ink"
            />
            <Figure
              label="Yield"
              value={yieldPct === null ? "—" : `${yieldPct}%`}
              tone={
                yieldPct !== null && yieldPct >= 95 ? "text-teal" : "text-warn-deep"
              }
            />
          </div>
        )}

        {yieldPct !== null && yieldPct < 95 && (
          <p className="flex items-start gap-2 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Yield is under 95%. If that isn&rsquo;t acceptable, say so below and
            raise a deviation in Issues &amp; CAPAs.
          </p>
        )}

        <form
          onSubmit={handleSubmit((values) => sign.mutate(values))}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-ink-3">
              Is the yield acceptable?
            </span>
            <Controller
              name="yieldAcceptable"
              control={control}
              render={({ field }) => (
                <div className="flex gap-2">
                  <Choice
                    on={field.value === true}
                    onClick={() => field.onChange(true)}
                    tone="teal"
                  >
                    Yes — within range
                  </Choice>
                  <Choice
                    on={field.value === false}
                    onClick={() => field.onChange(false)}
                    tone="warn"
                  >
                    No — needs a deviation
                  </Choice>
                </div>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="signoff-notes"
              className="block text-xs font-medium text-ink-3"
            >
              Sign-off notes{" "}
              <span className="text-ink-5">
                {acceptable ? "(optional)" : "(required)"}
              </span>
            </label>
            <textarea
              id="signoff-notes"
              rows={3}
              aria-invalid={Boolean(errors.notes)}
              placeholder="e.g. 2.1% loss within SOP limits, all in-process checks passed."
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12"
              {...register("notes")}
            />
            {errors.notes?.message && (
              <p role="alert" className="text-[11px] text-danger-deep">
                {errors.notes.message}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-10 rounded-xl px-4 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {stage?.is_final ? "Sign off & finish batch" : "Confirm complete"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div>
      <p className={cn("font-mono text-lg font-bold", tone)}>{value}</p>
      <p className="text-[10px] text-ink-5">{label}</p>
    </div>
  );
}

function Choice({
  on,
  onClick,
  tone,
  children,
}: {
  on: boolean;
  onClick: () => void;
  tone: "teal" | "warn";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition",
        on
          ? tone === "teal"
            ? "border-teal bg-teal-soft text-teal-deep"
            : "border-warn-line bg-warn-tint text-warn-ink"
          : "border-line bg-surface text-ink-4 hover:border-ink-6 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
