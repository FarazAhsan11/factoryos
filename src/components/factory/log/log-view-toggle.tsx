"use client";

import { FileText, Sheet } from "lucide-react";

import { LOG_VIEWS, type LogView } from "@/lib/factory/log-tabs";
import { cn } from "@/lib/utils";

const ICONS: Record<LogView, typeof FileText> = {
  form: FileText,
  grid: Sheet,
};

const HINTS: Record<LogView, string> = {
  form: "One entry at a time, every field labelled",
  grid: "Every room on one sheet — log them line by line",
};

/**
 * Form or Grid — how the Log entry tab is filled in. The same segmented
 * look as the tab strip beside it, one size smaller, so it reads as a setting
 * of the open tab rather than a third tab.
 */
export function LogViewToggle({
  value,
  onChange,
  className,
}: {
  value: LogView;
  onChange: (next: LogView) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Entry view"
      className={cn(
        "flex w-fit shrink-0 gap-1 rounded-xl border border-line bg-sunken-2 p-1",
        className,
      )}
    >
      {LOG_VIEWS.map((view) => {
        const Icon = ICONS[view.value];
        const active = view.value === value;
        return (
          <button
            key={view.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={HINTS[view.value]}
            onClick={() => onChange(view.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[13px] font-semibold transition",
              active
                ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgba(20,22,43,0.12)] ring-1 ring-line"
                : "text-ink-4 hover:bg-surface/60 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {view.label} view
          </button>
        );
      })}
    </div>
  );
}
