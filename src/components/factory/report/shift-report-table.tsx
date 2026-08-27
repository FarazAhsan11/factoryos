"use client";

import { Flag } from "lucide-react";

import {
  formatQty,
  formatRunTime,
  progressPct,
  type ShiftReportRoom,
  type ShiftReportRow,
} from "@/lib/factory/shift-report-queries";
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
}: {
  rooms: ShiftReportRoom[];
  unitWord: string;
}) {
  return (
    /* Its own scroll box on screen so the sticky header holds and the summary
       strip stays put; on paper the box is undone entirely — a printed sheet
       has no scrollbar, and clipping the report to one viewport would lose
       every room past the first dozen. */
    <div className="scrollbar-slim overflow-auto lg:min-h-0 lg:flex-1 print:block print:overflow-visible">
      <table className="w-full min-w-[1180px] border-collapse text-[12px]">
        <thead>
          {/* The colour is on the row, but the stickiness has to be on the
              cells: `position: sticky` on a `<tr>` is ignored outside Firefox. */}
          <tr className="text-white print:bg-surface print:text-black">
            <Th>{unitWord}</Th>
            <Th>Status / stage</Th>
            <Th>EQ no.</Th>
            <Th align="right">Run time</Th>
            <Th>Product</Th>
            <Th>Code</Th>
            <Th>Batch</Th>
            <Th align="right">Shift qty</Th>
            <Th align="right">Accumulative</Th>
            <Th align="right">Required</Th>
            <Th>Progress</Th>
            <Th align="right">Rejected</Th>
            <Th>Operators</Th>
            <Th>Comments</Th>
            <Th align="right">Speed</Th>
            <Th align="right">Target speed</Th>
          </tr>
        </thead>

        <tbody>
          {rooms.map((room) =>
            room.entries.length === 0 ? (
              <IdleRow key={room.unitId} room={room} />
            ) : (
              <RoomBlock key={room.unitId} room={room} />
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
    /* One spanning cell, not fourteen em-dashes. The dashes were fourteen
       separate invitations to look for a number, and there is none to find —
       the answer is the status, and it fits in a sentence. */
    <tr className="border-t border-line-soft bg-sunken/60 print:bg-surface">
      <td colSpan={16} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12px] font-semibold text-ink-3">
            {room.name}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.07em] ring-1",
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
        </div>
      </td>
    </tr>
  );
}

function RoomBlock({ room }: { room: ShiftReportRoom }) {
  return (
    <>
      {/* A titled band opening each room, with what the room did on the
          right — the one figure a supervisor wants before reading the rows
          underneath it. */}
      <tr className="border-t border-line bg-sunken print:bg-sunken">
        <td colSpan={16} className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
          </div>
        </td>
      </tr>
      {room.entries.map((entry, i) => (
        <EntryRow key={entry.id} entry={entry} first={i === 0} room={room} />
      ))}
    </>
  );
}

function EntryRow({
  entry,
  first,
  room,
}: {
  entry: ShiftReportRow;
  first: boolean;
  room: ShiftReportRoom;
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
        "border-t border-line-soft align-top transition-colors",
        entry.action_flag
          ? "bg-danger-soft print:bg-danger-soft"
          : "hover:bg-brand-soft/40 print:hover:bg-transparent",
      )}
    >
      <Td className="text-[11px] text-ink-5">{first ? room.name : ""}</Td>

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

      <Td className="max-w-[150px] truncate" title={entry.product_name ?? ""}>
        {entry.product_name ?? "—"}
      </Td>
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

      <Td className="max-w-[130px] truncate" title={operators}>
        {operators || "—"}
      </Td>
      <Td className="max-w-[160px] truncate" title={remark ?? ""}>
        {remark || "—"}
      </Td>

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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em]",
        // A deep indigo band rather than flat near-black: it belongs to the
        // same family as everything else on the page, and the gradient keeps
        // a sixteen-column header from reading as a solid bar of ink.
        "bg-[linear-gradient(180deg,var(--color-ink)_0%,#1d2140_100%)] text-white/85",
        "print:static print:bg-surface print:text-black",
        align === "right" ? "text-right" : "text-left",
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
        "px-3 py-2.5 text-ink-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
