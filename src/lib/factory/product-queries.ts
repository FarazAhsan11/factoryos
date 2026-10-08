import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import {
  PIPELINE_COLUMNS,
  type PipelineStatus,
} from "@/lib/factory/pipeline-queries";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for Products. Like the units/processes
 * lists, reads and writes go straight from the browser to Supabase and RLS
 * (`can_manage_factory`) is the trust boundary — which is what makes the
 * optimistic updates in the panel cheap.
 */

export interface Product {
  id: string;
  batch_no: string;
  code: string | null;
  name: string;
  work_order: string | null;
  required_qty: number;
  /**
   * `YYYY-MM-DD` — the day this batch joins the pipeline as Planned, or null
   * for a batch that is only ever added by hand from New batch. Kept after the
   * job is created, as the record of what was scheduled (migration 0018).
   */
  planned_for: string | null;
  active: boolean;
  created_at: string;

  /* ── The sales order behind the batch (migration 0041). All optional. ── */
  customer_code: string | null;
  customer_name: string | null;
  sales_order_no: string | null;
  /** Null is "not recorded"; 0 is kept as typed. */
  order_value: number | null;
  sales_rep: string | null;
  /** `YYYY-MM-DD` — the day the order was received. */
  ordered_on: string | null;
  /** `YYYY-MM-DD` — what the customer was promised. Seeds a new card's due date. */
  due_date: string | null;
  /**
   * `YYYY-MM-DD` — production's estimate. Informational: unlike `planned_for`
   * it moves nothing, and may already be in the past.
   */
  expected_start: string | null;
  expected_finish: string | null;
}

const COLUMNS = `id, batch_no, code, name, work_order, required_qty, planned_for,
  active, created_at, customer_code, customer_name, sales_order_no,
  order_value, sales_rep, ordered_on, due_date, expected_start,
  expected_finish`;

export const productKeys = {
  all: (factoryId: string) => ["factory_products", factoryId] as const,
  /**
   * Customer orders' pages, under `all` so the one `invalidateQueries` every
   * save already makes reaches them — and apart from it, so the full list the
   * rest of the app reads is never confused with one page of it.
   */
  pages: (factoryId: string) =>
    ["factory_products", factoryId, "page"] as const,
  page: (factoryId: string, params: ProductListParams) =>
    ["factory_products", factoryId, "page", params] as const,
  counts: (factoryId: string) =>
    ["factory_products", factoryId, "counts"] as const,
  customers: (factoryId: string) =>
    ["factory_products", factoryId, "customers"] as const,
  batchNos: (factoryId: string) =>
    ["factory_products", factoryId, "batch-nos"] as const,
};

/** Received, then one of the board's four columns. */
export type ProductStatus = "received" | PipelineStatus;

/**
 * Every status in the order a batch moves through them, with the board's own
 * labels and colours for the four it shares — so "On hold" on a product is
 * the same amber as the On hold column it is sitting in.
 */
export const PRODUCT_STATUSES: {
  status: ProductStatus;
  label: string;
  accent: string;
  tint: string;
}[] = [
  {
    status: "received",
    label: "Received",
    accent: "var(--color-ink-3)",
    tint: "var(--color-sunken-2)",
  },
  ...PIPELINE_COLUMNS,
];

/**
 * A product's status: **Received** from the moment it is added, until the
 * batch has a card on the pipeline board — then whatever the board says:
 * Planned, In production, On hold, Finished.
 *
 * Derived, never stored. The card's status is already moved by the shift log
 * (`pipeline_sync_from_log`) and by stage sign-offs; a copy on the product
 * would be a second record of the same fact, and the first one to fall out of
 * step would be the one a customer rang up about.
 */
export function productStatus(
  jobStatus: PipelineStatus | undefined,
): ProductStatus {
  return jobStatus ?? "received";
}

export function statusMeta(status: ProductStatus) {
  return PRODUCT_STATUSES.find((s) => s.status === status) ?? PRODUCT_STATUSES[0];
}

/** Every column a manager may change after the row exists. */
export type ProductPatch = Partial<Omit<Product, "id" | "created_at">>;

/** Turns a Postgres error into something an operator can act on. */
function toMessage(
  error: { code?: string; message: string },
  batchNo?: string,
): string {
  if (error.code === "23505") {
    return batchNo
      ? `Batch ${batchNo} already exists.`
      : "That batch number is already in use.";
  }
  return error.message;
}

/**
 * Form values → columns, for the single insert, the bulk import and an edit
 * alike, so the three can't disagree about what a blank field means.
 *
 * Everything but `batch_no`, which only the inserts send: once a batch exists
 * its number is what the shift log, the paperwork and every issue are filed
 * under, so an edit never re-sends it.
 */
export function toProductRow(values: ProductValues) {
  return {
    code: values.code || null,
    name: values.name,
    // The prototype falls back to the batch number when no separate work
    // order is tracked; keep that so the shift log always has something.
    work_order: values.workOrder?.trim() || values.batchNo,
    required_qty: values.requiredQty,
    // "" from an untouched date input is "not scheduled", not an empty date.
    // Re-sent unchanged on an edit, which the 0018 guard lets through — it
    // only objects to a date that moves.
    planned_for: values.plannedFor || null,
    // Blank is null, never "" or 0 — an order nobody priced is not an order
    // worth nothing.
    customer_code: values.customerCode || null,
    customer_name: values.customerName || null,
    sales_order_no: values.salesOrderNo || null,
    order_value: values.orderValue ?? null,
    sales_rep: values.salesRep || null,
    ordered_on: values.orderedOn || null,
    due_date: values.dueDate || null,
    expected_start: values.expectedStart || null,
    expected_finish: values.expectedFinish || null,
  } satisfies ProductPatch;
}

/** A stored row → what the edit form opens on. Null becomes "", not "null". */
export function toProductValues(product: Product): ProductValues {
  return {
    batchNo: product.batch_no,
    code: product.code ?? "",
    name: product.name,
    workOrder: product.work_order ?? "",
    requiredQty: Number(product.required_qty),
    plannedFor: product.planned_for ?? "",
    customerCode: product.customer_code ?? "",
    customerName: product.customer_name ?? "",
    salesOrderNo: product.sales_order_no ?? "",
    salesRep: product.sales_rep ?? "",
    orderValue:
      product.order_value === null ? undefined : Number(product.order_value),
    orderedOn: product.ordered_on ?? "",
    dueDate: product.due_date ?? "",
    expectedStart: product.expected_start ?? "",
    expectedFinish: product.expected_finish ?? "",
  };
}

export async function fetchProducts(factoryId: string): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_products")
    .select(COLUMNS)
    .eq("factory_id", factoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Product[];
}

/* ── Customer orders: the catalogue, filtered and paged on the server ──────
   The table used to load every batch and filter in the browser. Open vs
   Finished is not something a page of rows can answer, so the database derives
   it (`factory_products_expanded`, 0047) and the table asks for one page of one
   half at a time. */

/** Which half of the catalogue — see `is_finished` in the view. */
export type ProductScope = "open" | "finished";

export const DEFAULT_PRODUCT_PAGE_SIZE = 50;

export interface ProductListParams {
  scope: ProductScope;
  /** Free text; blank is no filter. */
  search: string;
  /** Zero-based, like `.range()`. */
  page: number;
  pageSize: number;
}

/** A catalogue row plus what the board says about it — derived, never stored. */
export interface ProductRow extends Product {
  status: ProductStatus;
  is_finished: boolean;
}

export interface ProductPage {
  rows: ProductRow[];
  /** Total in this scope matching the search — drives the pager. */
  total: number;
  /**
   * The page these rows are, zero-based. Usually the one asked for; fewer if
   * that page no longer exists — the last row of the last page was deleted, or
   * a search narrowed the list under it — and then the last page there is.
   */
  page: number;
}

const ROW_COLUMNS = `${COLUMNS}, status, is_finished`;

/** The columns free-text search looks through — the same ones it always did. */
const SEARCH_COLUMNS = [
  "batch_no",
  "code",
  "name",
  "work_order",
  "customer_code",
  "customer_name",
  "sales_order_no",
  "status_label",
];

/**
 * PostgREST's `or=(…)` is a comma/parenthesis-delimited grammar, so those
 * characters come out of the term or the filter stops parsing. `%` and `_` stay:
 * they reach `ilike` as wildcards and only ever widen a match.
 */
function sanitizeSearch(term: string): string {
  return term
    .trim()
    .replace(/[,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchProductPage(
  factoryId: string,
  params: ProductListParams,
): Promise<ProductPage> {
  const { scope, search, page, pageSize } = params;
  const supabase = createClient();
  const start = page * pageSize;

  let query = supabase
    .from("factory_products_expanded")
    .select(ROW_COLUMNS, { count: "exact" })
    .eq("factory_id", factoryId)
    .eq("is_finished", scope === "finished");

  const term = sanitizeSearch(search);
  if (term) {
    query = query.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.%${term}%`).join(","));
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    // Two batches added in one import share a timestamp; without a stable
    // tiebreaker the same row can land on two pages and another on none.
    .order("id", { ascending: false })
    .range(start, start + pageSize - 1);

  if (error) throw new Error(error.message);
  const total = count ?? 0;
  // Asked for a page that is no longer there: give the last one instead of an
  // empty table with a pager that says there are rows.
  if ((data ?? []).length === 0 && total > 0 && page > 0) {
    return fetchProductPage(factoryId, {
      ...params,
      page: Math.ceil(total / pageSize) - 1,
    });
  }
  return { rows: (data ?? []) as unknown as ProductRow[], total, page };
}

/** The two pills' counts — the whole catalogue, whatever is typed in search. */
export async function fetchProductCounts(
  factoryId: string,
): Promise<Record<ProductScope, number>> {
  const supabase = createClient();
  const count = async (finished: boolean) => {
    const { count, error } = await supabase
      .from("factory_products_expanded")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", factoryId)
      .eq("is_finished", finished);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [open, finished] = await Promise.all([count(false), count(true)]);
  return { open, finished };
}

/**
 * Customer code → name, newest spelling first, for the forms to fill a name in
 * from a code the catalogue has already seen. Two narrow columns rather than
 * the whole table, since the table itself is no longer in memory.
 */
export async function fetchCustomerNames(
  factoryId: string,
): Promise<{ customer_code: string; customer_name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_products")
    .select("customer_code, customer_name")
    .eq("factory_id", factoryId)
    .not("customer_code", "is", null)
    .not("customer_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as { customer_code: string; customer_name: string }[];
}

/**
 * Every batch number on file, for the bulk import to name the ones it will
 * skip. Read a thousand at a time — that is where PostgREST stops, and a list
 * that quietly stopped there would let a re-pasted sheet through as "new".
 */
export async function fetchBatchNos(factoryId: string): Promise<string[]> {
  const supabase = createClient();
  const out: string[] = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await supabase
      .from("factory_products")
      .select("batch_no")
      .eq("factory_id", factoryId)
      .order("id")
      .range(from, from + step - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r: { batch_no: string }) => r.batch_no));
    if ((data ?? []).length < step) break;
  }
  return out;
}

export async function createProduct(
  factoryId: string,
  values: ProductValues,
): Promise<Product> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("factory_products")
    .insert({
      factory_id: factoryId,
      batch_no: values.batchNo,
      ...toProductRow(values),
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(toMessage(error, values.batchNo));
  return data as Product;
}

/** What became of one row of a bulk import. */
export interface ProductImportResult {
  batchNo: string;
  ok: boolean;
  error?: string;
}

/** Rows per insert. Big enough to be one round-trip for a normal paste. */
const IMPORT_CHUNK = 50;

/**
 * Bulk-inserts catalogue rows, reporting the outcome of every one.
 *
 * Chunked rather than one statement so a 300-row paste doesn't ride on a
 * single request, and **not** an upsert: silently overwriting a batch's
 * required quantity because someone re-pasted last month's sheet is the kind
 * of quiet data loss this catalogue can't afford. Existing batches are
 * identified in the review step instead (`splitExisting`) and skipped.
 *
 * A chunk that fails is retried row by row. Postgres rejects the whole
 * statement on one bad row and the error names no batch, so without the
 * retry a single late duplicate would report 50 failures and leave the
 * operator to work out which one it was.
 */
export async function createProducts(
  factoryId: string,
  rows: ProductValues[],
): Promise<ProductImportResult[]> {
  const supabase = createClient();
  const results: ProductImportResult[] = [];

  const toRow = (values: ProductValues) => ({
    factory_id: factoryId,
    batch_no: values.batchNo,
    ...toProductRow(values),
  });

  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    const batch = rows.slice(i, i + IMPORT_CHUNK);
    const { error } = await supabase
      .from("factory_products")
      .insert(batch.map(toRow));

    if (!error) {
      results.push(...batch.map((r) => ({ batchNo: r.batchNo, ok: true })));
      continue;
    }

    for (const row of batch) {
      const { error: rowError } = await supabase
        .from("factory_products")
        .insert(toRow(row));
      results.push({
        batchNo: row.batchNo,
        ok: !rowError,
        error: rowError ? toMessage(rowError, row.batchNo) : undefined,
      });
    }
  }

  return results;
}

/**
 * Row-level edits — the table's inline quantity, date and Active toggle, and
 * the detail dialog's whole-row edit.
 *
 * `planned_for` is in here like any other column, but the database has the
 * final say on it: `factory_products_planned_for_guard` (migration 0018)
 * refuses a date in the past, and refuses any change at all once the batch has
 * a pipeline job. Both come back as readable messages naming the batch, so
 * they are passed through rather than restated here.
 */
export async function updateProduct(
  id: string,
  patch: ProductPatch,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_products")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(toMessage(error, patch.batch_no ?? undefined));
}

export async function deleteProduct(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("factory_products")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
