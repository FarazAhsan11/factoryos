"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Loader2,
  MessageSquare,
  Package,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";

import { ActionStageForm } from "@/components/factory/actions/action-stage-form";
import { ActionStageStepper } from "@/components/factory/actions/action-stage-stepper";
import { ActionStageTimeline } from "@/components/factory/actions/action-stage-timeline";
import { BatchSummary } from "@/components/factory/batch/batch-summary";
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
import { secondNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

const CONTROL =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12";

const STAGE_PILL: Record<string, string> = {
  open: "bg-warn-soft text-warn-deep ring-warn-line",
  investigating: "bg-brand-soft text-brand-deep ring-brand-line",
  action_taken: "bg-brand-soft text-brand-deep ring-brand-line",
  verification: "bg-teal-soft text-teal-deep ring-teal-line",
  closed: "bg-teal-soft text-teal-deep ring-teal-line",
};

type Tab = "next" | "record" | "activity";

/**
 * One issue in full.
 *
 * Three jobs happen in this box and they used to happen in one column: doing
 * the next thing, reading what the stages recorded, and following the
 * conversation. Stacked, each was a grey card of roughly equal weight, and the
 * dialog read as one long undifferentiated scroll — you could not tell at a
 * glance where the issue had got to or what you were being asked to do.
 *
 * So they are three tabs, and the frame around them never moves: the title and
 * the badges at the top, the clock in the footer. Whichever tab you are on,
 * "what is this and is it late?" is answered without scrolling — which is the
 * question that made people scroll in the first place.
 *
 * The stages and the thread stay separate for the same reason they always did.
 * Half of what happens to an issue is progress that changes nothing — "waiting
 * on the part", "retest booked Thursday" — and forcing that through a stage
 * gate would either lose it or produce a fake stage. The gates carry the
 * record; the thread carries the conversation.
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
      {/* `p-0` and a flex column so the tab panel is the only thing that
          scrolls. With the dialog's own padding the header and footer would
          scroll away with it, and the point of putting the clock down there is
          that it stays put. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* Keyed by the issue, so opening a different one remounts the body
            with fresh state — including which tab you were on. The
            alternative, an effect resetting the fields, runs a render late and
            leaks half-typed text from one issue into the next. */}
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
  const [tab, setTab] = useState<Tab>("next");
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
        assignee.trim() ? `Assigned to ${assignee.trim()}.` : "Unassigned.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closed = action.status === "closed";
  const busy = saveNote.isPending || reassign.isPending;

  return (
    <>
      {/* ── Header: what this is ─────────────────────────────────────── */}
      {/* `pr-12` keeps the title clear of the dialog's own close button. */}
      <DialogHeader className="shrink-0 gap-2 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {action.is_escalated && (
            <Badge className="bg-violet-line text-violet-deep">Escalated</Badge>
          )}
          {action.is_overdue && !action.is_escalated && (
            <Badge className="bg-danger-soft text-danger-deep">Overdue</Badge>
          )}
          {action.is_verify_overdue && (
            <Badge className="bg-warn-soft text-warn-deep">Sign-off late</Badge>
          )}
          {action.resolved_direct && (
            <Badge className="bg-sunken-2 text-ink-4">No CAPA</Badge>
          )}
          <Badge className={STAGE_PILL[action.status]}>
            {STAGE_LABELS[action.status]}
          </Badge>
        </div>

        <DialogTitle className="text-base leading-snug break-words text-ink">
          {action.title}
        </DialogTitle>
        <DialogDescription className="text-xs break-words">
          {action.unit_name ?? "Factory-wide"} · {action.category} ·{" "}
          {action.priority} priority
        </DialogDescription>
      </DialogHeader>

      {/* ── Tabs: which of the three jobs ────────────────────────────── */}
      <div className="shrink-0 px-5 pt-3">
        <div
          role="tablist"
          aria-label="Issue detail"
          className="flex gap-1 rounded-xl border border-line bg-sunken-2 p-1"
        >
          <TabButton
            active={tab === "next"}
            onClick={() => setTab("next")}
            Icon={PlayCircle}
          >
            Next step
          </TabButton>
          <TabButton
            active={tab === "record"}
            onClick={() => setTab("record")}
            Icon={ClipboardList}
          >
            Record
          </TabButton>
          <TabButton
            active={tab === "activity"}
            onClick={() => setTab("activity")}
            Icon={MessageSquare}
            count={notes.length}
          >
            Activity
          </TabButton>
        </div>
      </div>

      {/* ── The one scrolling region ─────────────────────────────────── */}
      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "next" && (
          <div className="space-y-4">
            {/* Position first, and only here: on the working tab it is the
                context for the form under it. */}
            <ActionStageStepper action={action} />
            <ActionStageForm action={action} role={role} onDone={refresh} />
          </div>
        )}

        {tab === "record" && (
          <div className="space-y-5">
            <Facts action={action} />

            {action.batch_no && (
              <section className="space-y-1.5">
                <SectionLabel>Affected batch</SectionLabel>
                {/* Read-only: the batch was settled when the issue was
                    raised — off the flagged entry, or typed by hand — and
                    re-pointing an investigation at a different run halfway
                    through is a new issue, not an edit. */}
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Package className="size-4 shrink-0 translate-y-0.5 text-ink-5" />
                  <span className="font-mono font-semibold text-ink">
                    {action.batch_no}
                  </span>
                  {action.product_name && (
                    <span className="text-ink-3">{action.product_name}</span>
                  )}
                  {action.product_code && (
                    <span className="font-mono text-xs text-ink-5">
                      {action.product_code}
                    </span>
                  )}
                </p>
                <BatchSummary factoryId={factoryId} batchNo={action.batch_no} />
              </section>
            )}

            {/* Reassignment only, and only once the investigation is under
                way. While an issue is Open, naming an owner *is* the first
                stage, and the form on the other tab collects it — two controls
                for one column would read as the app asking twice. Once closed,
                the owner is part of the record rather than a field. */}
            {!closed && action.status !== "open" && (
              <section className="space-y-1.5">
                <label
                  htmlFor="action-assignee"
                  className="block text-xs font-medium text-ink-3"
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
                    className="h-10 shrink-0 rounded-xl border border-line px-3 text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <SectionLabel>What each stage recorded</SectionLabel>
              <ActionStageTimeline
                action={action}
                role={role}
                onSaved={refresh}
              />
            </section>
          </div>
        )}

        {tab === "activity" && (
          <div className="space-y-3">
            {notesPending ? (
              <p className="py-8 text-center text-xs text-ink-5">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong bg-surface px-3.5 py-8 text-center text-xs text-ink-5">
                Nothing yet — the first update will show here.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {notes.map((entry) => (
                  <li
                    key={entry.id}
                    className={cn(
                      "rounded-xl px-3 py-2 text-[13px]",
                      entry.is_system
                        ? "bg-sunken-2 text-ink-4 italic"
                        : "border border-line bg-surface text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)]",
                    )}
                  >
                    <span className="break-words whitespace-pre-wrap">
                      {entry.note}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] not-italic text-ink-5">
                      {formatDue(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {!closed && (
              <div className="space-y-2 rounded-2xl border border-line bg-surface p-3.5">
                <label
                  htmlFor="action-note"
                  className="block text-[10px] font-bold uppercase tracking-[0.6px] text-ink-5"
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
                  className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/12"
                />
                <button
                  type="button"
                  onClick={() => saveNote.mutate()}
                  disabled={busy || !note.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-xs font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-40"
                >
                  {saveNote.isPending && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  Add note
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: the clock that is actually running ───────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
        <Clock action={action} />
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-9 shrink-0 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:opacity-60"
        >
          Close
        </button>
      </div>
    </>
  );
}

/**
 * Whichever clock is running, in one line, always on screen.
 *
 * Only ever one of them: the fix clock while the problem is live, the slower
 * sign-off clock once the fix is in, and neither once it is closed. Showing
 * the fix deadline on an issue whose fix is already in answers a question
 * nobody is asking.
 */
function Clock({ action }: { action: FactoryAction }) {
  // Read per render through the hook, so the relative times below stay as
  // current as they were before the React Compiler (see `useRenderClock`).
  const now = useRenderClock(secondNow);
  if (action.status === "closed") {
    return (
      <p className="min-w-0 truncate text-xs text-ink-4">
        {action.resolved_direct ? "Resolved" : "Closed"}
        {action.closed_at && ` ${formatDue(action.closed_at)}`}
      </p>
    );
  }

  const [label, at, late, tone] = action.verify_due_at
    ? [
        "Sign-off due",
        action.verify_due_at,
        action.is_verify_overdue,
        "var(--color-warn-deep)",
      ]
    : ["Due", action.due_at, action.is_overdue, "var(--color-danger-deep)"];

  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs text-ink-4">
      <span>{label}</span>
      <span className="font-medium text-ink">{formatDue(at as string)}</span>
      <span
        className="font-semibold"
        style={{ color: late ? (tone as string) : "var(--color-ink-4)" }}
      >
        {relativeTime(at as string, now)}
      </span>
      {/* The one number that turns "overdue" into something actionable: how
          long before this becomes a management problem. */}
      {action.is_overdue && !action.is_escalated && (
        <span className="text-warn-deep">
          · escalates {relativeTime(action.escalates_at, now)}
        </span>
      )}
    </p>
  );
}

/** The issue's fixed facts — the ones that never change after it is raised. */
function Facts({ action }: { action: FactoryAction }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface p-4 text-sm sm:grid-cols-3">
      <Fact label="Raised">{formatDue(action.created_at)}</Fact>
      <Fact label="Owner">
        {action.assigned_to ?? (
          <span className="italic text-warn-deep">Unassigned</span>
        )}
      </Fact>
      <Fact label="Source">
        {action.shift_log_entry_id ? "Shift log" : "Raised by hand"}
      </Fact>
      <Fact label="Due">{formatDue(action.due_at)}</Fact>
      {!action.resolved_direct && action.status !== "closed" && (
        <Fact label="Escalates">{formatDue(action.escalates_at)}</Fact>
      )}
      {action.verify_due_at && (
        <Fact label="Sign-off due">{formatDue(action.verify_due_at)}</Fact>
      )}
      {action.closed_at && (
        <Fact label={action.resolved_direct ? "Resolved" : "Closed"}>
          {formatDue(action.closed_at)}
        </Fact>
      )}
    </dl>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold tracking-[0.07em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold tracking-[0.07em] text-ink-4 uppercase">
      {children}
    </p>
  );
}

/** Matches the segmented control the pipeline's batch dialog already uses. */
function TabButton({
  active,
  onClick,
  Icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
          : "text-ink-4 hover:bg-surface/60 hover:text-ink",
      )}
    >
      <Icon className="size-4" />
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-bold",
            active ? "bg-brand-soft text-brand" : "bg-line text-ink-4",
          )}
        >
          {count}
        </span>
      )}
    </button>
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
        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ring-1 ring-current/15",
        className,
      )}
    >
      {children}
    </span>
  );
}
