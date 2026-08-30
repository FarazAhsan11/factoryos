"use client";

import { BatchTypeBadge } from "@/components/factory/pipeline/batch-type-badge";
import { bulkRemaining, type PipelineJob, packUnitSingular } from "@/lib/factory/pipeline-queries";
import type { Product } from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/** 540000 → "540,000". */
function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * What the batch number resolved to, and how far through its required
 * quantity the batch is. The operator types a batch; everything here is read
 * back out of Admin → Products and the entries already logged, so nobody
 * retypes a product name into a shift record.
 *
 * Since batch families (migration 0031) it also says what *kind* of batch
 * this is. That matters most on a packing run: the operator needs to know
 * whose bulk they are drawing on and how much of it is left, and that the run
 * they are about to log against may not have been released yet.
 */
export function BatchAutofill({
  query,
  product,
  runningTotal,
  job,
}: {
  /** The raw text in the batch field, so we can tell "empty" from "no match". */
  query: string;
  product: Product | null;
  /** Everything logged for this batch + activity, including the open entry. */
  runningTotal: number;
  /** The batch's pipeline card, when it has one. Null for a batch not on the board. */
  job?: PipelineJob | null;
}) {
  if (!product) {
    return (
      <p
        className={cn(
          "text-xs italic",
          query ? "text-danger-deep" : "text-ink-5",
        )}
      >
        {query
          ? `No match for batch “${query}” — check the product catalogue.`
          : "Type a batch number to auto-fill product details."}
      </p>
    );
  }

  const required = product.required_qty;

  /**
   * Batch-level progress, drawn **only for a batch with no plan**.
   *
   * A planned batch shows a bar per stage instead — against that stage's own
   * target, in that stage's own unit — which is the question an operator
   * filling this form actually has. A single order-level number cannot be
   * right beside it: dividing a stage total by the order quantity mixes units
   * (60 kg dispensed is not 60 of 100,000 tablets), and reading the plan's
   * last stage alone reports 0% on a batch whose parallel packing runs are
   * half done.
   *
   * Unplanned batches have no stage bar, so the per-activity total against the
   * required quantity stays the best available answer — and is what every
   * entry showed before stage planning landed.
   */
  const planned = Boolean(job && job.stage_count > 0);
  const pct =
    !planned && required > 0
      ? Math.round((runningTotal / required) * 100)
      : null;
  const capped = pct === null ? 0 : Math.min(100, pct);
  const tone =
    pct === null
      ? "var(--color-ink-5)"
      : pct >= 100
        ? "var(--color-teal)"
        : pct >= 70
          ? "var(--color-brand)"
          : "var(--color-warn)";

  const isPacking = job?.batch_type === "packing";
  const remaining = job ? bulkRemaining(job) : null;
  /**
   * A packing run still in Planned has not had its bulk released. A warning,
   * not a block: the paperwork often lags the floor by an hour, and refusing
   * the entry would only mean it gets logged against the wrong batch or not
   * at all.
   */
  const waitingForBulk = isPacking && job?.status === "planned";

  return (
    <div className="space-y-2.5 rounded-xl border border-brand-soft bg-brand-tint p-3.5">
      {job && job.batch_type !== "combined" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <BatchTypeBadge
            type={job.batch_type}
            detail={
              job.pack_size
                ? `${fmt(job.pack_size)} per ${packUnitSingular(job.pack_unit)}${job.market ? ` · ${job.market}` : ""}`
                : undefined
            }
          />
          {job.parent_batch_no && (
            <span className="font-mono text-[10px] font-semibold text-brand">
              ← {job.parent_batch_no} bulk
            </span>
          )}
        </div>
      )}

      {waitingForBulk && (
        <p className="rounded-lg bg-warn-tint px-2.5 py-1.5 text-[11px] font-medium text-warn-ink ring-1 ring-warn-line">
          {job?.parent_batch_no
            ? `Waiting for bulk from ${job.parent_batch_no} — this run isn’t released yet.`
            : "This packing run is still Planned — its bulk may not be available yet."}
        </p>
      )}

      <dl className="grid gap-1.5 text-xs">
        <Row label="Product" value={product.name} />
        <Row label="Code" value={product.code || "—"} mono />
        <Row
          label="Work order"
          value={product.work_order || product.batch_no}
          mono
        />
        <Row label="Required qty" value={fmt(required)} mono />
      </dl>

      {/* How much of the allocated bulk this run has left. Only drawn when
          both halves are known — a run with no allocation recorded has an
          unknown remainder, not a full one, and a confident "0 remaining"
          would stop a shift that has bulk sitting in front of it. */}
      {isPacking && remaining !== null && job && (
        <dl className="grid gap-1 rounded-lg bg-surface px-2.5 py-2 text-[11px]">
          <Row label="Bulk received" value={fmt(job.bulk_qty_received!)} mono />
          <Row label="Consumed" value={fmt(job.bulk_consumed!)} mono />
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-4">Remaining</dt>
            <dd
              className="font-mono text-[12px] font-semibold"
              style={{
                color:
                  remaining < Number(job.bulk_qty_received) * 0.1
                    ? "var(--color-danger)"
                    : "var(--color-teal)",
              }}
            >
              {fmt(remaining)}
            </dd>
          </div>
        </dl>
      )}

      {pct !== null && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${capped}%`, background: tone }}
            />
          </div>
          <p className="text-[11px] font-medium" style={{ color: tone }}>
            {pct}% complete — {fmt(runningTotal)} of {fmt(required)} required
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-4">{label}</dt>
      <dd
        className={cn(
          "truncate font-medium text-ink",
          mono && "font-mono text-[12px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
