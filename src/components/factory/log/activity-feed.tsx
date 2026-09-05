"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Cog, Users } from "lucide-react";

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
import { SelectField } from "@/components/ui/select-field";
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
          <SelectField
            value={unitFilter}
            onChange={setUnitFilter}
            ariaLabel={`Filter by ${units.singular.toLowerCase()}`}
            searchPlaceholder={`${units.singular} name…`}
            emptyMessage={`No ${units.singular.toLowerCase()} matches that.`}
            options={[
              { value: "all", label: `All ${units.plural.toLowerCase()}` },
              ...unitNames.map((name) => ({ value: name, label: name })),
            ]}
            className="h-9 rounded-lg px-2.5 text-xs font-medium"
          />
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
            accumulative: overruns?.get(overrunTarget.id)?.accumulative ?? null,
            required_qty: overruns?.get(overrunTarget.id)?.required_qty ?? null,
            allowed_qty: overruns?.get(overrunTarget.id)?.allowed_qty ?? null,
            overage_pct: overruns?.get(overrunTarget.id)?.overage_pct ?? 0,
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

  const produced = Number(entry.qty ?? 0);
  const rejected = Number(entry.qty_rejected ?? 0);
  const hasStats = produced > 0 || rejected > 0 || Boolean(entry.target_speed);
  const people = entry.operators?.length ? entry.operators.join(" / ") : null;

  return (
    /* A card with a coloured spine rather than a dot in a list. The dot was
       two pixels of the only thing that says at a glance whether an entry is
       routine, rejected or flagged; the spine says it from across the room.

       Inside, four bands in a fixed order — when, what, how much, who — so a
       supervisor scanning the column reads down the same place in every card
       instead of hunting through a sentence. It used to be one run-on line
       (room, activity, product, quantity and every badge), which wrapped
       differently in every card and buried the number that matters. */
    <li className="group relative overflow-hidden rounded-xl border border-line-soft bg-surface py-2.5 pr-2.5 pl-3.5 transition hover:border-line-strong hover:shadow-lift">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: tone(entry) }}
        aria-hidden
      />

      {/* ── When, and what needs attention ─────────────────────────────
          The clock leads because the feed is read in time order, and the
          badges sit opposite it on the same line, so a flagged entry is
          visible without reading a word of the card. */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-mono text-[11px] font-medium tracking-tight text-ink-4">
          {entry.start_time?.slice(0, 5) ?? "—"}
          {entry.end_time && ` → ${entry.end_time.slice(0, 5)}`}
          {entry.duration_minutes > 0 && (
            <span className="text-ink-5">
              {" · "}
              {formatMinutes(entry.duration_minutes)}
            </span>
          )}
        </p>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {entry.action_flag && (
            <span className={cn(BADGE, "bg-danger-soft text-danger-deep")}>
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
                className={cn(
                  BADGE,
                  "bg-warn-soft text-warn-deep transition hover:bg-warn-line",
                )}
              >
                Attention · +{fmt(overrun.overrun_qty)}
              </button>
            ) : (
              <span
                title={`Over the required quantity by ${fmt(overrun.overrun_qty)} — a manager has to explain it`}
                className={cn(BADGE, "bg-warn-soft text-warn-deep")}
              >
                Attention · +{fmt(overrun.overrun_qty)}
              </span>
            ))}
          {entry.amended_at && (
            <span className={cn(BADGE, "bg-sunken-2 text-ink-3")}>Amended</span>
          )}
          {canAmend && (
            <button
              type="button"
              onClick={onAmend}
              title="Attach a correction note — the original entry is preserved"
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-5 opacity-0 transition hover:border-warn-deep hover:bg-warn-tint hover:text-warn-deep focus-visible:opacity-100 group-hover:opacity-100"
            >
              Amend
            </button>
          )}
        </div>
      </div>

      {/* ── What ───────────────────────────────────────────────────────
          Room and activity on one line, the batch under it. Two lines rather
          than one sentence: the product name is the longest string on the
          card and used to push the activity onto a line by itself, which read
          as two different things. */}
      <p className="mt-1 text-[13px] leading-snug font-semibold break-words text-ink">
        {entry.unit?.name ?? "—"}
        <span className="font-normal text-ink-4"> · </span>
        {entry.process?.name ?? "—"}
      </p>
      {(entry.batch_no || entry.product) && (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug break-words text-ink-4">
          {entry.batch_no && (
            <span className="font-mono font-medium text-ink-3">
              {entry.batch_no}
            </span>
          )}
          {entry.batch_no && entry.product && " · "}
          {entry.product?.name}
        </p>
      )}

      {/* ── How much ───────────────────────────────────────────────────
          Numbers in labelled tiles instead of inline in a sentence, so the
          quantity, the rejects and the speed line up down the column and can
          be compared card to card by looking rather than by reading. */}
      {hasStats && (
        <dl className="mt-2 flex flex-wrap gap-1.5">
          {produced > 0 && (
            <Stat
              label="Output"
              /* A preparatory stage counts in drums or kg, not units —
                 printing "units" against 3 drums is a wrong number, not a
                 vague one. Production carries no qty_unit and falls back. */
              value={`${fmt(entry.qty)} ${entry.qty_unit ?? "units"}`}
              tone="text-brand"
            />
          )}
          {rejected > 0 && (
            <Stat
              label="Rejected"
              value={fmt(entry.qty_rejected)}
              tone="text-danger-deep"
            />
          )}
          {entry.target_speed ? (
            <Stat
              label={`Speed${entry.speed_unit ? ` · ${entry.speed_unit}` : ""}`}
              value={`${entry.actual_speed ?? "—"} / ${entry.target_speed}`}
              suffix={
                perf !== null ? (
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
                    {perf}%
                  </span>
                ) : null
              }
            />
          ) : null}
        </dl>
      )}

      {/* ── Who, and on what ───────────────────────────────────────────
          The people and the machine, last: needed to follow an entry up,
          never the reason anyone stops at one. */}
      {(people || entry.equipment_no) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-5">
          {people && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Users className="size-3 shrink-0 text-ink-6" aria-hidden />
              <span className="truncate">{people}</span>
            </span>
          )}
          {people && entry.equipment_no && (
            <span className="text-ink-6" aria-hidden>
              ·
            </span>
          )}
          {entry.equipment_no && (
            <span className="inline-flex items-center gap-1 font-mono">
              <Cog className="size-3 shrink-0 text-ink-6" aria-hidden />
              {entry.equipment_no}
            </span>
          )}
        </p>
      )}

      {/* ── What was said about it ─────────────────────────────────────
          Every line of prose the entry carries, gathered under one rule so
          they read as annotations on the record rather than as more of it. */}
      {(entry.slow_reason ||
        overrun?.overrun_note ||
        entry.comment ||
        entry.amend_note) && (
        <div className="mt-1.5 space-y-1 border-l-2 border-line-soft pl-2">
          {entry.slow_reason && (
            <p className="text-[11px] leading-snug break-words text-ink-4">
              Ran slow: <em>{entry.slow_reason}</em>
            </p>
          )}
          {/* Once explained, the reason and the name stay on the entry. The
              flag is gone; the record of why is not. */}
          {overrun?.overrun_note && (
            <p className="text-[11px] leading-snug break-words text-warn-deep">
              Overrun: {overrun.overrun_note}
              {overrun.overrun_cleared_by_name && (
                <span className="text-warn-ink">
                  {" "}
                  — {overrun.overrun_cleared_by_name}
                </span>
              )}
            </p>
          )}
          {entry.comment && (
            <p className="line-clamp-3 text-[11px] leading-snug break-words italic text-ink-4">
              {entry.comment}
            </p>
          )}
          {entry.amend_note && (
            <p className="line-clamp-3 text-[11px] leading-snug break-words whitespace-pre-line text-violet">
              {entry.amend_note}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Every badge on a feed card, so none of them drifts a pixel from the rest. */
const BADGE =
  "rounded-full px-1.5 py-0.5 text-[9.5px] font-bold whitespace-nowrap";

/**
 * One measurement, labelled.
 *
 * A tile rather than a phrase: the label is what makes "1" readable without a
 * sentence around it, and a fixed shape is what lets three cards be compared
 * by looking rather than by reading.
 */
function Stat({
  label,
  value,
  tone,
  suffix,
}: {
  label: string;
  value: string;
  /** Colour for the value — the measurement's own meaning, not decoration. */
  tone?: string;
  /** Trails the value inside the same tile: the performance percentage. */
  suffix?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-sunken px-2 py-1 ring-1 ring-line-soft/60">
      <dt className="text-[9px] font-semibold tracking-[0.05em] text-ink-5 uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "truncate font-mono text-[12px] font-semibold tracking-tight",
          tone ?? "text-ink-2",
        )}
      >
        {value}
        {suffix && <span className="ml-1">{suffix}</span>}
      </dd>
    </div>
  );
}
