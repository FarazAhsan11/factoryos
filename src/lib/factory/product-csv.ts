import {
  productSchema,
  type ProductValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  detectDelimiter,
  indexOfHeader,
  numberedLines,
  parseIsoDate,
  parseQuantity,
  splitLine,
  type CsvRowError,
} from "@/lib/factory/csv";
import { todayKey } from "@/lib/factory/dates";

/**
 * Parsing for the product bulk import. Plain module (no React, no Supabase)
 * so the dialog stays presentational and this stays testable.
 *
 * The same parser serves both tabs of the import dialog: a pasted spreadsheet
 * selection and an uploaded .csv are the same text once the clipboard has been
 * read, and `splitLine` treats tab, comma and semicolon alike. Two parsers
 * would only be two sets of rules to keep in step.
 */

export interface ParsedProductCsv {
  rows: ProductValues[];
  errors: CsvRowError[];
}

/**
 * Written in the order the Add product form asks for them, so the template
 * and the screen teach the same shape. Real-looking rows, not `foo`/`bar`:
 * the point of an example is to show what a batch number and a quantity
 * actually look like here.
 */
export const PRODUCT_CSV_HEADERS =
  "batch,code,product name,work order,required qty,planned for";

/**
 * The template's dates are written relative to when it is downloaded, not
 * baked in. A fixed example date is in the past by the time anyone opens the
 * file, and pasting a past date back in is the one thing the column refuses —
 * so a hard-coded sample would teach the format by demonstrating the error.
 */
export function productCsvTemplate(now: Date = new Date()): string {
  const inDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  };
  return (
    `${PRODUCT_CSV_HEADERS}\n` +
    `46004,PC2934,JSHealth Vaginal Probiotic Capsules,46004,540000,${inDays(1)}\n` +
    `45972,PC1868,Quercesorb Capsules,45972,540000,${inDays(4)}\n` +
    `45721,PC1870,TriMagnesium Citrate 900mg Capsules,45721,1875000,\n`
  );
}

const BATCH_HEADERS = [
  "batch",
  "batch no",
  "batch no.",
  "batch number",
  "batch_no",
  "batch / w.o.",
  "batch/w.o.",
  "lot",
];
const CODE_HEADERS = ["code", "product code", "item code", "sku"];
const NAME_HEADERS = ["name", "product", "product name", "description", "item"];
const WORK_ORDER_HEADERS = [
  "work order",
  "work_order",
  "workorder",
  "wo",
  "w.o.",
  "order",
];
const QTY_HEADERS = [
  "required qty",
  "required quantity",
  "required_qty",
  "required",
  "qty",
  "quantity",
  "target",
  "target qty",
];
const PLANNED_HEADERS = [
  "planned for",
  "planned_for",
  "planned",
  "plan for",
  "planned date",
  "plan date",
  "start date",
  "scheduled",
  "scheduled for",
  "schedule",
  "date",
];

/**
 * Parses pasted or uploaded text into validated rows plus a per-line error
 * list. A header row is used when present; otherwise columns are read
 * positionally as batch, code, name, work order, required qty.
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
  if (lines.length === 0) return { rows: [], errors: [] };

  // Decided once from the header line and used for every row, so a pasted
  // `540,000` stays one cell instead of becoming 540.
  const delimiter = detectDelimiter(lines[0].raw);
  const firstCells = splitLine(lines[0].raw, delimiter);
  const hasHeader =
    indexOfHeader(firstCells, BATCH_HEADERS) !== -1 ||
    indexOfHeader(firstCells, NAME_HEADERS) !== -1;

  /**
   * A headerless file is read positionally, which is only safe when it has
   * exactly the columns that order describes. A narrower one shifts every
   * value left and imports rows that look fine and aren't: a three-column file
   * put the product name into `code`, the quantity into `name`, and left
   * `required_qty` at 0 — every field it landed in happened to accept a
   * string, so nothing failed and nothing warned.
   *
   * Refused outright rather than guessed at. Which three columns someone meant
   * is not recoverable from the data, and a header row says it exactly.
   *
   * Five is still accepted alongside six: the planned date was added after
   * this importer shipped, and a sheet written to the old shape is a complete
   * catalogue with nothing scheduled — which is exactly what a blank date
   * means anyway.
   */
  if (!hasHeader && firstCells.length !== 5 && firstCells.length !== 6) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          value: "",
          message:
            firstCells.length === 1
              ? `Columns couldn't be found — the file needs commas between values, and a header row (${PRODUCT_CSV_HEADERS.replace(/,/g, ", ")}).`
              : `Found ${firstCells.length} columns and no header row. Add a header (${PRODUCT_CSV_HEADERS.replace(/,/g, ", ")}) so each column can be identified.`,
        },
      ],
    };
  }

  const columns = hasHeader
    ? {
        batch: indexOfHeader(firstCells, BATCH_HEADERS),
        code: indexOfHeader(firstCells, CODE_HEADERS),
        name: indexOfHeader(firstCells, NAME_HEADERS),
        workOrder: indexOfHeader(firstCells, WORK_ORDER_HEADERS),
        qty: indexOfHeader(firstCells, QTY_HEADERS),
        planned: indexOfHeader(firstCells, PLANNED_HEADERS),
      }
    : {
        batch: 0,
        code: 1,
        name: 2,
        workOrder: 3,
        qty: 4,
        // -1 for a five-column file, which `pick` reads as absent.
        planned: firstCells.length === 6 ? 5 : -1,
      };

  const body = hasHeader ? lines.slice(1) : lines;
  const rows: ProductValues[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();

  for (const { line, raw } of body) {
    const cells = splitLine(raw, delimiter);
    const pick = (index: number) => (index >= 0 ? (cells[index] ?? "") : "");

    const batchNo = pick(columns.batch);
    const name = pick(columns.name);
    const qtyCell = pick(columns.qty);
    const label = batchNo || name || raw.slice(0, 40);

    const requiredQty = parseQuantity(qtyCell);
    if (requiredQty === null) {
      errors.push({
        line,
        value: label,
        message: `"${qtyCell}" isn't a quantity.`,
      });
      continue;
    }

    // Reported as its own error rather than left to the schema, because the
    // fix is a specific one: it is almost always a spreadsheet writing
    // 14/08/2026, and the message has to say which format to save in.
    const plannedCell = pick(columns.planned);
    const plannedFor = parseIsoDate(plannedCell);
    if (plannedFor === null) {
      errors.push({
        line,
        value: label,
        message: `"${plannedCell}" isn't a date. Write planned dates as YYYY-MM-DD (e.g. ${todayKey()}).`,
      });
      continue;
    }

    const parsed = productSchema.safeParse({
      batchNo,
      code: pick(columns.code),
      name,
      // The catalogue falls back to the batch number when a factory doesn't
      // track work orders separately — same rule as `createProduct`.
      workOrder: pick(columns.workOrder) || batchNo,
      requiredQty,
      plannedFor,
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

  return { rows, errors };
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
