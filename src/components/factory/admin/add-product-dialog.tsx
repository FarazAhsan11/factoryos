"use client";

import { useState } from "react";
import { Package, Plus } from "lucide-react";

import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import {
  EMPTY_PRODUCT,
  ProductForm,
} from "@/components/factory/admin/product-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Add product: the button beside Bulk import, and the form it opens.
 *
 * It was an inline strip across the top of the list while a batch was six
 * fields. With the customer order behind it, fifteen fields in a row would
 * push the list below the fold on every visit to add one batch a day — so the
 * form lives in a dialog and the list keeps the screen.
 */
export function AddProductDialog({
  customers,
  onAdd,
}: {
  customers: Map<string, string>;
  /** Resolves once added; rejects (after its own toast) to keep the form open. */
  onAdd: (values: ProductValues) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Bumped on every open, so each one starts on a blank form while the
  // closing one keeps its content through the fade-out.
  const [session, setSession] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06]"
      >
        <Plus className="size-4" />
        Add product
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
            <DialogTitle className="flex items-center gap-2 text-ink">
              <Package className="size-4 text-brand" />
              Add product
            </DialogTitle>
            <DialogDescription>
              One batch and the customer order it&rsquo;s made against. Only the
              batch number and product name are required — fill in the rest
              when it&rsquo;s known.
            </DialogDescription>
          </DialogHeader>

          <ProductForm
            key={session}
            mode="create"
            initial={EMPTY_PRODUCT}
            customers={customers}
            onCancel={() => setOpen(false)}
            onSubmit={async (values) => {
              await onAdd(values);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
