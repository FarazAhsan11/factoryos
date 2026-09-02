import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The shared vocabulary of Admin & Settings.
 *
 * Eight tabs configure eight unrelated things, and they were eight slightly
 * different-looking screens: one had a bordered form, one a bare table, one a
 * tinted add-box with its own heading style. These primitives are what make
 * them read as one settings area — and they are the only place a control's
 * look is decided, so re-toning Admin means editing this file.
 */

export const FIELD =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70";

export const AREA =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_2px_rgb(20_22_43/0.04)] outline-none transition placeholder:text-placeholder hover:border-line-strong focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12 disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-70";

/** The frame around a list or table panel. */
export const PANEL =
  "overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_22_43/0.04)]";

/**
 * The heading every tab opens with: what this section configures, and — for
 * the ones that hold a list — how many of them there are.
 *
 * Admin is where someone lands not knowing what a "process stage" is, so the
 * one-line description is doing real work rather than decorating.
 */
export function PanelHeader({
  icon: Icon,
  title,
  description,
  count,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Rendered as a chip beside the title. Omit for a settings form. */
  count?: number;
  /** Import buttons and the like, aligned right. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-soft to-brand-line text-brand-deep"
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {title}
            {count !== undefined && (
              <span className="rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] font-bold tabular-nums text-ink-4">
                {count}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-4">
            {description}
          </p>
        </div>
      </div>
      {action && (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  );
}

/**
 * The "add one" card that opens most tabs.
 *
 * Sunken with an inset shadow, so it reads as a slot you drop something into
 * rather than as another list item — the composers used to be the same tone
 * as the rows beneath them.
 */
export function Composer({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-sunken p-4 shadow-[inset_0_1px_2px_rgb(20_22_43/0.04)]",
        className,
      )}
    >
      <p className="mb-3 text-[11px] font-bold tracking-[0.07em] text-ink-4 uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/** Nothing here yet — and, where it matters, what to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-14 text-center",
        className,
      )}
    >
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-sunken text-ink-6">
        <Icon className="size-6" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink-3">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-5">{hint}</p>}
    </div>
  );
}

/** Column heading for the panels that render a real table. */
export const TH =
  "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken-2 px-3.5 py-2.5 text-left text-[10px] font-bold tracking-[0.07em] text-ink-3 uppercase";

export const TD = "px-3.5 py-2.5 align-middle";
