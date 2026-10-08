"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  DEFAULT_PRODUCT_PAGE_SIZE,
  createProduct,
  deleteProduct,
  fetchBatchNos,
  fetchCustomerNames,
  fetchProductCounts,
  fetchProductPage,
  productKeys,
  toProductRow,
  updateProduct,
  type ProductListParams,
  type ProductPage,
  type ProductPatch,
  type ProductRow,
  type ProductScope,
} from "@/lib/factory/product-queries";
import { TablePagination } from "@/components/factory/data/table-pagination";
import { DateField } from "@/components/ui/date-picker";
import {
  EmptyState,
  FIELD,
  PANEL,
} from "@/components/factory/admin/settings-ui";
import { cn } from "@/lib/utils";

/**
 * The two halves of the catalogue.
 *
 * "Finished" is read from the pipeline, not from the row's own Active /
 * Retired chip — retiring is a manual act about whether the shift log may
 * still name a batch, while finishing is what the board says happened to it.
 * A batch can be finished and still active, or retired without ever running.
 * The database decides which half a batch is in (`is_finished`, 0047), so the
 * table can page one half at a time.
 */
const SCOPES: { value: ProductScope; label: string; hint: string }[] = [
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

/** How long typing pauses before the server is asked. */
const SEARCH_DELAY_MS = 300;

/** 540000 → "540,000"; 2.85 stays "2.85". */
function formatQty(qty: number) {
  return qty.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** `YYYY-MM-DD` → "14 Aug"; a blank date stays null so its cell shows a dash. */
function day(iso: string | null) {
  return iso ? formatDay(iso) : null;
}

const CELL = "px-4 py-3 align-top text-[0.8125rem] whitespace-nowrap";
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
  const pagesKey = productKeys.pages(factoryId);
  // What is typed, and what the server was last asked: the second trails the
  // first by `SEARCH_DELAY_MS`, so a request goes out when typing pauses rather
  // than once per keystroke.
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [scope, setScope] = useState<ProductScope>("open");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PRODUCT_PAGE_SIZE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  // One page of one half of the catalogue. The previous page stays on screen
  // (dimmed) while the next loads, so paging never flashes an empty table.
  const params: ProductListParams = {
    scope,
    search: appliedSearch,
    page,
    pageSize,
  };
  const {
    data: current,
    isPending,
    isError,
    error,
    isPlaceholderData,
  } = useQuery({
    queryKey: productKeys.page(factoryId, params),
    queryFn: () => fetchProductPage(factoryId, params),
    placeholderData: keepPreviousData,
  });
  const products = current?.rows ?? [];
  const total = current?.total ?? 0;

  /** The two pills' numbers — the whole catalogue, whatever is searched. */
  const { data: counts } = useQuery({
    queryKey: productKeys.counts(factoryId),
    queryFn: () => fetchProductCounts(factoryId),
  });
  const openCount = counts?.open ?? 0;
  const finishedCount = counts?.finished ?? 0;
  const catalogueSize = openCount + finishedCount;

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

  /**
   * Customer code → name, from what the catalogue already holds, so the form
   * can fill the name in once it has seen the code. The list is newest first
   * and the first spelling found wins — the one somebody chose most recently.
   * Read as its own two-column query: the table itself holds one page.
   */
  const { data: customerRows = [] } = useQuery({
    queryKey: productKeys.customers(factoryId),
    queryFn: () => fetchCustomerNames(factoryId),
  });
  const customers = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of customerRows) {
      const code = row.customer_code.trim().toLowerCase();
      if (code && !map.has(code)) map.set(code, row.customer_name);
    }
    return map;
  }, [customerRows]);

  // Every batch number on file, so the import can name the ones it will skip.
  const { data: batchNos = [] } = useQuery({
    queryKey: productKeys.batchNos(factoryId),
    queryFn: () => fetchBatchNos(factoryId),
    enabled: canManage,
  });

  // Read from the cache rather than kept as a copy, so a save — including
  // its optimistic patch — shows in the open dialog straight away.
  const editProduct = editId
    ? (products.find((p) => p.id === editId) ?? null)
    : null;

  /** Everything under the catalogue's key: the pages, the counts, the rest. */
  function refresh() {
    return queryClient.invalidateQueries({ queryKey: productKeys.all(factoryId) });
  }

  /** Applies `fn` to every cached page — the optimistic edits' one entry point. */
  function patchPages(fn: (page: ProductPage) => ProductPage) {
    queryClient.setQueriesData<ProductPage>({ queryKey: pagesKey }, (old) =>
      old ? fn(old) : old,
    );
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
      await queryClient.cancelQueries({ queryKey: pagesKey });
      const previous = queryClient.getQueriesData<ProductPage>({
        queryKey: pagesKey,
      });
      patchPages((old) => ({
        ...old,
        rows: old.rows.map((p) => (p.id === id ? { ...p, ...values } : p)),
      }));
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      context?.previous.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
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
      await queryClient.cancelQueries({ queryKey: pagesKey });
      const previous = queryClient.getQueriesData<ProductPage>({
        queryKey: pagesKey,
      });
      patchPages((old) => ({
        ...old,
        rows: old.rows.filter((p) => p.id !== id),
        total: Math.max(0, old.total - 1),
      }));
      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      context?.previous.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      toast.error(e.message);
    },
    onSettled: () => refresh(),
  });

  /** Typing sets the box at once and the question to the server a beat later. */
  function onSearch(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setAppliedSearch(value);
      setPage(0);
    }, SEARCH_DELAY_MS);
  }

  function changeScope(next: ProductScope) {
    setScope(next);
    setPage(0);
  }

  function goToPage(next: number) {
    setPage(next);
    // The new page starts at its top, not wherever the last one was left.
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function saveQty(product: ProductRow) {
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
  function saveDate(product: ProductRow) {
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
  async function saveDetails(
    product: { id: string; batch_no: string },
    values: ProductValues,
  ) {
    await patch.mutateAsync({ id: product.id, values: toProductRow(values) });
    toast.success(`Batch ${product.batch_no} updated.`);
  }

  const today = todayKey();

  return (
    /* Fills the workspace frame from `lg` up rather than growing the page: the
       title and filters stay put, the table takes the rest and scrolls inside
       itself — one scrollbar pair, header row pinned — and the pager sits
       under it. Below `lg` the page scrolls as usual. */
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      {/* One row, and no title above it — the rail already says where this
          is. The pills and search sit on the left and right of it, and the
          import and add buttons end it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {(!counts || catalogueSize > 0) && (
        <>
          {/* Which half of the catalogue is on screen. Not a tab strip: it
              filters one table rather than swapping panels, so the search box
              beside it keeps applying to whatever is showing. */}
          <div className="flex shrink-0 gap-1.5">
            {SCOPES.map((option) => {
              const on = scope === option.value;
              const count =
                option.value === "finished" ? finishedCount : openCount;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeScope(option.value)}
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

          <div className="hidden flex-1 sm:block" />

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-5" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search batch, product, customer, SO or status…"
              aria-label="Search the catalogue"
              className={cn(FIELD, "pr-3.5 pl-10")}
            />
          </div>
        </>
        )}

        {canManage && (
          <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
            <ProductImportDialog
              factoryId={factoryId}
              // Every batch number on file, so the dialog can name the ones it
              // will skip before writing anything.
              existingBatchNos={batchNos}
              onImported={refresh}
            />
            <AddProductDialog
              customers={customers}
              onAdd={(values) => add.mutateAsync(values).then(() => {})}
            />
          </div>
        )}
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the catalogue: {(error as Error).message}
        </p>
      ) : products.length === 0 && appliedSearch ? (
        <EmptyState
          icon={Search}
          title={`Nothing matches “${appliedSearch}”.`}
          hint={
            scope === "finished"
              ? "Only finished batches are being searched."
              : "Only open batches are being searched — try the Finished pill."
          }
        />
      ) : products.length === 0 && catalogueSize === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet."
          hint={
            canManage
              ? "Add your first batch with Add product, or import the catalogue from CSV."
              : "A manager fills the catalogue."
          }
        />
      ) : products.length === 0 ? (
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
      ) : (
        // The card holds the scroll box and the pager, so the pager is never
        // scrolled away and nothing is left hanging below the table.
        <div
          className={cn(
            PANEL,
            "flex flex-col transition-opacity lg:min-h-0 lg:flex-1",
            isPlaceholderData && "opacity-60",
          )}
        >
        <div
          ref={scrollRef}
          className="scrollbar-slim max-h-[70dvh] overflow-auto lg:max-h-none lg:min-h-0 lg:flex-1"
        >
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-[0.625rem] font-bold tracking-[0.07em] whitespace-nowrap text-ink-3 uppercase">
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
              {products.map((product) => {
                const editing = editingId === product.id;
                const editingDate = editingDateId === product.id;
                const promoted = onBoard.has(product.id);
                const status = product.status;
                // A finished batch can't be late any more, whatever the date.
                const pastDue =
                  product.due_date !== null &&
                  product.due_date < today &&
                  !product.is_finished;
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
                        "px-4 py-3 align-top font-mono text-[0.8125rem] font-medium whitespace-nowrap text-ink",
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
                          className="ml-1.5 font-mono text-[0.625rem] font-semibold text-brand"
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

                    <td className="px-4 py-3 text-right align-top font-mono text-[0.8125rem] text-ink">
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

                    <td className="min-w-[180px] px-4 py-3 align-top text-[0.8125rem]">
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
                    <td className="px-4 py-3 align-top text-[0.8125rem]">
                      {editingDate ? (
                        <span className="inline-flex items-center gap-1">
                          <DateField
                            min={today}
                            value={editDate}
                            onChange={setEditDate}
                            ariaLabel={`Planned date for batch ${product.batch_no}`}
                            placeholder="Not scheduled"
                            className="h-8 w-44 rounded-lg px-2 text-[0.8125rem]"
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
                            className="shrink-0 rounded-full bg-sunken-2 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-3 transition hover:bg-line"
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

        <div className="shrink-0 border-t border-line bg-gradient-to-b from-surface to-sunken px-3 py-2.5">
        <TablePagination
          page={current?.page ?? page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
        />
        </div>
        </div>
      )}

      <EditProductDialog
        product={editProduct}
        status={editProduct?.status ?? "received"}
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
    <span className={cn("text-ink-2", mono && "font-mono text-[0.7812rem]")}>
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
