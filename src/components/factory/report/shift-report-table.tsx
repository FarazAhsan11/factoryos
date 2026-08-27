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
    <div className="overflow-auto rounded-2xl border border-line bg-surface lg:min-h-0 lg:flex-1 print:block print:overflow-visible print:rounded-none print:border-0">
      <table className="w-full min-w-[1180px] border-collapse text-[12px]">
        <thead>
          {/* The colour is on the row, but the stickiness has to be on the
              cells: `position: sticky` on a `<tr>` is ignored outside Firefox. */}
          <tr className="bg-ink text-white print:bg-surface print:text-black">
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
    <tr className="border-t border-line-soft bg-sunken text-ink-5 print:bg-surface">
      <Td className="font-semibold text-ink-4">{room.name}</Td>
      <Td>
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            held ? "text-warn-deep" : "text-ink-5",
          )}
        >
          {room.idleStatus}
        </span>
      </Td>
      {Array.from({ length: 14 }).map((_, i) => (
        <Td key={i} className="text-center text-ink-6">
          —
        </Td>
      ))}
    </tr>
  );
}

function RoomBlock({ room }: { room: ShiftReportRoom }) {
  return (
    <>
      <tr className="border-t-2 border-line bg-sunken-2 print:bg-sunken-2">
        <td
          colSpan={16}
          className="px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink"
        >
          {room.name}
          {room.producedQty > 0 && (
            <span className="ml-2 font-mono text-[11px] font-semibold normal-case tracking-normal text-ink-3">
              {room.producedQty.toLocaleString()} this shift
            </span>
          )}
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
        "border-t border-line-soft align-top",
        entry.action_flag && "bg-danger-soft print:bg-danger-soft",
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
          <div className="min-w-[64px]">
            <span className="font-mono text-[10.5px] font-semibold text-ink-3">
              {pct}%
            </span>
            <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
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
        "sticky top-0 z-10 whitespace-nowrap bg-ink px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide",
        "print:static print:bg-surface",
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
        "px-3 py-2 text-ink-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
