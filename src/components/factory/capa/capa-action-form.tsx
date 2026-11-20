"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  capaPlanActionSchema,
  type CapaPlanActionValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  CONTROL,
  DateControl,
  Field,
  PersonControl,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import {
  ACTION_KINDS,
  addCapaAction,
  updateCapaAction,
  type CapaAction,
} from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * One action — CA or PA, what will be done, who, by when, and an optional
 * linked record (a change control or training record). Adds a new action, or
 * changes one not yet done. Used by the CAPA plan, and by Do to add actions
 * after the plan is approved.
 */
export function CapaActionForm({
  factoryId,
  capaId,
  action,
  defaultOwner,
  defaultDue,
  afterApproval,
  onDone,
}: {
  factoryId: string;
  capaId: string;
  /** Present when changing an action not yet done. */
  action?: CapaAction;
  defaultOwner: string;
  /** `YYYY-MM-DD` — read by the caller through the render clock. */
  defaultDue: string;
  /** Said under the form: the history marks it as added after approval. */
  afterApproval?: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CapaPlanActionValues>({
    resolver: zodResolver(capaPlanActionSchema),
    defaultValues: {
      kind: action?.kind ?? "ca",
      description: action?.description ?? "",
      owner: action?.owner_name ?? defaultOwner,
      targetDate: action?.target_date ?? defaultDue,
      linkedRecord: action?.linked_record ?? "",
    },
  });
  const errors = form.formState.errors;

  const save = useMutation({
    mutationFn: (v: CapaPlanActionValues) =>
      action ? updateCapaAction(action.id, v) : addCapaAction(factoryId, capaId, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(action ? "Action saved." : "Action added.");
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
      <p className="text-sm font-semibold text-ink">{action ? "Change action" : "Add action"}</p>

      <Field label="Type" required>
        <Controller
          name="kind"
          control={form.control}
          render={({ field }) => (
            <div role="radiogroup" aria-label="Type" className="grid gap-2 sm:grid-cols-2">
              {ACTION_KINDS.map((k) => {
                const active = field.value === k.value;
                return (
                  <button
                    key={k.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(k.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition",
                      active
                        ? "border-brand bg-brand-soft ring-2 ring-brand/15"
                        : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {k.label} ({k.short})
                    </span>
                    <span className="block text-[0.6875rem] text-ink-5">{k.hint}</span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </Field>

      <Field
        label="What will be done"
        htmlFor="capa-act-desc"
        required
        error={errors.description?.message}
      >
        <textarea
          id="capa-act-desc"
          rows={2}
          placeholder="e.g. Add a closing-pin wear check to the weekly PM plan"
          aria-invalid={Boolean(errors.description)}
          className={AREA}
          {...form.register("description")}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who" htmlFor="capa-act-owner" required error={errors.owner?.message}>
          <PersonControl
            control={form.control}
            name="owner"
            id="capa-act-owner"
            workers={workers}
            label="Who"
          />
        </Field>
        <Field label="Due" htmlFor="capa-act-due" required error={errors.targetDate?.message}>
          <DateControl
            control={form.control}
            name="targetDate"
            id="capa-act-due"
            invalid={Boolean(errors.targetDate)}
          />
        </Field>
      </div>

      <Field
        label="Linked record"
        htmlFor="capa-act-link"
        note="(optional)"
        hint="A change control or training record, e.g. CC-2026-041."
        error={errors.linkedRecord?.message}
      >
        <input
          id="capa-act-link"
          placeholder="e.g. CC-2026-041"
          className={cn(CONTROL, "font-mono")}
          {...form.register("linkedRecord")}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[0.6875rem] text-ink-5">
          {afterApproval
            ? "The plan is approved — the history records this as added after approval."
            : "A CA fixes this cause. A PA stops it happening elsewhere."}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {action ? "Save action" : "Add action"}
          </button>
        </div>
      </div>
    </form>
  );
}
