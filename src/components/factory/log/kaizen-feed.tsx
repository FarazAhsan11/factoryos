"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";

import { KaizenReviewDialog } from "@/components/factory/log/kaizen-review-dialog";
import {
  FILTER_LABELS,
  IMPACT_LABELS,
  KAIZEN_FILTERS,
  KAIZEN_IMPACTS,
  STATUS_META,
  fetchKaizenIdeas,
  kaizenKeys,
  matchesKaizenFilter,
  timeAgo,
  type KaizenFilter,
  type KaizenIdea,
} from "@/lib/factory/kaizen-queries";
import { cn } from "@/lib/utils";

const IMPACT_TINT = Object.fromEntries(
  KAIZEN_IMPACTS.map((i) => [i.value, i])
);

/**
 * The improvement queue, in the panel the shift-log feed occupies.
 *
 * Deliberately the same shape as `ActivityFeed` — a coloured dot, a line of
 * substance, a line of context — because it sits in the same place and is read
 * the same way. Switching tabs swaps *what* the column is a live view of, not
 * how to read one.
 *
 * Two things it does that the shift feed doesn't, both because an idea and an
 * entry are different kinds of record. It isn't scoped to today: an entry
 * stops mattering when the shift ends, an idea submitted on Tuesday is still
 * waiting on Friday. And its rows are actionable — the review happens in the
 * feed, because a queue you have to leave in order to work through is a queue
 * that doesn't get worked through.
 */
export function KaizenFeed({
  factoryId,
  userId,
  canReview,
}: {
  factoryId: string;
  userId: string;
  /** Supervisor and up — see `can_review_factory()` in migration 0019. */
  canReview: boolean;
}) {
  const [filter, setFilter] = useState<KaizenFilter>("all");
  const [selected, setSelected] = useState<KaizenIdea | null>(null);

  const {
    data: ideas = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: kaizenKeys.all(factoryId),
    queryFn: () => fetchKaizenIdeas(factoryId),
  });

  const counts = useMemo(() => {
    const map = {} as Record<KaizenFilter, number>;
    for (const key of KAIZEN_FILTERS) {
      map[key] = ideas.filter((i) => matchesKaizenFilter(i, key)).length;
    }
    return map;
  }, [ideas]);

  const visible = useMemo(
    () => ideas.filter((i) => matchesKaizenFilter(i, filter)),
    [ideas, filter]
  );

  // The dialog holds a snapshot, so it is re-read from the refetched list —
  // otherwise approving an idea leaves its own dialog showing "New".
  const selectedLive = useMemo(
    () => ideas.find((i) => i.id === selected?.id) ?? selected,
    [ideas, selected]
  );

  const waiting = counts.new + counts.under_review;

  return (
    <aside className="rounded-2xl border border-[#E6EAF1] bg-white lg:sticky lg:top-6">
      <header className="flex items-center justify-between gap-2 border-b border-[#EEF1F6] px-4 py-3.5">
        <h2 className="text-sm font-semibold text-[#0F1B34]">
          Improvement ideas
        </h2>
        {/* The number that means something: how many are waiting on a human.
            A total count of every idea ever submitted only goes up. */}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            waiting > 0
              ? "bg-[#FEF9C3] text-[#A16207]"
              : "bg-[#ECFDF5] text-[#047857]"
          )}
        >
          {waiting > 0 ? `${waiting} awaiting review` : "All reviewed"}
        </span>
      </header>

      {ideas.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-[#EEF1F6] px-4 py-2.5">
          {KAIZEN_FILTERS.filter(
            // An empty status is a chip that can only ever show "0" — kept
            // only for the filter that is currently on, so the row doesn't
            // reshuffle under the cursor when the last item leaves a state.
            (key) => key === "all" || counts[key] > 0 || filter === key
          ).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                filter === key
                  ? "border-[#0F1B34] bg-[#0F1B34] text-white"
                  : "border-[#E6EAF1] bg-white text-[#475569] hover:border-[#CBD5E1]"
              )}
            >
              {FILTER_LABELS[key]}
              <span
                className={cn(
                  "ml-1 font-bold",
                  filter === key ? "text-white/70" : "text-[#94A3B8]"
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-[#F8FAFC]"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
            Could not load ideas: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <Lightbulb className="mx-auto size-5 text-[#CBD5E1]" />
            <p className="mt-2 text-xs text-[#94A3B8]">
              {ideas.length === 0
                ? "No ideas yet — be the first."
                : `Nothing ${FILTER_LABELS[filter].toLowerCase()}.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((idea) => (
              <IdeaRow
                key={idea.id}
                idea={idea}
                onOpen={() => setSelected(idea)}
                canOpen={canReview || idea.submitted_by === userId}
              />
            ))}
          </ul>
        )}
      </div>

      <KaizenReviewDialog
        idea={selectedLive}
        factoryId={factoryId}
        userId={userId}
        canReview={canReview}
        onClose={() => setSelected(null)}
      />
    </aside>
  );
}

function IdeaRow({
  idea,
  onOpen,
  canOpen,
}: {
  idea: KaizenIdea;
  onOpen: () => void;
  /** A reviewer, or the person who submitted it. Everyone else just reads. */
  canOpen: boolean;
}) {
  const status = STATUS_META[idea.status];
  const impact = IMPACT_TINT[idea.impact];

  const body = (
    <>
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ background: status.dot }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[13px] leading-snug text-[#0F1B34]">{idea.idea}</p>

        <div className="flex flex-wrap items-center gap-1">
          <Chip tint={status.tint} ink={status.ink}>
            {status.label}
          </Chip>
          <Chip tint="#F1F5F9" ink="#475569">
            {idea.category}
          </Chip>
          {impact && (
            <Chip tint={impact.tint} ink={impact.ink}>
              {IMPACT_LABELS[idea.impact]}
            </Chip>
          )}
        </div>

        <p className="text-[11px] text-[#94A3B8]">
          {idea.submitted_by_name ?? "Unknown"} · {timeAgo(idea.created_at)}
          {idea.reviewed_by_name && ` · reviewed by ${idea.reviewed_by_name}`}
        </p>

        {/* The decision, next to the idea it was made about. A reason that
            lives only inside a dialog is a reason the person who submitted it
            never reads. */}
        {idea.review_note && (
          <p className="whitespace-pre-line text-[11px] italic text-[#64748B]">
            ↳ {idea.review_note}
          </p>
        )}
      </div>
    </>
  );

  if (!canOpen) {
    return <li className="flex gap-2.5">{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] gap-2.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-[#F8FAFC] focus-visible:bg-[#F8FAFC] focus-visible:outline-none"
      >
        {body}
      </button>
    </li>
  );
}

function Chip({
  tint,
  ink,
  children,
}: {
  tint: string;
  ink: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold"
      style={{ background: tint, color: ink }}
    >
      {children}
    </span>
  );
}
