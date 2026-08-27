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

const IMPACT_TINT = Object.fromEntries(KAIZEN_IMPACTS.map((i) => [i.value, i]));

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
    [ideas, filter],
  );

  // The dialog holds a snapshot, so it is re-read from the refetched list —
  // otherwise approving an idea leaves its own dialog showing "New".
  const selectedLive = useMemo(
    () => ideas.find((i) => i.id === selected?.id) ?? selected,
    [ideas, selected],
  );

  const waiting = counts.new + counts.under_review;

  return (
    /* Same shell as the shift feed, deliberately — it sits in the same place
       and is read the same way, so it scrolls the same way too. */
    <aside className="flex flex-col overflow-hidden rounded-2xl border border-[#E6EAF1] bg-white shadow-[0_1px_2px_rgba(15,27,52,0.04),0_12px_32px_-24px_rgba(15,27,52,0.5)] lg:h-full">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EEF1F6] px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#0F1B34]">
          <span className="grid size-7 place-items-center rounded-lg bg-[#FEF9C3] text-[#CA8A04]">
            <Lightbulb className="size-4" />
          </span>
          Improvement ideas
        </h2>
        {/* The number that means something: how many are waiting on a human.
            A total count of every idea ever submitted only goes up. */}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            waiting > 0
              ? "bg-[#FEF9C3] text-[#A16207] ring-1 ring-[#FDE68A]"
              : "bg-[#ECFDF5] text-[#047857] ring-1 ring-[#A7F3D0]/70",
          )}
        >
          {waiting > 0 ? `${waiting} awaiting review` : "All reviewed"}
        </span>
      </header>

      {ideas.length > 0 && (
        <div className="scrollbar-slim flex shrink-0 gap-1 overflow-x-auto border-b border-[#EEF1F6] bg-[#FBFCFE] px-4 py-2.5">
          {KAIZEN_FILTERS.filter(
            // An empty status is a chip that can only ever show "0" — kept
            // only for the filter that is currently on, so the row doesn't
            // reshuffle under the cursor when the last item leaves a state.
            (key) => key === "all" || counts[key] > 0 || filter === key,
          ).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                filter === key
                  ? "border-[#2563EB] bg-[#2563EB] text-white shadow-[0_4px_12px_-6px_rgba(37,99,235,0.9)]"
                  : "border-[#E2E8F0] bg-white text-[#475569] hover:border-[#CBD5E1] hover:text-[#0F1B34]",
              )}
            >
              {FILTER_LABELS[key]}
              <span
                className={cn(
                  "ml-1 font-bold",
                  filter === key ? "text-white/70" : "text-[#94A3B8]",
                )}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3.5 py-3 max-lg:max-h-[32rem]">
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl bg-[#F4F7FB]"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-xs font-medium text-[#B91C1C]">
            Could not load ideas: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-[#FEF9C3] text-[#CA8A04]">
              <Lightbulb className="size-5" />
            </span>
            <p className="mt-2.5 text-xs text-[#94A3B8]">
              {ideas.length === 0
                ? "No ideas yet — be the first."
                : `Nothing ${FILTER_LABELS[filter].toLowerCase()}.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
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
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: status.dot }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          title={idea.idea}
          className="line-clamp-4 text-[13px] leading-snug break-words text-[#0F1B34]"
        >
          {idea.idea}
        </p>

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

        <p className="text-[11px] break-words text-[#94A3B8]">
          {idea.submitted_by_name ?? "Unknown"} · {timeAgo(idea.created_at)}
          {idea.reviewed_by_name && ` · reviewed by ${idea.reviewed_by_name}`}
        </p>

        {/* The decision, next to the idea it was made about. A reason that
            lives only inside a dialog is a reason the person who submitted it
            never reads. */}
        {idea.review_note && (
          <p className="line-clamp-3 text-[11px] break-words whitespace-pre-line italic text-[#64748B]">
            ↳ {idea.review_note}
          </p>
        )}
      </div>
    </>
  );

  const CARD =
    "relative flex overflow-hidden rounded-xl border border-[#EDF1F7] bg-white py-2.5 pr-3 pl-4";

  if (!canOpen) {
    return <li className={CARD}>{body}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          CARD,
          "w-full text-left transition hover:border-[#DBE3EF] hover:shadow-[0_6px_18px_-12px_rgba(15,27,52,0.55)] focus-visible:border-[#2563EB] focus-visible:outline-none",
        )}
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
      className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold"
      style={{ background: tint, color: ink }}
    >
      {children}
    </span>
  );
}
