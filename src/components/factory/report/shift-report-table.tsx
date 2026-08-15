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
    <div className="overflow-x-auto rounded-2xl border border-[#E6EAF1] bg-white print:overflow-visible print:rounded-none print:border-0">
      <table className="w-full min-w-[1180px] border-collapse text-[12px]">
        <thead>
          <tr className="bg-[#0F1B34] text-white print:bg-white print:text-black">
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
            )
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
    <tr className="border-t border-[#EEF1F6] bg-[#FBFCFE] text-[#94A3B8] print:bg-white">
      <Td className="font-semibold text-[#64748B]">{room.name}</Td>
      <Td>
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            held ? "text-[#B45309]" : "text-[#94A3B8]"
          )}
        >
          {room.idleStatus}
        </span>
      </Td>
      {Array.from({ length: 14 }).map((_, i) => (
        <Td key={i} className="text-center text-[#CBD5E1]">
          —
        </Td>
      ))}
    </tr>
  );
}

function RoomBlock({ room }: { room: ShiftReportRoom }) {
  return (
    <>
      <tr className="border-t-2 border-[#E6EAF1] bg-[#F1F5F9] print:bg-[#F1F5F9]">
        <td
          colSpan={16}
          className="px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#0F1B34]"
        >
          {room.name}
          {room.producedQty > 0 && (
            <span className="ml-2 font-mono text-[11px] font-semibold normal-case tracking-normal text-[#475569]">
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
        "border-t border-[#EEF1F6] align-top",
        entry.action_flag && "bg-[#FEF2F2] print:bg-[#FEF2F2]"
      )}
    >
      <Td className="text-[11px] text-[#94A3B8]">{first ? room.name : ""}</Td>

      <Td>
        <span className="font-medium text-[#0F1B34]">
          {entry.process_name ?? "—"}
        </span>
        {entry.action_flag && (
          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[#B91C1C]">
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

      <Td align="right" className="font-mono font-semibold text-[#1D4ED8]">
        {formatQty(entry.qty)}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.accumulative)}
      </Td>
      <Td align="right" className="font-mono">
        {formatQty(entry.target_qty)}
      </Td>

      <Td>
        {pct === null ? (
          <span className="text-[#CBD5E1]">—</span>
        ) : (
          <div className="min-w-[64px]">
            <span className="font-mono text-[10.5px] font-semibold text-[#475569]">
              {pct}%
            </span>
            <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-[#EEF1F6]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background:
                    pct >= 80 ? "#16A34A" : pct >= 50 ? "#F59E0B" : "#DC2626",
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
          (entry.qty_rejected ?? 0) > 0 && "font-semibold text-[#B91C1C]"
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
        "whitespace-nowrap px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide",
        align === "right" ? "text-right" : "text-left"
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
        "px-3 py-2 text-[#334155]",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}
