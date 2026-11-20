"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  dueExtensionSchema,
  type DueExtensionValues,
} from "@/app/factory/[slug]/deviations/schemas";
import {
  AREA,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "@/components/factory/deviations/deviation-fields";
import { DateField } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addDays, formatDateTime, formatDay } from "@/lib/factory/dates";
import { deviationKeys, type Deviation } from "@/lib/factory/deviation-queries";
import {
  decideExtension,
  extensionKeys,
  fetchExtensions,
  requestExtension,
  type DueExtension,
} from "@/lib/factory/extension-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

/**
 * A deviation's due date extensions (0072), as the reference QMS (qms-v5)
 * has them: more time is **asked for** — a later date and the reason — and a
 * QA approver **approves** it (the due date moves) or **rejects** it with a
 * reason. One request waits at a time; the old date stays in the history.
 *
 * For now the person who asked may also decide (to test with one login); the
 * screen warns rather than refuses, as the investigation's approval does.
 */

/** The case's requests, oldest first — shared by the page, the header and the report. */
export function useExtensions(factoryId: string, deviationId: string) {
  return useQuery({
    queryKey: extensionKeys.forCase(factoryId, deviationId),
    queryFn: () => fetchExtensions(deviationId),
  });
}

/** Whether a request may be made now — open, assessed, nothing waiting. */
export function canRequestExtension(d: Deviation, extensions: DueExtension[]): boolean {
  return (
    d.status === "open" &&
    Boolean(d.assessed_at) &&
    Boolean(d.sla_date) &&
    !extensions.some((e) => e.status === "requested")
  );
}

const STATUS_TEXT: Record<DueExtension["status"], string> = {
  requested: "font-semibold text-warn-deep",
  approved: "text-teal-deep",
  rejected: "text-ink-3",
};

const STATUS_LABEL: Record<DueExtension["status"], string> = {
  requested: "Waiting for QA",
  approved: "Approved",
  rejected: "Rejected",
};

/** History → Due date extensions: every request, and QA's decision on it. */
export function DueExtensions({
  deviation: d,
  factoryId,
  canDecide,
  viewerName,
}: {
  deviation: Deviation;
  factoryId: string;
  /** Supervisor and up, on an open case. False on the printed report. */
  canDecide: boolean;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const { data: extensions = [], isPending } = useExtensions(factoryId, d.id);
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null);
  const [asking, setAsking] = useState(false);

  // Nothing to show on a case that has no due date yet and never asked.
  if (!isPending && extensions.length === 0 && !(d.status === "open" && d.assessed_at)) {
    return null;
  }

  async function decide(e: DueExtension, approve: boolean, note: string) {
    const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
    if (norm(viewerName) && norm(viewerName) === norm(e.requested_by_name)) {
      toast.warning(
        "You asked for this extension — another QA approver should normally decide it.",
      );
    }
    await decideExtension(e.id, approve, note, viewerName);
    // The due date, the header, the audit trail and this list.
    await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
    toast.success(
      approve
        ? `Extension approved — ${d.deviation_no} is now due ${formatDay(e.to_date)}.`
        : "Extension rejected.",
    );
    setDeciding(null);
  }

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-ink">Due date extensions</h3>

      {isPending ? (
        <Loader2 className="size-4 animate-spin text-ink-5" />
      ) : extensions.length === 0 ? (
        <p className="text-sm text-ink-5">None.</p>
      ) : (
        <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-4">
              <tr>
                <th className="px-3.5 py-2 font-semibold">Requested</th>
                <th className="px-3.5 py-2 font-semibold">From → to</th>
                <th className="px-3.5 py-2 font-semibold">Reason</th>
                <th className="px-3.5 py-2 font-semibold">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft bg-surface">
              {extensions.map((e) => {
                return (
                  <ExtensionRow
                    key={e.id}
                    extension={e}
                    canDecide={canDecide && d.status === "open"}
                    deciding={deciding?.id === e.id ? deciding.approve : null}
                    onStart={(approve) => setDeciding({ id: e.id, approve })}
                    onCancel={() => setDeciding(null)}
                    onDecide={(note) => decide(e, deciding!.approve, note)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canDecide && canRequestExtension(d, extensions) && (
        <>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand print:hidden"
          >
            <CalendarClock className="size-4" />
            Request an extension
          </button>
          <ExtendDueDialog
            deviation={d}
            factoryId={factoryId}
            viewerName={viewerName}
            open={asking}
            onOpenChange={setAsking}
          />
        </>
      )}
    </section>
  );
}

function ExtensionRow({
  extension: e,
  canDecide,
  deciding,
  onStart,
  onCancel,
  onDecide,
}: {
  extension: DueExtension;
  canDecide: boolean;
  /** true approving, false rejecting, null neither. */
  deciding: boolean | null;
  onStart: (approve: boolean) => void;
  onCancel: () => void;
  onDecide: (note: string) => Promise<void>;
}) {
  return (
    <>
      <tr className="align-top">
        <td className="px-3.5 py-2.5 text-ink-3">
          {e.requested_by_name ?? "—"} · {formatDateTime(e.requested_at)}
        </td>
        <td className="whitespace-nowrap px-3.5 py-2.5 text-ink-3 tabular-nums">
          {formatDay(e.from_date)} →{" "}
          <span className="font-semibold text-ink">{formatDay(e.to_date)}</span>
        </td>
        <td className="px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere text-ink-2">{e.reason}</td>
        <td className="px-3.5 py-2.5">
          {e.status === "requested" ? (
            canDecide && deciding === null ? (
              <span className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onStart(true)}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Approve
                </button>
                <span className="mx-1.5 text-ink-5">·</span>
                <button
                  type="button"
                  onClick={() => onStart(false)}
                  className="text-xs font-semibold text-danger-deep hover:underline"
                >
                  Reject
                </button>
              </span>
            ) : (
              <span className={STATUS_TEXT.requested}>{STATUS_LABEL.requested}</span>
            )
          ) : (
            <span className="text-ink-4">
              <span className={STATUS_TEXT[e.status]}>{STATUS_LABEL[e.status]}</span> by{" "}
              {e.decided_by_name ?? "—"} · {e.decided_at ? formatDateTime(e.decided_at) : "—"}
              {e.note && (
                <span className="text-ink-3 wrap-anywhere"> — {e.note}</span>
              )}
            </span>
          )}
        </td>
      </tr>
      {deciding !== null && (
        <tr>
          <td colSpan={4} className="bg-sunken px-3.5 py-3">
            <DecisionForm
              approve={deciding}
              toDate={e.to_date}
              onCancel={onCancel}
              onDecide={onDecide}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DecisionForm({
  approve,
  toDate,
  onCancel,
  onDecide,
}: {
  approve: boolean;
  toDate: string;
  onCancel: () => void;
  onDecide: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!approve && note.trim().length < 5) {
      setError("Give the reason for rejecting the extension.");
      return;
    }
    setBusy(true);
    try {
      await onDecide(note.trim());
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <label htmlFor="ext-note" className="block text-sm font-semibold text-ink-2">
        {approve
          ? `Approve the new due date, ${formatDay(toDate)} — comment (optional)`
          : "Reject the extension — reason"}
      </label>
      <textarea
        id="ext-note"
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError(null);
        }}
        aria-invalid={Boolean(error)}
        className={AREA}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={busy} className={PRIMARY_BUTTON}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {approve ? "Approve extension" : "Reject extension"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * "Extend due date" — the new date (two weeks on, to start with) and why.
 * Mounted only while open, so each opening starts from the current due date.
 */
export function ExtendDueDialog({
  deviation: d,
  factoryId,
  viewerName,
  open,
  onOpenChange,
}: {
  deviation: Deviation;
  factoryId: string;
  viewerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>Extend due date — {d.deviation_no}</DialogTitle>
          <DialogDescription>
            A QA approver approves the new date. The old date stays in the history.
          </DialogDescription>
        </DialogHeader>
        {open && d.sla_date && (
          <ExtendForm
            deviation={d}
            currentDue={d.sla_date}
            factoryId={factoryId}
            viewerName={viewerName}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExtendForm({
  deviation: d,
  currentDue,
  factoryId,
  viewerName,
  onDone,
}: {
  deviation: Deviation;
  currentDue: string;
  factoryId: string;
  viewerName: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<DueExtensionValues>({
    resolver: zodResolver(dueExtensionSchema(currentDue)),
    defaultValues: { toDate: addDays(currentDue, 14), reason: "" },
  });
  const { control, register, formState } = form;
  const errors = formState.errors;

  async function submit(v: DueExtensionValues) {
    try {
      await requestExtension(d.id, v.toDate, v.reason, viewerName);
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(`Extension to ${formatDay(v.toDate)} requested — waiting for QA.`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="space-y-4">
      <p className="text-sm text-ink-3">
        Current due date:{" "}
        <span className="font-semibold text-ink">{formatDay(currentDue)}</span>
      </p>
      <Field label="New due date" htmlFor="ext-to" required error={errors.toDate?.message}>
        <Controller
          control={control}
          name="toDate"
          render={({ field }) => (
            <DateField
              id="ext-to"
              value={field.value}
              onChange={field.onChange}
              min={addDays(currentDue, 1)}
              ariaInvalid={Boolean(errors.toDate)}
            />
          )}
        />
      </Field>
      <Field label="Reason" htmlFor="ext-reason" required error={errors.reason?.message}>
        <textarea
          id="ext-reason"
          rows={3}
          placeholder="e.g. Waiting for supplier test results"
          className={cn(AREA)}
          {...register("reason")}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          disabled={formState.isSubmitting}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
        <button type="submit" disabled={formState.isSubmitting} className={PRIMARY_BUTTON}>
          {formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
          Request extension
        </button>
      </div>
    </form>
  );
}
