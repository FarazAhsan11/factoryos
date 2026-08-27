import type { ProductValues } from "@/app/factory/[slug]/admin/schemas";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side data access for Admin → Products. Like the units/processes
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
   * for a batch that is only ever added by hand from New job. Kept after the
   * job is created, as the record of what was scheduled (migration 0018).
   */
  planned_for: string | null;
  active: boolean;
  created_at: string;
}

const COLUMNS =
  "id, batch_no, code, name, work_order, required_qty, planned_for, active, created_at";

export const productKeys = {
  all: (factoryId: string) => ["factory_products", factoryId] as const,
};

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
      code: values.code || null,
      name: values.name,
      // The prototype falls back to the batch number when no separate work
      // order is tracked; keep that so the shift log always has something.
      work_order: values.workOrder?.trim() || values.batchNo,
      required_qty: values.requiredQty,
      // "" from an untouched date input is "not scheduled", not an empty date.
      planned_for: values.plannedFor || null,
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
    code: values.code || null,
    name: values.name,
    work_order: values.workOrder?.trim() || values.batchNo,
    required_qty: values.requiredQty,
    planned_for: values.plannedFor || null,
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
 * Row-level edits from the catalogue table.
 *
 * `planned_for` is in here like any other column, but the database has the
 * final say on it: `factory_products_planned_for_guard` (migration 0018)
 * refuses a date in the past, and refuses any change at all once the batch has
 * a pipeline job. Both come back as readable messages naming the batch, so
 * they are passed through rather than restated here.
 */
export async function updateProduct(
  id: string,
  patch: Partial<
    Pick<
      Product,
      | "batch_no"
      | "code"
      | "name"
      | "work_order"
      | "required_qty"
      | "planned_for"
      | "active"
    >
  >,
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
