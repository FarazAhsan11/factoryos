"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import { ProductForm } from "@/components/factory/admin/product-form";
import { ProductStatusChip } from "@/components/factory/admin/product-status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDay, todayKey } from "@/lib/factory/dates";
import {
  toProductValues,
  type Product,
  type ProductStatus,
} from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/** 540000 → "540,000"; null → an em dash, never a 0. */
function fmt(n: number | null | undefined) {
  return n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function day(iso: string | null) {
  return iso ? formatDay(iso) : "—";
}

/**
 * One catalogue row, in full — opened from the product's name in the list.
 *
 * The list carries what someone scans for (batch, product, customer, due
 * date); this carries everything, including the fields that are empty. A
 * blank order value is a different fact from 0, and a record that silently
 * leaves the question out reads as though it was never asked.
 *
 * Edit swaps the same dialog over to `ProductForm`, prefilled — the form
 * Add product uses — rather than opening a second dialog on top of this one.
 */
export function ProductDetailDialog({
  product,
  status,
  joinedBoard,
  packingParent,
  canManage,
  customers,
  onSave,
  onClose,
}: {
  product: Product | null;
  /** From `productStatus` — the board's, or Received before there is a card. */
  status: ProductStatus;
  /** `YYYY-MM-DD` the card joined the board, when there is one. */
  joinedBoard?: string;
  /** The bulk batch this one is a packing run of, when it is one. */
  packingParent?: string;
  canManage: boolean;
  customers: Map<string, string>;
  /** Resolves once saved; rejects (after its own toast) to keep the form open. */
  onSave: (product: Product, values: ProductValues) => Promise<void>;
  onClose: () => void;
}) {
  // Keyed to the product, so opening a different one never lands in edit.
  const [editingFor, setEditingFor] = useState<string | null>(null);
  const editing = product !== null && editingFor === product.id;

  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => {
        if (open) return;
        setEditingFor(null);
        onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-line bg-surface px-5 pt-5 pr-12 pb-4">
          <DialogTitle className="break-words text-ink">
            {editing ? "Edit product" : (product?.name ?? "—")}
          </DialogTitle>
          <DialogDescription className="font-mono text-[12.5px]">
            Batch {product?.batch_no}
            {product?.code && ` · ${product.code}`}
          </DialogDescription>
          {product && !editing && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <ProductStatusChip status={status} />
              {!product.active && (
                <Chip className="bg-sunken-2 text-ink-4">Retired</Chip>
              )}
              {packingParent && (
                <Chip className="bg-brand-soft text-brand">
                  Packing run of {packingParent}
                </Chip>
              )}
            </div>
          )}
        </DialogHeader>

        {product &&
          (editing ? (
            <ProductForm
              key={product.id}
              mode="edit"
              initial={toProductValues(product)}
              plannedLocked={
                status === "received"
                  ? undefined
                  : "This batch is already on the pipeline board, so its planned date is fixed."
              }
              customers={customers}
              onCancel={() => setEditingFor(null)}
              onSubmit={async (values) => {
                await onSave(product, values);
                setEditingFor(null);
              }}
            />
          ) : (
            <ProductDetails
              product={product}
              status={status}
              joinedBoard={joinedBoard}
              canManage={canManage}
              onEdit={() => setEditingFor(product.id)}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function ProductDetails({
  product,
  status,
  joinedBoard,
  canManage,
  onEdit,
}: {
  product: Product;
  status: ProductStatus;
  joinedBoard?: string;
  canManage: boolean;
  onEdit: () => void;
}) {
  // A finished batch can't be late any more, whatever the calendar says.
  const pastDue =
    product.due_date !== null &&
    product.due_date < todayKey() &&
    status !== "finished";

  const planned =
    status === "received"
      ? product.planned_for
        ? formatDay(product.planned_for)
        : "Not scheduled"
      : product.planned_for
        ? `${formatDay(product.planned_for)} · on the board`
        : joinedBoard
          ? `Added to the board ${formatDay(joinedBoard)}`
          : "On the board";

  return (
    <>
      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Group title="Customer order">
            <Row label="Customer" value={product.customer_name} />
            <Row label="Customer code" value={product.customer_code} mono />
            <Row label="SO order no" value={product.sales_order_no} mono />
            <Row label="Order value" value={fmt(product.order_value)} mono />
            <Row label="Rep / sales manager" value={product.sales_rep} />
          </Group>

          <Group title="Batch">
            <Row label="Batch / W.O." value={product.batch_no} mono />
            <Row label="Work order" value={product.work_order} mono />
            <Row label="Product code" value={product.code} mono />
            <Row
              label="Required qty"
              value={fmt(product.required_qty)}
              mono
              strong
            />
            {/* Not the status in the header: that is where the batch is on
                the board; this is whether the shift log may still name it. */}
            <Row label="Catalogue" value={product.active ? "Active" : "Retired"} />
          </Group>

          <Group title="Dates" className="sm:col-span-2" columns>
            <Row label="Order received" value={day(product.ordered_on)} />
            <Row label="Exp. start" value={day(product.expected_start)} />
            <Row label="Exp. finish" value={day(product.expected_finish)} />
            <Row
              label="Due date"
              value={day(product.due_date)}
              hint={pastDue ? "past due" : undefined}
              danger={pastDue}
            />
            <Row label="Planned for" value={planned} />
          </Group>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3.5">
        <p className="text-[11px] text-ink-5">
          Added{" "}
          {new Date(product.created_at).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
        {canManage && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink-2 transition hover:bg-sunken"
          >
            <Pencil className="size-3.5" />
            Edit details
          </button>
        )}
      </div>
    </>
  );
}

function Chip({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Group({
  title,
  columns,
  className,
  children,
}: {
  title: string;
  /** Lay the rows out two across — for a group as wide as the dialog. */
  columns?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line-soft bg-sunken p-3.5",
        className,
      )}
    >
      <h3 className="mb-2 text-[10px] font-bold tracking-[0.08em] text-ink-5 uppercase">
        {title}
      </h3>
      <dl
        className={cn(
          "space-y-1.5",
          columns && "grid gap-x-6 gap-y-1.5 space-y-0 sm:grid-cols-2",
        )}
      >
        {children}
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  danger,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  strong?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-ink-4">
        {label}
        {hint && (
          <span className={cn("ml-1 text-[10px]", danger ? "text-danger-deep" : "text-ink-6")}>
            ({hint})
          </span>
        )}
      </dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-xs font-medium text-ink-2",
          mono && "font-mono text-[12.5px]",
          strong && "font-semibold text-ink",
          danger && "text-danger-deep",
        )}
        title={value ?? undefined}
      >
        {value || "—"}
      </dd>
    </div>
  );
}
