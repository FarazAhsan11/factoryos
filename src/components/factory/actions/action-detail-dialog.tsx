"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ActionStageForm } from "@/components/factory/actions/action-stage-form";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
import { ActionStageTimeline } from "@/components/factory/actions/action-stage-timeline";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FactoryRole } from "@/lib/factory/context";
import {
  STAGE_LABELS,
  actionKeys,
  addActionNote,
  assignAction,
  fetchActionNotes,
  formatDue,
  relativeTime,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white";

const STAGE_PILL: Record<string, string> = {
  open: "bg-[#FEF3C7] text-[#B45309]",
  investigating: "bg-[#DBEAFE] text-[#1D4ED8]",
  action_taken: "bg-[#E0E7FF] text-[#4338CA]",
  closed: "bg-[#DCFCE7] text-[#15803D]",
};

/**
 * One issue in full: where it has got to, what each stage produced, and the
 * single move it can make next.
 *
 * The thread and the stages are deliberately separate. Half of what happens to
 * an issue is progress that changes nothing — "waiting on the part", "retest
 * booked for Thursday" — and forcing that through a stage gate would either
 * lose it or produce a fake stage. The gates carry the record; the thread
 * carries the conversation.
 */
export function ActionDetailDialog({
  action,
  factoryId,
  userId,
  role,
  onClose,
}: {
  action: FactoryAction | null;
  factoryId: string;
  userId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        {/* Keyed by the issue, so opening a different one remounts the body
            with fresh state. The alternative — an effect resetting the note
            and assignee fields — runs a render late and leaks half-typed text
            from one issue into the next. */}
        {action && (
          <Body
            key={action.id}
            action={action}
            factoryId={factoryId}
            userId={userId}
            role={role}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  action,
  factoryId,
  userId,
  role,
  onClose,
}: {
  action: FactoryAction;
  factoryId: string;
  userId: string;
  role: FactoryRole;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(action.assigned_to ?? "");

  const { data: notes = [], isPending: notesPending } = useQuery({
    queryKey: actionKeys.notes(action.id),
    queryFn: () => fetchActionNotes(action.id),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: actionKeys.all(factoryId) }),
      queryClient.invalidateQueries({ queryKey: actionKeys.notes(action.id) }),
    ]);
  }

  const saveNote = useMutation({
    mutationFn: () => addActionNote(factoryId, action.id, note, userId),
    onSuccess: async () => {
      setNote("");
      await refresh();
      toast.success("Note added.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassign = useMutation({
    mutationFn: () => assignAction(action.id, assignee),
    onSuccess: async () => {
      await refresh();
      toast.success(
        assignee.trim() ? `Assigned to ${assignee.trim()}.` : "Unassigned."
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closed = action.status === "closed";
  const busy = saveNote.isPending || reassign.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[#0F1B34]">{action.title}</DialogTitle>
        <DialogDescription>
          {action.unit_name ?? "Factory-wide"} · {action.category} ·{" "}
          {action.priority} priority
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-1.5">
        {action.is_escalated && (
          <Badge className="bg-[#EDE9FE] text-[#6D28D9]">Escalated</Badge>
        )}
        {action.is_overdue && !action.is_escalated && (
          <Badge className="bg-[#FEE2E2] text-[#B91C1C]">Overdue</Badge>
        )}
        {action.is_verify_overdue && (
          <Badge className="bg-[#FEF3C7] text-[#B45309]">Sign-off late</Badge>
        )}
        <Badge className={STAGE_PILL[action.status]}>
          {STAGE_LABELS[action.status]}
        </Badge>
      </div>

      {/* Which clock is running depends on the stage: the fix clock while the
          problem is live, the slower sign-off clock once the fix is in. Only
          one of them is ever the answer to "is this late?" */}
      <dl className="space-y-1.5 rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] p-3.5 text-sm">
        {!closed && action.status !== "action_taken" && (
          <>
            <Row label="Due">
              {formatDue(action.due_at)}
              <span
                className={cn(
                  "ml-1.5 text-xs font-semibold",
                  action.is_overdue ? "text-[#B91C1C]" : "text-[#64748B]"
                )}
              >
                {relativeTime(action.due_at)}
              </span>
            </Row>
            {!action.is_escalated && (
              <Row label="Escalates">
                {formatDue(action.escalates_at)}
                <span className="ml-1.5 text-xs text-[#64748B]">
                  {relativeTime(action.escalates_at)}
                </span>
              </Row>
            )}
          </>
        )}

        {action.verify_due_at && (
          <Row label="Sign-off due">
            {formatDue(action.verify_due_at)}
            <span
              className={cn(
                "ml-1.5 text-xs font-semibold",
                action.is_verify_overdue ? "text-[#B45309]" : "text-[#64748B]"
              )}
            >
              {relativeTime(action.verify_due_at)}
            </span>
          </Row>
        )}

        {action.closed_at && (
          <Row label="Closed">{formatDue(action.closed_at)}</Row>
        )}
      </dl>

      {/* Read-only here. The batch is a fact about the issue that was settled
          when it was raised — from the flagged entry, or typed by hand — and
          re-pointing an investigation at a different run halfway through is a
          new issue, not an edit. */}
      {action.batch_no && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
            Affected batch
          </p>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono font-semibold text-[#0F1B34]">
              {action.batch_no}
            </span>
            {action.product_name && (
              <span className="text-[#475569]">{action.product_name}</span>
            )}
            {action.product_code && (
              <span className="font-mono text-xs text-[#94A3B8]">
                {action.product_code}
              </span>
            )}
          </p>
          <BatchSummary factoryId={factoryId} batchNo={action.batch_no} />
        </div>
      )}

      {/* Reassignment only, and only once the investigation is under way.
          While an issue is still Open, naming an owner *is* the first stage —
          the start-investigation form below collects it. Showing this box
          there too put two controls for one column in one dialog, which read
          as the app asking the same question twice. Once closed, the owner is
          part of the record rather than a field. */}
      {!closed && action.status !== "open" && (
        <div className="space-y-1.5">
          <label
            htmlFor="action-assignee"
            className="block text-xs font-medium text-[#475569]"
          >
            Assigned to
          </label>
          <div className="flex gap-2">
            <input
              id="action-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Name — or leave blank to unassign"
              className={CONTROL}
            />
            <button
              type="button"
              onClick={() => reassign.mutate()}
              disabled={busy || assignee === (action.assigned_to ?? "")}
              className="h-10 shrink-0 rounded-xl border border-[#E6EAF1] px-3 text-sm font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
          Progress
        </p>
        <ActionStageTimeline action={action} role={role} onSaved={refresh} />
      </div>

      <ActionStageForm action={action} role={role} onDone={refresh} />

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]">
          Activity &amp; notes {notes.length > 0 && `(${notes.length})`}
        </p>

        {notesPending ? (
          <p className="py-4 text-center text-xs text-[#94A3B8]">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#CBD5E1] px-3.5 py-5 text-center text-xs text-[#94A3B8]">
            Nothing yet — the first update will show here.
          </p>
        ) : (
          <ul className="max-h-48 space-y-1.5 overflow-y-auto">
            {notes.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "rounded-xl px-3 py-2 text-[13px]",
                  entry.is_system
                    ? "bg-[#F8FAFC] text-[#64748B] italic"
                    : "border border-[#E6EAF1] text-[#0F1B34]"
                )}
              >
                <span className="whitespace-pre-wrap">{entry.note}</span>
                <span className="mt-0.5 block text-[10.5px] not-italic text-[#94A3B8]">
                  {formatDue(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!closed && (
        <div className="space-y-2 rounded-xl bg-[#F8FAFC] p-3">
          <label
            htmlFor="action-note"
            className="block text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]"
          >
            Add note{" "}
            <span className="font-normal normal-case">
              (without changing stage)
            </span>
          </label>
          <textarea
            id="action-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Update, progress, next steps…"
            className="w-full rounded-xl border border-[#E6EAF1] bg-white px-3.5 py-2.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB]"
          />
          <button
            type="button"
            onClick={() => saveNote.mutate()}
            disabled={busy || !note.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6EAF1] bg-white px-3 text-xs font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:pointer-events-none disabled:opacity-40"
          >
            {saveNote.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Add note
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="h-10 w-full rounded-xl border border-[#E6EAF1] text-sm font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-60"
      >
        Close
      </button>
    </>
  );
}

function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        className
      )}
    >
      {children}
    </span>
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
      <dt className="text-xs text-[#64748B]">{label}</dt>
      <dd className="text-right text-[13px] text-[#0F1B34]">{children}</dd>
    </div>
  );
}
