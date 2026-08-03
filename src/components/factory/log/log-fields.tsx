import { cn } from "@/lib/utils";

/**
 * Presentational primitives shared by the shift-log form. They stay dumb —
 * react-hook-form owns the state, these only lay out a label, a control and
 * an inline error.
 */

export const CONTROL =
  "h-11 w-full rounded-xl border border-[#E6EAF1] bg-[#FBFCFE] px-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#2563EB]/12 disabled:cursor-not-allowed disabled:opacity-60";

export const MONO = "font-mono text-[13px]";

export function SectionTitle({
  children,
  hint,
  className,
}: {
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-baseline gap-2", className)}>
      <span className="text-[10px] font-bold uppercase tracking-[1px] text-[#94A3B8]">
        {children}
      </span>
      {hint && (
        <span className="text-[10px] font-semibold text-[#2563EB]">{hint}</span>
      )}
    </div>
  );
}

export function Field({
  label,
  note,
  optional,
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
  error?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-[#475569]"
      >
        {label}
        {note && <span className="ml-1 text-[10px] text-[#94A3B8]">{note}</span>}
        {optional && (
          <span className="ml-1 text-[10px] font-normal text-[#94A3B8]">
            (optional)
          </span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
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
        className
      )}
    >
      {children}
    </div>
  );
}
