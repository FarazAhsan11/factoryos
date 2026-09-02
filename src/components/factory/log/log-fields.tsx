import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Presentational primitives shared by the shift-log form. They stay dumb —
 * react-hook-form owns the state, these only lay out a label, a control and
 * an inline error.
 */

export const CONTROL =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-[0_1px_2px_rgba(20,22,43,0.04)] outline-none transition placeholder:text-placeholder hover:border-ink-6 focus:border-brand focus:shadow-none focus:ring-4 focus:ring-brand/12 disabled:cursor-not-allowed disabled:opacity-60";

export const MONO = "font-mono text-[13px]";

/**
 * The band a group of fields sits in. Sections used to be separated by
 * whitespace and a small grey caption, which left one flat sheet of inputs
 * eleven fields tall; tinting the group and boxing it lets the eye find
 * "Output" without reading.
 */
export const SECTION =
  "rounded-2xl border border-line-soft bg-sunken p-4 sm:p-[1.125rem]";

export function SectionTitle({
  children,
  hint,
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  hint?: string;
  /** Small mark beside the title — the section's shorthand at a glance. */
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("mb-3.5 flex items-center gap-2", className)}>
      {Icon && (
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface text-brand ring-1 ring-line"
        >
          <Icon className="size-3.5" />
        </span>
      )}
      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-2">
        {children}
      </span>
      {hint && (
        <span className="truncate text-[10px] font-semibold text-brand">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Field({
  label,
  note,
  optional,
  action,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  /** Small grey qualifier after the label — "(this entry)", "(auto)". */
  note?: string;
  /**
   * Renders the "(optional)" marker. A separate flag rather than more `note`
   * text so a field can say both what it means and that it may be left blank,
   * and so every optional field is marked identically — an operator shouldn't
   * have to submit the form to discover which ones the validator will reject.
   */
  optional?: boolean;
  /**
   * A control rendered opposite the label — currently the "Remove" affordance
   * on an added operator. It sits in the label row rather than under the input
   * so it can't be mistaken for part of the value, and so adding it doesn't
   * change the field's height and break the row alignment below.
   */
  action?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // Controls in a FieldRow line up because every label is exactly one line
  // tall — hence `truncate`, which is doing real work: a label long enough to
  // wrap would otherwise shove its own input below its neighbours'.
  //
  // Bottom-aligning them instead (`h-full` + `mt-auto`) also fixed that, but
  // broke the moment one cell grew taller than its neighbours for a different
  // reason — an operator picker with its free-text name box open dragged the
  // dropdown beside it to the floor of the row.
  return (
    <div className={cn("flex flex-col space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="block min-w-0 truncate text-xs font-semibold text-ink-2"
        >
          {label}
          {note && (
            <span className="ml-1 text-[10px] font-normal text-ink-5">
              {note}
            </span>
          )}
          {optional && (
            <span className="ml-1 text-[10px] font-normal text-ink-5">
              (optional)
            </span>
          )}
        </label>
        {/* Never squeezed by a long label — the label truncates instead. */}
        <span className="shrink-0">{action}</span>
      </div>
      <div className="space-y-1.5">
        {children}
        {error && (
          <p className="flex items-start gap-1 text-xs font-medium text-danger-deep">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** The three-across rows the prototype uses for times, output and speed. */
export function FieldRow({
  cols = 3,
  className,
  children,
}: {
  cols?: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
