/**
 * CSV primitives shared by the bulk importers (employees, products).
 *
 * Plain module — no React, no Supabase — so the dialogs stay presentational
 * and the parsing stays testable on its own.
 */

export interface CsvRowError {
  /** 1-based line number in the input, so the message points somewhere real. */
  line: number;
  value: string;
  message: string;
}

export type Delimiter = "," | ";" | "\t";

/** How many unquoted `char`s the line contains. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === char) count += 1;
  }
  return count;
}

/**
 * Which character separates this input's columns, decided **once** from its
 * first line and then used for every row.
 *
 * Not "any of comma, tab or semicolon", which is the obvious shortcut and is
 * wrong: a spreadsheet paste is tab-separated and routinely carries a required
 * quantity written `540,000`. Splitting on comma as well turns that into two
 * cells and files the batch with a target of 540 instead of 540,000 — a
 * plausible-looking number that no later screen can tell is off by a thousand.
 *
 * Tab wins outright when present (nothing else uses it), then whichever of
 * semicolon or comma appears more — European Excel writes `;`.
 */
export function detectDelimiter(firstLine: string): Delimiter {
  if (countOutsideQuotes(firstLine, "\t") > 0) return "\t";
  return countOutsideQuotes(firstLine, ";") > countOutsideQuotes(firstLine, ",")
    ? ";"
    : ",";
}

/** Minimal RFC-4180 split: handles quoted fields and escaped ("") quotes. */
export function splitLine(line: string, delimiter: Delimiter = ","): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Non-blank lines, each carrying its original 1-based line number. */
export function numberedLines(text: string): { line: number; raw: string }[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter(({ raw }) => raw.trim().length > 0);
}

/** Index of the first cell matching any of `candidates`, or -1. */
export function indexOfHeader(cells: string[], candidates: string[]): number {
  return cells.findIndex((c) => candidates.includes(c.trim().toLowerCase()));
}

/**
 * "540,000" → 540000; "1 875 000" → 1875000; "" → 0.
 *
 * Thousands separators are stripped because a required quantity copied out of
 * a spreadsheet almost always carries them, and rejecting the row for it would
 * fail the most ordinary paste there is. Returns null for anything that still
 * isn't a number, so the caller can report the line rather than store a NaN.
 */
export function parseQuantity(value: string): number | null {
  const cleaned = value.trim().replace(/[,\s_]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * "2026-08-14" → "2026-08-14"; "" → ""; anything else → null.
 *
 * Deliberately ISO-only, and this is the one place in the importer where being
 * strict is kinder than being clever. A spreadsheet saved in the UK writes
 * `08/09/2026` for 8 September and one saved in the US writes it for 9 August,
 * and nothing in the cell says which — so a parser that accepted slashes would
 * schedule a batch a month out roughly half the time, with no way for any
 * later screen to tell. Unlike a mangled quantity, the row would look entirely
 * correct.
 *
 * The calendar is checked too, not just the shape: `2026-02-31` matches the
 * pattern and is not a day.
 */
export function parseIsoDate(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;

  const [y, m, d] = cleaned.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const roundTrips =
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d;
  return roundTrips ? cleaned : null;
}

/** Splits validated rows into batches the caller can send one at a time. */
export function chunk<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}
