"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Flag,
  History,
  Loader2,
  Plus,
  ShieldCheck,
  Sheet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Cell,
  GRID_COLUMNS,
  GRID_SPAN,
  GRID_WIDTH,
} from "@/components/factory/log/grid/grid-cells";
import {
  LogGridRow,
  type GridRowHandle,
} from "@/components/factory/log/grid/log-grid-row";
import {
  useLogRegisters,
  type LogRegisters,
} from "@/components/factory/log/grid/use-log-registers";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { actionKeys } from "@/lib/factory/action-queries";
import { batchStageKeys } from "@/lib/factory/batch-stage-queries";
import {
  readGridDraft,
  writeGridDraft,
  type GridDraft,
} from "@/lib/factory/log-grid-draft";
import { pipelineKeys } from "@/lib/factory/pipeline-queries";
import {
  createLogEntry,
  fetchLogEntries,
  formatMinutes,
  logKeys,
  type LogEntry,
} from "@/lib/factory/shift-log-queries";
import {
  resolveCurrentShift,
  todayKey,
} from "@/lib/factory/shift-time-queries";
import { useColumnResize } from "@/lib/use-column-resize";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * Shift log → Log entry → **Grid**.
 *
 * Every room the factory has set up in Admin, one line each, typed straight
 * into — the form's entry laid out as a sheet, for whoever is catching up the
 * whole floor at once rather than filing one room's hour.
 *
 * **One button files the sheet.** The lines are typed room by room and filed
 * together with Log all at the bottom (plain "Log" when only one line is
 * waiting). Each line is still its own entry with its own validation, so one
 * room's missing batch number never holds back the room below it: the valid
 * lines are filed, the others stay put with what is wrong said under them.
 *
 * **Each room lists today's entries**, locked, whoever filed them and from
 * whichever view — the sheet is the floor's day so far, so it shows what has
 * been done as well as what is left. Corrections to those are made from the
 * activity feed or the shift report, as everywhere.
 *
 * **A line is opened with + under its room**, as many as the room needs, its
 * start clock where the room's last entry ended. A filed line is removed: its
 * entry is now in the list above it.
 *
 * **Nothing typed is lost to a reload.** Unlogged lines are kept in the
 * browser (`log-grid-draft.ts`) until they are filed, cleared or removed.
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
  const queryClient = useQueryClient();

  /**
   * What was typed and not logged before the page last loaded — read once.
   * The grid only draws its rows once the setup lists arrive, which never
   * happens during server rendering, so reading storage here cannot make the
   * first client render disagree with the server's.
   */
  const [restored] = useState(() =>
    readGridDraft(factoryId, userId, todayKey()),
  );
  const restoredCount = Object.keys(restored?.rows ?? {}).length;
  const [noticeOpen, setNoticeOpen] = useState(restoredCount > 0);

  /**
   * The lines open for typing, per room, in order. None until + is pressed
   * under a room: an untyped line in every room was a sheet of twenty rows
   * each looking half filled in.
   */
  const [lines, setLines] = useState<Record<string, GridLine[]>>(() =>
    restoredLines(restored),
  );

  /** Every mounted line's handle, by row id — what Log all files through. */
  const handles = useRef(new Map<string, GridRowHandle>());
  /** The lines holding typed, unlogged work: the count on the button. */
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);

  const removeLines = useCallback((rowIds: ReadonlySet<string>) => {
    setLines((prev) => {
      const next: Record<string, GridLine[]> = {};
      for (const [unitId, list] of Object.entries(prev)) {
        next[unitId] = list.filter((line) => !rowIds.has(line.id));
      }
      return next;
    });
  }, []);
  const removeRow = useCallback(
    (rowId: string) => removeLines(new Set([rowId])),
    [removeLines],
  );

  const setRowPending = useCallback((rowId: string, pending: boolean) => {
    setPendingIds((prev) => {
      if (prev.has(rowId) === pending) return prev;
      const next = new Set(prev);
      if (pending) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  /** Every line that has ever mounted — see `saveDraft`. */
  const seen = useRef(new Set<string>());
  const registerRow = useCallback(
    (rowId: string, handle: GridRowHandle | null) => {
      if (handle) {
        handles.current.set(rowId, handle);
        seen.current.add(rowId);
      } else {
        handles.current.delete(rowId);
      }
    },
    [],
  );

  /* ── The draft ──────────────────────────────────────────────────────── */

  /**
   * Writes every unlogged line to the browser, or clears the key when there
   * are none. Skipped when nothing changed, so an idle sheet costs one
   * stringify per tick and no storage traffic.
   */
  const lastSaved = useRef("");
  const saveDraft = useCallback(() => {
    const rows: GridDraft["rows"] = {};
    for (const [rowId, handle] of handles.current) {
      const values = handle.draft();
      if (values) rows[rowId] = values;
    }
    // Restored lines whose rooms haven't drawn yet — the grid draws past the
    // first screenful a moment later — are carried over as they were, or a
    // save in that moment would drop them from storage. Once a line has
    // mounted it speaks for itself, and one removed since is meant to go.
    for (const [rowId, values] of Object.entries(restored?.rows ?? {})) {
      if (!seen.current.has(rowId)) rows[rowId] = values;
    }
    const extra: GridDraft["extraRows"] = {};
    for (const [unitId, list] of Object.entries(lines)) {
      const kept = list.map((line) => line.id).filter((id) => id in rows);
      if (kept.length > 0) extra[unitId] = kept;
    }
    const draft: GridDraft = { date: todayKey(), extraRows: extra, rows };

    const encoded = JSON.stringify(draft);
    if (encoded === lastSaved.current) return;
    lastSaved.current = encoded;
    writeGridDraft(factoryId, userId, draft);
  }, [lines, factoryId, userId, restored]);

  // On a timer, as the form's draft is saved: the lines are typed into far
  // more often than the draft needs writing. And at once whenever a line
  // starts or stops holding work, so a line logged or cleared leaves storage
  // straight away. `pagehide` and `visibilitychange` catch the reload, the
  // closed tab and the tablet put down — the moments the draft is for.
  useEffect(() => {
    saveDraft();
  }, [pendingIds, saveDraft]);
  useEffect(() => {
    const timer = setInterval(saveDraft, 2000);
    window.addEventListener("pagehide", saveDraft);
    document.addEventListener("visibilitychange", saveDraft);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", saveDraft);
      document.removeEventListener("visibilitychange", saveDraft);
    };
  }, [saveDraft]);

  /* ── Today, as filed ────────────────────────────────────────────────── */

  // The activity feed's own query and key, so the two views share one read
  // and both move when either files.
  const date = useRenderClock(todayKey);
  const { data: dayEntries = [] } = useQuery({
    queryKey: logKeys.day(factoryId, date),
    queryFn: () => fetchLogEntries(factoryId, date),
  });
  const loggedByUnit = useMemo(() => {
    const byUnit: Record<string, LogEntry[]> = {};
    for (const entry of dayEntries) {
      (byUnit[entry.unit_id] ??= []).push(entry);
    }
    // In the order the work happened, which is how the sheet reads down.
    for (const list of Object.values(byUnit)) {
      list.sort(
        (a, b) =>
          (a.start_time ?? "~").localeCompare(b.start_time ?? "~") ||
          a.created_at.localeCompare(b.created_at),
      );
    }
    return byUnit;
  }, [dayEntries]);

  /**
   * Opens a line under a room, its start clock where the room's work last
   * stopped — the next entry starts where the last one ended. That is the end
   * typed on the line above, when there is one waiting to be logged, or else
   * the end of the room's last entry filed today. A room that has logged
   * nothing today opens blank: the shift's start would be a guess, and a
   * guessed time looks exactly like a chosen one.
   */
  function addLine(unitId: string) {
    const above = (lines[unitId] ?? []).at(-1);
    let startAt = above ? (handles.current.get(above.id)?.endTime() ?? "") : "";
    if (!startAt) {
      const filed = loggedByUnit[unitId] ?? [];
      const last = filed.findLast((entry) => entry.end_time);
      startAt = last?.end_time?.slice(0, 5) ?? "";
    }
    const line = { id: `line-${crypto.randomUUID()}`, startAt };
    setLines((prev) => ({
      ...prev,
      [unitId]: [...(prev[unitId] ?? []), line],
    }));
  }

  /* ── Log all ────────────────────────────────────────────────────────── */

  /**
   * Held for the whole run, not just the render: a second press landing
   * before the button has re-rendered as disabled would file every line twice.
   */
  const filing = useRef(false);
  async function logAll() {
    if (filing.current) return;
    // Room order, each room's lines top to bottom — the order the sheet reads
    // in, and so the order a reader expects them filed.
    const waiting = registers.units
      .flatMap((u) => lines[u.id] ?? [])
      .filter((line) => pendingIds.has(line.id))
      .flatMap((line) => {
        const handle = handles.current.get(line.id);
        return handle ? [{ rowId: line.id, handle }] : [];
      });
    if (waiting.length === 0) return;

    filing.current = true;
    setBusy(true);
    setNoticeOpen(false);
    try {
      // Every line checked before any is filed, so everything wrong on the
      // sheet shows at once rather than one room per press.
      const checked = await Promise.all(
        waiting.map(async ({ rowId, handle }) => ({
          rowId,
          line: handle,
          values: await handle.validate(),
        })),
      );

      // The working day is read now, not when the grid opened — a grid left
      // open across midnight must not file under yesterday.
      const day = todayKey();
      let filed = 0;
      let lastFiled: LogEntry | null = null;
      const refused: string[] = [];
      /** Lines filed — removed once the run is over; their entries replace them. */
      const done = new Set<string>();

      // One at a time, never in parallel. The database judges each entry
      // against the ones before it — a stage's tolerance against what it has
      // already taken, a pipeline card's move against its last one — and two
      // inserts racing for the same stage could each pass a check that
      // together they fail.
      for (const { rowId, line, values } of checked) {
        if (!values) continue;
        try {
          const entry = await createLogEntry(
            values,
            userId,
            day,
            line.productId(),
          );
          // Above its line at once, rather than after the refetch below.
          queryClient.setQueryData<LogEntry[]>(
            logKeys.day(factoryId, day),
            (old) => (old ? [entry, ...old] : old),
          );
          line.logged();
          done.add(rowId);
          filed += 1;
          lastFiled = entry;
        } catch (e) {
          line.failed((e as Error).message);
          refused.push(line.unitName);
        }
      }

      // Now, not on the next tick: a reload in between would restore the
      // lines just filed, ready to be filed a second time.
      saveDraft();
      // The filed lines go; their entries are already above, locked. Lines
      // that were incomplete or refused stay, saying why.
      if (done.size > 0) removeLines(done);

      if (filed > 0) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: logKeys.factory(factoryId),
          }),
          queryClient.invalidateQueries({
            queryKey: ["shift_log_batch", factoryId],
          }),
          // The same triggers the form invalidates for: an entry can move a
          // pipeline card, raise an action, and change a stage's total.
          queryClient.invalidateQueries({
            queryKey: pipelineKeys.all(factoryId),
          }),
          queryClient.invalidateQueries({
            queryKey: actionKeys.all(factoryId),
          }),
          queryClient.invalidateQueries({
            queryKey: batchStageKeys.all(factoryId),
          }),
          // And the shift report, one tab away, is a sheet of exactly these.
          queryClient.invalidateQueries({
            queryKey: ["shift_report", factoryId],
          }),
        ]);
      }

      if (filed === 1 && lastFiled) {
        toast.success(
          `Logged — ${lastFiled.unit?.name ?? ""} · ${lastFiled.process?.name ?? ""}` +
            (lastFiled.duration_minutes
              ? ` · ${formatMinutes(lastFiled.duration_minutes)}`
              : ""),
        );
      } else if (filed > 1) {
        toast.success(`Logged ${filed} entries.`);
      }
      const invalid = checked
        .filter((c) => !c.values)
        .map((c) => c.line.unitName);
      if (invalid.length > 0) {
        toast.error(
          `${invalid.length} ${invalid.length === 1 ? "line isn't" : "lines aren't"} complete — ${listNames(invalid)}. What's missing is marked under each.`,
        );
      }
      if (refused.length > 0) {
        toast.error(
          `${refused.length} ${refused.length === 1 ? "line was" : "lines were"} refused — ${listNames(refused)}. The reason is under each.`,
        );
      }
    } finally {
      filing.current = false;
      setBusy(false);
    }
  }

  /* ── Layout ─────────────────────────────────────────────────────────── */

  /** Widths the viewer has dragged a column to — see `useColumnResize`. */
  const { widths, resizing, startResize } = useColumnResize(GRID_FLOORS);

  const shiftTimes = registers.shiftTimes;
  // The running shift, read on every render through the hook so the header
  // follows the clock across a handover (see `useRenderClock`).
  const running = useRenderClock(() =>
    shiftTimes ? resolveCurrentShift(shiftTimes) : null,
  );

  const pendingCount = pendingIds.size;

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

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-surface px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand-line text-brand">
            <Sheet className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold text-ink">Quick grid</h2>
            <p className="truncate text-[0.6875rem] text-ink-5">
              Every {units.singular.toLowerCase()} on one sheet — press + to
              add a line, then Log all at the bottom.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && shiftTimes && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[0.625rem] font-semibold text-brand-deep ring-1 ring-brand-line">
              {running === "morning" ? "Morning" : "Afternoon"} shift ·{" "}
              {shiftTimes[running].startTime} – {shiftTimes[running].endTime}
            </span>
          )}
          {dayEntries.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[0.625rem] font-semibold text-teal-deep ring-1 ring-teal-line/70">
              <Check className="size-3" />
              {dayEntries.length} logged today
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2.5 py-1 text-[0.625rem] font-semibold text-teal-deep ring-1 ring-teal-line/70">
            <ShieldCheck className="size-3" />
            Audit-protected
          </span>
        </div>
      </header>

      {/* Said once, after a reload put lines back: they are real typing, not
          a prefill, and they are not filed until Log all is pressed. */}
      {noticeOpen && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-warn-line bg-warn-tint px-5 py-2 text-[0.75rem] text-warn-ink">
          <p className="flex min-w-0 items-center gap-2">
            <History className="size-3.5 shrink-0" aria-hidden />
            <span>
              Restored {restoredCount}{" "}
              {restoredCount === 1 ? "line" : "lines"} you typed before the page
              reloaded. {restoredCount === 1 ? "It isn't" : "They aren't"}{" "}
              logged yet — check, then Log all.
            </span>
          </p>
          <button
            type="button"
            onClick={() => setNoticeOpen(false)}
            aria-label="Dismiss"
            className="grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-warn-soft"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Its own scroll box, both ways: the header row stays put going down,
          and the whole sheet moves together going across. */}
      <div
        className={cn(
          "scrollbar-slim min-h-[320px] overflow-auto lg:min-h-0 lg:flex-1",
          resizing && "cursor-col-resize select-none [&_*]:cursor-col-resize",
        )}
      >
        <table
          className="table-fixed border-separate border-spacing-0 text-[0.7812rem]"
          style={
            widths === null
              ? { width: GRID_WIDTH, minWidth: "100%" }
              : { width: widths.reduce((sum, w) => sum + w, 0) }
          }
        >
          <colgroup>
            {GRID_COLUMNS.map((column, i) => (
              <col
                key={column.key}
                style={{ width: widths?.[i] ?? column.width }}
              />
            ))}
          </colgroup>

          <thead>
            <tr>
              {GRID_COLUMNS.map((column, i) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-[3] border-b border-line bg-sunken-2 px-3 py-2.5 text-[0.625rem] leading-tight font-bold tracking-[0.07em] whitespace-nowrap text-ink-4 uppercase",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.key === "room" ? (
                    units.singular
                  ) : column.key === "actions" ? (
                    <span className="sr-only">Status</span>
                  ) : (
                    column.label
                  )}
                  {/* Every column but the last, which holds a status and a
                      button rather than anything to read. */}
                  {column.key !== "actions" && (
                    <ColumnResizeHandle
                      onPointerDown={(event) => startResize(i, event)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <RoomBlocks
            factoryId={factoryId}
            canManage={canManage}
            registers={registers}
            loggedByUnit={loggedByUnit}
            restoredRows={restored?.rows ?? NO_RESTORE}
            lines={lines}
            onAddRow={addLine}
            onRemoveRow={removeRow}
            onRegister={registerRow}
            onPendingChange={setRowPending}
          />
        </table>
      </div>

      <footer className="flex shrink-0 items-center justify-end border-t border-line-soft bg-gradient-to-b from-surface to-sunken px-5 py-2.5">
        {/* The sheet's one way to file. "Log" for a single line, "Log all"
            with the count once there is more than one, so the button says
            how much it is about to file before it is pressed. */}
        <div className="flex items-center gap-3">
          <span className="text-[0.75rem] font-medium text-ink-4">
            {pendingCount === 0
              ? "Nothing waiting to be logged"
              : `${pendingCount} ${pendingCount === 1 ? "line" : "lines"} not logged yet`}
          </span>
          <button
            type="button"
            onClick={() => void logAll()}
            disabled={busy || pendingCount === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-[0.8125rem] font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            {busy
              ? "Logging…"
              : pendingCount > 1
                ? `Log all (${pendingCount})`
                : "Log"}
          </button>
        </div>
      </footer>
    </section>
  );
}

/** The columns' starting widths — and how narrow a drag may take each one. */
const GRID_FLOORS = GRID_COLUMNS.map((column) => column.width);

/** "Room 1, Room 4 and Room 7", or the first few and a count. */
function listNames(names: string[]): string {
  if (names.length <= 3) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** One line open for typing, under its room. */
interface GridLine {
  id: string;
  /** Where its start clock opens, "HH:MM" — or "" for blank. */
  startAt: string;
}

/**
 * The lines a saved draft held, back under their rooms in their order.
 *
 * A line saved before every line was opened with + was keyed by its room
 * rather than listed under it; its values still name the room, so it is put
 * back there rather than lost.
 */
function restoredLines(draft: GridDraft | null): Record<string, GridLine[]> {
  const byUnit: Record<string, GridLine[]> = {};
  if (!draft) return byUnit;
  const placed = new Set<string>();
  for (const [unitId, ids] of Object.entries(draft.extraRows)) {
    for (const id of ids) {
      if (!(id in draft.rows)) continue;
      (byUnit[unitId] ??= []).push({ id, startAt: "" });
      placed.add(id);
    }
  }
  for (const [id, values] of Object.entries(draft.rows)) {
    if (placed.has(id) || !values.unitId) continue;
    (byUnit[values.unitId] ??= []).push({ id, startAt: "" });
  }
  return byUnit;
}

/** Nothing logged, no lines open — shared so an idle room's props never change. */
const NO_ENTRIES: LogEntry[] = [];
const NO_LINES: GridLine[] = [];
const NO_RESTORE: GridDraft["rows"] = {};

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
  canManage,
  registers,
  loggedByUnit,
  restoredRows,
  lines,
  onAddRow,
  onRemoveRow,
  onRegister,
  onPendingChange,
}: {
  factoryId: string;
  canManage: boolean;
  registers: LogRegisters;
  loggedByUnit: Record<string, LogEntry[]>;
  restoredRows: GridDraft["rows"];
  lines: Record<string, GridLine[]>;
  onAddRow: (unitId: string) => void;
  onRemoveRow: (rowId: string) => void;
  onRegister: (rowId: string, handle: GridRowHandle | null) => void;
  onPendingChange: (rowId: string, pending: boolean) => void;
}) {
  const total = registers.units.length;
  const shown = useDeferredValue(total, Math.min(total, FIRST_PAINT_ROOMS));

  return registers.units.slice(0, shown).map((unit) => (
    <RoomBlock
      key={unit.id}
      factoryId={factoryId}
      canManage={canManage}
      // The register's own object, not a fresh `{ id, name }`: a new object
      // per render would re-render every room whenever any one of them logs.
      unit={unit}
      registers={registers}
      logged={loggedByUnit[unit.id] ?? NO_ENTRIES}
      restoredRows={restoredRows}
      lines={lines[unit.id] ?? NO_LINES}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      onRegister={onRegister}
      onPendingChange={onPendingChange}
    />
  ));
}

/**
 * One room's block: what it has logged today, the lines open for typing
 * under it, and the + that opens another. A `tbody` per room so the block is
 * one unit on the sheet.
 */
function RoomBlock({
  factoryId,
  canManage,
  unit,
  registers,
  logged,
  restoredRows,
  lines,
  onAddRow,
  onRemoveRow,
  onRegister,
  onPendingChange,
}: {
  factoryId: string;
  canManage: boolean;
  unit: { id: string; name: string };
  registers: LogRegisters;
  logged: LogEntry[];
  restoredRows: GridDraft["rows"];
  lines: GridLine[];
  onAddRow: (unitId: string) => void;
  onRemoveRow: (rowId: string) => void;
  onRegister: (rowId: string, handle: GridRowHandle | null) => void;
  onPendingChange: (rowId: string, pending: boolean) => void;
}) {
  /** Nothing logged and nothing open — said in the heading, not left blank. */
  const empty = logged.length === 0 && lines.length === 0;

  return (
    <tbody>
      {/* A titled band opening each room, as the shift report opens its
          rooms. Without it a room with nothing logged was a lone "Add row"
          link, and the rooms ran into each other down the sheet. */}
      <tr>
        <td
          colSpan={GRID_SPAN}
          className="border-t border-line-strong bg-sunken-2 p-0"
        >
          {/* Pinned to the left edge, so the name stays in view however far
              the sheet is scrolled across. */}
          <div className="sticky left-0 flex w-fit items-center gap-3 px-3.5 py-2">
            <span className="flex items-center gap-2 text-[0.75rem] font-bold tracking-[0.07em] text-ink uppercase">
              <span aria-hidden className="h-3.5 w-1 rounded-full bg-brand" />
              {unit.name}
            </span>
            {empty && (
              <span className="text-[0.6875rem] text-ink-5">
                Nothing logged today.
              </span>
            )}
          </div>
        </td>
      </tr>

      {logged.map((entry) => (
        <LoggedRow key={entry.id} entry={entry} unitName={unit.name} />
      ))}

      {lines.map((line, i) => (
        <LogGridRow
          key={line.id}
          factoryId={factoryId}
          rowId={line.id}
          canManage={canManage}
          unit={unit}
          registers={registers}
          primary={i === 0}
          startAt={line.startAt}
          restored={restoredRows[line.id]}
          onRemove={() => onRemoveRow(line.id)}
          onRegister={onRegister}
          onPendingChange={onPendingChange}
        />
      ))}

      {/* Closes the room's block, under its last row — so a new line opens
          right where the button was pressed. Pinned to the left edge like
          the heading above. */}
      <tr>
        <td colSpan={GRID_SPAN} className="border-t border-line-soft p-0">
          <div className="sticky left-0 w-fit px-3.5 py-1.5">
            <button
              type="button"
              onClick={() => onAddRow(unit.id)}
              title={`Add a row for ${unit.name}`}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[0.625rem] font-semibold text-ink-4 transition hover:border-brand hover:bg-brand-tint hover:text-brand"
            >
              <Plus className="size-3" aria-hidden />
              Add row
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  );
}

/**
 * An entry already filed today — locked, in the teal the feed uses for a
 * landed entry, so the line under it is plainly the one to type into.
 */
function LoggedRow({
  entry,
  unitName,
}: {
  entry: LogEntry;
  unitName: string;
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
    time: (
      <span className="font-mono">
        {clock(entry.start_time)}
        {entry.end_time && (
          <span className="text-ink-5"> → {clock(entry.end_time)}</span>
        )}
      </span>
    ),
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
    <tr className="bg-teal-soft/50 [&>td]:h-9 [&>td]:border-t">
      {GRID_COLUMNS.map((column, i) => {
        if (column.key === "room") {
          return (
            <Cell
              key={column.key}
              title={`${unitName} — logged at ${filedAt}`}
            >
              <span className="flex h-9 items-center gap-1.5 pl-3.5 text-[0.75rem] text-teal-deep">
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
              <span className="flex h-9 items-center justify-end gap-1 px-3 text-[0.6875rem] font-semibold text-teal-deep">
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
            // The row's teal spine, on whichever column opens the sheet.
            className={cn(i === 0 && "border-l-3 border-l-teal")}
          >
            <span
              className={cn(
                "flex h-9 items-center px-3 text-[0.75rem] text-ink-3",
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
