"use client";

import { Flag, PenLine } from "lucide-react";

import { formatMinutes, type LogEntry } from "@/lib/factory/shift-log-queries";
import { cn } from "@/lib/utils";

/** 540000 → "540,000"; null stays a dash, never a 0. */
function fmt(n: number | null | undefined) {
  return n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** The colour of the row's spine — the reading the shift-log feed gives it. */
function tone(entry: LogEntry): string {
  if (entry.action_flag) return "var(--color-danger)";
  if (Number(entry.qty_rejected ?? 0) > 0) return "var(--color-warn)";
  if (Number(entry.qty ?? 0) > 0) return "var(--color-teal)";
  return "var(--color-brand-line)";
}

/**
 * Everything the floor logged against one batch, newest first.
 *
 * A table, not cards. Cards were the first cut and they were wrong here: five
 * entries filled a screen, and the question this tab answers — how did the
 * batch's runs compare, where did the rejects come from, which hour is
 * missing — is a question about a *column*, which cards cannot show. Issues
 * and Maintenance stay as cards because each of those is one document with a
 * story; a shift entry is a row of figures.
 *
 * No batch or product column: the masthead above says which batch this is, and
 * repeating it on every row would spend the width the figures need.
 */
export function BatchActivityList({
  entries,
  onOpen,
}: {
  entries: LogEntry[];
  onOpen: (entry: LogEntry) => void;
}) {
  return (
    <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
      {/* Fixed layout with declared widths, the same rule the shift report
          learned: auto layout sizes each column to whatever happens to be in
          it, so the headings stop sitting over their own figures the moment
          one comment runs long. */}
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-[12px]">
        <colgroup>
          <col className="w-[124px]" />
          <col className="w-[92px]" />
          <col className="w-[136px]" />
          <col className="w-[116px]" />
          <col className="w-[76px]" />
          <col className="w-[80px]" />
          <col className="w-[108px]" />
          <col className="w-[84px]" />
          <col className="w-[104px]" />
          <col className="w-[130px]" />
        </colgroup>

        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Room</Th>
            <Th>Activity</Th>
            <Th>Ran</Th>
            <Th align="right">Time</Th>
            <Th>EQ no.</Th>
            <Th align="right">Output</Th>
            <Th align="right">Rejected</Th>
            <Th align="right">Speed</Th>
            <Th>Operators</Th>
          </tr>
        </thead>

        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              tabIndex={0}
              role="button"
              onClick={() => onOpen(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(entry);
                }
              }}
              className={cn(
                "group cursor-pointer border-t border-line-soft transition-colors focus-visible:outline-none",
                entry.action_flag
                  ? "bg-danger-soft hover:bg-danger-tint"
                  : "bg-surface hover:bg-brand-soft/40",
                "focus-visible:bg-brand-soft/60",
              )}
            >
              {/* The date carries the spine, so a flagged or rejected row is
                  visible down the left edge without reading a cell. */}
              <Td
                className="font-mono"
                style={{ boxShadow: `inset 4px 0 0 0 ${tone(entry)}` }}
              >
                <span className="block truncate">{entry.log_date}</span>
                <span className="block truncate text-[10.5px] text-ink-5 capitalize">
                  {entry.shift}
                </span>
              </Td>

              <Td className="truncate" title={entry.unit?.name ?? ""}>
                {entry.unit?.name ?? "—"}
              </Td>

              <Td className="truncate" title={entry.process?.name ?? ""}>
                <span className="font-medium text-ink">
                  {entry.process?.name ?? "—"}
                </span>
                {entry.action_flag && (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] font-bold tracking-wide text-danger-deep uppercase">
                    <Flag className="size-2.5 shrink-0" aria-hidden />
                    {entry.action_flag}
                  </span>
                )}
                {/* An amended row is a corrected row, and on a batch record
                    that is the fact somebody is looking for. */}
                {entry.amended_at && !entry.action_flag && (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-violet">
                    <PenLine className="size-2.5 shrink-0" aria-hidden />
                    Amended
                  </span>
                )}
              </Td>

              <Td className="font-mono text-ink-3">
                {entry.start_time?.slice(0, 5) ?? "—"}
                {entry.end_time && ` → ${entry.end_time.slice(0, 5)}`}
              </Td>
              <Td align="right" className="font-mono text-ink-3">
                {entry.duration_minutes > 0
                  ? formatMinutes(entry.duration_minutes)
                  : "—"}
              </Td>
              <Td className="truncate font-mono text-ink-3">
                {entry.equipment_no || "—"}
              </Td>

              <Td
                align="right"
                className="font-mono font-semibold text-brand-deep"
              >
                {fmt(entry.qty)}
                {/* A preparatory room made "3 drums", not "3". */}
                {entry.qty_unit && entry.qty !== null && (
                  <span className="ml-1 text-[9px] font-medium text-ink-5">
                    {entry.qty_unit}
                  </span>
                )}
              </Td>
              <Td
                align="right"
                className={cn(
                  "font-mono",
                  (entry.qty_rejected ?? 0) > 0 &&
                    "font-semibold text-danger-deep",
                )}
              >
                {fmt(entry.qty_rejected)}
              </Td>
              <Td align="right" className="font-mono text-ink-3">
                {entry.target_speed
                  ? `${entry.actual_speed ?? "—"} / ${entry.target_speed}`
                  : "—"}
              </Td>

              <Td
                className="truncate"
                title={entry.operators?.join(", ") ?? ""}
              >
                {entry.operators?.length ? entry.operators.join(", ") : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        // Wraps at spaces, never inside a word — a heading split into
        // "REJECTE / D" reads as a typo in a record people sign.
        "sticky top-0 z-10 px-2.5 py-2 text-[10px] leading-tight font-bold tracking-[0.06em] break-normal uppercase",
        "bg-[linear-gradient(180deg,var(--color-ink)_0%,#1d2140_100%)] text-white/85",
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
  style,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td
      title={title}
      style={style}
      className={cn(
        "px-2.5 py-2 align-middle text-ink-2",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
