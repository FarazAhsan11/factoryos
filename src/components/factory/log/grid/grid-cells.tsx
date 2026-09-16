import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The grid's furniture — columns, cells and the class strings every control in
 * a cell shares. Kept apart from the rows so the header, a row being typed and
 * a row already filed are drawn from one column list and cannot drift apart.
 */

export type GridColumnKey =
  | "room"
  | "activity"
  | "batch"
  | "product"
  | "start"
  | "end"
  | "hrs"
  | "qty"
  | "unit"
  | "rejected"
  | "target"
  | "operators"
  | "equipment"
  | "speedUnit"
  | "targetSpeed"
  | "actualSpeed"
  | "flag"
  | "comment"
  | "actions";

/**
 * Left to right in the order an entry is thought through: where, what, which
 * batch, when, how much, who — then the machine detail and the notes that only
 * some activities have. Pixel widths sized to what each column holds; the grid
 * is wider than a laptop and scrolls sideways as one sheet — no column is
 * pinned.
 */
export const GRID_COLUMNS: {
  key: GridColumnKey;
  label: string;
  width: number;
  align?: "right";
}[] = [
  { key: "room", label: "Room", width: 140 },
  { key: "activity", label: "Activity / stage", width: 188 },
  { key: "batch", label: "Batch #", width: 116 },
  { key: "product", label: "Product", width: 170 },
  { key: "start", label: "Start", width: 108 },
  { key: "end", label: "End", width: 108 },
  { key: "hrs", label: "Hrs", width: 88, align: "right" },
  { key: "qty", label: "Qty", width: 104, align: "right" },
  { key: "unit", label: "Unit", width: 112 },
  { key: "rejected", label: "Rejected", width: 96, align: "right" },
  { key: "target", label: "Target qty", width: 104, align: "right" },
  { key: "operators", label: "Operators", width: 172 },
  { key: "equipment", label: "EQ no.", width: 100 },
  { key: "speedUnit", label: "Speed unit", width: 150 },
  { key: "targetSpeed", label: "Target speed", width: 104, align: "right" },
  { key: "actualSpeed", label: "Actual speed", width: 104, align: "right" },
  { key: "flag", label: "Flag", width: 168 },
  { key: "comment", label: "Comment", width: 220 },
  { key: "actions", label: "", width: 132 },
];

export const GRID_WIDTH = GRID_COLUMNS.reduce((sum, c) => sum + c.width, 0);
export const GRID_SPAN = GRID_COLUMNS.length;

/**
 * A text or number input filling its cell edge to edge. No border, no radius:
 * the gridlines separate the cells, and the cell being typed in gets the
 * outline a spreadsheet draws round its active cell.
 */
export const INPUT =
  "block h-10 w-full rounded-none border-0 bg-transparent px-3 text-[12.5px] text-ink outline-none transition-[background-color,box-shadow] placeholder:text-ink-6 hover:bg-brand-tint/60 focus:bg-surface focus:shadow-[inset_0_0_0_2px_var(--color-brand)] aria-invalid:bg-danger-soft/50 aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-danger)]";

/**
 * The same, for the combobox and the time picker — both bring their own
 * rounded, bordered, ringed trigger, overridden here rather than changed at
 * the source, because every other form in the app wants the boxed version.
 */
export const PICKER =
  "h-10 w-full gap-1.5 rounded-none border-0 bg-transparent px-3 text-[12.5px] shadow-none hover:bg-brand-tint/60 focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_2px_var(--color-brand)] data-popup-open:bg-surface data-popup-open:ring-0 data-popup-open:shadow-[inset_0_0_0_2px_var(--color-brand)] aria-invalid:ring-0 aria-invalid:bg-danger-soft/50 aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-danger)] [&_svg]:size-3.5";

/** A batch the gate would refuse: amber, the colour of the note saying why. */
export const WARN = "bg-warn-tint shadow-[inset_0_-2px_0_var(--color-warn)]";

/** A batch or machine that resolved against its register: a green underline. */
export const RESOLVED = "shadow-[inset_0_-2px_0_var(--color-teal)]";

export function Cell({
  children,
  className,
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        "h-10 overflow-hidden border-r border-line-soft p-0 align-middle last:border-r-0",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * A value the row shows but nobody types — the run time, the product the
 * batch resolved to, the derived target. Shaded like a spreadsheet's formula
 * cell, so it reads as worked out rather than waiting to be filled in.
 */
export function Static({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "flex h-10 items-center bg-brand-tint/70 px-3 text-[12.5px] text-ink-3",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * A cell this activity does not have. Hatched, so it cannot be mistaken for an
 * input nobody has filled in yet, and held at the control's own height so
 * switching to downtime does not make the row jump.
 */
export function Blank() {
  return (
    <span
      title="Not used for this activity"
      className="block h-10 w-full bg-[repeating-linear-gradient(135deg,transparent_0,transparent_5px,var(--color-line-soft)_5px,var(--color-line-soft)_6px)]"
    />
  );
}

export function Note({
  tone,
  children,
}: {
  tone: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11.5px] leading-snug font-medium",
        tone === "warn" ? "text-warn-ink" : "text-danger-deep",
      )}
    >
      <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * A labelled control in the row's detail strip — the few fields with no
 * column of their own. Label and value in one box, one line tall.
 */
export function StripField({
  label,
  tone,
  children,
}: {
  label: string;
  /** Amber for a control the entry cannot be filed without. */
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-stretch overflow-hidden rounded-md border bg-surface transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15",
        tone === "warn" ? "border-warn-line" : "border-line",
      )}
    >
      <span
        className={cn(
          "flex items-center border-r px-2 text-[9.5px] font-bold tracking-[0.06em] whitespace-nowrap uppercase",
          tone === "warn"
            ? "border-warn-line bg-warn-tint text-warn-deep"
            : "border-line bg-sunken-2 text-ink-5",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** A control inside a `StripField`, which draws the box round it. */
export const STRIP_CONTROL =
  "h-8 rounded-none border-0 bg-transparent px-2 text-[12px] shadow-none focus-visible:ring-0 data-popup-open:ring-0 aria-invalid:ring-0";
