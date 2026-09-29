"use client";

import { AlertTriangle, PauseCircle, ShieldAlert } from "lucide-react";

import {
  clock,
  fmtQty,
  isDowntime,
  type FloorEntry,
  type FloorProgress,
  type FloorRoom,
} from "@/lib/factory/floor-queries";
import { cn } from "@/lib/utils";

/**
 * One room on the floor board.
 *
 * Three states, told apart by the dot before anything is read: teal is
 * running (the latest entry made something), amber is stopped (the latest
 * entry is downtime), grey is idle (nothing logged that day). An idle room
 * is drawn quieter rather than hidden — the empty card is the answer to "is
 * anything running in 7?".
 *
 * A button, because it is the way into the room's dialog — and an idle room
 * opens too, since what is planned for it is still worth reading.
 */
export function FloorRoomCard({
  room,
  onOpen,
}: {
  room: FloorRoom;
  onOpen: () => void;
}) {
  const { latest, lastRun, progress, job } = room;
  const stopped = isDowntime(latest);
  const batchNo = latest?.batch_no?.trim() || lastRun?.batch_no?.trim() || null;
  const productName =
    latest?.product_name ?? lastRun?.product_name ?? job?.product_name ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex min-h-[176px] flex-col gap-2 rounded-2xl border p-4 text-left transition",
        "hover:-translate-y-px hover:shadow-[0_6px_20px_-8px_rgb(20_22_43/0.18)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        !latest
          ? "border-line bg-sunken/70 hover:border-line-strong"
          : stopped
            ? "border-warn-line bg-surface shadow-[inset_3px_0_0_var(--color-warn)]"
            : "border-brand-line/70 bg-surface shadow-[inset_3px_0_0_var(--color-teal)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "truncate text-[11px] font-bold tracking-[0.09em] uppercase",
            latest ? "text-ink-4" : "text-ink-5",
          )}
        >
          {room.name}
        </p>
        {latest && <TimeRange entry={latest} />}
      </div>

      {/* The headline: the batch where there is one, the state where not. */}
      <p className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            !latest
              ? "bg-ink-6"
              : stopped
                ? "bg-warn"
                : "bg-teal shadow-[0_0_0_3px_var(--color-teal-soft)]",
          )}
        />
        {batchNo ? (
          <span className="font-mono text-[15px] font-bold tracking-tight text-ink">
            {batchNo}
          </span>
        ) : (
          <span
            className={cn(
              "text-sm font-medium",
              stopped ? "text-warn-ink" : "text-ink-5",
            )}
          >
            {stopped ? "Downtime" : "Idle"}
          </span>
        )}
      </p>

      {!latest ? (
        <p className="text-xs text-ink-5 italic">Nothing logged on this day</p>
      ) : (
        <>
          {productName && (
            <p className="line-clamp-1 text-[13px] text-ink-3">{productName}</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1 truncate rounded-md px-2 py-0.5 text-[11.5px] font-semibold ring-1",
                stopped
                  ? "bg-warn-tint text-warn-ink ring-warn-line/70"
                  : "bg-brand-soft text-brand-deep ring-brand-line/70",
              )}
            >
              {stopped && <PauseCircle className="size-3 shrink-0" aria-hidden />}
              {latest.process_name ?? "—"}
            </span>
          </div>

          {stopped && latest.comment && (
            <p className="line-clamp-2 text-[11.5px] text-ink-4 italic">
              {latest.comment}
            </p>
          )}

          {progress ? (
            <ProgressLine
              progress={progress}
              // Behind a downtime entry the bar is the stage the room stopped
              // on — named, and drawn muted so it doesn't read as running.
              label={stopped ? `Before the stop: ${progress.stageName}` : null}
              muted={stopped}
            />
          ) : (
            !stopped &&
            latest.qty !== null && (
              <p className="text-[11.5px] text-ink-4">
                <span className="font-mono font-semibold text-ink">
                  {fmtQty(latest.qty)}
                </span>{" "}
                {latest.qty_unit ?? ""} logged
              </p>
            )
          )}
        </>
      )}

      <Badges room={room} />
    </button>
  );
}

function TimeRange({ entry }: { entry: FloorEntry }) {
  const start = clock(entry.start_time);
  const end = clock(entry.end_time);
  if (!start && !end) return null;
  return (
    <span className="shrink-0 font-mono text-[10.5px] text-ink-5 tabular-nums">
      {start ?? "…"}–{end ?? "…"}
    </span>
  );
}

function ProgressLine({
  progress,
  label,
  muted,
}: {
  progress: FloorProgress;
  label: string | null;
  muted: boolean;
}) {
  const tone = progress.over
    ? "var(--color-danger)"
    : muted
      ? "var(--color-ink-6)"
      : progress.pct >= 100
        ? "var(--color-teal)"
        : progress.pct >= 50
          ? "var(--color-brand)"
          : "var(--color-warn)";

  return (
    <div className="mt-auto space-y-1.5 pt-1">
      {label && <p className="truncate text-[10.5px] text-ink-5">{label}</p>}
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(100, progress.pct)}%`, background: tone }}
        />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-ink-5">
        <span>
          <span className="font-semibold text-ink">{progress.pct}%</span>{" "}
          progress
        </span>
        <span className="font-mono tabular-nums">
          <span className="font-semibold text-ink">{fmtQty(progress.made)}</span>{" "}
          / {fmtQty(progress.target)} {progress.unit}
        </span>
      </p>
    </div>
  );
}

function Badges({ room }: { room: FloorRoom }) {
  const { job, openIssues } = room;
  const quarantine = job?.quarantine_no;
  const held = !quarantine && job?.status === "hold";
  if (!openIssues && !quarantine && !held) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {openIssues > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-danger-deep ring-1 ring-danger-line">
          <AlertTriangle className="size-3" aria-hidden />
          {openIssues} open issue{openIssues === 1 ? "" : "s"}
        </span>
      )}
      {quarantine && (
        <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-danger-deep ring-1 ring-danger-line">
          <ShieldAlert className="size-3" aria-hidden />
          Quarantined · {quarantine}
        </span>
      )}
      {held && (
        <span className="inline-flex items-center gap-1 rounded-md bg-warn-tint px-1.5 py-0.5 text-[10.5px] font-semibold text-warn-ink ring-1 ring-warn-line/70">
          <PauseCircle className="size-3" aria-hidden />
          Batch on hold
        </span>
      )}
    </div>
  );
}
