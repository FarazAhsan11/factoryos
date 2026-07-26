"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import { AddProductForm } from "@/components/factory/admin/add-product-form";
import {
  createProduct,
  deleteProduct,
  fetchProducts,
  productKeys,
  updateProduct,
  type Product,
} from "@/lib/factory/product-queries";
import { cn } from "@/lib/utils";

/** 540000 → "540,000"; 2.85 stays "2.85". */
function formatQty(qty: number) {
  return qty.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Admin → Products: the batch catalogue. One row per batch / work order,
 * carrying its own code, name and required quantity — the shape the shift log
 * auto-fills from when someone types a batch number.
 */
export function ProductsPanel({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = productKeys.all(factoryId);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");

  const { data: products = [], isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchProducts(factoryId),
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const add = useMutation({
    mutationFn: (values: ProductValues) => createProduct(factoryId, values),
    onSuccess: async (created) => {
      await refresh();
      toast.success(`Batch ${created.batch_no} added.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Shared optimistic patch for the row-level edits. */
  const patch = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: Partial<Product>;
    }) => updateProduct(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Product[]>(queryKey);
      queryClient.setQueryData<Product[]>(queryKey, (old) =>
        (old ?? []).map((p) => (p.id === id ? { ...p, ...values } : p))
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSuccess: () => setEditingId(null),
    onSettled: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Product[]>(queryKey);
      queryClient.setQueryData<Product[]>(queryKey, (old) =>
        (old ?? []).filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  // A real catalogue runs to hundreds of batches, so filter in the client —
  // the list is already loaded and cached.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) =>
      [p.batch_no, p.code, p.name, p.work_order]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term))
    );
  }, [products, search]);

  function saveQty(product: Product) {
    const value = Number(editQty);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid quantity.");
      return;
    }
    if (value === product.required_qty) {
      setEditingId(null);
      return;
    }
    patch.mutate({ id: product.id, values: { required_qty: value } });
  }

  return (
    <div className="space-y-5">
      {canManage && (
        <AddProductForm onAdd={(values) => add.mutateAsync(values).then(() => {})} />
      )}

      {products.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by batch, code or product name…"
            aria-label="Search the catalogue"
            className="h-10 w-full rounded-xl border border-[#E6EAF1] bg-white pl-10 pr-3.5 text-sm text-[#0F1B34] outline-none transition placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/12"
          />
        </div>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
          Could not load the catalogue: {(error as Error).message}
        </p>
      ) : products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          No products yet
          {canManage ? " — add your first batch above." : "."}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#CBD5E1] px-4 py-10 text-center text-sm text-[#94A3B8]">
          Nothing matches “{search}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#E6EAF1] bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[#EEF1F6] text-left text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Product name</th>
                <th className="px-4 py-3">Work order</th>
                <th className="px-4 py-3 text-right">Required qty</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const editing = editingId === product.id;
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      "border-b border-[#F5F7FA] last:border-0",
                      !product.active && "bg-[#FBFCFE] text-[#94A3B8]"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-[#0F1B34]">
                      {product.batch_no}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-[#64748B]">
                      {product.code || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          product.active ? "text-[#0F1B34]" : "line-through"
                        )}
                      >
                        {product.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-[#64748B]">
                      {product.work_order || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-[#0F1B34]">
                      {editing ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            autoFocus
                            type="number"
                            step="any"
                            min={0}
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveQty(product);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            aria-label={`Required quantity for batch ${product.batch_no}`}
                            className="h-8 w-28 rounded-lg border border-[#E6EAF1] px-2 text-right text-sm outline-none focus:border-[#2563EB]"
                          />
                          <IconButton
                            label="Save quantity"
                            onClick={() => saveQty(product)}
                          >
                            <Check className="size-4 text-[#16A34A]" />
                          </IconButton>
                          <IconButton
                            label="Cancel"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="size-4" />
                          </IconButton>
                        </span>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(product.id);
                            setEditQty(String(product.required_qty));
                          }}
                          title="Edit required quantity"
                          className="rounded-md px-1.5 py-0.5 transition hover:bg-[#F1F5F9]"
                        >
                          {formatQty(product.required_qty)}
                        </button>
                      ) : (
                        formatQty(product.required_qty)
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              patch.mutate({
                                id: product.id,
                                values: { active: !product.active },
                              })
                            }
                            className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-medium text-[#475569] transition hover:bg-[#E2E8F0]"
                          >
                            {product.active ? "Active" : "Retired"}
                          </button>
                          <IconButton
                            label={`Delete batch ${product.batch_no}`}
                            onClick={() => remove.mutate(product.id)}
                          >
                            <Trash2 className="size-3.5 text-[#B91C1C]" />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canManage && products.length > 0 && (
        <p className="text-xs text-[#94A3B8]">
          Retire a finished batch to keep its shift history but hide it from new
          entries. Click a quantity to correct it.
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md p-1 text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#475569]"
    >
      {children}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-[#EEF1F6] p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-[#F8FAFC]" />
      ))}
    </div>
  );
}
