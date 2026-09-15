"use client";

import { Pencil } from "lucide-react";

import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import { ProductForm } from "@/components/factory/admin/product-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  toProductValues,
  type Product,
  type ProductStatus,
} from "@/lib/factory/product-queries";

/**
 * Edit product: opened from the row's Edit button in the catalogue table.
 *
 * The table already shows every field on file, so there is no read-only view
 * to pass through — the dialog opens straight onto `ProductForm`, prefilled,
 * the same form Add product uses.
 */
export function EditProductDialog({
  product,
  status,
  customers,
  onSave,
  onClose,
}: {
  product: Product | null;
  /** From `productStatus` — decides whether the planned date is still editable. */
  status: ProductStatus;
  customers: Map<string, string>;
  /** Resolves once saved; rejects (after its own toast) to keep the form open. */
  onSave: (product: Product, values: ProductValues) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="flex items-center gap-2 break-words text-ink">
            <Pencil className="size-4 shrink-0 text-brand" />
            Edit product
          </DialogTitle>
          <DialogDescription className="font-mono text-[12.5px]">
            Batch {product?.batch_no}
            {product?.code && ` · ${product.code}`}
          </DialogDescription>
        </DialogHeader>

        {product && (
          <ProductForm
            // Keyed to the product, so opening a different row never shows
            // the last one's half-edited values.
            key={product.id}
            mode="edit"
            initial={toProductValues(product)}
            plannedLocked={
              status === "received"
                ? undefined
                : "This batch is already on the pipeline board, so its planned date is fixed."
            }
            customers={customers}
            onCancel={onClose}
            onSubmit={async (values) => {
              await onSave(product, values);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
