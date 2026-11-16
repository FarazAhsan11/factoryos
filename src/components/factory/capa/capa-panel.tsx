"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { CheckCircle2, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_STATUSES,
  capaActionCloseSchema,
  capaActionSchema,
  capaVerifySchema,
  type CapaActionCloseValues,
  type CapaActionValues,
  type CapaVerifyValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  Badge,
  Cols,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Group,
  Muted,
  PersonControl,
  SelectControl,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import {
  ACTION_KINDS,
  ACTION_STATUS_LABELS,
  actionKindMeta,
  addCapaAction,
  capaKeys,
  closeCapaAction,
  fetchCapaActions,
  updateCapaAction,
  verifyCapa,
  type Capa,
  type CapaAction,
} from "@/lib/factory/capa-queries";
import { formatDateTime, todayKey } from "@/lib/factory/dates";
import { deviationKeys } from "@/lib/factory/deviation-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * One CAPA's working surface — its actions and its verification.
 *
 * Drawn in two places, the case's CAPA tab and the CAPA register's dialog, so
 * a CAPA is worked the same way from either. Everything is inline rather than
 * in a dialog of its own: this already sits inside one, and an action is
 * three fields.
 *
 * The fields are the ones the case's old CA / PA tabs had — owner, target
 * date, actual closed date, closed by, description — under the same labels.
 * `capa_actions_guard` and `capas_guard` own the rules; these forms only say
 * the same things first.
 */
export function CapaPanel({
  capa,
  factoryId,
  readOnly,
}: {
  capa: Capa;
  factoryId: string;
  /** Below supervisor, or the case around it is closed. */
  readOnly: boolean;
}) {
  const frozen = readOnly || capa.status === "effective";

  const { data: actions = [], isPending } = useQuery({
    queryKey: capaKeys.actions(factoryId, capa.id),
    queryFn: () => fetchCapaActions(capa.id),
  });

  /** Which inline form is open: a new action, an edit, or a close. */
  const [editing, setEditing] = useState<
    | { mode: "add" }
    | { mode: "edit"; action: CapaAction }
    | { mode: "close"; action: CapaAction; today: string }
    | null
  >(null);

  const allClosed =
    actions.length > 0 && actions.every((a) => a.closed_date !== null);

  return (
    <div className="space-y-6">
      <Group title="Actions">
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-line bg-sunken-2 text-left text-[0.625rem] font-bold tracking-[0.07em] text-ink-3 uppercase">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Target / due date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actual closed date</th>
                <th className="px-3 py-2">Closed by</th>
                {!frozen && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-ink-5">
                    <Loader2 className="mx-auto size-4 animate-spin" />
                  </td>
                </tr>
              ) : actions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-ink-5">
                    No actions yet.
                  </td>
                </tr>
              ) : (
                actions.map((a) => (
                  <ActionRow
                    key={a.id}
                    action={a}
                    frozen={frozen}
                    onEdit={() => setEditing({ mode: "edit", action: a })}
                    onClose={() =>
                      setEditing({ mode: "close", action: a, today: todayKey() })
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[0.6875rem] text-ink-5">
          A CA fixes the cause in front of you. A PA stops it happening
          elsewhere.
        </p>

        {!frozen &&
          (editing?.mode === "add" ? (
            <ActionForm
              key="add"
              factoryId={factoryId}
              capaId={capa.id}
              onDone={() => setEditing(null)}
            />
          ) : editing?.mode === "edit" ? (
            <ActionForm
              key={editing.action.id}
              factoryId={factoryId}
              capaId={capa.id}
              action={editing.action}
              onDone={() => setEditing(null)}
            />
          ) : editing?.mode === "close" ? (
            <CloseActionForm
              key={editing.action.id}
              factoryId={factoryId}
              action={editing.action}
              today={editing.today}
              onDone={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing({ mode: "add" })}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
            >
              <Plus className="size-4" />
              Add action
            </button>
          ))}
      </Group>

      <Group title="Verification of effectiveness">
        {capa.status === "effective" ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-teal-line bg-teal-soft px-4 py-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" />
              <div>
                <p className="text-sm font-semibold text-teal-deep">
                  Verified effective by {capa.verified_by_name}
                </p>
                <p className="text-xs text-teal-deep/80">
                  {capa.verified_at && formatDateTime(capa.verified_at)}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label="Effectiveness criteria" wide>
                {capa.effectiveness_criteria ?? <Muted>—</Muted>}
              </Fact>
              <Fact label="Verification" wide>
                {capa.verification ?? <Muted>—</Muted>}
              </Fact>
            </dl>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label="Effectiveness criteria" wide>
                {capa.effectiveness_criteria ?? <Muted>Not set yet</Muted>}
              </Fact>
              <Fact label="Verify by">
                <span
                  className={cn(
                    capa.is_verify_overdue && "font-semibold text-danger-deep",
                  )}
                >
                  {formatDate(capa.verify_by)}
                </span>
              </Fact>
            </dl>

            {!frozen &&
              (allClosed ? (
                <VerifyForm capa={capa} factoryId={factoryId} />
              ) : (
                <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3 text-xs text-ink-5">
                  The CAPA can be verified once it has at least one action and
                  every action is closed.
                </p>
              ))}
          </div>
        )}
      </Group>
    </div>
  );
}

function ActionRow({
  action,
  frozen,
  onEdit,
  onClose,
}: {
  action: CapaAction;
  frozen: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const kind = actionKindMeta(action.kind);
  const closed = action.closed_date !== null;
  return (
    <tr className="border-b border-sunken align-top last:border-0">
      <td className="px-3 py-2.5">
        <Badge
          className={
            action.kind === "ca"
              ? "bg-brand-soft text-brand-deep"
              : "bg-teal-soft text-teal-deep"
          }
        >
          {kind.short}
        </Badge>
      </td>
      <td className="max-w-[22rem] px-3 py-2.5 whitespace-pre-wrap text-ink">
        {action.description}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {action.owner_name ?? <Muted>—</Muted>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
        {formatDate(action.target_date)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {/* Closed is the close itself; otherwise the status it is set to. */}
        <Badge
          className={
            closed
              ? "bg-teal-soft text-teal-deep"
              : action.status === "in_progress"
                ? "bg-brand-soft text-brand-deep"
                : "bg-sunken-2 text-ink-4"
          }
        >
          {ACTION_STATUS_LABELS[closed ? "closed" : action.status]}
        </Badge>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
        {closed ? (
          <span className="font-medium text-teal-deep">
            {formatDate(action.closed_date)}
          </span>
        ) : (
          <Muted>Open</Muted>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {action.closed_by_name ?? <Muted>—</Muted>}
      </td>
      {!frozen && (
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {!closed && (
            <span className="inline-flex gap-1">
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit action"
                className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken-2 hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-3 transition hover:border-brand hover:text-brand"
              >
                Close
              </button>
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

/** Saving anything on a CAPA refreshes every Quality list, the rail included. */
function useCapaSave<T>(
  factoryId: string,
  run: (values: T) => Promise<void>,
  message: string,
  onDone?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: deviationKeys.all(factoryId),
      });
      toast.success(message);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function ActionForm({
  factoryId,
  capaId,
  action,
  onDone,
}: {
  factoryId: string;
  capaId: string;
  /** Present when correcting an open action. */
  action?: CapaAction;
  onDone: () => void;
}) {
  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CapaActionValues>({
    resolver: zodResolver(capaActionSchema),
    defaultValues: {
      kind: action?.kind ?? "ca",
      description: action?.description ?? "",
      owner: action?.owner_name ?? "",
      targetDate: action?.target_date ?? "",
      status: action?.status ?? "open",
    },
  });

  const save = useCapaSave<CapaActionValues>(
    factoryId,
    (v) =>
      action ? updateCapaAction(action.id, v) : addCapaAction(factoryId, capaId, v),
    action ? "Action saved." : "Action added.",
    onDone,
  );
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-2xl border border-brand-line bg-brand-tint/40 p-4"
    >
      <p className="text-sm font-semibold text-ink">
        {action ? "Edit action" : "New action"}
      </p>

      <Field label="Type" required>
        <Controller
          name="kind"
          control={form.control}
          render={({ field }) => (
            <div className="grid gap-2 sm:grid-cols-2">
              {ACTION_KINDS.map((k) => {
                const active = field.value === k.value;
                return (
                  <button
                    key={k.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => field.onChange(k.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition",
                      active
                        ? "border-brand bg-brand-soft ring-2 ring-brand/15"
                        : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {k.label}
                    </span>
                    <span className="block text-[0.6875rem] text-ink-5">
                      {k.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </Field>

      <Field
        label="Description"
        htmlFor="capa-action-desc"
        required
        error={errors.description?.message}
      >
        <textarea
          id="capa-action-desc"
          rows={3}
          placeholder="e.g. Discontinue the silica insert for this product. Implement induction seal."
          aria-invalid={Boolean(errors.description)}
          className={AREA}
          {...form.register("description")}
        />
      </Field>

      <Cols of={2}>
        <Field label="Owner" htmlFor="capa-action-owner">
          <PersonControl
            control={form.control}
            name="owner"
            id="capa-action-owner"
            workers={workers}
            label="Owner"
            placeholder="Who owns it"
          />
        </Field>
        <Field label="Target / due date" htmlFor="capa-action-target">
          <DateControl
            control={form.control}
            name="targetDate"
            id="capa-action-target"
          />
        </Field>
        <Field label="Status" htmlFor="capa-action-status">
          <SelectControl
            control={form.control}
            name="status"
            id="capa-action-status"
            options={ACTION_STATUSES.map((s) => ({
              value: s,
              label: ACTION_STATUS_LABELS[s],
            }))}
          />
        </Field>
      </Cols>

      <FormButtons
        pending={form.formState.isSubmitting}
        label={action ? "Save action" : "Add action"}
        onCancel={onDone}
      />
    </form>
  );
}

function CloseActionForm({
  factoryId,
  action,
  today,
  onDone,
}: {
  factoryId: string;
  action: CapaAction;
  /** Read when the form was opened — never from the clock in render. */
  today: string;
  onDone: () => void;
}) {
  const form = useForm<CapaActionCloseValues>({
    resolver: zodResolver(capaActionCloseSchema),
    defaultValues: { closedDate: today, closedBy: "" },
  });
  const save = useCapaSave<CapaActionCloseValues>(
    factoryId,
    (v) => closeCapaAction(action.id, v),
    `${actionKindMeta(action.kind).short} closed.`,
    onDone,
  );
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-2xl border border-brand-line bg-brand-tint/40 p-4"
    >
      <div>
        <p className="text-sm font-semibold text-ink">Close this action</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-4">
          {action.description}
        </p>
      </div>
      <Cols of={2}>
        <Field
          label="Actual closed date"
          htmlFor="capa-close-date"
          required
          error={errors.closedDate?.message}
        >
          <DateControl
            control={form.control}
            name="closedDate"
            id="capa-close-date"
            invalid={Boolean(errors.closedDate)}
          />
        </Field>
        <Field
          label="Closed by"
          htmlFor="capa-close-by"
          required
          error={errors.closedBy?.message}
        >
          <input
            id="capa-close-by"
            placeholder="Who signed it off"
            aria-invalid={Boolean(errors.closedBy)}
            className={CONTROL}
            {...form.register("closedBy")}
          />
        </Field>
      </Cols>
      <FormButtons
        pending={form.formState.isSubmitting}
        label="Close action"
        onCancel={onDone}
        note="A closed action is part of the record and is not edited."
      />
    </form>
  );
}

function VerifyForm({ capa, factoryId }: { capa: Capa; factoryId: string }) {
  const form = useForm<CapaVerifyValues>({
    resolver: zodResolver(capaVerifySchema),
    defaultValues: {
      effectivenessCriteria: capa.effectiveness_criteria ?? "",
      verification: "",
      verifiedBy: "",
    },
  });
  const save = useCapaSave<CapaVerifyValues>(
    factoryId,
    (v) => verifyCapa(capa.id, v),
    `${capa.capa_no} verified as effective.`,
  );
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-2xl border border-line bg-surface p-4"
    >
      <p className="text-sm font-semibold text-ink">Verify as effective</p>
      <Field
        label="Effectiveness criteria"
        htmlFor="capa-criteria"
        required
        hint="What would show the CAPA worked."
        error={errors.effectivenessCriteria?.message}
      >
        <textarea
          id="capa-criteria"
          rows={2}
          placeholder="e.g. No label mix-ups in the next 10 packing runs."
          className={AREA}
          {...form.register("effectivenessCriteria")}
        />
      </Field>
      <Field
        label="Verification"
        htmlFor="capa-verification"
        required
        hint="What was checked, and what it showed."
        error={errors.verification?.message}
      >
        <textarea
          id="capa-verification"
          rows={3}
          className={AREA}
          {...form.register("verification")}
        />
      </Field>
      <Field
        label="Verified by"
        htmlFor="capa-verified-by"
        required
        hint="Typed, and stamped with the time — the equivalent of the signature box."
        error={errors.verifiedBy?.message}
      >
        <input
          id="capa-verified-by"
          placeholder="Name"
          className={CONTROL}
          {...form.register("verifiedBy")}
        />
      </Field>
      <FormButtons
        pending={form.formState.isSubmitting}
        label={`Verify ${capa.capa_no}`}
        note="Once verified, the CAPA and its actions are frozen."
      />
    </form>
  );
}

function FormButtons({
  pending,
  label,
  onCancel,
  note,
}: {
  pending: boolean;
  label: string;
  onCancel?: () => void;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[0.6875rem] text-ink-5">{note}</p>
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-9 rounded-xl px-3.5 text-sm font-semibold text-ink-3 transition hover:bg-sunken-2 hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {label}
        </button>
      </div>
    </div>
  );
}
