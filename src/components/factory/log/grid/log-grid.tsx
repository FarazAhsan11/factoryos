"use client";

import { useCallback, useDeferredValue, useRef, useState } from "react";
import { Check, Flag, Plus, ShieldCheck, Sheet } from "lucide-react";

import {
  Cell,
  GRID_COLUMNS,
  GRID_SPAN,
  GRID_WIDTH,
} from "@/components/factory/log/grid/grid-cells";
import { LogGridRow } from "@/components/factory/log/grid/log-grid-row";
import {
  useLogRegisters,
  type LogRegisters,
} from "@/components/factory/log/grid/use-log-registers";
import { formatMinutes, type LogEntry } from "@/lib/factory/shift-log-queries";
import { resolveCurrentShift } from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/**
 * Shift log → Log entry → **Grid**.
 *
 * Every room the factory has set up in Admin, one line each, typed straight
 * into — the form's entry laid out as a sheet, for whoever is catching up the
 * whole floor at once rather than filing one room's hour.
 *
 * Each line is its own entry with its own validation and its own Log button
 * (or Enter), so one room's missing batch number never holds back the room
 * below it. A logged line settles into a locked row above, and the line under
 * it carries the run forward for the next hour. "Add row" gives a room a second
 * line for a second thing running in it at the same time.
 *
 * What is logged here is shown for this sitting only. The entries themselves
 * are in the database like any other — the activity feed beside the form and
 * the shift report tab both list them, and corrections are made there.
 */
export function LogGrid({
  factoryId,
  userId,
  units,
  canManage,
}: {
  factoryId: string;
  userId: string;
  units: { singular: string; plural: string };
  canManage: boolean;
}) {
  const registers = useLogRegisters(factoryId);

  /** Lines added with "Add row", per room, beyond the room's own. */
  const [extraRows, setExtraRows] = useState<Record<string, string[]>>({});
  /** What each room has filed from this grid, oldest first. */
  const [logged, setLogged] = useState<Record<string, LogEntry[]>>({});
  const nextKey = useRef(0);

  const addRow = useCallback((unitId: string) => {
    nextKey.current += 1;
    const key = `extra-${nextKey.current}`;
    setExtraRows((prev) => ({
      ...prev,
      [unitId]: [...(prev[unitId] ?? []), key],
    }));
  }, []);

  const removeRow = useCallback((unitId: string, key: string) => {
    setExtraRows((prev) => ({
      ...prev,
      [unitId]: (prev[unitId] ?? []).filter((k) => k !== key),
    }));
  }, []);

  const addLogged = useCallback((unitId: string, entry: LogEntry) => {
    setLogged((prev) => ({
      ...prev,
      [unitId]: [...(prev[unitId] ?? []), entry],
    }));
  }, []);

  const loggedCount = Object.values(logged).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  if (!registers.setupReady) return <GridSkeleton />;

  if (registers.units.length === 0 || registers.processes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-6 bg-surface px-4 py-12 text-center text-sm text-ink-5">
        {registers.units.length === 0
          ? `No ${units.plural.toLowerCase()} set up yet.`
          : "No process stages set up yet."}
        <br />
        Add them in Admin &amp; Settings before logging entries.
      </div>
    );
  }

  const shiftTimes = registers.shiftTimes;
  const running = shiftTimes ? resolveCurrentShift(shiftTimes) : null;

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand-line text-brand">
            <Sheet className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Quick grid</h2>
            <p className="truncate text-[11px] text-ink-5">
              Every {units.singular.toLowerCase()} on one sheet — fill a line
              and press Log, or Enter.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && shiftTimes && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand-deep ring-1 ring-brand-line">
              {running === "morning" ? "Morning" : "Afternoon"} shift ·{" "}
              {shiftTimes[running].startTime} – {shiftTimes[running].endTime}
            </span>
          )}
          {loggedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[10px] font-semibold text-teal-deep ring-1 ring-teal-line/70">
              <Check className="size-3" />
              {loggedCount} logged
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[10px] font-semibold text-teal-deep ring-1 ring-teal-line/70">
            <ShieldCheck className="size-3" />
            Audit-protected
          </span>
        </div>
      </header>

      {/* Its own scroll box, both ways: the header row stays put going down,
          and the whole sheet moves together going across. */}
      <div className="scrollbar-slim min-h-[320px] overflow-auto lg:min-h-0 lg:flex-1">
        <table
          className="table-fixed border-separate border-spacing-0 text-[12.5px]"
          style={{ width: GRID_WIDTH, minWidth: "100%" }}
        >
          <colgroup>
            {GRID_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {GRID_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-[3] border-b border-line bg-sunken-2 px-3 py-2.5 text-[10px] leading-tight font-bold tracking-[0.07em] whitespace-nowrap text-ink-4 uppercase",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.key === "room" ? (
                    units.singular
                  ) : column.key === "actions" ? (
                    <span className="sr-only">Log</span>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <RoomBlocks
            factoryId={factoryId}
            userId={userId}
            canManage={canManage}
            registers={registers}
            logged={logged}
            extraRows={extraRows}
            onAddRow={addRow}
            onRemoveRow={removeRow}
            onLogged={addLogged}
          />
        </table>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line-soft bg-gradient-to-b from-surface to-sunken px-5 py-2.5 text-[11px] text-ink-5">
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="size-3 shrink-0" aria-hidden />
          Corrections are amendments, not deletes — made from the activity feed
          or the shift report.
        </p>
        <p>
          Hatched cells don&rsquo;t apply to the chosen activity.
        </p>
      </footer>
    </section>
  );
}

/** Nothing logged, no rows added — shared so an idle room's props never change. */
const NO_ENTRIES: LogEntry[] = [];
const NO_ROWS: string[] = [];

/**
 * How many rooms the grid draws on its first paint. Enough to fill a screen;
 * the rest follow in a background render (see `RoomBlocks`).
 */
const FIRST_PAINT_ROOMS = 8;

/**
 * Every room's block, drawn in two passes.
 *
 * A grid row is a whole entry form — a dozen controls, each with its own
 * popup machinery — and twenty-five of them in one synchronous render is what
 * made opening the grid stall. `useDeferredValue` with an initial value paints
 * the first screenful at once and renders the remaining rooms at background
 * priority straight after, so the sheet is usable before it is complete and
 * nothing a user does waits on rooms below the fold.
 *
 * Its own component so the deferral starts when the rooms first exist: a hook
 * in the grid itself would mount while the registers were still loading, and
 * the "first paint" would be spent on zero rooms.
 */
function RoomBlocks({
  factoryId,
  userId,
  canManage,
  registers,
  logged,
  extraRows,
  onAddRow,
  onRemoveRow,
  onLogged,
}: {
  factoryId: string;
  userId: string;
  canManage: boolean;
  registers: LogRegisters;
  logged: Record<string, LogEntry[]>;
  extraRows: Record<string, string[]>;
  onAddRow: (unitId: string) => void;
  onRemoveRow: (unitId: string, key: string) => void;
  onLogged: (unitId: string, entry: LogEntry) => void;
}) {
  const total = registers.units.length;
  const shown = useDeferredValue(total, Math.min(total, FIRST_PAINT_ROOMS));

  return registers.units.slice(0, shown).map((unit) => (
    <RoomBlock
      key={unit.id}
      factoryId={factoryId}
      userId={userId}
      canManage={canManage}
      // The register's own object, not a fresh `{ id, name }`: a new object
      // per render would re-render every room whenever any one of them logs.
      unit={unit}
      registers={registers}
      logged={logged[unit.id] ?? NO_ENTRIES}
      extraRows={extraRows[unit.id] ?? NO_ROWS}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      onLogged={onLogged}
    />
  ));
}

/**
 * One room's block: what it has logged from here, its own line, any lines
 * added to it, and the way to add another. A `tbody` per room so the block is
 * one unit on the sheet.
 */
function RoomBlock({
  factoryId,
  userId,
  canManage,
  unit,
  registers,
  logged,
  extraRows,
  onAddRow,
  onRemoveRow,
  onLogged,
}: {
  factoryId: string;
  userId: string;
  canManage: boolean;
  unit: { id: string; name: string };
  registers: LogRegisters;
  logged: LogEntry[];
  extraRows: string[];
  onAddRow: (unitId: string) => void;
  onRemoveRow: (unitId: string, key: string) => void;
  onLogged: (unitId: string, entry: LogEntry) => void;
}) {
  const handleLogged = (entry: LogEntry) => onLogged(unit.id, entry);

  return (
    <tbody>
      {logged.map((entry, i) => (
        <LoggedRow
          key={entry.id}
          entry={entry}
          unitName={unit.name}
          first={i === 0}
        />
      ))}

      <LogGridRow
        factoryId={factoryId}
        userId={userId}
        canManage={canManage}
        unit={unit}
        registers={registers}
        primary
        first={logged.length === 0}
        onLogged={handleLogged}
      />

      {extraRows.map((key) => (
        <LogGridRow
          key={key}
          factoryId={factoryId}
          userId={userId}
          canManage={canManage}
          unit={unit}
          registers={registers}
          primary={false}
          first={false}
          onRemove={() => onRemoveRow(unit.id, key)}
          onLogged={handleLogged}
        />
      ))}

      <tr>
        <td colSpan={GRID_SPAN} className="p-0">
          {/* Pinned to the left edge, so it stays under the room name however
              far the sheet is scrolled across. */}
          <button
            type="button"
            onClick={() => onAddRow(unit.id)}
            className="sticky left-0 inline-flex h-7 items-center gap-1 px-3.5 text-[11px] font-semibold text-brand/80 transition hover:text-brand"
          >
            <Plus className="size-3" aria-hidden />
            Add row for {unit.name}
          </button>
        </td>
      </tr>
    </tbody>
  );
}

/**
 * A line already filed from this grid — locked, in the teal the feed uses for
 * a landed entry, so the next line under it is plainly the one to type into.
 */
function LoggedRow({
  entry,
  unitName,
  first,
}: {
  entry: LogEntry;
  unitName: string;
  first: boolean;
}) {
  const fmt = (n: number | null) =>
    n === null || n === undefined
      ? "—"
      : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const clock = (t: string | null) => (t ? t.slice(0, 5) : "—");
  const operators = entry.operators?.filter(Boolean).join(", ");
  const filedAt = new Date(entry.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const values: Record<string, React.ReactNode> = {
    activity: (
      <span className="flex items-center gap-1.5">
        <span className="truncate font-medium text-ink-2">
          {entry.process?.name ?? "—"}
        </span>
      </span>
    ),
    batch: <span className="font-mono">{entry.batch_no || "—"}</span>,
    product: entry.product?.name ?? "—",
    start: <span className="font-mono">{clock(entry.start_time)}</span>,
    end: <span className="font-mono">{clock(entry.end_time)}</span>,
    hrs: (
      <span className="font-mono">
        {entry.duration_minutes ? formatMinutes(entry.duration_minutes) : "—"}
      </span>
    ),
    qty: (
      <span className="font-mono font-semibold text-brand-deep">
        {fmt(entry.qty)}
      </span>
    ),
    unit: entry.qty_unit ?? "—",
    rejected: <span className="font-mono">{fmt(entry.qty_rejected)}</span>,
    target: <span className="font-mono">{fmt(entry.target_qty)}</span>,
    operators: operators || "—",
    equipment: <span className="font-mono">{entry.equipment_no || "—"}</span>,
    speedUnit: entry.speed_unit ?? "—",
    targetSpeed: <span className="font-mono">{fmt(entry.target_speed)}</span>,
    actualSpeed: <span className="font-mono">{fmt(entry.actual_speed)}</span>,
    flag: entry.action_flag ? (
      <span className="inline-flex items-center gap-1 font-semibold text-danger-deep">
        <Flag className="size-3" /> {entry.action_flag}
      </span>
    ) : (
      "—"
    ),
    comment: entry.comment || entry.slow_reason || "—",
  };

  return (
    <tr
      className={cn(
        "bg-teal-soft/50 [&>td]:h-9 [&>td]:border-t",
        first && "[&>td]:border-t-line-strong",
      )}
    >
      {GRID_COLUMNS.map((column) => {
        if (column.key === "room") {
          return (
            <Cell
              key={column.key}
              title={`${unitName} — logged at ${filedAt}`}
              className="shadow-[inset_3px_0_0_0_var(--color-teal)]"
            >
              <span className="flex h-9 items-center gap-1.5 pl-3.5 text-[12px] text-teal-deep">
                <Check className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{unitName}</span>
              </span>
            </Cell>
          );
        }
        if (column.key === "actions") {
          return (
            <Cell
              key={column.key}
            >
              <span className="flex h-9 items-center justify-end gap-1 px-3 text-[11px] font-semibold text-teal-deep">
                Logged {filedAt}
              </span>
            </Cell>
          );
        }
        const value = values[column.key];
        return (
          <Cell
            key={column.key}
            title={typeof value === "string" ? value : undefined}
          >
            <span
              className={cn(
                "flex h-9 items-center px-3 text-[12px] text-ink-3",
                column.align === "right" && "justify-end",
              )}
            >
              <span className="min-w-0 truncate">{value}</span>
            </span>
          </Cell>
        );
      })}
    </tr>
  );
}

function GridSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1">
      <div className="h-[58px] shrink-0 animate-pulse border-b border-line bg-sunken" />
      <div className="h-9 shrink-0 animate-pulse border-b border-line bg-sunken-2" />
      <div className="min-h-[320px] flex-1 animate-pulse bg-sunken/40" />
    </div>
  );
}
