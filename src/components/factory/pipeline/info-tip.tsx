"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Explanatory text folded behind an (i) — for a form that should read as its
 * fields, with the "what is this for" one click away rather than printed
 * between every pair of them.
 */
export function InfoTip({
  label,
  children,
  className,
}: {
  /** Names the icon for assistive tech, e.g. "About bulk production". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-ink-5 transition outline-none hover:bg-sunken-2 hover:text-ink focus-visible:ring-4 focus-visible:ring-brand/12 data-popup-open:bg-sunken-2 data-popup-open:text-ink",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        {/* Above the dialog it opens from (z-50). */}
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-60">
          <Popover.Popup className="w-72 max-w-(--available-width) rounded-xl border border-line bg-surface px-3.5 py-3 text-[0.75rem] leading-snug font-normal tracking-normal text-ink-3 normal-case shadow-lift outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
