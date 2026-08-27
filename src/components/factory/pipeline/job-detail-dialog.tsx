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
import {
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-ink">{job?.product_name}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">
              {job?.product_code ? `${job.product_code} · ` : ""}
              {job?.batch_no}
            </span>
            {job?.unit_name && ` · currently in ${job.unit_name}`}
          </DialogDescription>
        </DialogHeader>

        {/* The headline the card shows, restated with what it means — the
            single most confusing number in the module without it. */}
        <div className="rounded-xl border border-line bg-sunken p-3.5">
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
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken-2">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
        </div>

        {job?.status === "hold" && job.hold_reason && (
          <p className="flex items-start gap-2 rounded-xl bg-warn-tint px-3.5 py-2.5 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            On hold — a {job.hold_reason.toLowerCase()} issue was flagged. The
            next entry logged without a flag releases it.
          </p>
        )}

        <div
          role="tablist"
          aria-label="Batch details"
          className="flex gap-1 rounded-xl bg-sunken-2 p-1"
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
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-5">
            <Loader2 className="size-4 animate-spin" />
            Loading the batch history…
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {tab === "progress" && (
              <Table
                empty="Nothing has been produced against this batch yet."
                rows={processes.length}
              >
                {processes.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-3 border-b border-sunken-2 px-3.5 py-2.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {p.name}
                      {p.isFinal && (
                        <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
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
                    className="flex items-center gap-3 border-b border-sunken-2 px-3.5 py-2.5 last:border-0"
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
                    className="border-b border-sunken-2 px-3.5 py-2.5 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger-deep">
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
                      <p className="mt-1 text-[11px] italic text-ink-4">
                        {e.comment}
                      </p>
                    )}
                    {e.operators?.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-ink-5">
                        {e.operators.join(" / ")}
                      </p>
                    )}
                    {e.amend_note && (
                      <p className="mt-0.5 whitespace-pre-line text-[11px] text-violet">
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
      <p className="rounded-xl border border-dashed border-ink-6 px-4 py-10 text-center text-xs text-ink-5">
        {empty}
      </p>
    );
  }
  return <ul className="rounded-xl border border-line">{children}</ul>;
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
          ? "bg-surface text-brand shadow-[0_1px_2px_rgba(20,22,43,0.08)]"
          : "text-ink-4 hover:text-ink",
      )}
    >
      <Icon className="size-4" />
      {children}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-danger-soft px-1.5 text-[10px] font-bold text-danger-deep">
          {count}
        </span>
      )}
    </button>
  );
}
