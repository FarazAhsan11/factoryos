import {
  ASSIGNABLE_ROLES,
  employeeRowSchema,
  type AssignableRole,
  type EmployeeRow,
} from "@/app/factory/[slug]/admin/schemas";

/**
 * CSV parsing for the employee bulk import. Kept in a plain module (no React,
 * no Supabase) so the dialog stays presentational and this stays testable.
 */

export interface CsvRowError {
  /** 1-based line number in the file, so the message points somewhere real. */
  line: number;
  value: string;
  message: string;
}

export interface ParsedCsv {
  rows: EmployeeRow[];
  errors: CsvRowError[];
}

export const CSV_TEMPLATE = "name,email,role\nThian Mang,thian@example.com,operator\nAisha Khan,aisha@example.com,admin\n";

/** Minimal RFC-4180 split: handles quoted fields and escaped ("") quotes. */
function splitLine(line: string): string[] {
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
    } else if (char === "," || char === ";") {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const NAME_HEADERS = ["name", "full name", "fullname", "full_name", "employee"];
const EMAIL_HEADERS = ["email", "e-mail", "email address"];
const ROLE_HEADERS = ["role", "access", "permission"];

function indexOfHeader(cells: string[], candidates: string[]) {
  return cells.findIndex((c) => candidates.includes(c.toLowerCase()));
}

function normalizeRole(value: string): AssignableRole | null {
  const v = value.trim().toLowerCase();
  if (!v) return "operator"; // blank role column → the safe default
  const match = ASSIGNABLE_ROLES.find((r) => r === v);
  return match ?? null;
}

/**
 * Parses a CSV into validated rows plus a per-line error list. A header row is
 * used when present; otherwise columns are read as name, email, role. Rows that
 * fail validation are reported rather than silently dropped, and duplicate
 * emails within the file are collapsed to the first occurrence.
 */
export function parseEmployeeCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l, i) => ({ line: i + 1, raw: l }))
    .filter(({ raw }) => raw.trim().length > 0);

  if (lines.length === 0) return { rows: [], errors: [] };

  const firstCells = splitLine(lines[0].raw);
  const hasHeader =
    indexOfHeader(firstCells, EMAIL_HEADERS) !== -1 ||
    indexOfHeader(firstCells, NAME_HEADERS) !== -1;

  const columns = hasHeader
    ? {
        name: indexOfHeader(firstCells, NAME_HEADERS),
        email: indexOfHeader(firstCells, EMAIL_HEADERS),
        role: indexOfHeader(firstCells, ROLE_HEADERS),
      }
    : { name: 0, email: 1, role: 2 };

  const body = hasHeader ? lines.slice(1) : lines;
  const rows: EmployeeRow[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();

  for (const { line, raw } of body) {
    const cells = splitLine(raw);
    const pick = (index: number) => (index >= 0 ? cells[index] ?? "" : "");

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

    const parsed = employeeRowSchema.safeParse({ fullName: name, email, role });
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
  const batches: EmployeeRow[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}
