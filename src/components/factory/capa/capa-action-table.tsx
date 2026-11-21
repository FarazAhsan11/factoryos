"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  capaActionAddSchema,
  capaDoneSchema,
  type CapaActionAddValues,
  type CapaDoneValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { PlanGroupHead } from "@/components/factory/capa/capa-plan-editor";
import {
  AREA,
  CONTROL,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { DateField } from "@/components/ui/date-picker";
import { addDays } from "@/lib/factory/dates";
import {
  addCapaAction,
  markCapaActionDone,
  type Capa,
  type CapaAction,
  type CapaActionKind,
} from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

const HEAD: Record<CapaActionKind, { title: string; sub: string; word: string }> = {
  ca: { title: "Corrective actions", sub: "Remove the cause of this problem.", word: "corrective" },
  pa: {
    title: "Preventive actions",
    sub: "Optional — stop it happening on other products, lines or suppliers.",
    word: "preventive",
  },
};

/**
 * One kind of the CAPA's actions as a table — read-only (an approved plan),
 * or with the Done column (Implement): ✓ and the date when done, with the
 * completion evidence under the row, or **Mark done**, which opens the
 * evidence form in place. More actions may be added after approval.
 */
export function CapaActionTable({
  capa,
  actions,
  kind,
  mode,
  factoryId,
  canDo,
  canAdd,
  viewerName,
  today,
}: {
  capa: Capa;
  actions: CapaAction[];
  kind: CapaActionKind;
  mode: "ro" | "impl";
  factoryId: string;
  canDo: boolean;
  canAdd: boolean;
  viewerName: string;
  today: string;
}) {
  const [doing, setDoing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = actions.filter((a) => a.kind === kind);
  const head = HEAD[kind];
  const impl = mode === "impl";

  return (
    <section className="space-y-2.5">
      <PlanGroupHead title={head.title} sub={head.sub} />
      {rows.length === 0 ? (
        !(impl && canAdd) && <p className="text-sm text-ink-5">None.</p>
      ) : (
        <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-4">
              <tr>
                <th className="px-3.5 py-2 font-semibold">Action</th>
                <th className="w-[12rem] px-3.5 py-2 font-semibold">Owner</th>
                <th className="w-[9rem] px-3.5 py-2 font-semibold">Target date</th>
                {impl && <th className="w-[9rem] px-3.5 py-2 font-semibold">Done</th>}
              </tr>
            </thead>
            <tbody className="bg-surface">
              {rows.map((a) => {
                const done = Boolean(a.closed_date);
                const overdue = !done && a.target_date !== null && a.target_date < today;
                const evidence = [a.evidence, a.linked_record].filter(Boolean).join("\n");
                return (
                  <ActionRows
                    key={a.id}
                    a={a}
                    impl={impl}
                    done={done}
                    overdue={overdue}
                    evidence={evidence}
                    canDo={canDo && impl && capa.step !== "plan" && capa.step !== "closed"}
                    doing={doing === a.id}
                    onStart={() => setDoing(a.id)}
                    onStop={() => setDoing(null)}
                    factoryId={factoryId}
                    viewerName={viewerName}
                    today={today}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {impl &&
        canAdd &&
        (adding ? (
          <AddActionForm
            capa={capa}
            kind={kind}
            factoryId={factoryId}
            today={today}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
          >
            <Plus className="size-3.5" />
            Add {head.word} action
          </button>
        ))}
    </section>
  );
}

function ActionRows({
  a,
  impl,
  done,
  overdue,
  evidence,
  canDo,
  doing,
  onStart,
  onStop,
  factoryId,
  viewerName,
  today,
}: {
  a: CapaAction;
  impl: boolean;
  done: boolean;
  overdue: boolean;
  evidence: string;
  canDo: boolean;
  doing: boolean;
  onStart: () => void;
  onStop: () => void;
  factoryId: string;
  viewerName: string;
  today: string;
}) {
  const [more, setMore] = useState(false);
  const long = evidence.length > 140 || evidence.split("\n").length > 2;
  return (
    <>
      <tr className={cn("align-top", !(done && evidence) && !doing && "border-b border-line-soft last:border-b-0")}>
        <td className="px-3.5 py-2.5 wrap-anywhere text-ink">{a.description}</td>
        <td className="px-3.5 py-2.5 text-ink-2">{a.owner_name ?? "—"}</td>
        <td className={cn("px-3.5 py-2.5 whitespace-nowrap", overdue ? "font-semibold text-danger-deep" : "text-ink-3")}>
          {formatDate(a.target_date)}
        </td>
        {impl && (
          <td className="px-3.5 py-2.5">
            {done ? (
              <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap text-teal-deep">
                <Check className="size-3.5" />
                {formatDate(a.closed_date)}
                {a.closed_by_name && a.closed_by_name !== a.owner_name && (
                  <span className="block text-xs font-normal text-ink-4">by {a.closed_by_name}</span>
                )}
              </span>
            ) : doing ? (
              <span className="text-xs text-ink-4">Marking done…</span>
            ) : canDo ? (
              <button
                type="button"
                onClick={onStart}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
              >
                Mark done
              </button>
            ) : (
              <span className="text-xs text-ink-5">Open</span>
            )}
          </td>
        )}
      </tr>
      {impl && done && evidence && (
        <tr className="border-b border-line-soft last:border-b-0">
          <td colSpan={4} className="bg-sunken/60 px-3.5 pt-1 pb-2.5">
            <p className="text-[0.6875rem] font-semibold tracking-wide text-ink-5 uppercase">
              Completion evidence
            </p>
            <p className={cn("text-sm whitespace-pre-wrap wrap-anywhere text-ink-3", long && !more && "line-clamp-2")}>
              {evidence}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setMore((m) => !m)}
                className="text-xs font-semibold text-brand hover:underline"
              >
                {more ? "Show less" : "Show more"}
              </button>
            )}
          </td>
        </tr>
      )}
      {doing && (
        <tr className="border-b border-line-soft last:border-b-0">
          <td colSpan={4} className="bg-sunken px-3.5 py-3">
            <DoneForm action={a} factoryId={factoryId} viewerName={viewerName} today={today} onDone={onStop} />
          </td>
        </tr>
      )}
    </>
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
    defaultValues: { evidence: "", linkedRecord: "" },
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
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]"
    >
      <Field label="Completion evidence" htmlFor="cd-evidence" required error={errors.evidence?.message}>
        <textarea
          id="cd-evidence"
          rows={3}
          autoFocus
          placeholder="What was done and where it is recorded, e.g. Closing pins replaced on encapsulator 2 — WO-4471"
          aria-invalid={Boolean(errors.evidence)}
          className={AREA}
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
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <span className="text-xs text-ink-4">Done today, by {viewerName}.</span>
      </div>
    </form>
  );
}

function AddActionForm({
  capa,
  kind,
  factoryId,
  today,
  onDone,
}: {
  capa: Capa;
  kind: CapaActionKind;
  factoryId: string;
  today: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CapaActionAddValues>({
    resolver: zodResolver(capaActionAddSchema),
    defaultValues: { description: "", owner: "", targetDate: addDays(today, 30) },
  });
  const errors = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: CapaActionAddValues) => addCapaAction(factoryId, capa.id, kind, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Action added.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-xl border border-line bg-sunken p-3.5"
    >
      <p className="text-sm font-semibold text-ink">
        Add {HEAD[kind].word} action — {capa.capa_no}
      </p>
      <Field label="Action" htmlFor="ca-add" required error={errors.description?.message}>
        <input id="ca-add" autoFocus placeholder="What will be done" className={CONTROL} {...form.register("description")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner" htmlFor="ca-add-owner" required error={errors.owner?.message}>
          <input id="ca-add-owner" placeholder="Owner" className={CONTROL} {...form.register("owner")} />
        </Field>
        <Field label="Target date" required error={errors.targetDate?.message}>
          <Controller
            name="targetDate"
            control={form.control}
            render={({ field }) => (
              <DateField value={field.value} onChange={field.onChange} min={today} ariaLabel="Target date" />
            )}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Add action
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        {capa.plan_approved_at && (
          <span className="text-xs text-ink-4">Recorded as added after plan approval.</span>
        )}
      </div>
    </form>
  );
}
