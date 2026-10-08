"use client";

import { useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Cog,
  Layers,
  PauseCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DayStepper } from "@/components/factory/floor/day-stepper";
import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import {
  stageName,
  stageProgress,
  type BatchStage,
} from "@/lib/factory/batch-stage-queries";
import { formatDay } from "@/lib/factory/dates";
import {
  clock,
  fmtQty,
  isDowntime,
  roomSchedule,
  type FloorRoom,
  type RoomScheduleItem,
} from "@/lib/factory/floor-queries";
import {
  PIPELINE_COLUMNS,
  jobProgress,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { cn } from "@/lib/utils";

type Tab = "batch" | "schedule";

/**
 * One room, opened from its card: the batch it is working, whole, and what
 * the plan puts in the room.
 *
 * Two tabs because they are the two questions the card raises and cannot
 * answer — "how far through is this batch, not just this stage?" and "what
 * comes into this room next?". Both read lists the board already holds, so
 * opening a room costs no request.
 */
export function FloorRoomDialog({
  room,
  day,
  today,
  stages,
  jobs,
  unitWord,
  onClose,
}: {
  /** Null closes the dialog. */
  room: FloorRoom | null;
  /** The day the board is showing — where the schedule tab starts. */
  day: string;
  today: string;
  stages: BatchStage[];
  jobs: PipelineJob[];
  unitWord: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={room !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {room && (
          // Keyed on the room so each opening starts on its own default tab
          // and its own day, rather than wherever the last room was left.
          <RoomBody
            key={`${room.unitId}:${day}`}
            room={room}
            day={day}
            today={today}
            stages={stages}
            jobs={jobs}
            unitWord={unitWord}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoomBody({
  room,
  day,
  today,
  stages,
  jobs,
  unitWord,
}: {
  room: FloorRoom;
  day: string;
  today: string;
  stages: BatchStage[];
  jobs: PipelineJob[];
  unitWord: string;
}) {
  const [tab, setTab] = useState<Tab>(room.job ? "batch" : "schedule");
  const latest = room.latest;

  return (
    <>
      <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
        <DialogTitle className="text-ink">{room.name}</DialogTitle>
        <DialogDescription>
          {latest ? (
            <>
              {isDowntime(latest) ? "Stopped" : "Last logged"}:{" "}
              <span className="font-medium text-ink-3">
                {latest.process_name}
              </span>
              {latest.batch_no && (
                <>
                  {" "}
                  on{" "}
                  <span className="font-mono font-semibold text-brand">
                    {latest.batch_no}
                  </span>
                </>
              )}
              {clock(latest.start_time) &&
                ` · ${clock(latest.start_time)}–${clock(latest.end_time) ?? "…"}`}
              {` · ${formatDay(day)}`}
            </>
          ) : (
            `Nothing logged on ${formatDay(day)}.`
          )}
        </DialogDescription>
      </DialogHeader>

      <div
        role="tablist"
        aria-label={`${room.name} details`}
        className="mx-5 mt-4 flex shrink-0 gap-1 rounded-xl border border-line bg-sunken-2 p-1"
      >
        <TabButton
          active={tab === "batch"}
          onClick={() => setTab("batch")}
          Icon={Layers}
        >
          Batch progress
        </TabButton>
        <TabButton
          active={tab === "schedule"}
          onClick={() => setTab("schedule")}
          Icon={CalendarDays}
        >
          {unitWord} schedule
        </TabButton>
      </div>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "batch" ? (
          <BatchProgress room={room} stages={stages} />
        ) : (
          <ScheduleTab
            unitId={room.unitId}
            startDay={day}
            today={today}
            stages={stages}
            jobs={jobs}
            unitWord={unitWord}
          />
        )}
      </div>
    </>
  );
}

/* ── Batch progress ───────────────────────────────────────────────────── */

const STATUS_STYLE = {
  pending: { icon: Circle, tone: "text-ink-5", label: "Pending" },
  in_progress: { icon: Cog, tone: "text-brand", label: "In progress" },
  complete: { icon: CheckCircle2, tone: "text-teal", label: "Signed off" },
} as const;

function BatchProgress({
  room,
  stages,
}: {
  room: FloorRoom;
  stages: BatchStage[];
}) {
  const job = room.job;
  const batchNo = room.latest?.batch_no ?? room.lastRun?.batch_no;

  if (!job) {
    return (
      <Empty>
        {batchNo
          ? `Batch ${batchNo} has no card on the batch board, so there is no plan to show.`
          : room.latest
            ? "The latest entry in this room names no batch."
            : "No batch was worked in this room on this day. The schedule tab shows what is planned here."}
      </Empty>
    );
  }

  const plan = stages
    .filter((s) => s.job_id === job.id)
    .sort((a, b) => a.sequence_order - b.sequence_order);
  const currentStageId =
    (isDowntime(room.latest) ? room.lastRun : room.latest)?.batch_stage_id ??
    null;
  const column = PIPELINE_COLUMNS.find((c) => c.status === job.status);
  const percent = jobProgress(job);

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-brand">
            {job.batch_no}
          </span>
          <BatchTypeBadge type={job.batch_type} />
          {column && (
            <span
              className="rounded-full px-2 py-0.5 text-[0.6562rem] font-semibold"
              style={{ background: column.tint, color: column.accent }}
            >
              {column.label}
            </span>
          )}
          {job.quarantine_no && (
            <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[0.6562rem] font-semibold text-danger-deep ring-1 ring-danger-line">
              Quarantined · {job.quarantine_no}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-semibold text-ink">
          {job.product_name}
          {job.product_code && (
            <span className="ml-1.5 font-mono text-[0.6875rem] font-normal text-ink-5">
              {job.product_code}
            </span>
          )}
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium text-ink-4">
            Batch completion
            <span className="ml-1 text-ink-5">
              · {job.stages_complete} of {job.stage_count} stage
              {job.stage_count === 1 ? "" : "s"} signed off
            </span>
          </p>
          <p className="font-mono text-sm font-semibold text-ink">
            {fmtQty(job.produced_qty)} / {fmtQty(job.required_qty)}
            {percent !== null && (
              <span className="ml-1.5 text-brand">{percent}%</span>
            )}
          </p>
        </div>
        <Bar pct={percent ?? 0} tone="var(--color-brand)" className="mt-2 h-2" />
        {job.due_date && (
          <p className="mt-2 text-[0.6875rem] text-ink-5">
            Due {formatDay(job.due_date)}
          </p>
        )}
      </section>

      {plan.length === 0 ? (
        <Empty>No stages have been planned for this batch yet.</Empty>
      ) : (
        <ol className="space-y-2">
          {plan.map((stage, i) => (
            <StageLine
              key={stage.id}
              index={i}
              stage={stage}
              current={stage.id === currentStageId}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StageLine({
  stage,
  index,
  current,
}: {
  stage: BatchStage;
  index: number;
  /** The stage the room's card is about. */
  current: boolean;
}) {
  const style = STATUS_STYLE[stage.status];
  const Icon = style.icon;
  const pct = stageProgress(stage);
  const tone = stage.is_over_tolerance
    ? "var(--color-danger)"
    : (pct ?? 0) >= 100
      ? "var(--color-teal)"
      : "var(--color-brand)";

  return (
    <li
      className={cn(
        "rounded-xl border bg-surface p-3",
        current
          ? "border-brand-line ring-2 ring-brand-soft"
          : stage.status === "complete"
            ? "border-teal-line/60"
            : "border-line",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-sunken-2 font-mono text-[0.6875rem] font-bold text-ink-4">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
            <Icon className={cn("size-3.5 shrink-0", style.tone)} aria-hidden />
            {stageName(stage)}
            {current && (
              <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-brand-deep ring-1 ring-brand-line">
                This room
              </span>
            )}
            {stage.is_final && (
              <span className="rounded-full bg-sunken-2 px-1.5 py-0.5 text-[0.625rem] font-semibold text-ink-4 ring-1 ring-line">
                Completes the order
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-5">
            {style.label}
            {" · "}
            {stage.unit_name ?? "No room"}
            {" · "}
            {stage.planned_date ? (
              <span
                className={cn(
                  stage.is_behind_plan && "font-semibold text-warn-ink",
                )}
              >
                {formatDay(stage.planned_date)}
                {stage.is_behind_plan ? " · behind plan" : ""}
              </span>
            ) : (
              "Not scheduled"
            )}
          </p>

          {pct !== null ? (
            <div className="mt-2 space-y-1">
              <Bar pct={pct} tone={tone} />
              <p className="font-mono text-[0.6562rem] text-ink-4 tabular-nums">
                {fmtQty(stage.accumulated_qty)} / {fmtQty(stage.target_qty)}{" "}
                {stage.target_unit}
                <span className="ml-1 font-semibold" style={{ color: tone }}>
                  {pct}%
                </span>
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[0.6875rem] text-ink-5 italic">No target set</p>
          )}
        </div>
      </div>
    </li>
  );
}

/* ── Room schedule ────────────────────────────────────────────────────── */

function ScheduleTab({
  unitId,
  startDay,
  today,
  stages,
  jobs,
  unitWord,
}: {
  unitId: string;
  startDay: string;
  today: string;
  stages: BatchStage[];
  jobs: PipelineJob[];
  unitWord: string;
}) {
  // Its own day, starting from the board's: stepping back through a room's
  // plan should not move the board underneath the dialog.
  const [day, setDay] = useState(startDay);
  const schedule = roomSchedule(stages, jobs, unitId, day, today);
  const nothing =
    schedule.onDay.length +
      schedule.carriedOver.length +
      schedule.upcoming.length +
      schedule.unscheduled.length ===
    0;

  return (
    <div className="space-y-4">
      <DayStepper value={day} onChange={setDay} today={today} />

      {nothing ? (
        <Empty>
          Nothing is planned for this {unitWord.toLowerCase()} on or after{" "}
          {formatDay(day)}.
        </Empty>
      ) : (
        <>
          <Group
            title={day === today ? "Planned for today" : `Planned for ${formatDay(day)}`}
            items={schedule.onDay}
            empty="Nothing was planned for this day."
          />
          {schedule.carriedOver.length > 0 && (
            <Group
              title="Carried over — planned earlier, not signed off"
              items={schedule.carriedOver}
              showDate
            />
          )}
          {schedule.upcoming.length > 0 && (
            <Group title="Coming up" items={schedule.upcoming} showDate />
          )}
          {schedule.unscheduled.length > 0 && (
            <Group title="Not scheduled yet" items={schedule.unscheduled} />
          )}
        </>
      )}
    </div>
  );
}

function Group({
  title,
  items,
  empty,
  showDate = false,
}: {
  title: string;
  items: RoomScheduleItem[];
  empty?: string;
  showDate?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-[0.6562rem] font-bold tracking-[0.08em] text-ink-5 uppercase">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-3.5 py-3 text-xs text-ink-5">
          {empty}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {items.map(({ stage, job }) => {
            const style = STATUS_STYLE[stage.status];
            const Icon = style.icon;
            const pct = stageProgress(stage);
            return (
              <li
                key={stage.id}
                className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-0"
              >
                <Icon className={cn("size-4 shrink-0", style.tone)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-mono font-semibold text-brand">
                      {job?.batch_no ?? "—"}
                    </span>
                    <span className="font-medium text-ink">
                      {stageName(stage)}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[0.6875rem] text-ink-5">
                    {job?.product_name ?? "Unnamed batch"}
                    {showDate && stage.planned_date && (
                      <span
                        className={cn(
                          stage.is_behind_plan && "font-semibold text-warn-ink",
                        )}
                      >
                        {" · "}
                        {formatDay(stage.planned_date)}
                      </span>
                    )}
                    {stage.est_finish_date &&
                      ` → ${formatDay(stage.est_finish_date)}`}
                    {job?.status === "hold" && (
                      <span className="text-warn-ink">
                        {" · "}
                        <PauseCircle className="inline size-3" aria-hidden /> on
                        hold
                      </span>
                    )}
                  </p>
                </div>
                <div className="w-28 shrink-0 text-right">
                  <p className="font-mono text-[0.6875rem] text-ink-4 tabular-nums">
                    {stage.target_qty
                      ? `${fmtQty(stage.accumulated_qty)} / ${fmtQty(stage.target_qty)}`
                      : style.label}
                  </p>
                  {pct !== null && (
                    <Bar
                      pct={pct}
                      tone={
                        stage.status === "complete"
                          ? "var(--color-teal)"
                          : "var(--color-brand)"
                      }
                      className="mt-1"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Bar({
  pct,
  tone,
  className,
}: {
  pct: number;
  tone: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-1.5 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset",
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(100, pct)}%`, background: tone }}
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-xs text-ink-5">
      {children}
    </p>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
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
    </button>
  );
}
