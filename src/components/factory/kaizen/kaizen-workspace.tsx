"use client";

import { KaizenFeed } from "@/components/factory/kaizen/kaizen-feed";
import { KaizenForm } from "@/components/factory/kaizen/kaizen-form";

/**
 * Kaizen — improvement ideas from the floor, and the queue that reviews them.
 *
 * It used to be the shift log's second tab, which put it behind a screen an
 * operator opens with a half-filled entry in front of them; an idea is not
 * something you have while filing a downtime record. It is its own place now,
 * and the shift log's second tab is the Shift report instead.
 *
 * The pairing is the same one the shift log uses — what you are adding to,
 * beside what you are adding — because that is what stops a submission
 * feeling like it went nowhere.
 */
export function KaizenWorkspace({
  factoryId,
  userId,
  userName,
  canReview,
}: {
  factoryId: string;
  userId: string;
  /** The signed-in person, shown in place of a "submitted by" box. */
  userName: string;
  /** Supervisor and up — may move an idea through the review states. */
  canReview: boolean;
}) {
  return (
    /* `lg:grid-rows-1` is what makes the columns equal-height: without a
       single explicit row, each panel sizes to its own content and the taller
       one sets a page scroll again. */
    <div className="grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1 lg:items-stretch">
      <div className="min-w-0 lg:min-h-0">
        <KaizenForm factoryId={factoryId} userId={userId} userName={userName} />
      </div>

      <KaizenFeed
        factoryId={factoryId}
        userId={userId}
        canReview={canReview}
      />
    </div>
  );
}
