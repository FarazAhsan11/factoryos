import {
  SHIFT_SLOTS,
  workerSchema,
  type ShiftSlot,
  type WorkerValues,
} from "@/app/factory/[slug]/admin/schemas";
import {
  detectDelimiter,
  indexOfHeader,
  numberedLines,
  splitLine,
  type CsvRowError,
} from "@/lib/factory/csv";

/**
 * Parsing for Workforce → Bulk add. Reads either a CSV file or rows pasted
 * straight out of a spreadsheet (tab-separated) — `detectDelimiter` tells the
 * two apart — into validated workers. Plain module, like `employee-csv.ts`, so
 * the dialog stays presentational.
 *
 * Paste is accepted here although the product importer dropped it, because
 * the failure that sank it there can't pass quietly here: a selection one
 * column short puts a role in the shift column or a shift in the department
 * column, and both are checked against a closed list — so a shifted paste is
 * a page of errors, not a page of plausible wrong rows.
 */

export type { CsvRowError };

export interface ParsedWorkers {
  rows: WorkerValues[];
  errors: CsvRowError[];
}

/** What a row gets for a column it leaves blank — or doesn't have at all. */
export interface WorkerDefaults {
  departmentId: string;
  shift: ShiftSlot;
  role: string;
}

export const WORKER_CSV_TEMPLATE =
  "name,department,shift,role\n" +
  "Thian Mang,Production,morning,Operator\n" +
  "Aisha Khan,Packing,afternoon,Team leader\n" +
  "Ravi Kumar,Engineering,rotating,Fitter\n";

const NAME_HEADERS = ["name", "full name", "fullname", "full_name", "employee", "worker"];
const DEPARTMENT_HEADERS = ["department", "dept", "section"];
const SHIFT_HEADERS = ["shift", "default shift", "default_shift"];
const ROLE_HEADERS = ["role", "position", "designation", "job", "job title"];

/** The employee importer's forgiveness: "rotating" / "both", "am" / "pm". */
function normalizeShift(value: string, blank: ShiftSlot): ShiftSlot | null {
  const v = value.trim().toLowerCase();
  if (!v) return blank;
  if (v === "rotating" || v === "rotate") return "both";
  if (v === "am") return "morning";
  if (v === "pm" || v === "evening" || v === "night") return "afternoon";
  return SHIFT_SLOTS.find((s) => s === v) ?? null;
}

/**
 * Parses the input into workers plus a per-line error list.
 *
 * A header row is used when present; otherwise the columns are read as name,
 * department, shift, role — and a single column is just names, which is what a
 * paste of one spreadsheet column gives. A blank or missing cell takes the
 * dialog's `defaults`, so thirty names pasted from the packing team can all be
 * put on Packing, afternoon, in one go.
 *
 * A department is matched by name against `departments` (case-insensitively);
 * one the plant doesn't have is an error rather than a blank, so nobody is
 * filed half-assigned without noticing. `existing` is the names already on the
 * register: those rows are reported and skipped, as is a repeat of an earlier
 * row in the same input.
 */
export function parseWorkers(
  text: string,
  {
    departments,
    existing,
    defaults,
  }: {
    departments: { id: string; name: string }[];
    existing: string[];
    defaults: WorkerDefaults;
  },
): ParsedWorkers {
  const lines = numberedLines(text);
  if (lines.length === 0) return { rows: [], errors: [] };

  const delimiter = detectDelimiter(lines[0].raw);
  const firstCells = splitLine(lines[0].raw, delimiter);
  const hasHeader = indexOfHeader(firstCells, NAME_HEADERS) !== -1;

  const columns = hasHeader
    ? {
        name: indexOfHeader(firstCells, NAME_HEADERS),
        department: indexOfHeader(firstCells, DEPARTMENT_HEADERS),
        shift: indexOfHeader(firstCells, SHIFT_HEADERS),
        role: indexOfHeader(firstCells, ROLE_HEADERS),
      }
    : { name: 0, department: 1, shift: 2, role: 3 };

  const byName = new Map(
    departments.map((d) => [d.name.trim().toLowerCase(), d.id]),
  );
  const seen = new Set(existing.map((n) => n.trim().toLowerCase()));
  const onRegister = new Set(seen);

  const rows: WorkerValues[] = [];
  const errors: CsvRowError[] = [];

  for (const { line, raw } of hasHeader ? lines.slice(1) : lines) {
    const cells = splitLine(raw, delimiter);
    const pick = (index: number) => (index >= 0 ? (cells[index] ?? "") : "");

    const name = pick(columns.name);
    const label = name || raw.slice(0, 40);

    const departmentCell = pick(columns.department);
    const departmentId = departmentCell
      ? byName.get(departmentCell.trim().toLowerCase())
      : defaults.departmentId;
    if (departmentId === undefined) {
      errors.push({
        line,
        value: label,
        message: `No department called "${departmentCell}" — add it in Configuration → Departments, or leave the column blank.`,
      });
      continue;
    }

    const shiftCell = pick(columns.shift);
    const shift = normalizeShift(shiftCell, defaults.shift);
    if (!shift) {
      errors.push({
        line,
        value: label,
        message: `"${shiftCell}" isn't a shift — use morning, afternoon or rotating.`,
      });
      continue;
    }

    const parsed = workerSchema.safeParse({
      fullName: name,
      departmentId,
      shift,
      role: pick(columns.role) || defaults.role || "Operator",
    });
    if (!parsed.success) {
      errors.push({
        line,
        value: label,
        message: parsed.error.issues[0]?.message ?? "Invalid row.",
      });
      continue;
    }

    const key = parsed.data.fullName.toLowerCase();
    if (seen.has(key)) {
      errors.push({
        line,
        value: parsed.data.fullName,
        message: onRegister.has(key)
          ? "Already on the workforce."
          : "Duplicate of an earlier row.",
      });
      continue;
    }

    seen.add(key);
    rows.push(parsed.data);
  }

  return { rows, errors };
}
