"use client";

import { useState } from "react";
import { Flag, PenLine, Plus } from "lucide-react";

import {
  formatQty,
  formatRunTime,
  progressPct,
  type ShiftReportRoom,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
import { NewEntryRow } from "@/components/factory/report/new-entry-row";
import type { RunningShift } from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * The report proper: every room, in room order, with what it ran this shift.
 *
 * Fifteen columns, not the prototype's eighteen. Three of its columns showed
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
  factoryId,
  userId,
  date,
  shift,
}: {
  rooms: ShiftReportRoom[];
  unitWord: string;
  factoryId: string;
  /** The viewer, who is also the author of any row added here. */
  userId: string;
  /** The sheet's date and shift — what a row added here is filed against. */
  date: string;
  shift: RunningShift;
  /**
   * Opens the correction dialog on one entry. Reading the sheet is when a
   * supervisor notices a wrong figure, so the fix starts on the row they are
   * already looking at rather than a page away in the entry feed.
   */
  onEdit: (entry: ShiftReportRow) => void;
  /** Their own entry, or a manager's — the same rule RLS enforces on the write. */
  canEdit: (entry: ShiftReportRow) => boolean;
}) {
  /**
   * The room a new row is open on, if any. One at a time: two half-typed rows
   * on one sheet is two ways to lose the other.
   */
  const [adding, setAdding] = useState<string | null>(null);

  return (
    /* Its own scroll box on screen so the sticky header holds and the summary
       strip stays put; on paper the box is undone entirely — a printed sheet
       has no scrollbar, and clipping the report to one viewport would lose
       every room past the first dozen. */
    <div className="scrollbar-slim overflow-auto lg:min-h-0 lg:flex-1 print:block print:overflow-visible">
      {/* `table-fixed`, with every column given a width in pixels.

          Three approaches were tried here and two were wrong. Auto layout
          sized each column to whatever happened to be in it, so no heading sat
          over its own figures and the grid moved as the shift filled up.
          Percentage widths fixed the grid but sized the columns to the table
          instead of to their contents, which left headings too narrow to hold
          their own words — first clipped to "ACCUMU…", then, once wrapping was
          allowed, split down the middle into "REQUIRE / D".

          Pixels sized to the longest word each column has to hold is the
          answer. Seventeen columns of real words do not fit a laptop, and
          pretending otherwise is what broke the headings; the sheet is wider
          than the window and scrolls, which is what a wide sheet does. Headings
          still wrap at spaces — "TARGET / SPEED" — but never inside a word. */}
      <table className="w-full min-w-[1614px] table-fixed border-collapse text-[12px]">
        <colgroup>
          {/* The edit column. Not hidden here for print — `display:none` on a
              `<col>` is not honoured the way it is on a cell, and the `th`/`td`
              already carry `print:hidden`. */}
          <col className="w-[34px]" />
          <col className="w-[84px]" />
          <col className="w-[110px]" />
          <col className="w-[76px]" />
          <col className="w-[88px]" />
          <col className="w-[140px]" />
          <col className="w-[74px]" />
          <col className="w-[80px]" />
          <col className="w-[92px]" />
          {/* "ACCUMULATIVE" is the longest unbreakable word on the sheet, and
              this column is sized to it rather than the other way round. */}
          <col className="w-[118px]" />
          <col className="w-[90px]" />
          <col className="w-[96px]" />
          <col className="w-[90px]" />
          <col className="w-[110px]" />
          <col className="w-[140px]" />
          <col className="w-[96px]" />
          <col className="w-[96px]" />
        </colgroup>

        <thead>
          {/* The colour is on the row, but the stickiness has to be on the
              cells: `position: sticky` on a `<tr>` is ignored outside Firefox. */}
          <tr className="text-white print:bg-surface print:text-black">
            {/* The edit column is leftmost so it is reachable without
                scrolling a sixteen-column sheet sideways, and it carries no
                heading: an icon column labelled "Edit" spends a header on
                something the icon already says. */}
            <Th className="print:hidden">
              <span className="sr-only">Correct entry</span>
            </Th>
            <Th>{unitWord}</Th>
            <Th>Status / stage</Th>
            <Th>EQ no.</Th>
            <Th align="right">Run time</Th>
            <Th>Product</Th>
            <Th>Code</Th>
            <Th>Batch</Th>
            <Th align="right">Shift qty</Th>
            <Th align="right">Accumulative</Th>
            {/* Not "Required": this column holds the entry own target_qty —
                speed times how long it ran, what this shift was expected to
                make — and "Required qty" everywhere else in FactoryOS means
                the batch order quantity. One word made a handover sheet read
                as "this batch needs 10,000" where it said "this shift was
                expected to make 10,000". Named as the log form names it. */}
            <Th align="right">Shift target</Th>
            <Th>Progress</Th>
            <Th align="right">Rejected</Th>
            <Th>Operators</Th>
            <Th>Comments</Th>
            <Th align="right">Speed</Th>
            <Th align="right">Target speed</Th>
          </tr>
        </thead>

        <tbody>
          {rooms.map((room) => (
            <RoomRows
              key={room.unitId}
              room={room}
              onEdit={onEdit}
              canEdit={canEdit}
              adding={adding === room.unitId}
              onAdd={() => setAdding(room.unitId)}
              onDoneAdding={() => setAdding(null)}
              factoryId={factoryId}
              userId={userId}
              date={date}
              shift={shift}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One room's place on the sheet: its heading or its idle line, its entries,
 * and — while it is open — the row being typed into it.
 *
 * A room with entries and a room without were two different rows before this,
 * and the `+` has to sit on both: an entry missed in a room that logged
 * nothing is exactly the one worth catching.
 */
function RoomRows({
  room,
  onEdit,
  canEdit,
  adding,
  onAdd,
  onDoneAdding,
  factoryId,
  userId,
  date,
  shift,
}: {
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  canEdit: (entry: ShiftReportRow) => boolean;
  adding: boolean;
  onAdd: () => void;
  onDoneAdding: () => void;
  factoryId: string;
  userId: string;
  date: string;
  shift: RunningShift;
}) {
  return (
    <>
      {room.entries.length === 0 ? (
        <IdleRow room={room} onAdd={onAdd} />
      ) : (
        <RoomBlock
          room={room}
          onEdit={onEdit}
          canEdit={canEdit}
          onAdd={onAdd}
        />
      )}
      {adding && (
        <NewEntryRow
          factoryId={factoryId}
          userId={userId}
          date={date}
          shift={shift}
          unit={{ id: room.unitId, name: room.name }}
          onDone={onDoneAdding}
        />
      )}
    </>
  );
}

/**
 * Adds a row to this room. Quiet until the room is hovered, like the pencil
 * on an entry — a sheet of twenty rooms must not be twenty invitations to
 * type — but never hidden, because a control that only exists on hover cannot
 * be found on a tablet.
 */
function AddButton({ room, onAdd }: { room: string; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      title={`Add an entry for ${room}`}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[10px] font-semibold text-ink-5 opacity-70 transition group-hover/room:opacity-100 hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:opacity-100 print:hidden"
    >
      <Plus className="size-3" aria-hidden />
      Add entry
    </button>
  );
}

/**
 * A room that logged nothing this shift — kept on the sheet, not dropped.
 *
 * A report listing only the busy rooms can't answer "was anything running in
 * 7?", and the blank row is the answer. Its status comes from the pipeline
 * board: a room holding a batch is not the same as a room standing ready.
 */
function IdleRow({
  room,
  onAdd,
}: {
  room: ShiftReportRoom;
  onAdd: () => void;
}) {
  const held = room.idleStatus === "HOLD";
  return (
    /* Three cells, not one spanning cell.

       It was a single `colSpan={17}` and that is what put the room name at the
       left edge of the table while the ROOM heading sat 46px further in, over
       the column it names — the complaint that read as "the columns do not line
       up" was this row ignoring the columns entirely. The name now sits in the
       Room column and the status in Status / stage, where their headings are;
       only the message spans, because there is nothing to put under the other
       fourteen headings.

       Still not fourteen em-dashes: the dashes were fourteen separate
       invitations to look for a number, and there is none to find — the answer
       is the status, and it fits in a sentence. */
    <tr className="group/room border-t border-line-soft bg-sunken/60 print:bg-surface">
      <td className="print:hidden" />
      <Td className="text-[12px] font-semibold text-ink-3" title={room.name}>
        {room.name}
      </Td>
      <td colSpan={15} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.07em] uppercase ring-1",
              held
                ? "bg-warn-soft text-warn-deep ring-warn-line"
                : "bg-sunken-2 text-ink-4 ring-line",
            )}
          >
            {room.idleStatus}
          </span>
          <span className="text-[11px] text-ink-5">
            Nothing logged this shift.
          </span>
          <AddButton room={room.name} onAdd={onAdd} />
        </div>
      </td>
    </tr>
  );
}

function RoomBlock({
  room,
  onEdit,
  canEdit,
  onAdd,
}: {
  room: ShiftReportRoom;
  onEdit: (entry: ShiftReportRow) => void;
  canEdit: (entry: ShiftReportRow) => boolean;
  onAdd: () => void;
}) {
  return (
    <>
      {/* A titled band opening each room, with what the room did beside the
          name — the one figure a supervisor wants before reading the rows
          underneath it.

          Beside it, not opposite it. The band spans the sheet, so pushing its
          summary to the far edge parked "1 entry · 200 produced" underneath
          SPEED and TARGET SPEED, where it read as those columns' values for
          this row. Nothing that is not a column's value may sit under that
          column's heading. */}
      <tr className="group/room border-t border-line bg-sunken print:bg-sunken">
        {/* An empty cell for the edit column, so the band's title starts where
            the Room column starts rather than at the table's edge. */}
        <td className="print:hidden" />
        <td colSpan={16} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.07em] text-ink">
              <span
                aria-hidden
                className="h-3.5 w-1 rounded-full bg-brand print:hidden"
              />
              {room.name}
            </span>
            <span className="flex items-center gap-2 text-[11px] text-ink-4">
              <span>
                {room.entries.length}{" "}
                {room.entries.length === 1 ? "entry" : "entries"}
              </span>
              {room.producedQty > 0 && (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10.5px] font-semibold text-brand-deep print:bg-surface">
                  {room.producedQty.toLocaleString()} produced
                </span>
              )}
            </span>
            <AddButton room={room.name} onAdd={onAdd} />
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
        entry.action_flag
          ? "bg-danger-soft print:bg-danger-soft"
          : "hover:bg-brand-soft/40 print:hover:bg-transparent",
      )}
    >
      {/* Dimmed until the row is hovered or the button is focused, so a sheet
          of forty rows isn't forty pencils competing with the numbers — but
          never hidden, because a control that only exists on hover cannot be
          found on a tablet. */}
      <Td className="print:hidden">
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

      {/* Named once per room — the band above carries it, and repeating it
          down every row of a nine-entry block is noise. Kept as a column all
          the same: it is what the CSV export and the printed sheet are read
          by, where there are no bands to look up to. */}
      <Td
        className="text-[11px] text-ink-5"
        title={first ? room.name : undefined}
      >
        {first ? room.name : ""}
      </Td>

      <Td>
        <span className="font-medium text-ink">
          {entry.process_name ?? "—"}
        </span>
        {entry.action_flag && (
          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-danger-deep">
            <Flag className="size-3 shrink-0" />
            {entry.action_flag}
          </span>
        )}
      </Td>

      <Td className="font-mono text-[11px]">{entry.equipment_no || "—"}</Td>
      <Td align="right" className="font-mono">
        {formatRunTime(entry.duration_minutes)}
      </Td>

      <Td title={entry.product_name ?? ""}>{entry.product_name ?? "—"}</Td>
      <Td className="font-mono text-[11px]">{entry.product_code || "—"}</Td>
      <Td className="font-mono text-[11px]">{entry.batch_no || "—"}</Td>

      <Td align="right" className="font-mono font-semibold text-brand-deep">
        {formatQty(entry.qty)}
        {/* A preparatory room hands over "3 drums", not "3". On a printed
            handover the bare number is the one thing nobody can go back and
            ask about. */}
        {entry.qty_unit && entry.qty !== null && (
          <span className="ml-1 text-[9px] font-medium text-ink-5">
            {entry.qty_unit}
          </span>
        )}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.accumulative)}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.target_qty)}
      </Td>

      <Td>
        {pct === null ? (
          <span className="text-ink-6">—</span>
        ) : (
          <div className="min-w-[72px]">
            <span className="font-mono text-[10.5px] font-semibold tabular-nums text-ink-3">
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

      <Td
        align="right"
        className={cn(
          "font-mono",
          (entry.qty_rejected ?? 0) > 0 && "font-semibold text-danger-deep",
        )}
      >
        {formatQty(entry.qty_rejected)}
      </Td>

      <Td title={operators}>{operators || "—"}</Td>
      <Td title={remark ?? ""}>{remark || "—"}</Td>

      <Td align="right" className="font-mono">
        {entry.actual_speed
          ? `${entry.actual_speed}${entry.speed_unit ? ` ${entry.speed_unit}` : ""}`
          : "—"}
      </Td>
      <Td align="right" className="font-mono">
        {entry.target_speed || "—"}
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        // Wraps at spaces, never inside a word, and never truncated. A
        // heading clipped to "ACCUMU…" names nothing, and one split into
        // "REQUIRE / D" is worse — it reads as a typo in a document people
        // sign. `break-normal` is what forbids the second; the column widths
        // above are what make the first unnecessary.
        "sticky top-0 z-10 px-3 py-2 text-[10px] leading-tight font-bold tracking-[0.06em] break-normal uppercase",
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
