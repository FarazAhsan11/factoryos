import { cn } from "@/lib/utils";

/**
 * A column's right edge, dragged sideways to widen it — goes inside a `th`,
 * which must be positioned (a sticky heading already is). Pair with
 * `useColumnResize`.
 *
 * The divider line is always drawn, faint, and brightens under the pointer: a
 * handle that only appears on hover cannot be found on a tablet. `touch-none`
 * so a finger drags the column instead of scrolling the sheet. Pass `className`
 * to recolour the line for a dark heading.
 */
export function ColumnResizeHandle({
  onPointerDown,
  className,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-y-0 right-0 w-3 cursor-col-resize touch-none select-none",
        "before:absolute before:inset-y-2 before:right-0 before:w-px before:bg-line-strong before:transition-colors hover:before:w-0.5 hover:before:bg-brand",
        "print:hidden",
        className,
      )}
    />
  );
}
