"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Package,
  Search,
  Trash2,
  X,
} from "lucide-react";
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
import { DateField } from "@/components/ui/date-picker";
import {
  EmptyState,
  FIELD,
  PANEL,
  PanelHeader,
} from "@/components/factory/admin/settings-ui";
import { cn } from "@/lib/utils";

/**
 * The two halves of the catalogue.
 *
 * "Finished" is read from the pipeline, not from the row's own Active /
 * Retired chip — retiring is a manual act about whether the shift log may
 * still name a batch, while finishing is what the board says happened to it.
 * A batch can be finished and still active, or retired without ever running.
 */
type Scope = "open" | "finished";

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  {
    value: "open",
    label: "Open",
    hint: "Batches not yet planned, plus everything the board is still carrying — planned, in production or on hold.",
  },
  {
    value: "finished",
    label: "Finished",
    hint: "Batches whose every pipeline job has been signed off.",
  },
];

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
  const [scope, setScope] = useState<Scope>("open");
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
  /**
   * Batches that were created as packing runs of another batch, and the bulk
   * they came from.
   *
   * The New batch dialog writes a catalogue row and a pipeline card in one
   * act (migration 0031), so 46001 can appear here without anyone having
   * typed it on this screen. Saying where it came from is what stops the
   * catalogue looking like it grew rows on its own.
   */
  const packingParent = useMemo(
    () =>
      new Map(
        jobs
          .filter((job) => job.parent_batch_no)
          .map((job) => [job.product_id, job.parent_batch_no!]),
      ),
    [jobs],
  );

  /**
   * Which batches the board has signed off.
   *
   * A batch counts as finished only when it has at least one pipeline job and
   * *every* one of them is finished — a batch run as three work orders is not
   * done because the first one is. A batch with no job at all hasn't been
   * planned yet, which is the other half of the Open pill, not this one.
   */
  const finished = useMemo(() => {
    const done = new Map<string, boolean>();
    for (const job of jobs) {
      done.set(
        job.product_id,
        (done.get(job.product_id) ?? true) && job.status === "finished",
      );
    }
    return new Set(
      [...done].filter(([, complete]) => complete).map(([id]) => id),
    );
  }, [jobs]);

  /* The catalogue grows monotonically — every batch ever made stays in it, so
     by the second month the rows anyone actually works with are outnumbered by
     history. The pills split it on the one fact that decides that: whether the
     board is still carrying the batch. */
  const scoped = useMemo(
    () => products.filter((p) => finished.has(p.id) === (scope === "finished")),
    [products, finished, scope],
  );
  const finishedCount = useMemo(
    () => products.filter((p) => finished.has(p.id)).length,
    [products, finished],
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
    if (!term) return scoped;
    return scoped.filter((p) =>
      [p.batch_no, p.code, p.name, p.work_order]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term)),
    );
  }, [scoped, search]);

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
      <PanelHeader
        icon={Package}
        title="Products"
        description="The batch catalogue. A batch number typed into the shift log resolves to a product here, and a scheduled date puts it on the pipeline board."
        count={products.length}
        action={
          canManage ? (
            <ProductImportDialog
              factoryId={factoryId}
              // The catalogue is already loaded here, so the dialog can name
              // the batches it will skip before writing anything.
              existingBatchNos={products.map((p) => p.batch_no)}
              onImported={refresh}
            />
          ) : undefined
        }
      />

      {canManage && (
        <AddProductForm
          onAdd={(values) => add.mutateAsync(values).then(() => {})}
        />
      )}

      {/* Import moved up beside the title — it is a second way to fill the
          catalogue, not a field of the Add form and not a sibling of search. */}
      {products.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Which half of the catalogue is on screen. Not a tab strip: it
              filters one table rather than swapping panels, so the search box
              beside it keeps applying to whatever is showing. */}
          <div className="flex shrink-0 gap-1.5">
            {SCOPES.map((option) => {
              const on = scope === option.value;
              const count =
                option.value === "finished"
                  ? finishedCount
                  : products.length - finishedCount;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setScope(option.value)}
                  aria-pressed={on}
                  title={option.hint}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    on
                      ? "border-brand bg-brand text-white shadow-brand-sm"
                      : "border-line bg-surface text-ink-3 hover:border-ink-6 hover:text-ink",
                  )}
                >
                  {option.label}
                  <span
                    className={cn(
                      "ml-1.5 font-bold tabular-nums",
                      on ? "text-white/70" : "text-ink-5",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by batch, code or product name…"
              aria-label="Search the catalogue"
              className={cn(FIELD, "pr-3.5 pl-10")}
            />
          </div>
        </div>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the catalogue: {(error as Error).message}
        </p>
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet."
          hint={
            canManage
              ? "Add your first batch above, or import the catalogue from CSV."
              : "A manager fills the catalogue."
          }
        />
      ) : scoped.length === 0 ? (
        // An empty pill is not an empty catalogue — say which one is empty,
        // or the screen reads as "your products are gone".
        <EmptyState
          icon={scope === "finished" ? CheckCircle2 : Package}
          title={
            scope === "finished"
              ? "No finished batches yet."
              : "Every batch in the catalogue is finished."
          }
          hint={
            scope === "finished"
              ? "A batch lands here once every pipeline job against it is signed off."
              : "Add a batch above, or switch to Finished to see the completed ones."
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`Nothing matches “${search}”.`}
          hint={
            scope === "finished"
              ? "Only finished batches are being searched."
              : "Only open batches are being searched — try the Finished pill."
          }
        />
      ) : (
        <div className={cn(PANEL, "overflow-x-auto")}>
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line bg-sunken-2 text-left text-[10px] font-bold tracking-[0.07em] text-ink-3 uppercase">
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
                      {packingParent.has(product.id) && (
                        <span
                          className="ml-1.5 font-mono text-[10px] font-semibold text-brand"
                          title={`Packing run of batch ${packingParent.get(product.id)}`}
                        >
                          ← {packingParent.get(product.id)}
                        </span>
                      )}
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
                          <DateField
                            min={todayKey()}
                            value={editDate}
                            onChange={setEditDate}
                            ariaLabel={`Planned date for batch ${product.batch_no}`}
                            placeholder="Not scheduled"
                            className="h-8 w-44 rounded-lg px-2 text-[13px]"
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
