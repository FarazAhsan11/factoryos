import {
  productSchema,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  detectDelimiter,
  numberedLines,
  parseDateCell,
  parseQuantity,
  resolveHeaders,
  splitLine,
  type CsvRowError,
} from "@/lib/factory/csv";
import { todayKey } from "@/lib/factory/dates";

/**
 * Parsing for the product bulk import. Plain module (no React, no Supabase)
 * so the dialog stays presentational and this stays testable.
 */

/** A column the importer recognised, and the header it was found under. */
export interface ReadColumn {
  label: string;
  header: string;
}

export interface ParsedProductCsv {
  rows: ProductValues[];
  errors: CsvRowError[];
  /** What each recognised column is being read as. */
  read: ReadColumn[];
  /**
   * Header cells that matched no field. Shown in the review, because a
   * column the importer didn't recognise is otherwise blank on every row it
   * imports — and nobody finds out until they open one.
   */
  ignored: string[];
}

/**
 * Written in the order the Add product form asks for them, so the template
 * and the screen teach the same shape. Real-looking rows, not `foo`/`bar`:
 * the point of an example is to show what a batch number and a quantity
 * actually look like here.
 */
export const PRODUCT_CSV_HEADERS =
  "batch,work order,product code,required qty,product name," +
  "customer code,customer name,so order no,order value,sales rep," +
  "order received,exp start,finish,due date,planned for";

/**
 * The template's dates are written relative to when it is downloaded, not
 * baked in. A fixed example date is in the past by the time anyone opens the
 * file, and pasting a past planned date back in is the one thing the column
 * refuses — so a hard-coded sample would teach the format by demonstrating
 * the error.
 */
export function productCsvTemplate(now: Date = new Date()): string {
  const inDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  };
  return (
    `${PRODUCT_CSV_HEADERS}\n` +
    `46004,46004,PC2934,540000,JSHealth Vaginal Probiotic Capsules,NHP310,Northside Health Products,56006,124695,Alex Morgan,${inDays(-21)},${inDays(7)},${inDays(35)},${inDays(45)},${inDays(7)}\n` +
    `45972,45972,PC1868,540000,Quercesorb Capsules,VIT118,Vitality Labs Pty Ltd,60215,22500,Sam Patel,${inDays(-10)},${inDays(14)},${inDays(40)},${inDays(60)},\n` +
    `45721,45721,PC1870,1875000,TriMagnesium Citrate 900mg Capsules,VIT118,Vitality Labs Pty Ltd,60215,,Sam Patel,${inDays(-10)},,,${inDays(60)},\n`
  );
}

/**
 * The header each field is read from, most specific first. Matched after
 * `normalizeHeader`, so punctuation and case don't count: "Batch /Work order"
 * is "batch work order", "Exp. Start" is "exp start".
 *
 * **Order matters** — `resolveHeaders` gives each column to the first field
 * that claims it. The name is resolved before the code and prefers a
 * description, so on a sheet with both "Product" (PC2657.60) and "Item
 * Description" the codes land in `code`; on an older sheet with only
 * "Product", that column is still the name.
 *
 * "start date" reads as the expected start rather than the planned date: a
 * planned date puts cards on the board and refuses the past, and a column
 * merely *called* a start date is far more often an estimate.
 */
const FIELDS = {
  batch: [
    "batch",
    "batch no",
    "batch number",
    "batch work order",
    "batch wo",
    "batch w o",
    "lot",
    "lot no",
  ],
  name: [
    "product name",
    "item description",
    "description",
    "name",
    "item name",
    "item",
    "product",
  ],
  code: ["product code", "item code", "code", "sku", "product"],
  workOrder: ["work order", "workorder", "wo", "w o", "order"],
  qty: [
    "required qty",
    "required quantity",
    "ordered qty",
    "ordered quantity",
    "order qty",
    "order quantity",
    "qty ordered",
    "required",
    "qty",
    "quantity",
    "target",
    "target qty",
  ],
  customerCode: [
    "customer code",
    "cust code",
    "customer no",
    "customer number",
    "customer id",
    "account code",
  ],
  customerName: ["customer name", "customer", "cust name", "client name", "client"],
  salesOrderNo: [
    "so order no",
    "so order number",
    "so no",
    "so number",
    "so",
    "sales order",
    "sales order no",
    "sales order number",
  ],
  orderValue: ["order value", "value", "order total", "sales value", "order amount", "amount"],
  salesRep: [
    "rep sales manager",
    "sales rep",
    "rep",
    "sales manager",
    "salesperson",
    "sales person",
    "account manager",
  ],
  orderedOn: [
    "order received",
    "ordered received",
    "order received date",
    "ordered received date",
    "ordered rec",
    "ordered rec date",
    "ordered req",
    "ordered req date",
    "order date",
    "ordered date",
    "date ordered",
    "ordered on",
  ],
  expectedStart: [
    "exp start",
    "expected start",
    "exp start date",
    "expected start date",
    "est start",
    "estimated start",
    "start date",
    "start",
  ],
  expectedFinish: [
    "finish",
    "exp finish",
    "expected finish",
    "finish date",
    "exp finish date",
    "expected finish date",
    "est finish",
    "end date",
  ],
  dueDate: ["due date", "due", "delivery date", "required by"],
  planned: [
    "planned for",
    "planned",
    "plan for",
    "planned date",
    "plan date",
    "scheduled",
    "scheduled for",
    "schedule",
    "date",
  ],
} as const;

type Field = keyof typeof FIELDS;

/** How each field is named back to the person reviewing the import. */
const LABELS: Record<Field, string> = {
  batch: "Batch",
  name: "Product name",
  code: "Product code",
  workOrder: "Work order",
  qty: "Required qty",
  customerCode: "Customer code",
  customerName: "Customer name",
  salesOrderNo: "SO order no",
  orderValue: "Order value",
  salesRep: "Rep",
  orderedOn: "Order received",
  expectedStart: "Exp. start",
  expectedFinish: "Finish",
  dueDate: "Due date",
  planned: "Planned for",
};

/** The date columns, each reported by name when its cell can't be read. */
const DATE_FIELDS = [
  ["plannedFor", "planned"],
  ["orderedOn", "orderedOn"],
  ["expectedStart", "expectedStart"],
  ["expectedFinish", "expectedFinish"],
  ["dueDate", "dueDate"],
] as const;

/** "$124,695.00" → 124695; "" → undefined (not recorded); junk → null. */
function parseMoney(cell: string): number | undefined | null {
  const cleaned = cell.replace(/[$€£¥]/g, "").trim();
  if (!cleaned) return undefined;
  return parseQuantity(cleaned);
}

/**
 * Parses uploaded text into validated rows plus a per-line error list. A
 * header row is used when present; otherwise columns are read positionally as
 * batch, code, name, work order, required qty (and planned for).
 *
 * Rows that fail are **reported, never silently dropped** — a bulk import that
 * quietly loses three of two hundred batches is worse than one that refuses
 * them out loud, because the gap only surfaces weeks later when a shift entry
 * can't find its batch.
 *
 * Duplicate batch numbers within the input collapse to the first occurrence;
 * `batch_no` is unique per tenant (case-insensitively, migration 0008), so
 * sending both would just be one guaranteed insert failure.
 */
export function parseProductCsv(text: string): ParsedProductCsv {
  const lines = numberedLines(text);
  if (lines.length === 0) return { rows: [], errors: [], read: [], ignored: [] };

  // Decided once from the header line and used for every row, so a pasted
  // `540,000` stays one cell instead of becoming 540.
  const delimiter = detectDelimiter(lines[0].raw);
  const firstCells = splitLine(lines[0].raw, delimiter);
  const found = resolveHeaders(firstCells, FIELDS);
  const hasHeader = found.batch !== -1 || found.name !== -1;

  /**
   * A headerless file is read positionally, which is only safe when it has
   * exactly the columns that order describes. A narrower one shifts every
   * value left and imports rows that look fine and aren't: a three-column file
   * put the product name into `code`, the quantity into `name`, and left
   * `required_qty` at 0 — every field it landed in happened to accept a
   * string, so nothing failed and nothing warned.
   *
   * Refused outright rather than guessed at. Which three columns someone meant
   * is not recoverable from the data, and a header row says it exactly. The
   * customer-order columns are header-only for the same reason: fifteen
   * positional columns is a shape nobody gets right by hand.
   *
   * Five is still accepted alongside six: the planned date was added after
   * this importer shipped, and a sheet written to the old shape is a complete
   * catalogue with nothing scheduled — which is exactly what a blank date
   * means anyway.
   */
  if (!hasHeader && firstCells.length !== 5 && firstCells.length !== 6) {
    return {
      rows: [],
      read: [],
      ignored: [],
      errors: [
        {
          line: 1,
          value: "",
          message:
            firstCells.length === 1
              ? "Columns couldn't be found — the file needs commas between values, and a header row naming at least the batch and the product name. The template shows every column it reads."
              : `Found ${firstCells.length} columns and no header row. Add a header naming each column (at least batch and product name) so each one can be identified — the template shows them all.`,
        },
      ],
    };
  }

  const columns: Record<Field, number> = hasHeader
    ? found
    : {
        ...(Object.fromEntries(
          Object.keys(FIELDS).map((field) => [field, -1]),
        ) as Record<Field, number>),
        batch: 0,
        code: 1,
        name: 2,
        workOrder: 3,
        qty: 4,
        // -1 for a five-column file, which `pick` reads as absent.
        planned: firstCells.length === 6 ? 5 : -1,
      };

  const claimed = new Set(Object.values(columns).filter((i) => i >= 0));
  const read = (Object.keys(columns) as Field[])
    .filter((field) => columns[field] >= 0)
    .sort((a, b) => columns[a] - columns[b])
    .map((field) => ({
      label: LABELS[field],
      header: hasHeader ? firstCells[columns[field]] : `column ${columns[field] + 1}`,
    }));
  const ignored = hasHeader
    ? firstCells.filter((cell, i) => cell.trim() && !claimed.has(i))
    : [];

  const body = hasHeader ? lines.slice(1) : lines;
  const rows: ProductValues[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();

  for (const { line, raw } of body) {
    const cells = splitLine(raw, delimiter);
    const pick = (field: Field) => {
      const index = columns[field];
      return index >= 0 ? (cells[index] ?? "") : "";
    };

    const batchNo = pick("batch");
    const name = pick("name");
    const label = batchNo || name || raw.slice(0, 40);

    const qtyCell = pick("qty");
    const requiredQty = parseQuantity(qtyCell);
    if (requiredQty === null) {
      errors.push({
        line,
        value: label,
        message: `"${qtyCell}" isn't a quantity.`,
      });
      continue;
    }

    const valueCell = pick("orderValue");
    const orderValue = parseMoney(valueCell);
    if (orderValue === null) {
      errors.push({
        line,
        value: label,
        message: `"${valueCell}" isn't an order value.`,
      });
      continue;
    }

    // Reported as their own errors rather than left to the schema, because
    // the fix is a specific one: it is almost always a spreadsheet writing
    // 14/08/2026, and the message has to say which formats will do.
    const dates: Partial<Record<(typeof DATE_FIELDS)[number][0], string>> = {};
    let badDate: string | null = null;
    for (const [key, field] of DATE_FIELDS) {
      const cell = pick(field);
      const parsed = parseDateCell(cell);
      if (parsed === null) {
        badDate = `"${cell}" under ${LABELS[field]} isn't a date. Write dates as YYYY-MM-DD or 30-Sep-26.`;
        break;
      }
      dates[key] = parsed;
    }
    if (badDate) {
      errors.push({ line, value: label, message: badDate });
      continue;
    }

    const parsed = productSchema.safeParse({
      batchNo,
      code: pick("code"),
      name,
      // The catalogue falls back to the batch number when a factory doesn't
      // track work orders separately — same rule as `createProduct`.
      workOrder: pick("workOrder") || batchNo,
      requiredQty,
      customerCode: pick("customerCode"),
      customerName: pick("customerName"),
      salesOrderNo: pick("salesOrderNo"),
      salesRep: pick("salesRep"),
      orderValue,
      ...dates,
    });
    if (!parsed.success) {
      errors.push({
        line,
        value: label,
        message: parsed.error.issues[0]?.message ?? "Invalid row.",
      });
      continue;
    }

    const key = parsed.data.batchNo.toLowerCase();
    if (seen.has(key)) {
      errors.push({
        line,
        value: parsed.data.batchNo,
        message: "Duplicate of an earlier row in this input.",
      });
      continue;
    }

    seen.add(key);
    rows.push(parsed.data);
  }

  return { rows, errors, read, ignored };
}

/**
 * Splits parsed rows into those the catalogue already holds and those it
 * doesn't, matching case-insensitively on batch number the way the unique
 * index does.
 *
 * Checked here rather than left to the insert because the whole catalogue is
 * already loaded in the panel behind the dialog. That turns "23505 duplicate
 * key" — which names no batch and arrives after the fact — into a line in the
 * review step naming exactly which batches are already on file, before
 * anything is written.
 */
export function splitExisting(
  rows: ProductValues[],
  existingBatchNos: string[],
): { fresh: ProductValues[]; duplicates: ProductValues[] } {
  const known = new Set(existingBatchNos.map((b) => b.trim().toLowerCase()));
  const fresh: ProductValues[] = [];
  const duplicates: ProductValues[] = [];
  for (const row of rows) {
    (known.has(row.batchNo.toLowerCase()) ? duplicates : fresh).push(row);
  }
  return { fresh, duplicates };
}
