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
    <aside className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="grid size-7 place-items-center rounded-lg bg-warn-soft text-warn-deep">
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
              ? "bg-warn-soft text-warn-deep ring-1 ring-warn-line"
              : "bg-teal-soft text-teal-deep ring-1 ring-teal-line/70",
          )}
        >
          {waiting > 0 ? `${waiting} awaiting review` : "All reviewed"}
        </span>
      </header>

      {ideas.length > 0 && (
        <div className="scrollbar-slim flex shrink-0 gap-1 overflow-x-auto border-b border-line-soft bg-sunken px-4 py-2.5">
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
                  ? "border-brand bg-brand text-white shadow-brand-sm"
                  : "border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
              )}
            >
              {FILTER_LABELS[key]}
              <span
                className={cn(
                  "ml-1 font-bold",
                  filter === key ? "text-white/70" : "text-ink-5",
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
                className="h-20 animate-pulse rounded-xl bg-sunken"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2.5 text-xs font-medium text-danger-deep">
            Could not load ideas: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-warn-soft text-warn-deep">
              <Lightbulb className="size-5" />
            </span>
            <p className="mt-2.5 text-xs text-ink-5">
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
          className="line-clamp-4 text-[13px] leading-snug break-words text-ink"
        >
          {idea.idea}
        </p>

        <div className="flex flex-wrap items-center gap-1">
          <Chip tint={status.tint} ink={status.ink}>
            {status.label}
          </Chip>
          <Chip tint="var(--color-sunken-2)" ink="var(--color-ink-3)">
            {idea.category}
          </Chip>
          {impact && (
            <Chip tint={impact.tint} ink={impact.ink}>
              {IMPACT_LABELS[idea.impact]}
            </Chip>
          )}
        </div>

        <p className="text-[11px] break-words text-ink-5">
          {idea.submitted_by_name ?? "Unknown"} · {timeAgo(idea.created_at)}
          {idea.reviewed_by_name && ` · reviewed by ${idea.reviewed_by_name}`}
        </p>

        {/* The decision, next to the idea it was made about. A reason that
            lives only inside a dialog is a reason the person who submitted it
            never reads. */}
        {idea.review_note && (
          <p className="line-clamp-3 text-[11px] break-words whitespace-pre-line italic text-ink-4">
            ↳ {idea.review_note}
          </p>
        )}
      </div>
    </>
  );

  const CARD =
    "relative flex overflow-hidden rounded-xl border border-line-soft bg-surface py-2.5 pr-3 pl-4";

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
          "w-full text-left transition hover:border-line-strong hover:shadow-lift focus-visible:border-brand focus-visible:outline-none",
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
