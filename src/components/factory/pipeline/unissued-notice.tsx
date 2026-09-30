"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";

/**
 * "N batches not issued yet", folded into an icon beside the page title.
 *
 * It was a full-width banner above the board. The rows already say which
 * batches are waiting — each carries its own "Not issued" note and an amber
 * Plan stages button — so the banner spent three lines repeating them; the
 * count stays on the icon and the explanation is one click away.
 */
export function UnissuedNotice({ count }: { count: number }) {
  const one = count === 1;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${count} batch${one ? "" : "es"} not issued yet — details`}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-warn-tint pr-2 pl-1.5 text-[11px] font-bold text-warn-ink ring-1 ring-warn-line transition outline-none hover:brightness-95 focus-visible:ring-4 focus-visible:ring-brand/12 data-popup-open:brightness-95"
      >
        <Info className="size-4" aria-hidden />
        {count}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="z-50 w-80 max-w-(--available-width) rounded-2xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink shadow-[0_24px_60px_-20px_rgb(20_22_43/0.45)] outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Popover.Title className="font-semibold">
              {count} batch{one ? "" : "es"} not issued yet
            </Popover.Title>
            <Popover.Description className="mt-1">
              Nothing can be logged against {one ? "it" : "them"} until{" "}
              {one ? "its" : "their"} stages are planned and{" "}
              {one ? "it is" : "they are"} issued for production — use Plan
              stages on the batch to do it. Downtime is always loggable.
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
