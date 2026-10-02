"use client";

import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cog,
} from "lucide-react";

import { stageName, stageProgress } from "@/lib/factory/batch-stage-queries";
import { addDays, formatDay, todayKey } from "@/lib/factory/dates";
import {
  compareRoomNames,
  dayDiff,
  findRoomConflicts,
  formatShortDate,
  mondayOf,
  stageSpan,
  type RoomConflict,
  type RoomLane,
  type ScheduledStage,
  type StageSpan,
} from "@/lib/factory/schedule";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/** Two weeks across — enough to see what comes after this week. */
const DAYS = 14;
/** How many stages a room shows on one day before it says "+N more". */
const MAX_TRACKS = 3;
const ROOM_COL = 184;
const DAY_COL = 112;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A colour per batch, so one batch can be followed from room to room.
 *
 * Hashed from the job id rather than handed out in order, so a batch keeps
 * its colour when the window moves or another batch is added. Red is left
 * out: it means a clash on this screen.
 */
const HUES = [234, 174, 271, 28, 199, 322, 142, 48];

function batchHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

/**
 * Schedule → Board. The plan as a calendar: rooms down the side, a fortnight
 * across the top, each stage drawn over the days it holds its room.
 *
 * The rooms are the busy rooms from `buildRoomLanes`, the same set the Queue
 * lists, so the two views cannot disagree about which rooms are busy. A stage
 * spans `stageSpan` — planned date to estimated finish, and a running stage
 * to today at least. Stages that overlap in one room are stacked, never drawn
 * over each other, and the days they share are marked as a clash.
 */
export function ScheduleCalendar({
  lanes,
  unitWord,
  onOpen,
  onShowAll,
}: {
  lanes: RoomLane[];
  unitWord: string;
  onOpen: (entry: ScheduledStage) => void;
  /** Hands the room to the Queue, which lists everything in it. */
  onShowAll: (unitId: string) => void;
}) {
  const today = useRenderClock(todayKey);
  /**
   * The window's first Monday, or null to follow today — so the calendar left
   * alone rolls over at midnight, and "Today" is just forgetting the choice.
   */
  const [picked, setPicked] = useState<string | null>(null);
  const start = picked ?? mondayOf(today);
  const end = addDays(start, DAYS - 1);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  /** The room a conflict link jumped to — scrolled into view and ringed. */
  const [focusRoom, setFocusRoom] = useState<string | null>(null);
  const focusRef = useCallback(
    (node: HTMLElement | null) => {
      if (node && focusRoom) {
        node.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    [focusRoom],
  );

  const rooms = [...lanes].sort((a, b) =>
    compareRoomNames(a.unitName, b.unitName),
  );
  const conflicts = findRoomConflicts(lanes, today);

  const jumpTo = (day: string, unitId?: string) => {
    setPicked(mondayOf(day));
    setFocusRoom(unitId ?? null);
  };

  const columns = `${ROOM_COL}px repeat(${DAYS}, minmax(${DAY_COL}px, 1fr))`;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-soft">
            <button
              type="button"
              onClick={() => setPicked(addDays(start, -7))}
              aria-label="Previous week"
              className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken hover:text-ink"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setFocusRoom(null);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-3 transition hover:bg-sunken hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPicked(addDays(start, 7))}
              aria-label="Next week"
              className="grid size-8 place-items-center rounded-lg text-ink-4 transition hover:bg-sunken hover:text-ink"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <p className="text-sm font-semibold text-ink tabular-nums">
            {formatDay(start)} – {formatDay(end)}
          </p>
        </div>
        <Legend />
      </div>

      <ConflictBanner
        conflicts={conflicts}
        unitWord={unitWord}
        onShow={(c) => jumpTo(c.from, c.unitId)}
      />

      <div className="scrollbar-slim min-h-0 flex-1 overflow-auto rounded-2xl border border-line bg-surface shadow-card max-lg:max-h-[75svh]">
        <div style={{ minWidth: ROOM_COL + DAYS * DAY_COL }}>
          <div
            className="sticky top-0 z-30 grid border-b border-line bg-sunken-2"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="sticky left-0 z-10 flex items-end border-r border-line bg-sunken-2 px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase">
              {unitWord}
            </div>
            {days.map((day, i) => {
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={cn(
                    "border-l border-line-soft px-2 py-2 text-center",
                    isToday && "bg-brand-soft",
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] font-bold tracking-[0.06em] uppercase",
                      isToday ? "text-brand-deep" : "text-ink-5",
                    )}
                  >
                    {WEEKDAYS[i % 7]}
                    {isToday && " · Today"}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11.5px] font-semibold tabular-nums",
                      isToday ? "text-brand-deep" : "text-ink-3",
                    )}
                  >
                    {formatDay(day)}
                  </p>
                </div>
              );
            })}
          </div>

          {rooms.map((lane) => (
            <RoomRow
              key={lane.unitId}
              ref={lane.unitId === focusRoom ? focusRef : undefined}
              lane={lane}
              days={days}
              start={start}
              end={end}
              today={today}
              columns={columns}
              focused={lane.unitId === focusRoom}
              onOpen={onOpen}
              onShowAll={() => onShowAll(lane.unitId)}
              onJump={(day) => jumpTo(day, lane.unitId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface Placed {
  entry: ScheduledStage;
  span: StageSpan;
  /** First and last visible column, 0-based within the window. */
  from: number;
  to: number;
  track: number;
}

/**
 * One room: its stages laid out over the window, overlapping ones stacked.
 *
 * Stacking is first-fit — each stage takes the top track that is free on its
 * first day — which keeps a room with no clashes to one track, so a calm room
 * stays one line tall and only a double-booked one grows.
 */
function RoomRow({
  ref,
  lane,
  days,
  start,
  end,
  today,
  columns,
  focused,
  onOpen,
  onShowAll,
  onJump,
}: {
  ref?: (node: HTMLElement | null) => void;
  lane: RoomLane;
  days: string[];
  start: string;
  end: string;
  today: string;
  columns: string;
  focused: boolean;
  onOpen: (entry: ScheduledStage) => void;
  onShowAll: () => void;
  onJump: (day: string) => void;
}) {
  const spans = lane.stages.map((entry) => ({
    entry,
    span: stageSpan(entry.stage, today),
  }));
  const undated = spans.filter((s) => !s.span).length;

  const inWindow = spans
    .filter(
      (s): s is { entry: ScheduledStage; span: StageSpan } =>
        s.span !== null && s.span.end >= start && s.span.start <= end,
    )
    .map((s) => ({
      ...s,
      from: Math.max(0, dayDiff(start, s.span.start)),
      to: Math.min(days.length - 1, dayDiff(start, s.span.end)),
    }))
    // Lane order breaks ties, so a running stage takes the top track.
    .sort((a, b) => a.from - b.from);

  const trackEnds: number[] = [];
  const placed: Placed[] = inWindow.map((s) => {
    let track = trackEnds.findIndex((last) => last < s.from);
    if (track === -1) track = trackEnds.length;
    trackEnds[track] = s.to;
    return { ...s, track };
  });

  const perDay = days.map(
    (_, i) => placed.filter((p) => p.from <= i && p.to >= i).length,
  );
  const hiddenPerDay = days.map(
    (_, i) =>
      placed.filter((p) => p.track >= MAX_TRACKS && p.from <= i && p.to >= i)
        .length,
  );
  // A clash is only worth marking where it can still be planned away.
  const clash = days.map((day, i) => perDay[i] > 1 && day >= today);
  const clashDays = clash.filter(Boolean).length;
  const hasHidden = hiddenPerDay.some((n) => n > 0);
  const tracks = Math.max(1, Math.min(MAX_TRACKS, trackEnds.length));
  const rowCount = tracks + (hasHidden ? 1 : 0);

  /** Where this room's work is, when none of it falls in the window. */
  const elsewhere =
    placed.length > 0
      ? null
      : (spans
          .map((s) => s.span)
          .filter((s): s is StageSpan => s !== null && s.start > end)
          .sort((a, b) => (a.start < b.start ? -1 : 1))[0]?.start ??
        spans
          .map((s) => s.span)
          .filter((s): s is StageSpan => s !== null && s.end < start)
          .sort((a, b) => (a.end > b.end ? -1 : 1))[0]?.end ??
        null);

  return (
    <div
      ref={ref}
      className="grid scroll-mt-16 border-b border-line-soft last:border-0"
      style={{
        gridTemplateColumns: columns,
        gridTemplateRows: `repeat(${rowCount}, minmax(48px, auto))`,
      }}
    >
      <div
        className={cn(
          "sticky left-0 z-20 flex flex-col justify-center gap-1 border-r border-line px-3 py-2",
          // The room a conflict link jumped to.
          focused
            ? "bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]"
            : "bg-surface",
        )}
        style={{ gridColumn: 1, gridRow: "1 / -1" }}
      >
        <p className="text-sm font-semibold text-ink">{lane.unitName}</p>
        <p className="text-[10.5px] text-ink-5">
          {lane.stages.length} stage{lane.stages.length === 1 ? "" : "s"} to
          run
        </p>
        <div className="flex flex-wrap gap-1">
          {clashDays > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-danger-deep ring-1 ring-danger-line">
              <AlertTriangle className="size-3" aria-hidden />
              Clash · {clashDays} day{clashDays === 1 ? "" : "s"}
            </span>
          )}
          {/* No day to draw them on — the Queue lists them, and is where they
              get one. */}
          {undated > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-4 transition hover:border-brand-line hover:text-brand-deep"
            >
              {undated} undated
              <ChevronRight className="size-3" aria-hidden />
            </button>
          )}
          {elsewhere && (
            <button
              type="button"
              onClick={() => onJump(elsewhere)}
              className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-4 transition hover:border-brand-line hover:text-brand-deep"
            >
              {elsewhere > end ? "Next" : "Last"} {formatDay(elsewhere)}
              <ChevronRight className="size-3" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {days.map((day, i) => {
        const weekend = i % 7 >= 5;
        return (
          <div
            key={day}
            aria-hidden
            className={cn(
              "border-l border-line-soft",
              weekend && "bg-sunken/70",
              day === today && "bg-brand-tint",
              clash[i] &&
                "bg-danger-tint shadow-[inset_0_2px_0_var(--color-danger)]",
            )}
            style={{ gridColumn: i + 2, gridRow: "1 / -1" }}
          />
        );
      })}

      {placed
        .filter((p) => p.track < MAX_TRACKS)
        .map((p) => (
          <StageBar
            key={p.entry.stage.id}
            placed={p}
            clipLeft={p.span.start < start}
            clipRight={p.span.end > end}
            clashing={clash.some((c, i) => c && p.from <= i && p.to >= i)}
            onOpen={() => onOpen(p.entry)}
          />
        ))}

      {hasHidden &&
        hiddenPerDay.map((n, i) =>
          n > 0 ? (
            <button
              key={`more-${days[i]}`}
              type="button"
              onClick={onShowAll}
              className="relative z-10 mx-1 mb-1 self-start rounded-md border border-dashed border-danger-line bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold text-danger-deep transition hover:bg-danger-soft"
              style={{ gridColumn: i + 2, gridRow: rowCount }}
            >
              +{n} more
            </button>
          ) : null,
        )}
    </div>
  );
}

/**
 * One stage on the calendar. Solid while it is running, a tint while it is
 * still planned — the one distinction a planner reads before the batch number.
 */
function StageBar({
  placed,
  clipLeft,
  clipRight,
  clashing,
  onOpen,
}: {
  placed: Placed;
  clipLeft: boolean;
  clipRight: boolean;
  clashing: boolean;
  onOpen: () => void;
}) {
  const { entry, span, from, to, track } = placed;
  const { stage, job } = entry;
  const running = stage.status === "in_progress";
  const pct = running ? stageProgress(stage) : null;
  const hue = batchHue(stage.job_id);
  const name = stageName(stage);

  const title = [
    `${job?.batch_no ?? "—"} · ${name}`,
    job?.product_name,
    `${formatShortDate(span.start)}${span.end !== span.start ? ` → ${formatShortDate(span.end)}` : ""}${running ? " · running" : ""}`,
    stage.is_behind_plan ? "Behind plan — the day has passed unstarted" : null,
    stage.is_overrunning ? "Overrunning its estimated finish" : null,
    job?.due_date ? `Due ${formatShortDate(job.due_date)}` : null,
    clashing ? "Shares this room with another stage" : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={title.replaceAll("\n", ", ")}
      className={cn(
        "relative z-10 my-1 flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5 text-left transition",
        "hover:-translate-y-px hover:shadow-[0_3px_10px_rgb(20_22_43/0.14)] focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none",
        clipLeft ? "ml-0 rounded-l-none border-l-0" : "ml-1",
        clipRight ? "mr-0 rounded-r-none border-r-0" : "mr-1",
        clashing && "ring-2 ring-danger/70",
      )}
      style={{
        gridColumn: `${from + 2} / ${to + 3}`,
        gridRow: track + 1,
        ...(running
          ? {
              background: `hsl(${hue} 58% 40%)`,
              borderColor: `hsl(${hue} 58% 34%)`,
              color: "white",
            }
          : {
              background: `hsl(${hue} 85% 96%)`,
              borderColor: `hsl(${hue} 55% 80%)`,
              color: `hsl(${hue} 55% 24%)`,
              boxShadow: clipLeft
                ? undefined
                : `inset 3px 0 0 hsl(${hue} 58% 45%)`,
            }),
      }}
    >
      {/* Three lines — batch, stage, product — so a one-day bar never trades
          the stage name for the batch number beside it. */}
      <span className="flex min-w-0 items-center gap-1 text-[11.5px] leading-tight">
        {clipLeft && <ChevronLeft className="size-3 shrink-0 opacity-70" />}
        {running && <Cog className="size-3 shrink-0" aria-hidden />}
        <span className="truncate font-mono font-bold tracking-tight">
          {job?.batch_no ?? "—"}
        </span>
        {stage.is_behind_plan && (
          <AlertTriangle
            className={cn("size-3 shrink-0", !running && "text-warn-deep")}
            aria-hidden
          />
        )}
        {stage.is_overrunning && (
          <Clock
            className={cn("size-3 shrink-0", !running && "text-warn-deep")}
            aria-hidden
          />
        )}
        {clipRight && (
          <ChevronRight className="ml-auto size-3 shrink-0 opacity-70" />
        )}
      </span>
      <span className="truncate text-[11.5px] leading-tight font-semibold">
        {name}
      </span>
      <span className="truncate text-[10.5px] leading-tight opacity-80">
        {job?.product_name ?? "Unnamed batch"}
      </span>
      {pct !== null && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/15">
          <span
            className="block h-full"
            style={{
              width: `${Math.min(100, pct)}%`,
              background: stage.is_over_tolerance
                ? "var(--color-danger)"
                : "rgb(255 255 255 / 0.85)",
            }}
          />
        </span>
      )}
    </button>
  );
}

/**
 * Every double-booked room from today on, said once above the calendar —
 * where it can be read without scrolling to find the red — with a link that
 * moves the window to the clash and rings the room.
 */
function ConflictBanner({
  conflicts,
  unitWord,
  onShow,
}: {
  conflicts: RoomConflict[];
  unitWord: string;
  onShow: (conflict: RoomConflict) => void;
}) {
  const [open, setOpen] = useState(false);
  if (conflicts.length === 0) return null;

  const word = unitWord.toLowerCase();
  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-danger-line bg-danger-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-danger-deep"
      >
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">
            {conflicts.length} {word} conflict
            {conflicts.length === 1 ? "" : "s"}
          </strong>{" "}
          — more than one stage planned into the same {word} on the same day.
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold">
          {open ? "Hide" : "Review"}
          <ChevronDown
            className={cn("size-3.5 transition", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <ul className="scrollbar-slim max-h-48 divide-y divide-danger-line/50 overflow-y-auto border-t border-danger-line/70 bg-surface/60">
          {conflicts.map((c) => (
            <li
              key={`${c.unitId}-${c.from}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-xs"
            >
              <span className="font-semibold text-ink">{c.unitName}</span>
              <span className="text-ink-4 tabular-nums">
                {formatDay(c.from)}
                {c.to !== c.from && ` – ${formatDay(c.to)}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-3">
                {c.entries
                  .map(
                    (e) => `${e.job?.batch_no ?? "—"} ${stageName(e.stage)}`,
                  )
                  .join("  ·  ")}
              </span>
              <button
                type="button"
                onClick={() => onShow(c)}
                className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-danger-deep hover:underline"
              >
                Show
                <ChevronRight className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-4">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-brand" aria-hidden />
        Running
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-4 rounded-sm border border-brand-line bg-brand-soft shadow-[inset_2px_0_0_var(--color-brand)]"
          aria-hidden
        />
        Planned
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertTriangle className="size-3 text-warn-deep" aria-hidden />
        Behind plan
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3 text-warn-deep" aria-hidden />
        Past est. finish
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-4 rounded-sm bg-danger-tint shadow-[inset_0_2px_0_var(--color-danger)]"
          aria-hidden
        />
        Clash
      </span>
      <span className="text-ink-5">· colour follows the batch</span>
    </div>
  );
}
