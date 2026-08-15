"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchProducts, productKeys } from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * What a typed batch number resolves to — product, code and what the work
 * order asked for.
 *
 * Shared by the forms that *reference* a batch without logging against one:
 * a maintenance request, an issue raised by hand. Its whole job is to confirm
 * the number was typed correctly, so it reads from the product catalogue and
 * nothing else — one already-cached query, no per-keystroke lookups.
 *
 * The shift log keeps its own `BatchAutofill`, and that is not duplication:
 * there the number that matters is the running total *for the activity being
 * logged* plus what is currently in the quantity field — a live figure that
 * depends on form state this component has no business knowing about.
 */
export function BatchSummary({
  factoryId,
  batchNo,
  className,
}: {
  factoryId: string;
  /** Raw text from the field, so "empty" reads differently from "no match". */
  batchNo: string;
  className?: string;
}) {
  const query = batchNo.trim();

  const { data: products = [] } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const product = useMemo(() => {
    const term = query.toLowerCase();
    if (!term) return null;
    return products.find((p) => p.batch_no.toLowerCase() === term) ?? null;
  }, [products, query]);

  if (!query) {
    return (
      <p className={cn("text-[11px] italic text-[#94A3B8]", className)}>
        Type a batch number to pull in its product.
      </p>
    );
  }

  // Stated, not treated as an error: the fault or the issue is real whether or
  // not the batch was ever added to the catalogue, and the typed text is
  // stored either way. Refusing it here would only teach people to leave the
  // field blank, which loses the one detail that ties this to a run.
  if (!product) {
    return (
      <p className={cn("text-[11px] italic text-[#B45309]", className)}>
        No batch “{query}” in the catalogue — it will be saved as typed.
      </p>
    );
  }

  return (
    <dl
      className={cn(
        "grid gap-1 rounded-xl border border-[#DBEAFE] bg-[#F5F9FF] p-3 text-[11.5px]",
        className
      )}
    >
      <Row label="Product" value={product.name} />
      <Row label="Code" value={product.code || "—"} mono />
      <Row
        label="Required qty"
        value={product.required_qty > 0 ? fmt(product.required_qty) : "—"}
        mono
      />
    </dl>
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
