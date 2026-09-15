"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Package,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  plannedForField,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import { AddProductDialog } from "@/components/factory/admin/add-product-dialog";
import { EditProductDialog } from "@/components/factory/admin/edit-product-dialog";
import { ProductStatusChip } from "@/components/factory/admin/product-status-chip";
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
  productStatus,
  statusMeta,
  toProductRow,
  updateProduct,
  type Product,
  type ProductPatch,
  type ProductStatus,
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

/** `YYYY-MM-DD` → "14 Aug"; a blank date stays null so its cell shows a dash. */
function day(iso: string | null) {
  return iso ? formatDay(iso) : null;
}

const CELL = "px-4 py-3 align-top text-[13px] whitespace-nowrap";
/* Every field is a column, so the table runs wider than the screen. The batch
   number stays pinned while the rest scroll, so a row is still identifiable
   wherever it is scrolled to. */
const STICKY_LEFT = "sticky left-0 z-10 shadow-[inset_-1px_0_0_var(--color-line)]";
/* The header row stays in view while the rows scroll under it. Each cell
   paints its own ground and bottom rule: a row's background and border don't
   travel with a sticky cell. */
const TH =
  "sticky top-0 z-20 bg-sunken-2 px-4 py-3 shadow-[inset_0_-1px_0_var(--color-line)]";

/**
 * Products: the batch catalogue. One row per batch / work order,
 * carrying its own code, name and required quantity — the shape the shift log
 * auto-fills from when someone types a batch number — and, since migration
 * 0041, the customer order it is made against.
 *
 * Every field on file is a column; the pencil in Actions opens the edit form.
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
  const [editId, setEditId] = useState<string | null>(null);

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

  /** Each batch's card status — one card per batch (0016's unique index). */
  const jobStatus = useMemo(
    () => new Map(jobs.map((job) => [job.product_id, job.status])),
    [jobs],
  );
  /**
   * The day each card joined the board (`planned_at`, as a local day) — what
   * Planned for shows for a batch that was put there rather than scheduled.
   */
  const joinedBoard = useMemo(
    () =>
      new Map(
        jobs.map((job) => [job.product_id, todayKey(new Date(job.planned_at))]),
      ),
    [jobs],
  );
  function statusOf(id: string): ProductStatus {
    return productStatus(jobStatus.get(id));
  }

  /**
   * Customer code → name, from what the catalogue already holds, so the form
   * can fill the name in once it has seen the code. The list is newest first
   * and the first spelling found wins — the one somebody chose most recently.
   */
  const customers = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      const code = p.customer_code?.trim().toLowerCase();
      if (code && p.customer_name && !map.has(code)) {
        map.set(code, p.customer_name);
      }
    }
    return map;
  }, [products]);

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

  // Read from the cache rather than kept as a copy, so a save — including
  // its optimistic patch — shows in the open dialog straight away.
  const editProduct = editId
    ? (products.find((p) => p.id === editId) ?? null)
    : null;

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

  /** Shared optimistic patch for the row-level edits and the Edit dialog. */
  const patch = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductPatch }) =>
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
  // the list is already loaded and cached. The customer and the sales order
  // are searched too: "everything for Phytologic" is a question the list
  // gets asked.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return scoped;
    return scoped.filter((p) =>
      [
        p.batch_no,
        p.code,
        p.name,
        p.work_order,
        p.customer_code,
        p.customer_name,
        p.sales_order_no,
        statusMeta(productStatus(jobStatus.get(p.id))).label,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term)),
    );
  }, [scoped, search, jobStatus]);

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

  /** The Edit dialog's save. Rejects on failure so the form stays open. */
  async function saveDetails(product: Product, values: ProductValues) {
    await patch.mutateAsync({ id: product.id, values: toProductRow(values) });
    toast.success(`Batch ${product.batch_no} updated.`);
  }

  const today = todayKey();

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={Package}
        title="Products"
        description="The batch catalogue and the customer order behind each batch. A batch number typed into the shift log resolves to a product here, and a scheduled date puts it on the pipeline board."
        count={products.length}
        action={
          canManage ? (
            <>
              <ProductImportDialog
                factoryId={factoryId}
                // The catalogue is already loaded here, so the dialog can name
                // the batches it will skip before writing anything.
                existingBatchNos={products.map((p) => p.batch_no)}
                onImported={refresh}
              />
              <AddProductDialog
                customers={customers}
                onAdd={(values) => add.mutateAsync(values).then(() => {})}
              />
            </>
          ) : undefined
        }
      />

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
              placeholder="Search batch, product, customer, SO or status…"
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
              ? "Add your first batch with Add product, or import the catalogue from CSV."
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
              : "Add a batch with Add product, or switch to Finished to see the completed ones."
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
        // Scrolls both ways inside itself, capped to the viewport, so the
        // header row can stick to its top — a sticky header only sticks
        // within its nearest scrolling box, and this one has to scroll
        // sideways anyway.
        <div
          className={cn(
            PANEL,
            "scrollbar-slim max-h-[max(20rem,calc(100dvh-20rem))] overflow-auto",
          )}
        >
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-[0.07em] whitespace-nowrap text-ink-3 uppercase">
                {/* Pinned on both axes, so it sits above the scrolling
                    header cells and the pinned batch cells alike. */}
                <th
                  className={cn(
                    TH,
                    "left-0 z-30 shadow-[inset_-1px_-1px_0_var(--color-line)]",
                  )}
                >
                  Batch
                </th>
                <th className={TH}>Product</th>
                <th className={TH}>Product code</th>
                <th className={TH}>Work order</th>
                <th className={TH}>Status</th>
                <th className={cn(TH, "text-right")}>Required qty</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Customer code</th>
                <th className={TH}>SO order no</th>
                <th className={cn(TH, "text-right")}>Order value</th>
                <th className={TH}>Rep / sales manager</th>
                <th className={TH}>Order received</th>
                <th className={TH}>Exp. start</th>
                <th className={TH}>Exp. finish</th>
                <th className={TH}>Due</th>
                <th className={TH}>Planned for</th>
                <th className={TH}>Added</th>
                {canManage && <th className={cn(TH, "text-right")}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const editing = editingId === product.id;
                const editingDate = editingDateId === product.id;
                const promoted = onBoard.has(product.id);
                const status = statusOf(product.id);
                // A finished batch can't be late any more, whatever the date.
                const pastDue =
                  product.due_date !== null &&
                  product.due_date < today &&
                  !finished.has(product.id);
                // The pinned batch cell paints its own ground, or the
                // scrolling columns would show through it.
                const rowBg = product.active ? "bg-surface" : "bg-sunken";
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      "border-b border-sunken last:border-0",
                      !product.active && "bg-sunken text-ink-5",
                    )}
                  >
                    <td
                      className={cn(
                        STICKY_LEFT,
                        rowBg,
                        "px-4 py-3 align-top font-mono text-[13px] font-medium whitespace-nowrap text-ink",
                      )}
                    >
                      {product.batch_no}
                    </td>

                    <td className="min-w-[240px] px-4 py-3 align-top">
                      <span
                        className={cn(
                          "font-medium",
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

                    <td className={CELL}>
                      <Val value={product.code} mono />
                    </td>
                    <td className={CELL}>
                      <Val value={product.work_order} mono />
                    </td>

                    {/* Nobody sets this: Received until the batch has a card,
                        then the card's column, moved by the shift log. */}
                    <td className="px-4 py-3 align-top">
                      <ProductStatusChip
                        status={status}
                        title={
                          status === "received"
                            ? "Order received — not on the pipeline board yet."
                            : "Where the batch is on the pipeline board. It follows the shift log."
                        }
                      />
                    </td>

                    <td className="px-4 py-3 text-right align-top font-mono text-[13px] text-ink">
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

                    <td className="min-w-[180px] px-4 py-3 align-top text-[13px]">
                      <Val value={product.customer_name} />
                    </td>
                    <td className={CELL}>
                      <Val value={product.customer_code} mono />
                    </td>
                    <td className={CELL}>
                      <Val value={product.sales_order_no} mono />
                    </td>
                    {/* A blank order value is "not recorded" — a dash, never a 0. */}
                    <td className={cn(CELL, "text-right")}>
                      <Val
                        value={
                          product.order_value === null
                            ? null
                            : formatQty(Number(product.order_value))
                        }
                        mono
                      />
                    </td>
                    <td className={CELL}>
                      <Val value={product.sales_rep} />
                    </td>
                    <td className={CELL}>
                      <Val value={day(product.ordered_on)} />
                    </td>
                    <td className={CELL}>
                      <Val value={day(product.expected_start)} />
                    </td>
                    <td className={CELL}>
                      <Val value={day(product.expected_finish)} />
                    </td>

                    <td className={CELL}>
                      {product.due_date ? (
                        <span
                          title={
                            pastDue
                              ? `Due ${product.due_date} — past due and not finished`
                              : `Due ${product.due_date}`
                          }
                          className={cn(
                            pastDue
                              ? "font-medium text-danger-deep"
                              : "text-ink-3",
                          )}
                        >
                          {formatDay(product.due_date)}
                        </span>
                      ) : (
                        <span className="text-ink-6">—</span>
                      )}
                    </td>

                    {/* The schedule. Three states, and they are genuinely
                        different things: a date still to come, a batch already
                        on the board (frozen — the schedule has been acted on),
                        and no schedule at all, which is not a gap but the
                        other way of working: New job, by hand, on the day. */}
                    <td className="px-4 py-3 align-top text-[13px]">
                      {editingDate ? (
                        <span className="inline-flex items-center gap-1">
                          <DateField
                            min={today}
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
                        // Fixed once the card exists (0018). Either way this is
                        // the day the batch reached Planned: its scheduled date,
                        // or — for one put on the board from New batch or From
                        // catalogue — the day that happened, read from the card.
                        <span
                          title={
                            product.planned_for
                              ? `Scheduled for ${product.planned_for} and already on the pipeline board, so the date is now fixed.`
                              : "No date was scheduled — this is the day it was added to the pipeline board."
                          }
                          className="text-ink-4"
                        >
                          {product.planned_for
                            ? formatDay(product.planned_for)
                            : joinedBoard.has(product.id)
                              ? `Added ${formatDay(joinedBoard.get(product.id)!)}`
                              : "—"}
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

                    <td className={CELL}>
                      <Val value={formatDay(todayKey(new Date(product.created_at)))} />
                    </td>

                    {canManage && (
                      <td className="px-4 py-3 align-top">
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
                            label={`Edit batch ${product.batch_no}`}
                            onClick={() => setEditId(product.id)}
                          >
                            <Pencil className="size-3.5 text-brand" />
                          </IconButton>
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

      <EditProductDialog
        product={editProduct}
        status={editProduct ? statusOf(editProduct.id) : "received"}
        customers={customers}
        onSave={saveDetails}
        onClose={() => setEditId(null)}
      />
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

/** A plain value cell — an em dash for a field left blank, never an empty cell. */
function Val({
  value,
  mono,
}: {
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return <span className="text-ink-6">—</span>;
  return (
    <span className={cn("text-ink-2", mono && "font-mono text-[12.5px]")}>
      {value}
    </span>
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
