"use client";

import { Flag, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinutes, type LogEntry } from "@/lib/factory/shift-log-queries";
import { cn } from "@/lib/utils";

/** 540000 → "540,000"; null → an em dash, never a 0. */
function fmt(n: number | null | undefined) {
  return n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * One logged entry, in full and read-only.
 *
 * Read-only on purpose. The batch record is where a finished batch is
 * *examined* — by QA, by whoever is answering a complaint — and an editable
 * field on that screen is an invitation to correct history while reading it.
 * Corrections belong where the work is: the shift log's feed and the shift
 * report both offer an amendment, and both stamp who amended and why.
 *
 * Everything the row holds is shown, including the fields that are null. A
 * blank Rejected on a production entry means nobody recorded one, which is a
 * different fact from zero, and a record that silently omits the question
 * cannot be read against the paper batch record it is standing in for.
 */
export function BatchEntryDialog({
  entry,
  onClose,
}: {
  entry: LogEntry | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="text-ink">
            {entry?.unit?.name ?? "—"}
            <span className="font-normal text-ink-4"> · </span>
            {entry?.process?.name ?? "—"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {entry?.log_date} · {entry?.shift} shift
            {entry?.batch_no && ` · batch ${entry.batch_no}`}
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {entry.action_flag && (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-3.5 py-2.5 text-xs font-medium text-danger-deep">
                <Flag className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  Flagged{" "}
                  <strong className="font-semibold">{entry.action_flag}</strong>{" "}
                  — this entry raised an issue, tracked under Issues.
                </span>
              </p>
            )}

            <Group title="When">
              <Row label="Date" value={entry.log_date} mono />
              <Row label="Shift" value={entry.shift} />
              <Row
                label="Ran"
                value={`${entry.start_time?.slice(0, 5) ?? "—"} → ${
                  entry.end_time?.slice(0, 5) ?? "—"
                }`}
                mono
              />
              <Row
                label="Duration"
                value={
                  entry.duration_minutes > 0
                    ? formatMinutes(entry.duration_minutes)
                    : "—"
                }
                mono
              />
            </Group>

            <Group title="What">
              <Row label="Product" value={entry.product?.name ?? "—"} />
              <Row label="Code" value={entry.product?.code ?? "—"} mono />
              <Row label="Batch" value={entry.batch_no ?? "—"} mono />
              <Row label="Activity" value={entry.process?.name ?? "—"} />
              <Row label="Equipment" value={entry.equipment_no ?? "—"} mono />
            </Group>

            {/* Quantities are absent from a downtime entry rather than zero —
                the form never asks, and the database stores null. Printing a
                row of zeroes here would invent a measurement. */}
            {entry.process?.category !== "downtime" && (
              <Group title="Quantities">
                <Row
                  label="Shift target"
                  value={fmt(entry.target_qty)}
                  mono
                  hint="speed × duration"
                />
                <Row
                  label="Produced"
                  value={`${fmt(entry.qty)}${entry.qty_unit ? ` ${entry.qty_unit}` : ""}`}
                  mono
                  strong
                />
                <Row
                  label="Rejected / rework"
                  value={fmt(entry.qty_rejected)}
                  mono
                />
              </Group>
            )}

            {entry.process?.has_machine && (
              <Group title="Speed">
                <Row label="Unit" value={entry.speed_unit ?? "—"} />
                <Row label="Target" value={fmt(entry.target_speed)} mono />
                <Row label="Actual" value={fmt(entry.actual_speed)} mono />
                <Row label="Slow reason" value={entry.slow_reason ?? "—"} />
              </Group>
            )}

            <Group title="Who">
              <Row
                label="Operators"
                value={
                  entry.operators?.length ? entry.operators.join(", ") : "—"
                }
              />
            </Group>

            {(entry.comment || entry.amend_note) && (
              <Group title="Recorded">
                {entry.comment && (
                  <p className="text-xs leading-relaxed break-words text-ink-3 italic">
                    {entry.comment}
                  </p>
                )}
                {entry.amend_note && (
                  <p className="mt-2 rounded-xl border border-violet-line bg-violet-soft px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-line text-violet-deep">
                    <strong className="font-semibold">Amendment</strong>
                    <br />
                    {entry.amend_note}
                  </p>
                )}
              </Group>
            )}

            <p className="mt-4 flex items-center gap-1.5 border-t border-line-soft pt-3 text-[11px] text-ink-5">
              <ShieldCheck className="size-3 shrink-0" aria-hidden />
              Filed {new Date(entry.created_at).toLocaleString()}
              {entry.amended_at &&
                ` · amended ${new Date(entry.amended_at).toLocaleString()}`}
              . Corrections are made from the shift log, never here.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3 rounded-xl border border-line-soft bg-sunken p-3.5 last:mb-0">
      <h3 className="mb-2 text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase">
        {title}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  /** Where the figure came from, for one nobody typed. */
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-ink-4">
        {label}
        {hint && <span className="ml-1 text-[10px] text-ink-6">({hint})</span>}
      </dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-xs font-medium text-ink-2",
          mono && "font-mono text-[12.5px]",
          strong && "font-semibold text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
