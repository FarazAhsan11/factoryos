"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  actionKeys,
  addActionNote,
  assignAction,
  fetchActionNotes,
  formatDue,
  relativeTime,
  updateActionStatus,
  type ActionStatus,
  type FactoryAction,
} from "@/lib/factory/action-queries";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white";

/**
 * One action in full: its facts, its thread, and the two buttons that move it.
 *
 * Adding a note and changing the status are deliberately separate. Half of
 * what happens to an action is progress that changes nothing — "waiting on the
 * part", "retest booked for Thursday" — and forcing that through a status
 * change would either lose it or produce a fake status. The prototype got this
 * right and it is worth keeping.
 */
export function ActionDetailDialog({
  action,
  factoryId,
  userId,
  onClose,
}: {
  action: FactoryAction | null;
  factoryId: string;
  userId: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        {/* Keyed by the action, so opening a different one remounts the body
            with fresh state. The alternative — an effect resetting the note
            and assignee fields — runs a render late and leaks half-typed text
            from one action into the next. */}
        {action && (
          <Body
            key={action.id}
            action={action}
            factoryId={factoryId}
            userId={userId}
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
  onClose,
}: {
  action: FactoryAction;
  factoryId: string;
  userId: string;
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

  const setStatus = useMutation({
    mutationFn: async (status: ActionStatus) => {
      // A note typed before pressing Resolve is part of that update, not
      // something to discard — save it first so the thread reads in order.
      if (note.trim()) {
        await addActionNote(factoryId, action.id, note, userId);
      }
      await updateActionStatus(action.id, status);
    },
    onSuccess: async () => {
      setNote("");
      await refresh();
      toast.success("Action updated.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassign = useMutation({
    mutationFn: () => assignAction(action.id, assignee),
    onSuccess: async () => {
      await refresh();
      toast.success(
        assignee.trim() ? `Assigned to ${assignee.trim()}.` : "Unassigned.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = saveNote.isPending || setStatus.isPending || reassign.isPending;
  const resolved = action.status === "resolved";

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
        <Badge
          className={cn(
            resolved
              ? "bg-[#DCFCE7] text-[#15803D]"
              : action.status === "in_progress"
                ? "bg-[#DBEAFE] text-[#1D4ED8]"
                : "bg-[#FEF3C7] text-[#B45309]",
          )}
        >
          {resolved
            ? "Resolved"
            : action.status === "in_progress"
              ? "In progress"
              : "Open"}
        </Badge>
      </div>

      <dl className="space-y-1.5 rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] p-3.5 text-sm">
        <Row label="Due">
          {formatDue(action.due_at)}
          {!resolved && (
            <span
              className={cn(
                "ml-1.5 text-xs font-semibold",
                action.is_overdue ? "text-[#B91C1C]" : "text-[#64748B]",
              )}
            >
              {relativeTime(action.due_at)}
            </span>
          )}
        </Row>
        {!resolved && !action.is_escalated && (
          <Row label="Escalates">
            {formatDue(action.escalates_at)}
            <span className="ml-1.5 text-xs text-[#64748B]">
              {relativeTime(action.escalates_at)}
            </span>
          </Row>
        )}
        {action.resolved_at && (
          <Row label="Resolved">{formatDue(action.resolved_at)}</Row>
        )}
      </dl>

      {action.notes && (
        <p className="rounded-xl bg-[#F8FAFC] px-3.5 py-3 text-[13px] text-[#334155]">
          {action.notes}
        </p>
      )}

      {/* Assignment lives in the body, not a separate screen: the most
                common thing to do with an unassigned action is give it to
                someone, and that shouldn't need a second dialog. */}
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
                    : "border border-[#E6EAF1] text-[#0F1B34]",
                )}
              >
                {entry.note}
                <span className="mt-0.5 block text-[10.5px] not-italic text-[#94A3B8]">
                  {formatDue(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!resolved && (
        <div className="space-y-2 rounded-xl bg-[#F8FAFC] p-3">
          <label
            htmlFor="action-note"
            className="block text-[10px] font-bold uppercase tracking-[0.6px] text-[#94A3B8]"
          >
            Add note{" "}
            <span className="font-normal normal-case">
              (without changing status)
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
            {saveNote.isPending && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            Add note
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-10 flex-1 rounded-xl border border-[#E6EAF1] text-sm font-medium text-[#475569] transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-60"
        >
          Close
        </button>

        {resolved ? (
          <button
            type="button"
            onClick={() => setStatus.mutate("open")}
            disabled={busy}
            className="h-10 rounded-xl border border-[#E6EAF1] px-4 text-sm font-medium text-[#475569] transition hover:border-[#B45309] hover:text-[#B45309] disabled:opacity-60"
          >
            Re-open
          </button>
        ) : (
          <>
            {action.status !== "in_progress" && (
              <button
                type="button"
                onClick={() => setStatus.mutate("in_progress")}
                disabled={busy}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,#3B82F6_0%,#2563EB_100%)] px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:opacity-60"
              >
                <Play className="size-3.5" />
                In progress
              </button>
            )}
            <button
              type="button"
              onClick={() => setStatus.mutate("resolved")}
              disabled={busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#16A34A] px-4 text-sm font-semibold text-white transition hover:brightness-[1.06] disabled:opacity-60"
            >
              {setStatus.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Resolve
            </button>
          </>
        )}
      </div>
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
        className,
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
