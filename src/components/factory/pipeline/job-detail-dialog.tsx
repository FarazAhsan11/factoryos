"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Factory, Layers, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import {
  allocationFor,
  bulkRemaining,
  fetchJobEntries,
  jobProgress,
  totalsByProcess,
  totalsByRoom,
  type PipelineJob,
} from "@/lib/factory/pipeline-queries";
import { formatMinutes } from "@/lib/factory/shift-log-queries";
import { cn } from "@/lib/utils";

type Tab = "progress" | "rooms" | "issues";

function fmt(n: number | null | undefined) {
  return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** "2026-08-08" → "8 Aug". */
function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Everything known about one batch, opened from its card.
 *
 * Three tabs over one fetch, because they are three slices of the same rows:
 * what each stage has produced, which rooms it has run in, and what went
 * wrong. The card can only carry one number; this is where the rest lives.
 */
export function JobDetailDialog({
  job,
  unitWord,
  onClose,
}: {
  /** Null closes the dialog; setting one opens it on that job. */
  job: PipelineJob | null;
  unitWord: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("progress");

  const { data: entries = [], isPending } = useQuery({
    queryKey: ["pipeline_job_entries", job?.product_id],
    queryFn: () => fetchJobEntries(job!.product_id),
    enabled: Boolean(job),
  });

  const processes = useMemo(() => totalsByProcess(entries), [entries]);
  const rooms = useMemo(() => totalsByRoom(entries), [entries]);
  const issues = useMemo(() => entries.filter((e) => e.action_flag), [entries]);

  const percent = job ? jobProgress(job) : null;

  return (
    <Dialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTab("progress");
          onClose();
        }
      }}
    >
      {/* `p-0` and a flex column so the list is the only thing that scrolls.
          The dialog used to scroll as a whole *and* cap its list at 18rem, so
          a long batch history had two scrollbars inside one box. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="break-words text-ink">
            {job?.product_name}
          </DialogTitle>
          <DialogDescription className="break-words">
            <span className="rounded-md bg-sunken-2 px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-4 ring-1 ring-line">
              {job?.batch_no}
            </span>
            {job?.product_code && (
              <span className="ml-1.5 font-mono text-[11px]">
                {job.product_code}
              </span>
            )}
            {job?.unit_name && ` · currently in ${job.unit_name}`}
          </DialogDescription>
        </DialogHeader>

        {job && <FamilyPanel job={job} />}

        {/* The headline the card shows, restated with what it means — the
            single most confusing number in the module without it. Pinned
            above the tabs, because it is the answer whichever tab is open. */}
        <div className="mx-5 mt-4 shrink-0 rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium text-ink-4">
              Batch completion
              <span className="ml-1 text-ink-5">
                (measured at the final stage)
              </span>
            </p>
            <p className="font-mono text-sm font-semibold text-ink">
              {fmt(job?.produced_qty)} / {fmt(job?.required_qty)}
              {percent !== null && (
                <span className="ml-1.5 text-brand">{percent}%</span>
              )}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken-2 ring-1 ring-line-soft ring-inset">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] transition-[width] duration-500"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
        </div>

        {job?.status === "hold" && job.hold_reason && (
          <p className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-xl border border-warn-line bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            On hold — a {job.hold_reason.toLowerCase()} issue was flagged. The
            next entry logged without a flag releases it.
          </p>
        )}

        <div
          role="tablist"
          aria-label="Batch details"
          className="mx-5 mt-3 flex shrink-0 gap-1 rounded-xl border border-line bg-sunken-2 p-1"
        >
          <TabButton
            active={tab === "progress"}
            onClick={() => setTab("progress")}
            Icon={Layers}
          >
            By stage
          </TabButton>
          <TabButton
            active={tab === "rooms"}
            onClick={() => setTab("rooms")}
            Icon={Factory}
          >
            {unitWord}s
          </TabButton>
          <TabButton
            active={tab === "issues"}
            onClick={() => setTab("issues")}
            Icon={AlertTriangle}
            count={issues.length}
          >
            Issues
          </TabButton>
        </div>

        {isPending ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-10 text-sm text-ink-5">
            <Loader2 className="size-4 animate-spin" />
            Loading the batch history…
          </div>
        ) : (
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {tab === "progress" && (
              <Table
                empty="Nothing has been produced against this batch yet."
                rows={processes.length}
              >
                {processes.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition last:border-0 hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {p.name}
                      {p.isFinal && (
                        <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand-deep ring-1 ring-brand-line">
                          Final
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-ink-5">
                        {p.entries} entr{p.entries === 1 ? "y" : "ies"}
                        {p.minutes > 0 && ` · ${formatMinutes(p.minutes)}`}
                        {p.rejected > 0 && (
                          <span className="text-danger-deep">
                            {" "}
                            · {fmt(p.rejected)} rejected
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm font-semibold",
                        p.isFinal ? "text-brand" : "text-ink-3",
                      )}
                    >
                      {fmt(p.qty)}
                    </span>
                  </li>
                ))}
              </Table>
            )}

            {tab === "rooms" && (
              <Table
                empty={`No ${unitWord.toLowerCase()} recorded yet.`}
                rows={rooms.length}
              >
                {rooms.map((r) => (
                  <li
                    key={r.name}
                    className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 transition last:border-0 hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {r.name}
                      <span className="mt-0.5 block text-[11px] text-ink-5">
                        {r.entries} entr{r.entries === 1 ? "y" : "ies"} · last
                        used {shortDate(r.lastDate)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-ink-3">
                      {formatMinutes(r.minutes)}
                    </span>
                  </li>
                ))}
              </Table>
            )}

            {tab === "issues" && (
              <Table
                empty="No issues have been flagged on this batch."
                rows={issues.length}
              >
                {issues.map((e) => (
                  <li
                    key={e.id}
                    className="border-b border-line-soft px-3.5 py-2.5 transition last:border-0 hover:bg-sunken"
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger-deep ring-1 ring-danger-line">
                        {e.action_flag}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {e.process?.name ?? "—"}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-5">
                        {shortDate(e.log_date)}
                        {e.unit?.name && ` · ${e.unit.name}`}
                      </span>
                    </div>
                    {e.comment && (
                      <p className="mt-1 text-[11px] break-words italic text-ink-4">
                        {e.comment}
                      </p>
                    )}
                    {e.operators?.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-ink-5">
                        {e.operators.join(" / ")}
                      </p>
                    )}
                    {e.amend_note && (
                      <p className="mt-0.5 text-[11px] break-words whitespace-pre-line text-violet">
                        ↳ {e.amend_note}
                      </p>
                    )}
                  </li>
                ))}
              </Table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Table({
  rows,
  empty,
  children,
}: {
  rows: number;
  empty: string;
  children: React.ReactNode;
}) {
  if (rows === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-10 text-center text-xs text-ink-5">
        {empty}
      </p>
    );
  }
  return (
    <ul className="overflow-hidden rounded-xl border border-line bg-surface">
      {children}
    </ul>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active
          ? "bg-surface text-brand-deep shadow-[0_1px_3px_rgb(20_22_43/0.12)] ring-1 ring-line"
          : "text-ink-4 hover:bg-surface/60 hover:text-ink",
      )}
    >
      <Icon className="size-4" />
      {children}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-danger-soft px-1.5 text-[10px] font-bold text-danger-deep ring-1 ring-danger-line">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Where this batch sits in its family, when it is in one.
 *
 * Renders nothing for a combined batch with no relations — which is most of
 * them — so the dialog gains a row only where there is something to say. For
 * a packing run that is whose bulk it draws on and how much is left; for a
 * manufacturing parent it is how much of its bulk has been claimed.
 */
function FamilyPanel({ job }: { job: PipelineJob }) {
  const allocation = allocationFor(job);
  const remaining = bulkRemaining(job);
  const isPacking = job.batch_type === "packing";

  if (job.batch_type === "combined" && !job.parent_batch_no) return null;
  if (!allocation && !job.parent_batch_no && remaining === null) return null;

  return (
    <div className="mx-5 mt-4 shrink-0 space-y-2 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <BatchTypeBadge
          type={job.batch_type}
          detail={
            job.pack_size
              ? `${fmt(job.pack_size)} per ${job.pack_unit ?? "container"}`
              : undefined
          }
        />
        {job.parent_batch_no && (
          <span className="text-[11px] text-ink-4">
            Bulk from{" "}
            <span className="font-mono font-semibold text-brand">
              {job.parent_batch_no}
            </span>
            {job.parent_product_name && ` — ${job.parent_product_name}`}
          </span>
        )}
        {job.market && (
          <span className="text-[11px] text-ink-5">{job.market}</span>
        )}
      </div>

      {/* A parent's side of the family: what its packing runs have claimed. */}
      {allocation && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="text-ink-4">
              Bulk allocated to {job.child_count} packing run
              {job.child_count === 1 ? "" : "s"}
            </span>
            <span className="font-mono font-semibold text-ink">
              {fmt(allocation.allocated)} / {fmt(allocation.target)}{" "}
              {job.bulk_unit ?? "units"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, allocation.pct)}%`,
                background: allocation.ok
                  ? "var(--color-brand)"
                  : "var(--color-danger)",
              }}
            />
          </div>
          {!allocation.ok && (
            <p className="text-[11px] font-medium text-warn-ink">
              ⚠ The packing runs ask for more bulk than this batch will make.
            </p>
          )}
        </div>
      )}

      {/* A child's side: what it has drawn down of what it was given. */}
      {isPacking && remaining !== null && (
        <p className="text-[11px] text-ink-4">
          Bulk{" "}
          <span className="font-mono text-ink">
            {fmt(job.bulk_consumed)} / {fmt(job.bulk_qty_received)}
          </span>{" "}
          consumed ·{" "}
          <span className="font-mono font-semibold text-teal">
            {fmt(remaining)}
          </span>{" "}
          remaining
        </p>
      )}
    </div>
  );
}
