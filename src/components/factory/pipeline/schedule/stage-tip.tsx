import { AlertTriangle, Clock, Cog, Users } from "lucide-react";

import { stageName, stageProgress } from "@/lib/factory/batch-stage-queries";
import {
  dayDiff,
  formatShortDate,
  type ScheduledStage,
  type StageSpan,
} from "@/lib/factory/schedule";
import { cn } from "@/lib/utils";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * What a stage bar says when it is hovered or focused: the batch and where the
 * stage stands, then the facts a planner reads off a bar — room, the days it
 * holds, what it owes and how far it is — and anything wrong with it in words.
 *
 * Laid out as a card rather than a line of text so the eye lands in the same
 * place every time: identity on a tint of the batch's own colour, facts as
 * label / value pairs, and warnings last, where they read as a verdict.
 */
export function StageTip({
  entry,
  span,
  hue,
  clashing,
}: {
  entry: ScheduledStage;
  span: StageSpan;
  /** The batch's hue on the calendar, so the card matches the bar it names. */
  hue: number;
  clashing: boolean;
}) {
  const { stage, job } = entry;
  const running = stage.status === "in_progress";
  const pct = running ? stageProgress(stage) : null;
  const days = dayDiff(span.start, span.end) + 1;

  const warnings = [
    stage.is_behind_plan
      ? "Behind plan — its planned day has passed unfinished."
      : null,
    stage.is_overrunning ? "Past its estimated finish." : null,
    stage.is_over_tolerance
      ? "Past the quantity this stage accepts."
      : null,
    clashing ? "Shares this room with another stage." : null,
  ].filter((w): w is string => w !== null);

  return (
    <div className="w-72 max-w-(--available-width) overflow-hidden text-ink">
      <div
        className="border-b px-3.5 py-3"
        style={{
          background: `hsl(${hue} 85% 96%)`,
          borderColor: `hsl(${hue} 55% 84%)`,
          boxShadow: `inset 3px 0 0 hsl(${hue} 58% 45%)`,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-sm font-bold tracking-tight"
            style={{ color: `hsl(${hue} 55% 24%)` }}
          >
            {job?.batch_no ?? "—"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-bold",
              running
                ? "bg-brand text-white"
                : "bg-surface text-ink-3 ring-1 ring-line",
            )}
          >
            {running && <Cog className="size-3" aria-hidden />}
            {running ? "Running" : "Planned"}
          </span>
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-tight font-semibold text-ink">
          {stageName(stage)}
        </p>
        <p className="mt-0.5 text-[0.6875rem] leading-snug text-ink-4">
          {job?.product_name ?? "Unnamed batch"}
          {job?.product_code ? ` · ${job.product_code}` : ""}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 px-3.5 py-3 text-[0.75rem]">
        <Row label="Room">{stage.unit_name ?? "Not assigned"}</Row>
        <Row label="Starts">{formatShortDate(span.start)}</Row>
        <Row label="Finishes">
          {formatShortDate(span.end)}
          <span className="ml-1.5 text-[0.6875rem] text-ink-5">
            · {days} day{days === 1 ? "" : "s"}
          </span>
        </Row>
        {job?.due_date && <Row label="Batch due">{formatShortDate(job.due_date)}</Row>}
        {stage.target_qty ? (
          <Row label="Target">
            <span className="font-mono tabular-nums">{fmt(stage.target_qty)}</span>{" "}
            <span className="text-[0.6875rem] text-ink-5">{stage.target_unit}</span>
          </Row>
        ) : null}
      </dl>

      {pct !== null && (
        <div className="px-3.5 pb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, pct)}%`,
                background: stage.is_over_tolerance
                  ? "var(--color-danger)"
                  : "var(--color-brand)",
              }}
            />
          </div>
          <p className="mt-1 font-mono text-[0.6875rem] tabular-nums text-ink-4">
            {fmt(stage.accumulated_qty)} / {fmt(stage.target_qty)}{" "}
            {stage.target_unit}
            <span className="ml-1.5 font-semibold text-ink-2">{pct}%</span>
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 border-t border-warn-line bg-warn-tint px-3.5 py-2.5">
          {warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-1.5 text-[0.6875rem] leading-snug text-warn-ink"
            >
              {w.startsWith("Past its") ? (
                <Clock className="mt-px size-3 shrink-0" aria-hidden />
              ) : w.startsWith("Shares") ? (
                <Users className="mt-px size-3 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              )}
              {w}
            </li>
          ))}
        </ul>
      )}

      {stage.planning_note && (
        <p className="border-t border-line-soft px-3.5 py-2.5 text-[0.6875rem] leading-snug text-ink-4 italic">
          &ldquo;{stage.planning_note}&rdquo;
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-[0.625rem] font-bold tracking-[0.05em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd className="min-w-0 truncate font-medium text-ink-2">{children}</dd>
    </>
  );
}
