"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useWatch } from "react-hook-form";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  capaPlanSchema,
  type CapaPlanValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaActionForm } from "@/components/factory/capa/capa-action-form";
import {
  AREA,
  Badge,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Muted,
  PersonControl,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { addDays } from "@/lib/factory/dates";
import {
  approveCapaPlan,
  planMissing,
  removeCapaAction,
  saveCapaPlan,
  type Capa,
  type CapaAction,
} from "@/lib/factory/capa-queries";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * Step 1 · CAPA plan — the reference QMS's (qms-v6): the actions (what, who,
 * due), how we will know it worked, when it is checked and by whom. Saved as
 * it is written; **approved** once complete, and then read-only. Actions start
 * after approval.
 */
export function CapaPlanStep({
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
  /** Supervisor and up, while the plan is not approved. */
  editable: boolean;
  viewerName: string;
  today: string;
}) {
  if (!editable) return <PlanFacts capa={capa} actions={actions} />;
  return (
    <div className="space-y-6">
      <PlanActions capa={capa} actions={actions} factoryId={factoryId} today={today} />
      <PlanForm
        // Re-seeded when the saved plan changes underneath it.
        key={`${capa.effectiveness_criteria}|${capa.check_mode}|${capa.verify_by}|${capa.check_why}|${capa.checker_name}|${capa.title}|${capa.owner_name}`}
        capa={capa}
        actions={actions}
        factoryId={factoryId}
        viewerName={viewerName}
      />
    </div>
  );
}

function PlanActions({
  capa,
  actions,
  factoryId,
  today,
}: {
  capa: Capa;
  actions: CapaAction[];
  factoryId: string;
  today: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<"add" | string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => removeCapaAction(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Action removed from the plan.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-ink">Actions</h4>
      {actions.length === 0 ? (
        <p className="text-sm text-ink-5">No actions yet — add at least one.</p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-xl border border-line bg-surface">
          {actions.map((a) =>
            editing === a.id ? (
              <li key={a.id} className="p-3">
                <CapaActionForm
                  factoryId={factoryId}
                  capaId={capa.id}
                  action={a}
                  defaultOwner={capa.owner_name ?? ""}
                  defaultDue={addDays(today, 30)}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={a.id} className="flex items-start gap-3 px-3.5 py-2.5 text-sm">
                <KindBadge kind={a.kind} />
                <span className="min-w-0 flex-1">
                  <span className="wrap-anywhere text-ink">{a.description}</span>
                  <span className="mt-0.5 block text-xs text-ink-4">
                    {a.owner_name ?? <span className="text-danger-deep">who?</span>} · due{" "}
                    {a.target_date ? formatDate(a.target_date) : <span className="text-danger-deep">—</span>}
                    {a.linked_record && <span className="font-mono"> · {a.linked_record}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Change action"
                    onClick={() => setEditing(a.id)}
                    className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken-2 hover:text-ink"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove action"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(a.id)}
                    className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken-2 hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "add" ? (
        <CapaActionForm
          factoryId={factoryId}
          capaId={capa.id}
          defaultOwner={capa.owner_name ?? ""}
          defaultDue={addDays(today, 30)}
          onDone={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing("add")}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
        >
          <Plus className="size-4" />
          Add action
        </button>
      )}
      <p className="text-[0.6875rem] text-ink-5">
        CA fixes this cause. PA stops it happening elsewhere.
      </p>
    </section>
  );
}

function PlanForm({
  capa,
  actions,
  factoryId,
  viewerName,
}: {
  capa: Capa;
  actions: CapaAction[];
  factoryId: string;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CapaPlanValues>({
    resolver: zodResolver(capaPlanSchema),
    defaultValues: {
      title: capa.title,
      owner: capa.owner_name ?? "",
      effectivenessCriteria: capa.effectiveness_criteria ?? "",
      checkMode: capa.check_mode,
      verifyBy: capa.verify_by ?? "",
      checkWhy: capa.check_why ?? "",
      checker: capa.checker_name ?? "",
    },
  });
  const { control, register, formState, setValue } = form;
  const errors = formState.errors;
  const mode = useWatch({ control, name: "checkMode" });
  const [note, setNote] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const save = useMutation({
    mutationFn: (v: CapaPlanValues) => saveCapaPlan(capa.id, v),
    onSuccess: async () => {
      await refresh();
      toast.success("Plan saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: () => {
      // The owner should not approve their own plan. Said, not enforced —
      // for now, so it can be tested with one login.
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (norm(viewerName) && norm(viewerName) === norm(capa.owner_name)) {
        toast.warning(
          `You own ${capa.capa_no} — another approver should normally approve its plan.`,
        );
      }
      return approveCapaPlan(capa.id, viewerName, note);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Plan approved — actions can start.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const missing = planMissing(capa, actions);
  const base = capa.last_due;
  const quick = (months: number) =>
    base ? addDays(base, months * 30) : null;

  return (
    <div className="space-y-5">
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
        className="space-y-4"
      >
        <h4 className="text-sm font-semibold text-ink">CAPA</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="cp-title" required error={errors.title?.message}>
            <input id="cp-title" className={CONTROL} {...register("title")} />
          </Field>
          <Field label="CAPA owner" htmlFor="cp-owner" error={errors.owner?.message}>
            <PersonControl control={control} name="owner" id="cp-owner" workers={workers} label="CAPA owner" />
          </Field>
        </div>

        <h4 className="pt-2 text-sm font-semibold text-ink">Effectiveness check</h4>
        <Field
          label="How will we know it worked?"
          htmlFor="cp-criteria"
          required
          hint="Something you can count, e.g. no denting on PC2173 in the next 10 batches."
          error={errors.effectivenessCriteria?.message}
        >
          <textarea id="cp-criteria" rows={2} className={AREA} {...register("effectivenessCriteria")} />
        </Field>

        <Field label="When to check" required>
          <Controller
            name="checkMode"
            control={control}
            render={({ field }) => (
              <div role="radiogroup" aria-label="When to check" className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { value: "dated", label: "On a date", hint: "Checked once it has had time to show" },
                    {
                      value: "at_implementation",
                      label: "When the actions are done",
                      hint: "Simple fixes — nothing to trend",
                    },
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
                        "rounded-xl border px-3 py-2 text-left transition",
                        active
                          ? "border-brand bg-brand-soft ring-2 ring-brand/15"
                          : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className="block text-sm font-semibold text-ink">{o.label}</span>
                      <span className="block text-[0.6875rem] text-ink-5">{o.hint}</span>
                    </button>
                  );
                })}
              </div>
            )}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "dated" ? (
            <Field
              label="Check on"
              htmlFor="cp-verify"
              required
              hint={
                base
                  ? `Counted from the last action due date (${formatDate(base)}).`
                  : "Add the actions first — the quick picks count from the last due date."
              }
              error={errors.verifyBy?.message}
            >
              <DateControl control={control} name="verifyBy" id="cp-verify" />
              {base && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[1, 3, 6].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setValue("verifyBy", quick(m)!, { shouldDirty: true })}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
                    >
                      +{m} month{m > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <Field
              label="Why a dated check isn't needed"
              htmlFor="cp-why"
              required
              error={errors.checkWhy?.message}
            >
              <input
                id="cp-why"
                placeholder="e.g. Form corrected; nothing to trend"
                className={CONTROL}
                {...register("checkWhy")}
              />
            </Field>
          )}
          <Field
            label="Checked by"
            htmlFor="cp-checker"
            required
            hint="Normally someone other than the CAPA owner."
            error={errors.checker?.message}
          >
            <input
              id="cp-checker"
              placeholder="Name of the person who checks it"
              className={CONTROL}
              {...register("checker")}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending || !formState.isDirty}
            className={SECONDARY_BUTTON}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save plan
          </button>
          {formState.isDirty && <span className="text-xs text-warn-deep">Unsaved changes</span>}
        </div>
      </form>

      <div className="space-y-3 rounded-2xl border border-line bg-sunken px-4 py-3.5">
        {missing.length > 0 ? (
          <p className="text-sm text-ink-3">
            <span className="font-semibold text-ink">Still needed:</span> {missing.join(", ")}.
          </p>
        ) : formState.isDirty ? (
          <p className="text-sm text-ink-3">Save the plan, then approve it.</p>
        ) : (
          <>
            <Field label="Approval comment" htmlFor="cp-note" note="(optional)">
              <input
                id="cp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={CONTROL}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={approve.isPending}
                onClick={() => approve.mutate()}
                className={PRIMARY_BUTTON}
              >
                {approve.isPending && <Loader2 className="size-4 animate-spin" />}
                Approve plan
              </button>
              <span className="text-xs text-ink-4">
                Actions start after approval. Signing as {viewerName}.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** An approved plan, or one read by someone below supervisor. */
export function PlanFacts({ capa, actions }: { capa: Capa; actions: CapaAction[] }) {
  return (
    <div className="space-y-5">
      {actions.length === 0 ? (
        <Muted>No actions yet.</Muted>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => (
            <li key={a.id} className="flex items-start gap-3 text-sm">
              <KindBadge kind={a.kind} />
              <span className="min-w-0">
                <span className="wrap-anywhere text-ink">{a.description}</span>
                <span className="text-ink-4">
                  {" "}
                  · {a.owner_name ?? "—"} · due {formatDate(a.target_date)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="How we will know it worked" wide>
          {capa.effectiveness_criteria ?? <Muted>Not set yet</Muted>}
        </Fact>
        <Fact label="Check">
          {capa.check_mode === "at_implementation"
            ? `When the actions are done — ${capa.check_why ?? ""}`
            : capa.verify_by
              ? formatDate(capa.verify_by)
              : <Muted>Not set yet</Muted>}
        </Fact>
        <Fact label="Checked by">{capa.checker_name ?? <Muted>—</Muted>}</Fact>
        {capa.plan_approval_note && (
          <Fact label="Approval comment" wide>
            {capa.plan_approval_note}
          </Fact>
        )}
      </dl>
    </div>
  );
}

export function KindBadge({ kind }: { kind: "ca" | "pa" }) {
  return (
    <Badge
      className={cn(
        "mt-0.5 shrink-0",
        kind === "ca" ? "bg-brand-soft text-brand-deep" : "bg-teal-soft text-teal-deep",
      )}
    >
      {kind.toUpperCase()}
    </Badge>
  );
}
