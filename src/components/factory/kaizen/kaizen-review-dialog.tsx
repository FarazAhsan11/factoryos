"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, ThumbsDown, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IMPACT_LABELS,
  STATUS_META,
  deleteKaizenIdea,
  kaizenKeys,
  reviewKaizenIdea,
  timeAgo,
  type KaizenIdea,
  type KaizenStatus,
} from "@/lib/factory/kaizen-queries";
import { secondNow, useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * One idea, and what can be done about it.
 *
 * The review is a single forward button rather than a dropdown of five
 * states, four of which are backwards: from New the only sensible move is to
 * start reviewing it, from Under review to approve it. Declining is the one
 * branch, so it gets its own button — and a required reason, because "no" with
 * no explanation is the fastest way to ensure nobody submits a second idea.
 */
export function KaizenReviewDialog({
  idea,
  factoryId,
  userId,
  canReview,
  onClose,
}: {
  idea: KaizenIdea | null;
  factoryId: string;
  userId: string;
  canReview: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={idea !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        {/* Keyed by the idea so opening a different one remounts with fresh
            state, rather than leaking a half-typed note into the next. */}
        {idea && (
          <Body
            key={idea.id}
            idea={idea}
            factoryId={factoryId}
            userId={userId}
            canReview={canReview}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  idea,
  factoryId,
  userId,
  canReview,
  onClose,
}: {
  idea: KaizenIdea;
  factoryId: string;
  userId: string;
  canReview: boolean;
  onClose: () => void;
}) {
  // Read per render through the hook, so the relative times below stay as
  // current as they were before the React Compiler (see `useRenderClock`).
  const now = useRenderClock(secondNow);
  const queryClient = useQueryClient();
  const [note, setNote] = useState(idea.review_note ?? "");
  const [declining, setDeclining] = useState(false);

  const status = STATUS_META[idea.status];
  const isAuthor = idea.submitted_by === userId;
  // The author may withdraw their own idea, but only while nobody has looked
  // at it — matching the delete policy in migration 0019, so the button is
  // never offered for something the database would refuse.
  const canWithdraw = isAuthor && idea.status === "new";

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: kaizenKeys.all(factoryId) });

  const move = useMutation({
    mutationFn: (next: KaizenStatus) => reviewKaizenIdea(idea.id, next, note),
    onSuccess: async (_data, next) => {
      await refresh();
      toast.success(`Idea marked ${STATUS_META[next].label.toLowerCase()}.`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const withdraw = useMutation({
    mutationFn: () => deleteKaizenIdea(idea.id),
    onSuccess: async () => {
      await refresh();
      toast.success("Idea withdrawn.");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = move.isPending || withdraw.isPending;

  function decline() {
    if (!note.trim()) {
      setDeclining(true);
      toast.error(
        "Give a reason — it's the part that keeps people suggesting.",
      );
      return;
    }
    move.mutate("declined");
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-ink">Improvement idea</DialogTitle>
        <DialogDescription className="break-words">
          {idea.submitted_by_name ?? "Unknown"} · {timeAgo(idea.created_at, now)} ·{" "}
          {idea.category} · {IMPACT_LABELS[idea.impact]}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ background: status.tint, color: status.ink }}
        >
          {status.label}
        </span>
        {idea.reviewed_by_name && idea.reviewed_at && (
          <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-[10px] font-semibold text-ink-3">
            {idea.reviewed_by_name} · {timeAgo(idea.reviewed_at, now)}
          </span>
        )}
      </div>

      <p className="max-h-64 overflow-y-auto rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed break-words whitespace-pre-line text-ink scrollbar-slim">
        {idea.idea}
      </p>

      {canReview ? (
        <div className="space-y-2">
          <label
            htmlFor="k-review-note"
            className="block text-[10px] font-bold uppercase tracking-[0.6px] text-ink-5"
          >
            Reviewer&rsquo;s note{" "}
            <span className="font-normal normal-case tracking-normal text-ink-4">
              {declining
                ? "— required to decline"
                : "— optional, and read by whoever suggested it"}
            </span>
          </label>
          <textarea
            id="k-review-note"
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim()) setDeclining(false);
            }}
            placeholder="What happens next, or why this one can't work…"
            className={cn(
              "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand",
              declining ? "border-danger-line" : "border-line",
            )}
          />
        </div>
      ) : (
        idea.review_note && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-ink-5">
              Reviewer&rsquo;s note
            </p>
            <p className="rounded-xl bg-surface px-3.5 py-2.5 text-[13px] break-words whitespace-pre-line text-ink-3">
              {idea.review_note}
            </p>
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="h-10 flex-1 rounded-xl border border-line text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand disabled:opacity-60"
        >
          Close
        </button>

        {canWithdraw && (
          <button
            type="button"
            onClick={() => withdraw.mutate()}
            disabled={busy}
            title="Remove your own idea — only possible before anyone has reviewed it"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink-5 transition hover:border-danger-deep hover:text-danger-deep disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
            Withdraw
          </button>
        )}

        {canReview && idea.status !== "declined" && (
          <button
            type="button"
            onClick={decline}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink-3 transition hover:border-danger-deep hover:text-danger-deep disabled:opacity-60"
          >
            <ThumbsDown className="size-3.5" />
            Decline
          </button>
        )}

        {canReview && status.next && (
          <button
            type="button"
            onClick={() => move.mutate(status.next!)}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:opacity-60"
          >
            {move.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
            {status.nextLabel}
          </button>
        )}

        {/* A declined idea isn't dead — the constraint that killed it may have
            gone. Reopening puts it back at the front of the queue rather than
            requiring someone to type it out again. */}
        {canReview && idea.status === "declined" && (
          <button
            type="button"
            onClick={() => move.mutate("under_review")}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-4 text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand disabled:opacity-60"
          >
            Reopen
          </button>
        )}
      </div>
    </>
  );
}
