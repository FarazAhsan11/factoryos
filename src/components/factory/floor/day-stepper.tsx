"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { DateField } from "@/components/ui/date-picker";
import { addDays } from "@/lib/factory/dates";
import { cn } from "@/lib/utils";

/**
 * ‹ day › with a way back to today — the board's day and the room
 * schedule's, which step the same way. `max` stops the board at today (there
 * is no floor to show tomorrow); the schedule leaves it off, since tomorrow's
 * plan is exactly what it is for.
 */
export function DayStepper({
  value,
  onChange,
  today,
  max,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  today: string;
  max?: string;
  className?: string;
}) {
  const next = addDays(value, 1);
  const atMax = max !== undefined && next > max;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <StepButton label="Previous day" onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft className="size-4" />
      </StepButton>
      <DateField
        value={value}
        onChange={(picked) => picked && onChange(picked)}
        max={max}
        ariaLabel="Day"
        className="w-44"
      />
      <StepButton
        label="Next day"
        disabled={atMax}
        onClick={() => onChange(next)}
      >
        <ChevronRight className="size-4" />
      </StepButton>
      {value !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="h-9 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink-3 transition hover:border-ink-6 hover:text-ink"
        >
          Today
        </button>
      )}
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink-4 transition hover:border-ink-6 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
