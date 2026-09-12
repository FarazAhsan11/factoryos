"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PackageSearch, X } from "lucide-react";

import {
  fetchProducts,
  productKeys,
  type Product,
} from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/**
 * Finds the batch a record is about.
 *
 * A search box rather than a dropdown: a factory's catalogue runs to hundreds
 * of batches, and the person opening this screen already has a number in their
 * hand — off a pallet label, a maintenance request, a complaint. Typing four
 * digits of it is faster than scrolling anything.
 *
 * Matching runs over the batch number, the product name, the code and the work
 * order, because the number is not always what the asker has: QA arrives with
 * a product name, engineering with a work order.
 */
export function BatchSearch({
  factoryId,
  selected,
  onSelect,
}: {
  factoryId: string;
  /** The batch currently on screen, so it can be shown and cleared. */
  selected: Product | null;
  onSelect: (product: Product | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * The typed text, settled.
   *
   * 200ms: long enough that a six-digit batch number is one filter rather than
   * six, short enough that it never feels like waiting. The catalogue is
   * already cached by every other screen, so this debounces the *filtering*,
   * not a request — which is why it can be this short.
   */
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(id);
  }, [term]);

  const { data: products = [], isPending } = useQuery({
    queryKey: productKeys.all(factoryId),
    queryFn: () => fetchProducts(factoryId),
  });

  const matches = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return [];
    return (
      products
        .filter((p) =>
          [p.batch_no, p.name, p.code, p.work_order]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(q)),
        )
        // An exact batch number first, then batch numbers that start with what
        // was typed, then everything else: someone typing 47004 wants 47004, not
        // the product whose name happens to contain those digits.
        .sort((a, b) => rank(a, q) - rank(b, q))
        .slice(0, 8)
    );
  }, [products, debounced]);

  // Close on an outside click. A results list that stays open behind the
  // record it just opened is a list nobody can dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(product: Product) {
    onSelect(product);
    setTerm("");
    setDebounced("");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div
        className={cn(
          "flex h-12 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 shadow-card transition",
          open && "border-brand ring-4 ring-brand/12",
        )}
      >
        <PackageSearch className="size-4.5 shrink-0 text-ink-5" aria-hidden />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            // One match and a definite answer — the fastest path off a label.
            if (e.key === "Enter" && matches.length === 1) choose(matches[0]);
          }}
          placeholder={
            selected
              ? "Search another batch…"
              : "Search a batch number, product, code or work order…"
          }
          autoComplete="off"
          aria-label="Search for a batch"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-placeholder"
        />
        {isPending && (
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-6" />
        )}
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            title="Clear the batch"
            className="grid size-6 shrink-0 place-items-center rounded-lg text-ink-5 transition hover:bg-sunken hover:text-danger-deep"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && debounced && (
        <ul className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
          {matches.length === 0 ? (
            <li className="px-3 py-4 text-center text-xs text-ink-5">
              No batch matches “{debounced}”.
              <br />
              <span className="text-ink-6">
                Batches are added under Products.
              </span>
            </li>
          ) : (
            matches.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => choose(product)}
                  className="flex w-full items-baseline gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-brand-tint focus-visible:bg-brand-tint focus-visible:outline-none"
                >
                  <span className="font-mono text-[13px] font-semibold text-ink">
                    {product.batch_no}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-4">
                    {product.name}
                  </span>
                  {product.code && (
                    <span className="shrink-0 font-mono text-[11px] text-ink-5">
                      {product.code}
                    </span>
                  )}
                  {/* Retired batches stay findable: a record is read *because*
                      the batch is finished, and hiding them would make this
                      screen useless for exactly the batches most often asked
                      about. */}
                  {!product.active && (
                    <span className="shrink-0 rounded-full bg-sunken-2 px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-4">
                      Retired
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Lower sorts first: exact number, then prefix, then anything else. */
function rank(product: Product, q: string): number {
  const no = product.batch_no.toLowerCase();
  if (no === q) return 0;
  if (no.startsWith(q)) return 1;
  if (no.includes(q)) return 2;
  return 3;
}
