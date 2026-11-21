"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  capaWithdrawSchema,
  type CapaWithdrawValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  Field,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { withdrawCapa, type Capa } from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * "Withdraw this CAPA" — for a CAPA still in Plan (0075). A link that opens
 * the reason in place; the CAPA is kept as a record, read-only, and its cases
 * go back to "Is a CAPA required?" undecided.
 */
export function WithdrawCapa({
  capa,
  factoryId,
  viewerName,
  className,
}: {
  capa: Capa;
  factoryId: string;
  viewerName: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<CapaWithdrawValues>({
    resolver: zodResolver(capaWithdrawSchema),
    defaultValues: { reason: "" },
  });
  const errors = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: CapaWithdrawValues) => withdrawCapa(capa.id, v.reason, viewerName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(`${capa.capa_no} withdrawn.`);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("text-xs font-semibold text-danger-deep hover:underline", className)}
      >
        Withdraw this CAPA
      </button>
    );
  }

  const cases = capa.cases.map((k) => k.deviation_no).join(", ");
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className={cn("space-y-3 rounded-xl border border-danger-line bg-danger-soft/40 p-4", className)}
    >
      <p className="text-sm font-semibold text-ink">Withdraw {capa.capa_no}</p>
      <p className="text-[0.8125rem] text-ink-3">
        The CAPA is kept as a record and cannot be edited again.
        {cases && ` ${cases} go${capa.cases.length === 1 ? "es" : ""} back to “Is a CAPA required?”.`}
      </p>
      <Field label="Reason" htmlFor={`wd-${capa.id}`} required error={errors.reason?.message}>
        <textarea
          id={`wd-${capa.id}`}
          rows={2}
          autoFocus
          placeholder="Why it is no longer needed, e.g. raised in error — the case is covered by CAPA-2026-004"
          aria-invalid={Boolean(errors.reason)}
          className={AREA}
          {...form.register("reason")}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-danger-deep disabled:opacity-60"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Withdraw
        </button>
        <button
          type="button"
          onClick={() => {
            form.reset({ reason: "" });
            setOpen(false);
          }}
          disabled={save.isPending}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
        <span className="text-xs text-ink-4">Signing as {viewerName}.</span>
      </div>
    </form>
  );
}
