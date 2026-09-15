"use client";

import { useMemo, useState } from "react";
import { CalendarClock, LayoutList, Rows3 } from "lucide-react";

import { ScheduleBoard } from "@/components/factory/pipeline/schedule/schedule-board";
import { ScheduleQueue } from "@/components/factory/pipeline/schedule/schedule-queue";
import { StageEditDialog } from "@/components/factory/pipeline/schedule/stage-edit-dialog";
import type { BatchStage } from "@/lib/factory/batch-stage-queries";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import {
  buildRoomLanes,
  stagesWithoutRoom,
  type ScheduledStage,
} from "@/lib/factory/schedule";
import { cn } from "@/lib/utils";

const VIEWS = [
  {
    value: "board",
    label: "Board",
    icon: Rows3,
    hint: "Board view — three stages ahead per room at a glance",
  },
  {
    value: "queue",
    label: "Queue",
    icon: LayoutList,
    hint: "Queue view — every stage, with dates, estimates and comments",
  },
] as const;

type ViewKey = (typeof VIEWS)[number]["value"];

/**
 * Pipeline → Schedule. The plan read by room instead of by batch.
 *
 * Two views over one derivation. The **Board** is the glance — which rooms are
 * busy, what is on them now, what comes next — and the **Queue** is the work
 * surface, where a planner sets the estimated finish and leaves the note that
 * says why a line sits where it does.
 *
 * Both read `buildRoomLanes`, so they cannot disagree about which rooms are
 * busy or what order a room's stages are in. Both open the same
 * `StageEditDialog`, so a stage edited from the glance is edited exactly as it
 * is from the list.
 *
 * No extra request: the stages and jobs are the ones the workspace already
 * holds for the Kanban board.
 */
export function ScheduleView({
  stages,
  jobs,
  factoryId,
  unitWord,
  canManage,
  showWorkOrder = false,
  onRefresh,
}: {
  stages: BatchStage[];
  jobs: PipelineJob[];
  factoryId: string;
  unitWord: string;
  canManage: boolean;
  /** Admin → Company tracks a work order per stage (0043). */
  showWorkOrder?: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const [view, setView] = useState<ViewKey>("board");
  const [editing, setEditing] = useState<ScheduledStage | null>(null);
  /**
   * The room the Queue should open on, set by a "+N more" on the Board.
   *
   * The Board draws three stages and a room can hold ten; rather than growing
   * a fourth and fifth column nobody can read across, the overflow hands the
   * room to the view that lists all of it, at the row it was asked about.
   */
  const [focusRoom, setFocusRoom] = useState<string | null>(null);

  const lanes = useMemo(() => buildRoomLanes(stages, jobs), [stages, jobs]);
  const roomless = useMemo(() => stagesWithoutRoom(stages), [stages]);
  const hint = VIEWS.find((v) => v.value === view)?.hint;

  /**
   * The open dialog re-read from the current stage list.
   *
   * `editing` is a snapshot from the moment the card was clicked; after a save
   * the query refetches and that snapshot is stale — the dialog would still be
   * showing the old date under a toast saying it was updated.
   */
  const editingStage = useMemo(
    () =>
      editing ? (stages.find((s) => s.id === editing.stage.id) ?? null) : null,
    [editing, stages],
  );

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page —
       the same contract the Kanban board has with <main> in FactoryShell.
       Without it the room list pushes the whole page down and the tab strip
       scrolls off the top, which is exactly the thing a planner needs to stay
       put while they work down a room. */
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex shrink-0 gap-1.5">
          {VIEWS.map((option) => {
            const on = view === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setView(option.value);
                  // The highlight belongs to the jump that caused it. Left
                  // set, the ring would still be on that room the next time
                  // anyone opened the Queue by hand.
                  setFocusRoom(null);
                }}
                aria-pressed={on}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                  on
                    ? "border-brand bg-brand text-white shadow-brand-sm"
                    : "border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-5">{hint}</p>
      </div>

      {/* Stages nobody has roomed cannot be drawn in a room, so they are
          absent from both views. Said out loud: a board that silently omits
          them under-reports the plant's load, and these are exactly the rows
          a planner has to fix. */}
      {roomless.length > 0 && (
        <p className="shrink-0 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
          <strong className="font-semibold">
            {roomless.length} stage{roomless.length === 1 ? "" : "s"} not shown
          </strong>{" "}
          — no {unitWord.toLowerCase()} assigned, so there is no lane to draw
          them in. Open the batch on the Kanban board and set one, and they
          appear here.
        </p>
      )}

      {lanes.length === 0 ? (
        <div className="shrink-0 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-16 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
            <CalendarClock className="size-6" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink-3">
            Nothing scheduled in any {unitWord.toLowerCase()}.
          </p>
          <p className="mt-1 text-xs text-ink-5">
            A {unitWord.toLowerCase()} appears here once a batch has a stage
            planned in it that has not been signed off.
          </p>
        </div>
      ) : (
        /* The rooms scroll, the toggle above them does not. A plant with
           twenty busy rooms is the ordinary case, and a planner comparing
           Room 4 with Room 22 should not lose the view switch on the way
           down. `min-h-0` is what lets a flex child scroll at all. */
        <div className="scrollbar-slim min-h-0 flex-1 overflow-auto pr-0.5 pb-1">
          {view === "board" ? (
            <ScheduleBoard
              lanes={lanes}
              onOpen={setEditing}
              onShowAll={(unitId) => {
                setFocusRoom(unitId);
                setView("queue");
              }}
            />
          ) : (
            <ScheduleQueue
              lanes={lanes}
              canManage={canManage}
              focusRoom={focusRoom}
              onOpen={setEditing}
              onSaved={onRefresh}
            />
          )}
        </div>
      )}

      <StageEditDialog
        stage={editingStage}
        job={editing?.job}
        factoryId={factoryId}
        canManage={canManage}
        showWorkOrder={showWorkOrder}
        onSaved={onRefresh}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
