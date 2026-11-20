"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  capaCheckSchema,
  type CapaCheckValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { formatDateTime } from "@/lib/factory/dates";
import {
  recordCapaCheck,
  type Capa,
  type CapaCheck,
} from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/** Whole days from `today` to `date` (both `YYYY-MM-DD`). */
function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * Step 3 · Effectiveness check — did it work? Worked closes the CAPA; didn't
 * work sends it back to Do. Every check is kept, newest last. A dated check
 * recorded before its date asks why.
 */
export function CapaCheckStep({
  capa,
  checks,
  factoryId,
  editable,
  viewerName,
  today,
}: {
  capa: Capa;
  checks: CapaCheck[];
  factoryId: string;
  /** Supervisor and up, while the CAPA is at its check. */
  editable: boolean;
  viewerName: string;
  today: string;
}) {
  const [recording, setRecording] = useState(false);
  const atCheck = capa.step === "check";
  const dated = capa.check_mode === "dated" && Boolean(capa.verify_by);
  const n = dated ? daysUntil(today, capa.verify_by!) : null;

  return (
    <div className="space-y-4">
      {atCheck && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-sunken px-4 py-3.5">
          <span>
            {dated ? (
              <span className={cn("block text-sm font-semibold", n! < 0 ? "text-danger-deep" : "text-ink")}>
                {n! > 0
                  ? `Check due in ${n} day${n === 1 ? "" : "s"}`
                  : n === 0
                    ? "Check due today"
                    : `Check ${-n!} day${n === -1 ? "" : "s"} overdue`}
              </span>
            ) : (
              <span className="block text-sm font-semibold text-ink">Confirm the fix worked</span>
            )}
            <span className="block text-xs text-ink-4">
              {dated
                ? `${formatDate(capa.verify_by)} · by ${capa.checker_name ?? "QA"}`
                : `Simple fix: ${capa.check_why ?? ""}`}
            </span>
          </span>
          {editable && !recording && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              className={n !== null && n > 0 ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            >
              {n !== null && n > 0 ? "Record check early" : "Record check"}
            </button>
          )}
        </div>
      )}

      {atCheck && (
        <p className="text-sm text-ink-3">
          <span className="text-ink-5">Measure:</span> {capa.effectiveness_criteria}
        </p>
      )}

      {recording && (
        <CheckForm
          capa={capa}
          early={n !== null && n > 0}
          factoryId={factoryId}
          viewerName={viewerName}
          onDone={() => setRecording(false)}
        />
      )}

      {checks.length > 0 && <CheckList checks={checks} />}
    </div>
  );
}

export function CheckList({ checks }: { checks: CapaCheck[] }) {
  return (
    <ul className="space-y-2.5">
      {checks.map((k) => {
        const worked = k.result === "effective";
        return (
          <li key={k.id} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                worked ? "bg-teal-soft text-teal-deep" : "bg-danger-soft text-danger-deep",
              )}
            >
              {worked ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-ink">{worked ? "Worked" : "Didn't work"}</span>
              <span className="wrap-anywhere text-ink-2"> — {k.findings}</span>
              <span className="block text-xs text-ink-4">
                {k.checked_by_name} · {formatDateTime(k.checked_at)}
                {k.early_reason && ` · checked early because: ${k.early_reason}`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CheckForm({
  capa,
  early,
  factoryId,
  viewerName,
  onDone,
}: {
  capa: Capa;
  early: boolean;
  factoryId: string;
  viewerName: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CapaCheckValues>({
    resolver: zodResolver(capaCheckSchema(early)),
    defaultValues: { result: "effective", findings: "", earlyReason: "" },
  });
  const errors = form.formState.errors;

  const save = useMutation({
    mutationFn: (v: CapaCheckValues) => {
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (norm(viewerName) && norm(viewerName) === norm(capa.owner_name)) {
        toast.warning(`You own ${capa.capa_no} — the check should normally be someone else's.`);
      }
      return recordCapaCheck(capa.id, v.result === "effective", v.findings, v.earlyReason, viewerName);
    },
    onSuccess: async (_, v) => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(
        v.result === "effective"
          ? `${capa.capa_no} closed — it worked.`
          : "Recorded — add new actions, then check again.",
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-2xl border border-brand-line bg-brand-tint/40 p-4"
    >
      <p className="text-sm font-semibold text-ink">Did it work? — {capa.capa_no}</p>
      <Field label="Result" required>
        <Controller
          name="result"
          control={form.control}
          render={({ field }) => (
            <div role="radiogroup" aria-label="Result" className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "effective", label: "Worked" },
                  { value: "not_effective", label: "Didn't work" },
                ] as const
              ).map((o) => {
                const active = field.value === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(o.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                      active
                        ? o.value === "effective"
                          ? "border-teal bg-teal-soft text-teal-deep ring-2 ring-teal/20"
                          : "border-danger bg-danger-soft text-danger-deep ring-2 ring-danger/20"
                        : "border-line bg-surface text-ink hover:border-line-strong",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
        />
      </Field>
      <Field
        label="What did you find?"
        htmlFor="ck-findings"
        required
        error={errors.findings?.message}
      >
        <textarea
          id="ck-findings"
          rows={3}
          placeholder="What you looked at and what it showed, e.g. 12 batches since May, 0 denting findings"
          aria-invalid={Boolean(errors.findings)}
          className={AREA}
          {...form.register("findings")}
        />
      </Field>
      {early && (
        <Field
          label={`Why check before ${formatDate(capa.verify_by)}?`}
          htmlFor="ck-early"
          required
          error={errors.earlyReason?.message}
        >
          <textarea id="ck-early" rows={2} className={AREA} {...form.register("earlyReason")} />
        </Field>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.6875rem] text-ink-5">
          Signing as {viewerName}. Worked closes the CAPA; didn&rsquo;t work sends it back to Do.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Sign check
          </button>
        </div>
      </div>
    </form>
  );
}
