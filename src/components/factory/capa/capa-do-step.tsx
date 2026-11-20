"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  capaDoneSchema,
  type CapaDoneValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaActionForm } from "@/components/factory/capa/capa-action-form";
import { KindBadge } from "@/components/factory/capa/capa-plan-step";
import {
  CONTROL,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { addDays } from "@/lib/factory/dates";
import {
  markCapaActionDone,
  type Capa,
  type CapaAction,
} from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * Step 2 · Do — each action marked done with its evidence (a document,
 * record or work order) and any linked record. More actions may be added; a
 * CAPA whose last check said it didn't work comes back here for them.
 */
export function CapaDoStep({
  capa,
  actions,
  factoryId,
  editable,
  viewerName,
  today,
}: {
  capa: Capa;
  actions: CapaAction[];
  factoryId: string;
  /** Supervisor and up, while the CAPA is in Do. */
  editable: boolean;
  viewerName: string;
  today: string;
}) {
  const [doing, setDoing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const done = actions.filter((a) => a.closed_date).length;
  const total = actions.length;
  const nextDue = capa.next_due;

  return (
    <div className="space-y-4">
      {capa.reopened && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
          The last check said it didn&rsquo;t work. Add new actions — it is checked again once
          they are done.
        </p>
      )}

      <div>
        <div className="flex justify-between text-xs text-ink-4">
          <span>
            {done} of {total} done
          </span>
          {capa.step === "do" && nextDue && (
            <span className={cn(nextDue < today && "font-semibold text-danger-deep")}>
              Next due {formatDate(nextDue)}
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken-2">
          <div
            className="h-full rounded-full bg-teal transition-[width]"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-line-soft">
        {actions.map((a) => {
          const isDone = Boolean(a.closed_date);
          const overdue = !isDone && a.target_date !== null && a.target_date < today;
          return (
            <li key={a.id} className="py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                    isDone ? "bg-teal-soft text-teal-deep" : "border border-line-strong",
                  )}
                >
                  {isDone && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex items-start gap-2">
                    <KindBadge kind={a.kind} />
                    <span className="wrap-anywhere text-ink">{a.description}</span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-4">
                    {a.owner_name ?? "—"} ·{" "}
                    {isDone ? (
                      <>
                        done {formatDate(a.closed_date)}
                        {a.closed_by_name && ` by ${a.closed_by_name}`}
                        {a.evidence && (
                          <span className="text-ink-3 wrap-anywhere"> — {a.evidence}</span>
                        )}
                      </>
                    ) : (
                      <span className={cn(overdue && "font-semibold text-danger-deep")}>
                        due {formatDate(a.target_date)}
                      </span>
                    )}
                    {a.linked_record && <span className="font-mono"> · {a.linked_record}</span>}
                  </span>
                </span>
                {editable && !isDone && doing !== a.id && (
                  <button
                    type="button"
                    onClick={() => setDoing(a.id)}
                    className="h-8 shrink-0 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
                  >
                    Done
                  </button>
                )}
              </div>
              {doing === a.id && (
                <DoneForm
                  action={a}
                  factoryId={factoryId}
                  viewerName={viewerName}
                  today={today}
                  onDone={() => setDoing(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {editable &&
        (adding ? (
          <CapaActionForm
            factoryId={factoryId}
            capaId={capa.id}
            defaultOwner={capa.owner_name ?? ""}
            defaultDue={addDays(today, 30)}
            afterApproval
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
          >
            <Plus className="size-4" />
            Add action
          </button>
        ))}
    </div>
  );
}

function DoneForm({
  action,
  factoryId,
  viewerName,
  today,
  onDone,
}: {
  action: CapaAction;
  factoryId: string;
  viewerName: string;
  today: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CapaDoneValues>({
    resolver: zodResolver(capaDoneSchema),
    defaultValues: { evidence: "", linkedRecord: action.linked_record ?? "" },
  });
  const errors = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: CapaDoneValues) => markCapaActionDone(action.id, v, today, viewerName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Action done.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="mt-3 space-y-3 rounded-2xl border border-brand-line bg-brand-tint/40 p-4"
    >
      <p className="text-sm font-semibold text-ink">Mark done</p>
      <Field
        label="Evidence"
        htmlFor="cd-evidence"
        required
        hint="A document, record or work order that shows it was done."
        error={errors.evidence?.message}
      >
        <input
          id="cd-evidence"
          placeholder="e.g. SOP-PK-012 rev 5, training record TR-118, WO-4471"
          aria-invalid={Boolean(errors.evidence)}
          className={CONTROL}
          {...form.register("evidence")}
        />
      </Field>
      <Field label="Linked record" htmlFor="cd-link" note="(optional)" error={errors.linkedRecord?.message}>
        <input
          id="cd-link"
          placeholder="Change control or training record"
          className={cn(CONTROL, "font-mono")}
          {...form.register("linkedRecord")}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.6875rem] text-ink-5">
          Done today, by {viewerName}. A done action is part of the record and is not edited.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Mark done
          </button>
        </div>
      </div>
    </form>
  );
}
