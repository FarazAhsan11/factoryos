"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import { AmendEntryDialog } from "@/components/factory/data/amend-entry-dialog";
import { ExplainOverrunDialog } from "@/components/factory/data/explain-overrun-dialog";
import {
  fetchLogEntries,
  fetchOverrunFlags,
  formatMinutes,
  logKeys,
  type LogEntry,
  type OverrunFlag,
} from "@/lib/factory/shift-log-queries";
import { todayKey } from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/** Colour-codes a row the way the prototype's feed dots do. */
function tone(entry: LogEntry): string {
  if (entry.action_flag) return "var(--color-danger)";
  if (Number(entry.qty_rejected ?? 0) > 0) return "var(--color-warn)";
  if (Number(entry.qty ?? 0) > 0) return "var(--color-teal)";
  return "var(--color-brand-line)";
}

function fmt(n: number | null) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Today's entries, newest first — the operator's receipt that a log landed,
 * and the supervisor's running view of the shift.
 *
 * Entries are never edited or deleted here. The only write is an amendment:
 * a correction note attached beside the original, offered on hover to whoever
 * the update policy would actually allow (the author, or a manager).
 */
export function ActivityFeed({
  factoryId,
  units,
  userId,
  canManage,
}: {
  factoryId: string;
  units: { singular: string; plural: string };
  userId: string;
  canManage: boolean;
}) {
  const [amendTarget, setAmendTarget] = useState<LogEntry | null>(null);
  const [overrunTarget, setOverrunTarget] = useState<LogEntry | null>(null);
  const [unitFilter, setUnitFilter] = useState("all");
  // Today only. This is the operator's receipt that an entry landed and the
  // supervisor's running view of the shift in progress — history is the Data
  // table's job, and a date picker here just built a second, worse one.
  // Recomputed each render rather than held in state, so a session left open
  // rolls onto the new day at midnight instead of freezing on yesterday.
  const date = todayKey();

  const {
    data: entries = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: logKeys.day(factoryId, date),
    queryFn: () => fetchLogEntries(factoryId, date),
  });

  // Separate from the feed's own read: an overrun compares a batch's running
  // total against its requirement, and that total is a window function that
  // only exists in `shift_log_entries_expanded`. Merged by id below.
  const { data: overruns } = useQuery({
    queryKey: logKeys.overruns(factoryId, date),
    queryFn: () => fetchOverrunFlags(factoryId, date),
  });

  const unitNames = useMemo(
    () =>
      [
        ...new Set(entries.map((e) => e.unit?.name).filter(Boolean)),
      ].sort() as string[],
    [entries],
  );

  const visible = useMemo(
    () =>
      unitFilter === "all"
        ? entries
        : entries.filter((e) => e.unit?.name === unitFilter),
    [entries, unitFilter],
  );

  return (
    /* Its own scroll container, not a sticky block in the page's scroll. The
       feed and the form are two views of the same shift and are read against
       each other — tying them to one scrollbar meant reaching the bottom of
       the form pushed the feed off the top of the screen. */
    <aside className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:h-full">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Shift activity</h2>
          {entries.length > 0 && (
            <span className="text-[11px] font-medium text-ink-5">
              {entries.length} today
            </span>
          )}
        </div>
        <span
          title="Entries appear here the moment they are filed, and are never edited in place"
          className="inline-flex items-center gap-1.5 rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-semibold text-teal-deep ring-1 ring-teal-line/70"
        >
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-teal-deep" />
          </span>
          Live · immutable
        </span>
      </header>

      {unitNames.length > 1 && (
        <div className="shrink-0 border-b border-line-soft bg-sunken px-4 py-2.5">
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            aria-label={`Filter by ${units.singular.toLowerCase()}`}
            className="select-chevron h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink outline-none transition hover:border-ink-6 focus:border-brand focus:ring-4 focus:ring-brand/12"
          >
            <option value="all">All {units.plural.toLowerCase()}</option>
            {unitNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3.5 py-3 max-lg:max-h-[32rem]">
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-sunken"
              />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2.5 text-xs font-medium text-danger-deep">
            Could not load the feed: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-sunken text-ink-6">
              <ClipboardList className="size-5" />
            </span>
            <p className="mt-2.5 text-xs text-ink-5">
              {entries.length === 0
                ? "Nothing logged yet today."
                : `No entries for ${unitFilter}.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((entry) => (
              <FeedRow
                key={entry.id}
                entry={entry}
                overrun={overruns?.get(entry.id)}
                canAmend={canManage || entry.logged_by === userId}
                onAmend={() => setAmendTarget(entry)}
                canExplainOverrun={canManage}
                onExplainOverrun={() => setOverrunTarget(entry)}
              />
            ))}
          </ul>
        )}
      </div>

      <AmendEntryDialog
        entry={
          amendTarget && {
            id: amendTarget.id,
            log_date: amendTarget.log_date,
            unit_name: amendTarget.unit?.name ?? null,
            process_name: amendTarget.process?.name ?? null,
            batch_no: amendTarget.batch_no,
            amend_note: amendTarget.amend_note,
          }
        }
        factoryId={factoryId}
        onClose={() => setAmendTarget(null)}
      />

      <ExplainOverrunDialog
        entry={
          overrunTarget && {
            id: overrunTarget.id,
            log_date: overrunTarget.log_date,
            unit_name: overrunTarget.unit?.name ?? null,
            process_name: overrunTarget.process?.name ?? null,
            batch_no: overrunTarget.batch_no,
            product_name: overrunTarget.product?.name ?? null,
            accumulative: null,
            required_qty: null,
            overrun_qty: overruns?.get(overrunTarget.id)?.overrun_qty ?? null,
            overrun_note: overruns?.get(overrunTarget.id)?.overrun_note ?? null,
          }
        }
        factoryId={factoryId}
        onClose={() => setOverrunTarget(null)}
      />
    </aside>
  );
}

function FeedRow({
  entry,
  overrun,
  canAmend,
  onAmend,
  canExplainOverrun,
  onExplainOverrun,
}: {
  entry: LogEntry;
  /** Undefined while the overrun query is still in flight. */
  overrun?: OverrunFlag;
  canAmend: boolean;
  onAmend: () => void;
  canExplainOverrun: boolean;
  onExplainOverrun: () => void;
}) {
  const perf =
    entry.target_speed && entry.actual_speed
      ? Math.round((entry.actual_speed / entry.target_speed) * 100)
      : null;

  return (
    /* A card with a coloured spine rather than a dot in a list. The dot was
       two pixels of the only thing that says at a glance whether an entry is
       routine, rejected or flagged; the spine says it from across the room. */
    <li className="group relative overflow-hidden rounded-xl border border-line-soft bg-surface py-2.5 pr-2.5 pl-4 transition hover:border-line-strong hover:shadow-lift">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: tone(entry) }}
        aria-hidden
      />
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[13px] leading-snug break-words text-ink">
            <strong className="font-semibold">{entry.unit?.name ?? "—"}</strong>
            {" — "}
            {entry.process?.name ?? "—"}
            {entry.product && (
              <span className="text-ink-4"> · {entry.product.name}</span>
            )}
            {Number(entry.qty ?? 0) > 0 && (
              <span className="font-semibold text-brand">
                {" "}
                {/* A preparatory stage counts in drums or kg, not units —
                  printing "units" against 3 drums is a wrong number, not a
                  vague one. Production carries no qty_unit and falls back. */}
                {fmt(entry.qty)} {entry.qty_unit ?? "units"}
              </span>
            )}
            {entry.action_flag && (
              <span className="ml-1.5 rounded-full bg-danger-soft px-1.5 py-0.5 text-[9.5px] font-semibold text-danger-deep">
                {entry.action_flag}
              </span>
            )}
            {/* Clickable for a manager, because the feed is where a supervisor
              is actually looking when the overrun lands — making them go to
              the data table to clear it is how a flag gets ignored. */}
            {overrun?.needs_overrun_note &&
              (canExplainOverrun ? (
                <button
                  type="button"
                  onClick={onExplainOverrun}
                  title={`Over the required quantity by ${fmt(overrun.overrun_qty)} — tap to explain`}
                  className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[9.5px] font-bold text-warn-deep transition hover:bg-warn-line"
                >
                  Attention · +{fmt(overrun.overrun_qty)}
                </button>
              ) : (
                <span
                  title={`Over the required quantity by ${fmt(overrun.overrun_qty)} — a manager has to explain it`}
                  className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[9.5px] font-bold text-warn-deep"
                >
                  Attention · +{fmt(overrun.overrun_qty)}
                </span>
              ))}
            {entry.amended_at && (
              <span className="ml-1.5 rounded-full bg-sunken-2 px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-3">
                Amended
              </span>
            )}
          </p>

          {/* Once explained, the reason and the name stay on the entry. The
            flag is gone; the record of why is not. */}
          {overrun?.overrun_note && (
            <p className="text-[11px] leading-snug break-words text-warn-deep">
              ↳ Overrun: {overrun.overrun_note}
              {overrun.overrun_cleared_by_name && (
                <span className="text-warn-ink">
                  {" "}
                  — {overrun.overrun_cleared_by_name}
                </span>
              )}
            </p>
          )}

          <p className="text-[11px] text-ink-5">
            {entry.start_time?.slice(0, 5) ?? "—"}
            {entry.end_time && ` → ${entry.end_time.slice(0, 5)}`}
            {entry.duration_minutes > 0 &&
              ` · ${formatMinutes(entry.duration_minutes)}`}
            {entry.equipment_no && ` · ${entry.equipment_no}`}
            {entry.operators?.length > 0 && ` · ${entry.operators.join(" / ")}`}
          </p>

          {entry.target_speed ? (
            <p className="text-[11px] text-ink-4">
              Speed: {entry.actual_speed ?? "—"} / {entry.target_speed}{" "}
              {entry.speed_unit ?? ""}
              {perf !== null && (
                <span
                  className={cn(
                    "font-semibold",
                    perf >= 90
                      ? "text-teal"
                      : perf >= 70
                        ? "text-warn"
                        : "text-danger",
                  )}
                >
                  {" "}
                  · {perf}%
                </span>
              )}
              {entry.slow_reason && (
                <em className="text-ink-5"> · {entry.slow_reason}</em>
              )}
            </p>
          ) : null}

          {Number(entry.qty_rejected ?? 0) > 0 && (
            <p className="text-[11px] font-medium text-danger-deep">
              ⚠ {fmt(entry.qty_rejected)} rejected / rework
            </p>
          )}

          {entry.comment && (
            <p className="line-clamp-3 text-[11px] break-words italic text-ink-4">
              {entry.comment}
            </p>
          )}

          {entry.amend_note && (
            <p className="line-clamp-3 text-[11px] break-words whitespace-pre-line text-violet">
              ↳ {entry.amend_note}
            </p>
          )}
        </div>

        {canAmend && (
          <button
            type="button"
            onClick={onAmend}
            title="Attach a correction note — the original entry is preserved"
            className="h-6 shrink-0 self-start rounded-md border border-line bg-surface px-1.5 text-[10px] font-semibold text-ink-5 opacity-0 transition hover:border-warn-deep hover:bg-warn-tint hover:text-warn-deep focus-visible:opacity-100 group-hover:opacity-100"
          >
            Amend
          </button>
        )}
      </div>
    </li>
  );
}
