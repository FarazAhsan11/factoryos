import {
  ASSIGNABLE_ROLES,
  SHIFT_SLOTS,
  employeeRowSchema,
  type AssignableRole,
  type EmployeeRow,
  type ShiftSlot,
} from "@/app/factory/[slug]/admin/schemas";

import {
  chunk,
  detectDelimiter,
  indexOfHeader,
  numberedLines,
  splitLine,
  type CsvRowError,
} from "@/lib/factory/csv";

/**
 * CSV parsing for the employee bulk import. Kept in a plain module (no React,
 * no Supabase) so the dialog stays presentational and this stays testable.
 *
 * The row-splitting, header-matching and chunking live in `csv.ts`, shared
 * with the product importer. Only what "an employee row" means is here.
 */

export type { CsvRowError };

export interface ParsedCsv {
  rows: EmployeeRow[];
  errors: CsvRowError[];
}

export const CSV_TEMPLATE =
  "name,email,role,shift\n" +
  "Thian Mang,thian@example.com,operator,morning\n" +
  "Aisha Khan,aisha@example.com,admin,afternoon\n" +
  "Ravi Kumar,ravi@example.com,operator,both\n";

const NAME_HEADERS = ["name", "full name", "fullname", "full_name", "employee"];
const EMAIL_HEADERS = ["email", "e-mail", "email address"];
const ROLE_HEADERS = ["role", "access", "permission"];
const SHIFT_HEADERS = ["shift", "default shift", "default_shift"];

function normalizeRole(value: string): AssignableRole | null {
  const v = value.trim().toLowerCase();
  if (!v) return "operator"; // blank role column → the safe default
  const match = ASSIGNABLE_ROLES.find((r) => r === v);
  return match ?? null;
}

/** Accepts the prototype's wording too: "rotating" / "both", "am" / "pm". */
function normalizeShift(value: string): ShiftSlot | null {
  const v = value.trim().toLowerCase();
  if (!v) return "morning";
  if (v === "rotating" || v === "rotate") return "both";
  if (v === "am") return "morning";
  if (v === "pm" || v === "evening" || v === "night") return "afternoon";
  return SHIFT_SLOTS.find((s) => s === v) ?? null;
}

/**
 * Parses a CSV into validated rows plus a per-line error list. A header row is
 * used when present; otherwise columns are read as name, email, role. Rows that
 * fail validation are reported rather than silently dropped, and duplicate
 * emails within the file are collapsed to the first occurrence.
 */
export function parseEmployeeCsv(text: string): ParsedCsv {
  const lines = numberedLines(text);
  if (lines.length === 0) return { rows: [], errors: [] };

  const delimiter = detectDelimiter(lines[0].raw);
  const firstCells = splitLine(lines[0].raw, delimiter);
  const hasHeader =
    indexOfHeader(firstCells, EMAIL_HEADERS) !== -1 ||
    indexOfHeader(firstCells, NAME_HEADERS) !== -1;

  const columns = hasHeader
    ? {
        name: indexOfHeader(firstCells, NAME_HEADERS),
        email: indexOfHeader(firstCells, EMAIL_HEADERS),
        role: indexOfHeader(firstCells, ROLE_HEADERS),
        shift: indexOfHeader(firstCells, SHIFT_HEADERS),
      }
    : { name: 0, email: 1, role: 2, shift: 3 };

  const body = hasHeader ? lines.slice(1) : lines;
  const rows: EmployeeRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();

  for (const { line, raw } of body) {
    const cells = splitLine(raw, delimiter);
    const pick = (index: number) => (index >= 0 ? (cells[index] ?? "") : "");

    const name = pick(columns.name);
    const email = pick(columns.email);
    const roleCell = pick(columns.role);
    const label = email || name || raw.slice(0, 40);

    const role = normalizeRole(roleCell);
    if (!role) {
      errors.push({
        line,
        value: label,
        message: `"${roleCell}" isn't a role — use admin or operator.`,
      });
      continue;
    }

    const shiftCell = pick(columns.shift);
    const defaultShift = normalizeShift(shiftCell);
    if (!defaultShift) {
      errors.push({
        line,
        value: label,
        message: `"${shiftCell}" isn't a shift — use morning, afternoon or both.`,
      });
      continue;
    }

    const parsed = employeeRowSchema.safeParse({
      fullName: name,
      email,
      role,
      defaultShift,
    });
    if (!parsed.success) {
      errors.push({
        line,
        value: label,
        message: parsed.error.issues[0]?.message ?? "Invalid row.",
      });
      continue;
    }

    if (seen.has(parsed.data.email)) {
      errors.push({
        line,
        value: parsed.data.email,
        message: "Duplicate of an earlier row in this file.",
      });
      continue;
    }

    seen.add(parsed.data.email);
    rows.push(parsed.data);
  }

  return { rows, errors };
}

/** Splits validated rows into action-sized batches (the schema caps at 25). */
export function chunkRows(rows: EmployeeRow[], size = 10): EmployeeRow[][] {
  return chunk(rows, size);
}
