"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  plannedForField,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import { AddProductForm } from "@/components/factory/admin/add-product-form";
import { ProductImportDialog } from "@/components/factory/admin/product-import-dialog";
import { formatDay, todayKey } from "@/lib/factory/dates";
import {
  fetchPipelineJobs,
  pipelineKeys,
} from "@/lib/factory/pipeline-queries";
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
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");

  const {
    data: products = [],
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => fetchProducts(factoryId),
  });

  /**
   * Which batches are already on the pipeline board.
   *
   * Same cache key the Pipeline page uses, so this is usually free, and it is
   * what decides whether a planned date is still editable: once a job exists
   * the schedule has been acted on, and migration 0018 refuses to change it.
   * Read here so the table can say so before anyone tries.
   */
  const { data: jobs = [] } = useQuery({
    queryKey: pipelineKeys.all(factoryId),
    queryFn: () => fetchPipelineJobs(factoryId),
  });
  const onBoard = useMemo(
    () => new Set(jobs.map((job) => job.product_id)),
    [jobs],
  );

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
    mutationFn: ({ id, values }: { id: string; values: Partial<Product> }) =>
      updateProduct(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Product[]>(queryKey);
      queryClient.setQueryData<Product[]>(queryKey, (old) =>
        (old ?? []).map((p) => (p.id === id ? { ...p, ...values } : p)),
      );
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      toast.error(e.message);
    },
    onSuccess: () => {
      setEditingId(null);
      setEditingDateId(null);
    },
    onSettled: () => refresh(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Product[]>(queryKey);
      queryClient.setQueryData<Product[]>(queryKey, (old) =>
        (old ?? []).filter((p) => p.id !== id),
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
        .some((field) => field!.toLowerCase().includes(term)),
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

  /**
   * Saves a planned date, or clears it when the field is emptied.
   *
   * Validated with the same `plannedForField` the Add form and the CSV import
   * use — three entry points, one rule about what a schedule may be. The
   * database re-checks it either way; this is what turns "check_violation"
   * into a sentence before the round-trip.
   */
  function saveDate(product: Product) {
    const value = editDate.trim();
    if (value === (product.planned_for ?? "")) {
      setEditingDateId(null);
      return;
    }

    const parsed = plannedForField.safeParse(value);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid date.");
      return;
    }

    patch.mutate({ id: product.id, values: { planned_for: value || null } });
  }

  return (
    <div className="space-y-5">
      {canManage && (
        <AddProductForm
          onAdd={(values) => add.mutateAsync(values).then(() => {})}
        />
      )}

      {/* Import sits beside the search rather than inside the Add form: it is
          a second way to fill the catalogue, not a field of the first. The row
          renders for a manager even on an empty catalogue, which is exactly
          when a bulk import is most wanted. */}
      {(canManage || products.length > 0) && (
        <div className="flex items-center gap-2">
          {products.length > 0 && (
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by batch, code or product name…"
                aria-label="Search the catalogue"
                className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-3.5 text-sm text-ink outline-none transition placeholder:text-ink-5 focus:border-brand focus:ring-4 focus:ring-brand/12"
              />
            </div>
          )}
          {canManage && (
            <ProductImportDialog
              factoryId={factoryId}
              // The catalogue is already loaded here, so the dialog can name
              // the batches it will skip before writing anything.
              existingBatchNos={products.map((p) => p.batch_no)}
              onImported={refresh}
            />
          )}
        </div>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the catalogue: {(error as Error).message}
        </p>
      ) : products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          No products yet
          {canManage ? " — add your first batch above." : "."}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ink-6 px-4 py-10 text-center text-sm text-ink-5">
          Nothing matches “{search}”.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs font-semibold uppercase tracking-wide text-ink-5">
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Product name</th>
                <th className="px-4 py-3">Work order</th>
                <th className="px-4 py-3 text-right">Required qty</th>
                <th className="px-4 py-3">Planned for</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const editing = editingId === product.id;
                const editingDate = editingDateId === product.id;
                const promoted = onBoard.has(product.id);
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      "border-b border-sunken last:border-0",
                      !product.active && "bg-sunken text-ink-5",
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-[13px] font-medium text-ink">
                      {product.batch_no}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink-4">
                      {product.code || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          product.active ? "text-ink" : "line-through",
                        )}
                      >
                        {product.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-ink-4">
                      {product.work_order || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[13px] text-ink">
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
                            className="h-8 w-28 rounded-lg border border-line px-2 text-right text-sm outline-none focus:border-brand"
                          />
                          <IconButton
                            label="Save quantity"
                            onClick={() => saveQty(product)}
                          >
                            <Check className="size-4 text-teal" />
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
                          className="rounded-md px-1.5 py-0.5 transition hover:bg-sunken-2"
                        >
                          {formatQty(product.required_qty)}
                        </button>
                      ) : (
                        formatQty(product.required_qty)
                      )}
                    </td>

                    {/* The schedule. Three states, and they are genuinely
                        different things: a date still to come, a batch already
                        on the board (frozen — the schedule has been acted on),
                        and no schedule at all, which is not a gap but the
                        other way of working: New job, by hand, on the day. */}
                    <td className="px-4 py-3 text-[13px]">
                      {editingDate ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            autoFocus
                            type="date"
                            min={todayKey()}
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveDate(product);
                              if (e.key === "Escape") setEditingDateId(null);
                            }}
                            aria-label={`Planned date for batch ${product.batch_no}`}
                            className="h-8 w-36 rounded-lg border border-line px-2 text-[13px] outline-none focus:border-brand"
                          />
                          <IconButton
                            label="Save planned date"
                            onClick={() => saveDate(product)}
                          >
                            <Check className="size-4 text-teal" />
                          </IconButton>
                          <IconButton
                            label="Cancel"
                            onClick={() => setEditingDateId(null)}
                          >
                            <X className="size-4" />
                          </IconButton>
                        </span>
                      ) : promoted ? (
                        // No dash when there is no date: a batch added by hand
                        // from New job never had a schedule, so a dash reads as
                        // a missing value rather than an inapplicable one. The
                        // chip already says everything true about the row.
                        <span
                          title={
                            product.planned_for
                              ? `Scheduled for ${product.planned_for} and already on the pipeline board, so the date is now fixed.`
                              : "Added to the pipeline board by hand from New job."
                          }
                          className="inline-flex items-center gap-1.5 text-ink-4"
                        >
                          {product.planned_for &&
                            formatDay(product.planned_for)}
                          <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                            On board
                          </span>
                        </span>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDateId(product.id);
                            setEditDate(product.planned_for ?? "");
                          }}
                          title="The day this batch joins the pipeline as Planned"
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:bg-sunken-2",
                            product.planned_for
                              ? "font-medium text-ink"
                              : "text-ink-5",
                          )}
                        >
                          {product.planned_for ? (
                            formatDay(product.planned_for)
                          ) : (
                            <>
                              <CalendarPlus className="size-3.5" />
                              Schedule
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-ink-4">
                          {product.planned_for
                            ? formatDay(product.planned_for)
                            : "—"}
                        </span>
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
                            className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 transition hover:bg-line"
                          >
                            {product.active ? "Active" : "Retired"}
                          </button>
                          <IconButton
                            label={`Delete batch ${product.batch_no}`}
                            onClick={() => remove.mutate(product.id)}
                          >
                            <Trash2 className="size-3.5 text-danger-deep" />
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
        <p className="text-xs text-ink-5">
          Retire a finished batch to keep its shift history but hide it from new
          entries. Click a quantity or a planned date to change it. A batch with
          a planned date joins the pipeline as <strong>Planned</strong> on that
          day; one without is added by hand from <strong>New job</strong>.
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
      className="shrink-0 rounded-md p-1 text-ink-5 transition hover:bg-sunken-2 hover:text-ink-3"
    >
      {children}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-line-soft p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-sunken" />
      ))}
    </div>
  );
}
