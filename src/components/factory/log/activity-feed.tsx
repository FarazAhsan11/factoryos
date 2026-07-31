"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AmendEntryDialog } from "@/components/factory/data/amend-entry-dialog";
import {
  fetchLogEntries,
  formatMinutes,
  logKeys,
  type LogEntry,
} from "@/lib/factory/shift-log-queries";
import { todayKey } from "@/lib/factory/shift-time-queries";
import { cn } from "@/lib/utils";

/** Colour-codes a row the way the prototype's feed dots do. */
function tone(entry: LogEntry): string {
  if (entry.action_flag) return "#DC2626";
  if (Number(entry.qty_rejected ?? 0) > 0) return "#F59E0B";
  if (Number(entry.qty ?? 0) > 0) return "#16A34A";
  return "#2563EB";
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
  const [unitFilter, setUnitFilter] = useState("all");
  // The feed is scoped to one working day. It defaults to today, but the day
  // is pickable — an afternoon shift that runs to 23:35 spills over midnight,
  // and its entries must not vanish from view at 00:00.
  const [date, setDate] = useState(() => todayKey());
  const isToday = date === todayKey();

  const { data: entries = [], isPending, isError, error } = useQuery({
    queryKey: logKeys.day(factoryId, date),
    queryFn: () => fetchLogEntries(factoryId, date),
  });

  const unitNames = useMemo(
    () =>
      [...new Set(entries.map((e) => e.unit?.name).filter(Boolean))].sort() as string[],
    [entries]
  );

  const visible = useMemo(
    () =>
      unitFilter === "all"
        ? entries
        : entries.filter((e) => e.unit?.name === unitFilter),
    [entries, unitFilter]
  );

  return (
    <aside className="rounded-2xl border border-[#E6EAF1] bg-white lg:sticky lg:top-6">
      <header className="flex items-center justify-between gap-2 border-b border-[#EEF1F6] px-4 py-3.5">
        <h2 className="text-sm font-semibold text-[#0F1B34]">Shift activity</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#047857]">
          ● Live · immutable
        </span>
      </header>

      <div className="flex items-center gap-2 border-b border-[#EEF1F6] px-4 py-2.5">
        <input
          type="date"
          value={date}
          max={todayKey()}
          onChange={(e) => setDate(e.target.value || todayKey())}
          aria-label="Show entries for"
          className="h-9 flex-1 rounded-lg border border-[#E6EAF1] bg-[#FBFCFE] px-2.5 text-xs text-[#0F1B34] outline-none focus:border-[#2563EB]"
        />
        {!isToday && (
          <button
            type="button"
            onClick={() => setDate(todayKey())}
            className="h-9 shrink-0 rounded-lg px-2.5 text-xs font-medium text-[#2563EB] transition hover:bg-[#EFF6FF]"
          >
            Today
          </button>
        )}
      </div>

      {unitNames.length > 1 && (
        <div className="border-b border-[#EEF1F6] px-4 py-2.5">
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            aria-label={`Filter by ${units.singular.toLowerCase()}`}
            className="h-9 w-full rounded-lg border border-[#E6EAF1] bg-[#FBFCFE] px-2.5 text-xs text-[#0F1B34] outline-none focus:border-[#2563EB]"
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

      <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-[#F8FAFC]" />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
            Could not load the feed: {(error as Error).message}
          </p>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-xs text-[#94A3B8]">
            {entries.length === 0
              ? isToday
                ? "Nothing logged yet today."
                : "Nothing was logged on this day."
              : `No entries for ${unitFilter}.`}
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((entry) => (
              <FeedRow
                key={entry.id}
                entry={entry}
                canAmend={canManage || entry.logged_by === userId}
                onAmend={() => setAmendTarget(entry)}
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
    </aside>
  );
}

function FeedRow({
  entry,
  canAmend,
  onAmend,
}: {
  entry: LogEntry;
  canAmend: boolean;
  onAmend: () => void;
}) {
  const perf =
    entry.target_speed && entry.actual_speed
      ? Math.round((entry.actual_speed / entry.target_speed) * 100)
      : null;

  return (
    <li className="group flex gap-2.5">
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ background: tone(entry) }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[13px] leading-snug text-[#0F1B34]">
          <strong className="font-semibold">{entry.unit?.name ?? "—"}</strong>
          {" — "}
          {entry.process?.name ?? "—"}
          {entry.product && (
            <span className="text-[#64748B]"> · {entry.product.name}</span>
          )}
          {Number(entry.qty ?? 0) > 0 && (
            <span className="font-semibold text-[#2563EB]">
              {" "}
              {fmt(entry.qty)} units
            </span>
          )}
          {entry.action_flag && (
            <span className="ml-1.5 rounded-full bg-[#FEF2F2] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#B91C1C]">
              {entry.action_flag}
            </span>
          )}
          {entry.amended_at && (
            <span className="ml-1.5 rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#475569]">
              Amended
            </span>
          )}
        </p>

        <p className="text-[11px] text-[#94A3B8]">
          {entry.start_time?.slice(0, 5) ?? "—"}
          {entry.end_time && ` → ${entry.end_time.slice(0, 5)}`}
          {entry.duration_minutes > 0 &&
            ` · ${formatMinutes(entry.duration_minutes)}`}
          {entry.equipment_no && ` · ${entry.equipment_no}`}
          {entry.operator_1 && ` · ${entry.operator_1}`}
          {entry.operator_2 && ` / ${entry.operator_2}`}
        </p>

        {entry.target_speed ? (
          <p className="text-[11px] text-[#64748B]">
            Speed: {entry.actual_speed ?? "—"} / {entry.target_speed}{" "}
            {entry.speed_unit ?? ""}
            {perf !== null && (
              <span
                className={cn(
                  "font-semibold",
                  perf >= 90
                    ? "text-[#16A34A]"
                    : perf >= 70
                      ? "text-[#F59E0B]"
                      : "text-[#DC2626]"
                )}
              >
                {" "}
                · {perf}%
              </span>
            )}
            {entry.slow_reason && (
              <em className="text-[#94A3B8]"> · {entry.slow_reason}</em>
            )}
          </p>
        ) : null}

        {Number(entry.qty_rejected ?? 0) > 0 && (
          <p className="text-[11px] font-medium text-[#B91C1C]">
            ⚠ {fmt(entry.qty_rejected)} rejected / rework
          </p>
        )}

        {entry.comment && (
          <p className="text-[11px] italic text-[#64748B]">{entry.comment}</p>
        )}

        {entry.amend_note && (
          <p className="whitespace-pre-line text-[11px] text-[#7C3AED]">
            ↳ {entry.amend_note}
          </p>
        )}
      </div>

      {canAmend && (
        <button
          type="button"
          onClick={onAmend}
          title="Attach a correction note — the original entry is preserved"
          className="h-6 shrink-0 self-start rounded-md border border-[#E6EAF1] px-1.5 text-[10px] font-medium text-[#94A3B8] opacity-0 transition hover:border-[#B45309] hover:text-[#B45309] focus-visible:opacity-100 group-hover:opacity-100"
        >
          Amend
        </button>
      )}
    </li>
  );
}
