"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LayoutList, Rows3 } from "lucide-react";
import { toast } from "sonner";

import { ScheduleBoard } from "@/components/factory/pipeline/schedule/schedule-board";
import { ScheduleCalendar } from "@/components/factory/pipeline/schedule/schedule-calendar";
import { ScheduleQueue } from "@/components/factory/pipeline/schedule/schedule-queue";
import { StageEditDialog } from "@/components/factory/pipeline/schedule/stage-edit-dialog";
import {
  batchStageKeys,
  stageName,
  updateBatchStage,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { addDays, formatDay } from "@/lib/factory/dates";
import type { PipelineJob } from "@/lib/factory/pipeline-queries";
import {
  fetchHolidays,
  fetchWeeklyOff,
  holidayKeys,
  weeklyOffKeys,
} from "@/lib/factory/holiday-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import {
  buildRoomLanes,
  dayDiff,
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
 * Pipeline → Room schedule and Pipeline → Gantt timeline. The plan read by
 * room instead of by batch.
 *
 * Three views over one derivation. On the Room schedule, the **Board** is the
 * glance — what each room is on now and the two stages after it — and the
 * **Queue** is the work surface, where a planner sets the estimated finish and
 * leaves the note that says why a line sits where it does. The **Gantt
 * timeline** is its own screen: every room across 2, 4 or 8 weeks, with
 * clashes marked and stages moved by dragging.
 *
 * All three read `buildRoomLanes` — every room the factory has, idle ones
 * included — so they cannot disagree about which rooms are busy or what order
 * a room's stages are in. All open the same `StageEditDialog`, so a stage
 * edited from the glance is edited exactly as it is from the list.
 *
 * No extra request: the stages and jobs are the ones the workspace already
 * holds for the Kanban board.
 */
export function ScheduleView({
  screen,
  stages,
  jobs,
  factoryId,
  unitWord,
  canManage,
  showWorkOrder = false,
  onRefresh,
}: {
  /** Which rail screen this is — the Room schedule or the Gantt timeline. */
  screen: "schedule" | "gantt";
  stages: BatchStage[];
  jobs: PipelineJob[];
  factoryId: string;
  unitWord: string;
  canManage: boolean;
  /** Admin → Company tracks a work order per stage (0043). */
  showWorkOrder?: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  /**
   * A room handed over from the Gantt timeline (`?room=`): a "+N more" on a
   * day stacked past three, or a room's undated stages, which have no day to
   * be drawn on. Read once, on mount — the workspace keys this view by
   * screen, so arriving from the Gantt is always a fresh mount.
   */
  const handedRoom = useSearchParams().get("room");
  const [view, setView] = useState<ViewKey>(handedRoom ? "queue" : "board");
  const [editing, setEditing] = useState<ScheduledStage | null>(null);
  /**
   * The room the Queue should open on — from the Gantt, or from a "+N more"
   * on the Board, which draws three stages of a room that can hold ten. Either
   * way the room goes to the view that lists all of it, at the row it was
   * asked about.
   */
  const [focusRoom, setFocusRoom] = useState<string | null>(handedRoom);

  /**
   * The Gantt's way into a whole room: the Room schedule's Queue, focused on
   * it. A URL rewrite, as the rail does — the page reads its screen from
   * `?tab=`, so nothing is torn down or refetched.
   */
  function showInQueue(unitId: string) {
    window.history.pushState(
      null,
      "",
      `?tab=schedule&room=${encodeURIComponent(unitId)}`,
    );
  }

  // Same key as the stage dialog and the rest of the app, so the list is
  // normally already cached. Every room is a lane, busy or idle.
  const { data: rooms = [] } = useQuery({
    queryKey: setupKeys.all("factory_units", factoryId),
    queryFn: () => fetchSetupItems("factory_units", factoryId),
  });

  const lanes = useMemo(
    () => buildRoomLanes(stages, jobs, rooms),
    [stages, jobs, rooms],
  );

  // The days the factory is closed (Admin → Shift times), drawn as tinted
  // columns on the Board. Day → name, since a day is what the calendar asks.
  const { data: holidayList = [] } = useQuery({
    queryKey: holidayKeys.all(factoryId),
    queryFn: () => fetchHolidays(factoryId),
  });
  const holidays = useMemo(
    () => new Map(holidayList.map((h) => [h.date, h.label])),
    [holidayList],
  );
  // Weekdays always closed (0 = Monday … 6 = Sunday) — tinted the same way.
  const { data: weeklyOffList = [] } = useQuery({
    queryKey: weeklyOffKeys.all(factoryId),
    queryFn: () => fetchWeeklyOff(factoryId),
  });
  const weeklyOff = useMemo(() => new Set(weeklyOffList), [weeklyOffList]);
  const roomless = useMemo(() => stagesWithoutRoom(stages), [stages]);
  const hint = VIEWS.find((v) => v.value === view)?.hint ?? "";

  const queryClient = useQueryClient();
  type Placement = Pick<BatchStage, "unit_id" | "planned_date" | "est_finish_date">;

  /**
   * Writes a stage's room and dates, drawing the move at once.
   *
   * The cache is patched before the request so the bar lands where it was
   * dropped instead of snapping back for the length of a round trip; the
   * refresh afterwards replaces the patch with what the server derived
   * (behind plan, overrunning). A failed write puts the stage back.
   */
  async function place(stage: BatchStage, to: Placement, from: Placement) {
    const key = batchStageKeys.all(factoryId);
    const patch = (values: Placement) =>
      queryClient.setQueryData<BatchStage[]>(key, (old) =>
        old?.map((s) =>
          s.id === stage.id
            ? {
                ...s,
                ...values,
                unit_name:
                  rooms.find((r) => r.id === values.unit_id)?.name ??
                  s.unit_name,
              }
            : s,
        ),
      );
    patch(to);
    try {
      await updateBatchStage(stage.id, to);
      return true;
    } catch (e) {
      patch(from);
      toast.error((e as Error).message);
      return false;
    } finally {
      await onRefresh();
    }
  }

  /**
   * A bar dropped on the Gantt: the stage takes the room and the start day it
   * was dropped on, and its estimated finish moves by the same number of days
   * so the stage keeps its length. Offered back with Undo, since a drag is
   * the one edit here that is easy to make by accident.
   */
  async function moveStage(
    entry: ScheduledStage,
    to: { unitId: string; start: string; fromStart: string },
  ) {
    const { stage, job } = entry;
    const delta = dayDiff(to.fromStart, to.start);
    const from: Placement = {
      unit_id: stage.unit_id,
      planned_date: stage.planned_date,
      est_finish_date: stage.est_finish_date,
    };
    const next: Placement = {
      unit_id: to.unitId,
      planned_date: to.start,
      est_finish_date: stage.est_finish_date
        ? addDays(stage.est_finish_date, delta)
        : null,
    };
    if (!(await place(stage, next, from))) return;

    const room = rooms.find((r) => r.id === to.unitId)?.name ?? unitWord;
    toast.success(
      `${job?.batch_no ?? "Stage"} · ${stageName(stage)} moved to ${room}, ${formatDay(to.start)}.`,
      {
        action: {
          label: "Undo",
          onClick: async () => {
            if (await place(stage, from, next)) toast.success("Move undone.");
          },
        },
      },
    );
  }

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
      {/* The Room schedule's toggle and hint. Not on the Gantt: it has one
          view, and its legend already says what the bars mean. */}
      {screen === "schedule" && (
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
          <p className="text-[0.6875rem] text-ink-5">{hint}</p>
        </div>
      )}

      {/* Stages nobody has roomed cannot be drawn in a room, so they are
          absent from every view. Said out loud: a board that silently omits
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
            No {unitWord.toLowerCase()} set up yet.
          </p>
          <p className="mt-1 text-xs text-ink-5">
            Every {unitWord.toLowerCase()} the factory has appears here —
            add them in Admin, and they show as idle until a batch is planned
            into them.
          </p>
        </div>
      ) : screen === "gantt" ? (
        /* The calendar owns its scroller: its week controls and the conflict
           banner stay put while the rooms scroll under a sticky day header. */
        <ScheduleCalendar
          lanes={lanes}
          canManage={canManage}
          onMove={moveStage}
          holidays={holidays}
          weeklyOff={weeklyOff}
          unitWord={unitWord}
          onOpen={setEditing}
          onShowAll={showInQueue}
        />
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
