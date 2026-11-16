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
  showCustomer,
  inline,
  className,
}: {
  factoryId: string;
  /** Raw text from the field, so "empty" reads differently from "no match". */
  batchNo: string;
  /** Add the customer the batch is made for (the deviation form, which no
   *  longer asks for it). */
  showCustomer?: boolean;
  /**
   * A compact two-column card — label over value, product and customer on the
   * first line, code and quantity on the second — to sit beside the batch
   * field instead of taking a block of its own under it. Values wrap rather
   * than truncate: a product name is often the longest thing on the form.
   */
  inline?: boolean;
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
    // Beside the field (the deviation form) an empty batch shows nothing:
    // the field's own placeholder already says what to type.
    if (inline) return null;
    return (
      <p className={cn("text-[0.6875rem] italic text-ink-5", className)}>
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
      <p className={cn("text-[0.6875rem] italic text-warn-deep", className)}>
        No batch “{query}” in the catalogue — it will be saved as typed.
      </p>
    );
  }

  if (inline) {
    const facts: { label: string; value: string; mono?: boolean }[] = [
      { label: "Product", value: product.name },
      ...(showCustomer
        ? [{ label: "Customer", value: product.customer_name || "—" }]
        : []),
      { label: "Code", value: product.code || "—", mono: true },
      {
        label: "Required qty",
        value: product.required_qty > 0 ? fmt(product.required_qty) : "—",
        mono: true,
      },
    ];
    return (
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-5 gap-y-2 rounded-xl border border-brand-soft bg-brand-tint px-3.5 py-2.5",
          className,
        )}
      >
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[0.625rem] text-ink-4">{f.label}</dt>
            <dd
              className={cn(
                "text-[0.78rem] leading-snug font-medium break-words text-ink",
                f.mono && "font-mono",
              )}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className={cn(
        "grid gap-1 rounded-xl border border-brand-soft bg-brand-tint p-3 text-[0.7188rem]",
        className,
      )}
    >
      <Row label="Product" value={product.name} />
      {showCustomer && (
        <Row label="Customer" value={product.customer_name || "—"} />
      )}
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
      <dt className="text-ink-4">{label}</dt>
      <dd
        className={cn(
          "truncate font-medium text-ink",
          mono && "font-mono text-[0.75rem]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
