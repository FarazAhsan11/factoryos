import { ArrowRight, Flag } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The pieces a stage plan is drawn with, shared by the two places one is
 * written: the Stages block in New batch (`StagePlanEditor`) and Plan stages
 * on a batch already on the board (`PlanStagesDialog`). One layout in two
 * dialogs, so a planner who learns one has learned both — and a column added
 * to one lands in the other.
 */

export const INPUT =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-4";
export const CONTROL = "h-9 rounded-lg px-2.5 text-[0.8125rem]";
export const HEAD =
  "text-[0.625rem] font-semibold tracking-[0.04em] text-ink-5 uppercase";

/**
 * The one-line row's columns: activity, room, [work order], start, end, target,
 * unit. The header row and every stage share it, so they cannot drift. Written
 * out in full — Tailwind finds classes by scanning for whole strings.
 */
export const ROW_COLS =
  "@3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_8.5rem_8.5rem_5.5rem_6.5rem]";
export const ROW_COLS_WO =
  "@3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_6rem_8.5rem_8.5rem_5.5rem_6.5rem]";

/**
 * What a route's pills take turns in, by position — so neighbours always read
 * as separate steps. Amber and red are left out: they mean "no activity yet"
 * and "this stage has an error", and a pill must never look like either by
 * accident. Written out in full, for the same reason as `ROW_COLS`.
 */
const PILL_TONES = [
  "border-brand-line bg-brand-soft text-brand-deep",
  "border-teal-line bg-teal-soft text-teal-deep",
  "border-violet-line bg-violet-soft text-violet-deep",
  "border-line-strong bg-sunken-2 text-ink-3",
];

export interface RouteStep {
  key: string;
  name: string;
  /** "30's" — shown after the name when the activity runs more than once. */
  runLabel?: string;
  /** No activity matched yet — the stage is a gap in the route. */
  unresolved?: boolean;
  /** The row has something to say. */
  error?: boolean;
}

/**
 * The route at a glance: one pill per stage, in order, wrapping onto the next
 * line when there are more than fit. The flag marks the stage that completes
 * the order — the last one.
 */
export function RoutePills({
  steps,
  className,
}: {
  steps: RouteStep[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-sunken/60 px-3 py-3",
        className,
      )}
    >
      <ol className="flex flex-wrap items-center gap-y-2" aria-label="Stage route">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.key} className="flex items-center">
              {index > 0 && (
                <ArrowRight
                  className="mx-1.5 size-3.5 shrink-0 text-ink-6"
                  aria-hidden
                />
              )}
              <span
                title={
                  isLast
                    ? `${step.name} — completes the order`
                    : `Stage ${index + 1}: ${step.name}`
                }
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[0.75rem] font-semibold",
                  step.error
                    ? "border-danger-line bg-danger-soft text-danger-deep"
                    : step.unresolved
                      ? "border-dashed border-warn-line bg-warn-tint text-warn-ink"
                      : PILL_TONES[index % PILL_TONES.length],
                )}
              >
                {isLast && <Flag className="size-3 shrink-0" aria-hidden />}
                <span className="truncate">{step.name}</span>
                {step.runLabel && (
                  <span className="font-normal opacity-70">· {step.runLabel}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One labelled field of a stage row. */
export function Cell({
  label,
  wide,
  children,
}: {
  label: string;
  /** Takes the full width of the narrow layout — activity, room, work order. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 space-y-1 @3xl:space-y-0",
        wide && "col-span-2 @3xl:col-span-1",
      )}
    >
      {/* The header row names the columns once the row is one line. */}
      <span className={cn(HEAD, "block @3xl:sr-only")}>{label}</span>
      {children}
    </div>
  );
}

/** The header row of the table: names the columns once, above every stage. */
export function ColumnHeads({
  showWorkOrder,
  leading = "w-[68px]",
  trailing = "w-8",
}: {
  showWorkOrder: boolean;
  /** Widths of the order controls' and the remove button's spacers. */
  leading?: string;
  trailing?: string;
}) {
  return (
    <div className="hidden gap-2.5 border-b border-line-soft bg-sunken/60 px-3 py-2 @3xl:flex">
      <span className={cn(leading, "shrink-0")} aria-hidden />
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-2",
          showWorkOrder ? ROW_COLS_WO : ROW_COLS,
        )}
        aria-hidden
      >
        <span className={HEAD}>Activity</span>
        <span className={HEAD}>Room</span>
        {showWorkOrder && <span className={HEAD}>Work order</span>}
        <span className={HEAD}>Start</span>
        <span className={HEAD}>End</span>
        <span className={HEAD}>Target</span>
        <span className={HEAD}>Unit</span>
      </div>
      <span className={cn(trailing, "shrink-0")} aria-hidden />
    </div>
  );
}
