"use client";

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
 */
export function BatchAutofill({
  query,
  product,
  runningTotal,
}: {
  /** The raw text in the batch field, so we can tell "empty" from "no match". */
  query: string;
  product: Product | null;
  /** Everything logged for this batch + activity, including the open entry. */
  runningTotal: number;
}) {
  if (!product) {
    return (
      <p
        className={cn(
          "text-xs italic",
          query ? "text-[#B91C1C]" : "text-[#94A3B8]"
        )}
      >
        {query
          ? `No match for batch “${query}” — check the product catalogue.`
          : "Type a batch number to auto-fill product details."}
      </p>
    );
  }

  const required = product.required_qty;
  const pct = required > 0 ? Math.round((runningTotal / required) * 100) : null;
  const capped = pct === null ? 0 : Math.min(100, pct);
  const tone =
    pct === null
      ? "#94A3B8"
      : pct >= 100
        ? "#16A34A"
        : pct >= 70
          ? "#2563EB"
          : "#F59E0B";

  return (
    <div className="space-y-2.5 rounded-xl border border-[#DBEAFE] bg-[#F5F9FF] p-3.5">
      <dl className="grid gap-1.5 text-xs">
        <Row label="Product" value={product.name} />
        <Row label="Code" value={product.code || "—"} mono />
        <Row label="Work order" value={product.work_order || product.batch_no} mono />
        <Row label="Required qty" value={fmt(required)} mono />
      </dl>

      {pct !== null && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#E2E8F0]">
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
      <dt className="text-[#64748B]">{label}</dt>
      <dd
        className={cn(
          "truncate font-medium text-[#0F1B34]",
          mono && "font-mono text-[12px]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
