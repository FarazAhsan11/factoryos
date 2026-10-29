"use client";

import { Flag, PenLine } from "lucide-react";

import {
  formatQty,
  formatRunTime,
  progressPct,
  type ShiftReportRoom,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import {
  REPORT_COLUMNS,
  REPORT_SPAN,
} from "@/components/factory/report/report-columns";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { useColumnResize } from "@/lib/use-column-resize";
import { cn } from "@/lib/utils";

const COLUMNS = REPORT_COLUMNS;
const COLUMN_WIDTHS = COLUMNS.map((column) => column.width);
const TABLE_WIDTH = COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
const SPAN = REPORT_SPAN;

/** "06:45:00" → "06:45". */
function clock(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

/**
 * The report proper: every room, in room order, with what it ran this shift.
 *
 * Not the prototype's columns as they were. Three of its columns showed
 * the same numbers twice — *Shift Total* and *Achieved* were both `qty`,
 * *Required* and *Target* were both `target_qty` — and a wide sheet that
 * prints one figure in two places invites the reader to hunt for a difference
 * that cannot exist. *WO* is gone because no work order is captured anywhere
 * in FactoryOS; it rendered blank for every row in the prototype too.
 */
export function ShiftReportTable({
  rooms,
  unitWord,
  onEdit,
  canEdit,
}: {
  rooms: ShiftReportRoom[];
  unitWord: string;
  /**
   * Opens the correction dialog on one entry. Reading the sheet is when a
   * supervisor notices a wrong figure, so the fix starts on the row they are
   * already looking at rather than a page away in the entry feed.
   */
  onEdit: (entry: ShiftReportRow) => void;
  /** Their own entry, or a manager's — the same rule RLS enforces on the write. */
  canEdit: (entry: ShiftReportRow) => boolean;
}) {
  /** Widths the viewer has dragged a column to — see `useColumnResize`. */
  const { widths, resizing, startResize } = useColumnResize(COLUMN_WIDTHS);
  const resize = (index: number) => (event: React.PointerEvent<HTMLElement>) =>
    startResize(index, event);

  return (
    /* Its own scroll box on screen so the sticky header holds and the summary
       strip stays put; on paper the box is undone entirely — a printed sheet
       has no scrollbar, and clipping the report to one viewport would lose
       every room past the first dozen. */
    <div
      className={cn(
        "scrollbar-slim overflow-auto lg:min-h-0 lg:flex-1 print:block print:overflow-visible",
        resizing && "cursor-col-resize select-none [&_*]:cursor-col-resize",
      )}
    >
      {/* `table-fixed`, with every column given a width in pixels.

          Three approaches were tried here and two were wrong. Auto layout
          sized each column to whatever happened to be in it, so no heading sat
          over its own figures and the grid moved as the shift filled up.
          Percentage widths fixed the grid but sized the columns to the table
          instead of to their contents, which left headings too narrow to hold
          their own words — first clipped to "ACCUMU…", then, once wrapping was
          allowed, split down the middle into "REQUIRE / D".

          Pixels sized to the longest word each column has to hold is the
          answer. Eighteen columns of real words do not fit a laptop, and
          pretending otherwise is what broke the headings; the sheet is wider
          than the window and scrolls, which is what a wide sheet does. Headings
          still wrap at spaces — "TARGET / SPEED" — but never inside a word. */}
      <table
        className={cn(
          "table-fixed border-collapse text-[0.75rem]",
          widths === null && "w-full",
        )}
        style={
          widths === null
            ? { minWidth: TABLE_WIDTH }
            : { width: widths.reduce((sum, w) => sum + w, 0) }
        }
      >
        <colgroup>
          {COLUMN_WIDTHS.map((width, i) => (
            <col key={i} style={{ width: widths?.[i] ?? width }} />
          ))}
        </colgroup>

        <thead>
          {/* The colour is on the row, but the stickiness has to be on the
              cells: `position: sticky` on a `<tr>` is ignored outside Firefox. */}
          <tr className="text-white print:bg-surface print:text-black">
            {COLUMNS.map((column, i) =>
              column.key === "edit" ? (
                /* The edit column is leftmost so it is reachable without
                   scrolling the sheet sideways, and it carries no heading: an
                   icon column labelled "Edit" spends a header on something
                   the icon already says. */
                <Th key={column.key} className="print:hidden">
                  <span className="sr-only">Correct entry</span>
                </Th>
              ) : (
                <Th
                  key={column.key}
                  align={column.align}
                  onResize={resize(i)}
                >
                  {column.key === "room" ? unitWord : column.label}
                </Th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {/* A room with entries gets a heading and its rows; a room without
              keeps a line of its own rather than dropping off the sheet. */}
          {rooms.map((room) =>
            room.entries.length === 0 ? (
              <IdleRow key={room.unitId} room={room} />
            ) : (
              <RoomBlock
                key={room.unitId}
                room={room}
                onEdit={onEdit}
                canEdit={canEdit}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A room that logged nothing this shift — kept on the sheet, not dropped.
 *
 * A report listing only the busy rooms can't answer "was anything running in
 * 7?", and the blank row is the answer. Its status comes from the pipeline
 * board: a room holding a batch is not the same as a room standing ready.
 */
function IdleRow({ room }: { room: ShiftReportRoom }) {
  const held = room.idleStatus === "HOLD";
  return (
    /* One line across the sheet, starting where a busy room's band title
       starts. Room is no longer the first column — the sheet opens on when —
       so a name parked in the Room column sat behind an empty time band, in
       the middle of the sheet, out of line with every other room's name.

       Still not a row of em-dashes: the dashes were so many separate
       invitations to look for a number, and there is none to find — the answer
       is the status, and it fits in a sentence. */
    <tr className="border-t border-line-soft bg-sunken-2/70 print:bg-surface">
      <td className="print:hidden" />
      <td colSpan={SPAN - 1} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* A fixed width, so the statuses down the sheet line up. */}
          <span
            title={room.name}
            className="w-[6.5rem] shrink-0 truncate text-[0.75rem] font-medium text-ink-4"
          >
            {room.name}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.625rem] font-bold tracking-[0.07em] uppercase ring-1",
              held
                ? "bg-warn-soft text-warn-deep ring-warn-line"
                : "bg-sunken-2 text-ink-4 ring-line",
            )}
          >
            {room.idleStatus}
          </span>
          <span className="text-[0.6875rem] text-ink-5">
            Nothing logged this shift.
          </span>
        </div>
      </td>
    </tr>
  );
}

function RoomBlock({
  room,
  onEdit,
  canEdit,
}: {
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  canEdit: (entry: ShiftReportRow) => boolean;
}) {
  return (
    <>
      {/* A titled band opening each room: its name, nothing else. The entry
          count and produced total used to sit beside the name, and both are
          already on the sheet — the rows are right underneath to be counted,
          and the summary strip above the table carries the shift's produced
          total. Said twice, they were noise between the reader and the rows. */}
      <tr className="border-t border-line bg-sunken-2 print:bg-sunken">
        {/* An empty cell for the edit column, so the band's title starts where
            the sheet's first column starts rather than at the table's edge. */}
        <td className="print:hidden" />
        <td colSpan={SPAN - 1} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-[0.75rem] font-bold uppercase tracking-[0.07em] text-ink">
              <span
                aria-hidden
                className="h-3.5 w-1 rounded-full bg-brand print:hidden"
              />
              {room.name}
            </span>
          </div>
        </td>
      </tr>
      {room.entries.map((entry, i) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          first={i === 0}
          room={room}
          onEdit={onEdit}
          canEdit={canEdit(entry)}
        />
      ))}
    </>
  );
}

function EntryRow({
  entry,
  first,
  room,
  onEdit,
  canEdit,
}: {
  entry: ShiftReportRow;
  first: boolean;
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  canEdit: boolean;
}) {
  const pct = progressPct(entry);
  const operators = entry.operators?.filter(Boolean).join(", ");
  // The comment is what someone chose to say; the slow reason is what the form
  // made them pick. Show the comment when there is one, fall back to the
  // reason — an empty cell where a run was flagged slow reads as nothing wrong.
  const remark = entry.comment || entry.slow_reason;

  return (
    <tr
      className={cn(
        "group border-t border-line-soft align-middle transition-colors",
        // Three backgrounds, three kinds of row, darkest to lightest: the
        // room band, then a room that logged nothing, then this — a real
        // entry, on white. They were all within a few percent of each other,
        // which left a filed entry looking like a placeholder for one.
        entry.action_flag
          ? "bg-danger-soft print:bg-danger-soft"
          : "bg-surface hover:bg-brand-soft/40 print:hover:bg-transparent",
      )}
    >
      {/* Carries the row spine as well as the pencil.

          Three near-identical greys were never going to answer "is this an
          entry or an empty room?" — the palette's steps are eight shades
          apart and the sheet is read at arm length. A solid bar down the left
          of every filed row does answer it, the same way the activity feed's
          spine does, and it takes its colour from the row: red where the entry
          is flagged, brand where it is ordinary.

          The pencil itself is dimmed until the row is hovered or the button is
          focused, so a sheet of forty rows isn't forty pencils competing with
          the numbers — but never hidden, because a control that only exists on
          hover cannot be found on a tablet. */}
      <Td
        className={cn(
          "print:hidden",
          entry.action_flag
            ? "shadow-[inset_4px_0_0_0_var(--color-danger)]"
            : "shadow-[inset_4px_0_0_0_var(--color-brand)]",
        )}
      >
        {canEdit ? (
          <button
            type="button"
            onClick={() => onEdit(entry)}
            title="Correct this entry"
            aria-label={`Correct the ${entry.process_name ?? "entry"} entry in ${room.name}`}
            className="grid size-6 place-items-center rounded-lg text-ink-6 opacity-60 transition group-hover:opacity-100 hover:bg-brand-soft hover:text-brand focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-brand/25 focus-visible:outline-none"
          >
            <PenLine className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span
            title="Only the operator who filed this entry, or a manager, can correct it"
            className="grid size-6 place-items-center text-ink-6/40"
            aria-hidden
          >
            <PenLine className="size-3.5" />
          </span>
        )}
      </Td>

      {/* When, as the Log history shows it: the start, and the end after an
          arrow, a shade lighter — the run time beside it is the figure; this
          is when it happened. */}
      <Td className="font-mono text-[0.6875rem] text-ink-3">
        {entry.start_time ? clock(entry.start_time) : "—"}
        {entry.end_time && (
          <span className="text-ink-5"> → {clock(entry.end_time)}</span>
        )}
      </Td>
      <Td align="right" className="font-mono">
        {formatRunTime(entry.duration_minutes)}
      </Td>

      {/* Named once per room — the band above carries it, and repeating it
          down every row of a nine-entry block is noise. Kept as a column all
          the same: it is what the CSV export and the printed sheet are read
          by, where there are no bands to look up to. */}
      <Td
        className="text-[0.6875rem] text-ink-5"
        title={first ? room.name : undefined}
      >
        {first ? room.name : ""}
      </Td>

      <Td>
        <span className="font-medium text-ink">
          {entry.process_name ?? "—"}
        </span>
        {entry.action_flag && (
          <span className="mt-0.5 flex items-center gap-1 text-[0.6562rem] font-bold uppercase tracking-wide text-danger-deep">
            <Flag className="size-3 shrink-0" />
            {entry.action_flag}
          </span>
        )}
      </Td>

      <Td className="font-mono text-[0.6875rem]">
        {entry.batch_no || "—"}
      </Td>
      <Td title={entry.product_name ?? ""}>
        {entry.product_name ?? "—"}
      </Td>
      <Td className="font-mono text-[0.6875rem]">
        {entry.product_code || "—"}
      </Td>

      <Td
        align="right"
        className="font-mono font-semibold text-brand-deep"
      >
        {formatQty(entry.qty)}
        {/* A preparatory room hands over "3 drums", not "3". On a printed
            handover the bare number is the one thing nobody can go back and
            ask about. */}
        {entry.qty_unit && entry.qty !== null && (
          <span className="ml-1 text-[0.5625rem] font-medium text-ink-5">
            {entry.qty_unit}
          </span>
        )}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.target_qty)}
      </Td>
      <Td
        align="right"
        className={cn(
          "font-mono",
          (entry.qty_rejected ?? 0) > 0 && "font-semibold text-danger-deep",
        )}
      >
        {formatQty(entry.qty_rejected)}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.accumulative)}
      </Td>

      <Td>
        {pct === null ? (
          <span className="text-ink-6">—</span>
        ) : (
          <div className="min-w-[72px]">
            <span className="font-mono text-[0.6562rem] font-semibold tabular-nums text-ink-3">
              {pct}%
            </span>
            <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background:
                    pct >= 80
                      ? "var(--color-teal)"
                      : pct >= 50
                        ? "var(--color-warn)"
                        : "var(--color-danger)",
                }}
              />
            </span>
          </div>
        )}
      </Td>

      <Td align="right" className="font-mono">
        {entry.target_speed || "—"}
      </Td>
      <Td align="right" className="font-mono">
        {entry.actual_speed
          ? `${entry.actual_speed}${entry.speed_unit ? ` ${entry.speed_unit}` : ""}`
          : "—"}
      </Td>

      <Td className="font-mono text-[0.6875rem]">
        {entry.equipment_no || "—"}
      </Td>
      <Td title={operators}>
        {operators || "—"}
      </Td>

      <Td title={remark ?? ""}>
        {remark || "—"}
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
  className,
  onResize,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Starts dragging this column's right edge; no handle without it. */
  onResize?: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <th
      className={cn(
        // Wraps at spaces, never inside a word, and never truncated. A
        // heading clipped to "ACCUMU…" names nothing, and one split into
        // "REQUIRE / D" is worse — it reads as a typo in a document people
        // sign. `break-normal` is what forbids the second; the column widths
        // above are what make the first unnecessary.
        "sticky top-0 z-10 px-3 py-2 text-[0.625rem] leading-tight font-bold tracking-[0.06em] break-normal uppercase",
        // A deep indigo band rather than flat near-black: it belongs to the
        // same family as everything else on the page, and the gradient keeps
        // a sixteen-column header from reading as a solid bar of ink.
        "bg-[linear-gradient(180deg,var(--color-ink)_0%,#1d2140_100%)] text-white/85",
        "print:static print:bg-surface print:text-black",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
      {onResize && (
        <ColumnResizeHandle
          onPointerDown={onResize}
          className="before:bg-white/15 hover:before:bg-white/80"
        />
      )}
    </th>
  );
}

function Td({
  children,
  className,
  align = "left",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        // `truncate` on every cell, because fixed layout does not shrink a
        // column to fit its contents — without it a long product name pushes
        // its own text under the neighbouring column instead of ending in an
        // ellipsis. The full string stays in the cell's `title`.
        "truncate px-3 py-2 text-ink-2",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
