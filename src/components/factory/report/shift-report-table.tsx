"use client";

import { Flag, History, PenLine } from "lucide-react";

import { formatMinutes } from "@/lib/factory/shift-log-queries";
import {
  formatQty,
  progressPct,
  type ShiftReportRoom,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import {
  REPORT_COLUMNS,
  REPORT_GROUPS,
} from "@/components/factory/report/report-columns";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { useColumnResize } from "@/lib/use-column-resize";
import { cn } from "@/lib/utils";

const COLUMNS = REPORT_COLUMNS;
const COLUMN_WIDTHS = COLUMNS.map((column) => column.width);
const TABLE_WIDTH = COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
/** Every column but the row's controls, which always open the sheet. */
const DATA_COLUMNS = COLUMNS.filter((column) => column.key !== "edit");
/** Each group with how many columns its heading spans. */
const GROUPS = REPORT_GROUPS.map((group) => ({
  ...group,
  span: COLUMNS.filter((column) => column.group === group.key).length,
}));
/** The columns that open a group, which is where the gap before a panel goes. */
const GROUP_OPENERS = new Set(
  REPORT_GROUPS.map(
    (group) => COLUMNS.find((column) => column.group === group.key)?.key,
  ),
);
/**
 * The gap between two panels. A border the colour of the sheet rather than a
 * rule, so a group ends in open space. On each cell, heading and body alike,
 * which only lines up because the table's borders are separate: a collapsed
 * border straddles the column edge, and scrolls away from a sticky heading.
 */
const PANEL_GAP = "border-l-[0.375rem] border-l-surface";

/** "06:45:00" → "06:45". */
function clock(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

/**
 * The report proper: the rooms that logged something, in room order, with what
 * each ran this shift.
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
  onHistory,
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
  /** Opens an amended entry's history. Anyone reading the sheet may. */
  onHistory: (entry: ShiftReportRow) => void;
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
          "table-fixed border-separate border-spacing-0 text-[0.75rem]",
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
          {/* The group titles. Stickiness has to be on the cells:
              `position: sticky` on a `<tr>` is ignored outside Firefox. The
              cell is the sheet's colour and the cap sits inside it, because a
              rounded corner on the cell itself would round the gap instead. */}
          <tr>
            <td className="sticky top-0 z-10 h-8 bg-surface print:hidden" />
            {GROUPS.map((group) => (
              <th
                key={group.key}
                colSpan={group.span}
                scope="colgroup"
                className="sticky top-0 z-10 h-8 bg-surface pt-2 pl-1.5 text-left align-bottom print:static"
              >
                <span
                  style={{ "--accent": group.accent } as React.CSSProperties}
                  className="flex h-6 items-center rounded-t-lg bg-ink px-3 text-[0.5938rem] font-bold tracking-[0.1em] whitespace-nowrap text-(--accent) uppercase shadow-[inset_0_0.125rem_0_0_var(--accent)] print:bg-surface print:text-black print:shadow-none"
                >
                  {group.label}
                </span>
              </th>
            ))}
          </tr>
          <tr>
            {/* A cell here for every column, the controls' included:
                `useColumnResize` reads this row's cells as the column list. */}
            {COLUMNS.map((column, i) =>
              column.key === "edit" ? (
                /* The edit column is leftmost so it is reachable without
                   scrolling the sheet sideways, and it carries no heading: an
                   icon column labelled "Edit" spends a header on something
                   the icon already says. */
                <th
                  key={column.key}
                  className="sticky top-8 z-10 bg-surface print:hidden"
                >
                  <span className="sr-only">
                    Correct entry and amendment history
                  </span>
                </th>
              ) : (
                <Th
                  key={column.key}
                  align={column.align}
                  className={cn(GROUP_OPENERS.has(column.key) && PANEL_GAP)}
                  onResize={resize(i)}
                >
                  {column.key === "room" ? unitWord : column.label}
                </Th>
              ),
            )}
          </tr>
        </thead>

        <tbody>
          {rooms.map((room) => (
            <RoomBlock
              key={room.unitId}
              room={room}
              onEdit={onEdit}
              onHistory={onHistory}
              canEdit={canEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoomBlock({
  room,
  onEdit,
  onHistory,
  canEdit,
}: {
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  onHistory: (entry: ShiftReportRow) => void;
  canEdit: (entry: ShiftReportRow) => boolean;
}) {
  return (
    <>
      {room.entries.map((entry, i) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          first={i === 0}
          room={room}
          onEdit={onEdit}
          onHistory={onHistory}
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
  onHistory,
  canEdit,
}: {
  entry: ShiftReportRow;
  first: boolean;
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  onHistory: (entry: ShiftReportRow) => void;
  canEdit: boolean;
}) {
  const operators = entry.operators?.filter(Boolean).join(", ");
  // A preparatory room says what it counts in; a production stage counts in
  // whatever its plan does. Nothing to count, nothing to count it in.
  const unit =
    entry.qty === null ? null : (entry.qty_unit ?? entry.stage_unit);

  const cells: Record<string, ReportCell> = {
    // On every row, not just a room's first: this column is what the CSV and
    // the printed sheet are read by. Stronger on the first, so the rooms can
    // be found running down the sheet without a band between them.
    room: {
      value: room.name,
      title: room.name,
      className: cn(
        "text-[0.6875rem]",
        first ? "font-semibold text-ink-2" : "text-ink-4",
      ),
    },
    stage: {
      value: (
        <>
          <span className="font-medium text-ink">
            {entry.process_name ?? "—"}
          </span>
          {entry.action_flag && (
            <span className="mt-0.5 flex items-center gap-1 text-[0.6562rem] font-bold uppercase tracking-wide text-danger-deep">
              <Flag className="size-3 shrink-0" />
              {entry.action_flag}
            </span>
          )}
        </>
      ),
    },
    // When, as the Log history shows it: the start, and the end after an
    // arrow, a shade lighter — the duration beside it is the figure; this is
    // when it happened.
    time: {
      value: (
        <>
          {entry.start_time ? clock(entry.start_time) : "—"}
          {entry.end_time && (
            <span className="text-ink-5"> → {clock(entry.end_time)}</span>
          )}
        </>
      ),
      className: "font-mono text-[0.6875rem] text-ink-3",
    },
    runTime: {
      value: formatMinutes(entry.duration_minutes),
      className: "font-mono text-[0.6875rem]",
    },
    batch: {
      value: entry.batch_no || "—",
      className: "font-mono text-[0.6875rem]",
    },
    product: {
      value: entry.product_name ?? "—",
      title: entry.product_name ?? "",
    },
    code: {
      value: entry.product_code || "—",
      className: "font-mono text-[0.6875rem]",
    },
    qty: {
      value: formatQty(entry.qty),
      className: "font-mono font-semibold text-brand-deep",
    },
    unit: { value: unit ?? "—", className: "text-[0.6875rem]" },
    target: { value: formatQty(entry.target_qty), className: "font-mono" },
    rejected: {
      value: formatQty(entry.qty_rejected),
      className: cn(
        "font-mono",
        (entry.qty_rejected ?? 0) > 0 && "font-semibold text-danger-deep",
      ),
    },
    accumulative: {
      value: <Accumulative entry={entry} />,
      className: "font-mono",
    },
    targetSpeed: { value: entry.target_speed || "—", className: "font-mono" },
    actualSpeed: {
      value: entry.actual_speed
        ? `${entry.actual_speed}${entry.speed_unit ? ` ${entry.speed_unit}` : ""}`
        : "—",
      className: "font-mono",
    },
    slowReason: {
      value: entry.slow_reason || "—",
      title: entry.slow_reason ?? "",
    },
    equipment: {
      value: entry.equipment_no || "—",
      className: "font-mono text-[0.6875rem]",
    },
    operators: { value: operators || "—", title: operators },
    comments: { value: entry.comment || "—", title: entry.comment ?? "" },
  };

  // Row rules live on the cells: a separate-borders table draws none on a row.
  // A shade stronger where one room hands over to the next.
  const rule = first ? "border-t-line-strong" : "border-t-line-soft";

  return (
    <tr
      className={cn(
        "group align-middle transition-colors",
        entry.action_flag
          ? "bg-danger-soft print:bg-danger-soft"
          : "bg-surface hover:bg-brand-soft/40 print:hover:bg-transparent",
      )}
    >
      {/* Carries the row spine as well as the pencil and the history.

          A solid bar down the left of every filed row, the same way the
          activity feed's spine does, taking its colour from the row: red where
          the entry is flagged, brand where it is ordinary.

          The pencil is dimmed until the row is hovered or the button is
          focused, so a sheet of forty rows isn't forty pencils competing with
          the numbers — but never hidden, because a control that only exists on
          hover cannot be found on a tablet.

          The history shows only on an entry that has been amended, in the
          violet an amendment is everywhere else, so a corrected row can be
          picked out without opening anything. */}
      <Td
        className={cn(
          "px-1.5 print:hidden",
          rule,
          entry.action_flag
            ? "shadow-[inset_4px_0_0_0_var(--color-danger)]"
            : "shadow-[inset_4px_0_0_0_var(--color-brand)]",
        )}
      >
        <span className="flex items-center gap-0.5">
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
          {entry.amended_at && (
            <button
              type="button"
              onClick={() => onHistory(entry)}
              title="Amendment history"
              aria-label={`Amendment history of the ${entry.process_name ?? "entry"} entry in ${room.name}`}
              className="grid size-6 place-items-center rounded-lg text-violet transition hover:bg-violet-soft hover:text-violet-deep focus-visible:ring-3 focus-visible:ring-brand/25 focus-visible:outline-none"
            >
              <History className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      </Td>

      {DATA_COLUMNS.map((column) => {
        const cell = cells[column.key];
        return (
          <Td
            key={column.key}
            align={column.align}
            title={cell.title}
            className={cn(
              rule,
              GROUP_OPENERS.has(column.key) && PANEL_GAP,
              // The family the palette keeps for computed fields, see-through
              // so a tinted cell stays part of a red flagged row.
              column.derived && "bg-brand-soft/50",
              cell.className,
            )}
          >
            {cell.value}
          </Td>
        );
      })}
    </tr>
  );
}

/** One cell's content, by column key — `REPORT_COLUMNS` decides where it goes. */
interface ReportCell {
  value: React.ReactNode;
  title?: string;
  className?: string;
}

/**
 * The batch's running total, with its progress under it. Progress has no column
 * of its own on the plant's sheet, and this is the figure it is drawn from.
 */
function Accumulative({ entry }: { entry: ShiftReportRow }) {
  const pct = progressPct(entry);
  return (
    <>
      {formatQty(entry.accumulative)}
      {pct !== null && (
        <span className="mt-1 flex items-center gap-1.5" title={`${pct}%`}>
          <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
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
          <span className="text-[0.5625rem] font-semibold text-ink-3">
            {pct}%
          </span>
        </span>
      )}
    </>
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
        "sticky top-8 z-10 px-3 py-2 text-[0.625rem] leading-tight font-bold tracking-[0.06em] break-normal uppercase",
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
        "truncate border-t px-3 py-2 text-ink-2",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
