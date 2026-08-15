import { createClient } from "@/lib/supabase/client";
import type { RunningShift } from "@/lib/factory/shift-time-queries";

/**
 * Shift log → data table. Reads the `shift_log_entries_expanded` view
 * (migration 0012), which flattens the unit/process/product names onto each
 * row and carries the running `accumulative` total per batch + activity.
 *
 * Filtering, sorting and paging all happen in Postgres. A factory logs
 * thousands of entries a month, so the browser is never handed the whole
 * table — the page fetches one slice, and `fetchLogStats` asks the database
 * to describe the rest.
 *
 * RLS is the trust boundary, same as every other tenant read: the view is
 * `security_invoker`, so it inherits the shift-log policies.
 */

export interface LogTableRow {
  id: string;
  log_date: string;
  shift: RunningShift;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  unit_id: string;
  unit_name: string | null;
  process_id: string;
  process_name: string | null;
  has_machine: boolean | null;
  batch_no: string | null;
  product_name: string | null;
  product_code: string | null;
  /** Null for an activity that produces nothing (Idle, Break, cleaning). */
  target_qty: number | null;
  qty: number | null;
  qty_rejected: number | null;
  accumulative: number | null;
  speed_unit: string | null;
  target_speed: number | null;
  actual_speed: number | null;
  slow_reason: string | null;
  equipment_no: string | null;
  operators: string[];
  /** The array joined with " / " — what search and sort actually run against. */
  operators_text: string | null;
  action_flag: string | null;
  comment: string | null;
  amended_at: string | null;
  amend_note: string | null;
  /** Who filed it — decides whether this viewer may amend it. */
  logged_by: string | null;

  /* Overproduction. All three are computed on read (migration 0023) — the
     stored half is `overrun_note`, the explanation that clears the flag. */
  required_qty: number | null;
  is_overrun: boolean;
  overrun_qty: number | null;
  needs_overrun_note: boolean;
  overrun_note: string | null;
  overrun_cleared_at: string | null;
  /** Who explained it — the point of a manager-only clearance. */
  overrun_cleared_by_name: string | null;
}

const COLUMNS = `
  id, log_date, shift, start_time, end_time, duration_minutes,
  unit_id, unit_name, process_id, process_name, has_machine,
  batch_no, product_name, product_code,
  target_qty, qty, qty_rejected, accumulative,
  speed_unit, target_speed, actual_speed, slow_reason,
  equipment_no, operators, operators_text, action_flag, comment,
  amended_at, amend_note, logged_by,
  required_qty, is_overrun, overrun_qty, needs_overrun_note,
  overrun_note, overrun_cleared_at, overrun_cleared_by_name
`;

/** "All entries" / "Flagged only" / one specific flag. */
export type FlagFilter = "all" | "flagged" | string;

export interface LogTableFilters {
  from: string;
  to: string;
  shift: "all" | RunningShift;
  unitId: string;
  processId: string;
  flag: FlagFilter;
  search: string;
}

/**
 * Columns a header click may sort by. A whitelist, not free text — the value
 * is interpolated into the query, and `.order()` takes a raw column name.
 */
export const SORTABLE = {
  log_date: "log_date",
  shift: "shift",
  start_time: "start_time",
  unit_name: "unit_name",
  process_name: "process_name",
  batch_no: "batch_no",
  product_name: "product_name",
  product_code: "product_code",
  duration_minutes: "duration_minutes",
  qty: "qty",
  target_qty: "target_qty",
  qty_rejected: "qty_rejected",
  accumulative: "accumulative",
  target_speed: "target_speed",
  actual_speed: "actual_speed",
  slow_reason: "slow_reason",
  equipment_no: "equipment_no",
  // The flattened text, not the array: ordering by a text[] compares element
  // by element, which reads as arbitrary once two entries share a first name.
  operators_text: "operators_text",
  action_flag: "action_flag",
  comment: "comment",
} as const;

export type SortColumn = keyof typeof SORTABLE;
export type SortDirection = "asc" | "desc";

export interface LogTableSort {
  column: SortColumn;
  direction: SortDirection;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Hard ceiling on a CSV export, so one click can't pull a year of entries. */
export const EXPORT_LIMIT = 5000;

export const logTableKeys = {
  /** Prefix for everything this module caches, for a blanket invalidate. */
  all: (factoryId: string) => ["shift_log_table", factoryId] as const,
  page: (
    factoryId: string,
    filters: LogTableFilters,
    sort: LogTableSort,
    page: number,
    pageSize: number
  ) =>
    [
      "shift_log_table",
      factoryId,
      "page",
      filters,
      sort,
      page,
      pageSize,
    ] as const,
  stats: (factoryId: string, filters: LogTableFilters) =>
    ["shift_log_table", factoryId, "stats", filters] as const,
};

/** The columns free-text search looks through, in the order a user expects. */
const SEARCH_COLUMNS = [
  "batch_no",
  "product_name",
  "product_code",
  "unit_name",
  "process_name",
  // `ilike` has nothing to say about a text[], so search reads the flattened
  // column the view derives from it.
  "operators_text",
  "comment",
  "equipment_no",
  "slow_reason",
  "action_flag",
];

/**
 * PostgREST's `or=(…)` is a comma/parenthesis-delimited grammar, so those
 * characters have to come out of the term or the filter stops parsing.
 *
 * `%` and `_` are deliberately left in: they reach `ilike` as wildcards and
 * only ever widen the match. The stats RPC interpolates the same term into
 * the same `ilike`, so both sides agree on what a search means — which is the
 * property that matters, since the stats bar describes the rows the table
 * paged through.
 */
function sanitizeSearch(term: string): string {
  return term.trim().replace(/[,()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The slice of PostgREST's builder this module chains. Described structurally
 * because the project has no generated `Database` types, so the real builder
 * generics carry no useful information here.
 */
interface FilterBuilder {
  eq(column: string, value: string): FilterBuilder;
  gte(column: string, value: string): FilterBuilder;
  lte(column: string, value: string): FilterBuilder;
  not(column: string, operator: string, value: null): FilterBuilder;
  or(filters: string): FilterBuilder;
  order(
    column: string,
    options: { ascending: boolean; nullsFirst?: boolean }
  ): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  limit(count: number): FilterBuilder;
}

/** Applies every filter to a query builder. Shared by the page and the export. */
function applyFilters(
  query: FilterBuilder,
  factoryId: string,
  f: LogTableFilters
): FilterBuilder {
  let q = query.eq("factory_id", factoryId);

  if (f.from) q = q.gte("log_date", f.from);
  if (f.to) q = q.lte("log_date", f.to);
  if (f.shift !== "all") q = q.eq("shift", f.shift);
  if (f.unitId !== "all") q = q.eq("unit_id", f.unitId);
  if (f.processId !== "all") q = q.eq("process_id", f.processId);

  if (f.flag === "flagged") q = q.not("action_flag", "is", null);
  else if (f.flag !== "all") q = q.eq("action_flag", f.flag);

  const term = sanitizeSearch(f.search);
  if (term) {
    q = q.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.%${term}%`).join(","));
  }

  return q;
}

/** Result shape of an awaited PostgREST query, with the count we ask for. */
interface QueryResult {
  data: LogTableRow[] | null;
  error: { message: string } | null;
  count: number | null;
}

export interface LogTablePage {
  rows: LogTableRow[];
  /** Total matching the filters, not the page — drives the pager. */
  total: number;
}

export async function fetchLogTablePage(
  factoryId: string,
  filters: LogTableFilters,
  sort: LogTableSort,
  page: number,
  pageSize: number
): Promise<LogTablePage> {
  const supabase = createClient();
  const start = page * pageSize;

  const filtered = applyFilters(
    supabase
      .from("shift_log_entries_expanded")
      .select(COLUMNS, { count: "exact" }) as unknown as FilterBuilder,
    factoryId,
    filters
  );

  const query = filtered
    .order(SORTABLE[sort.column], {
      ascending: sort.direction === "asc",
      nullsFirst: false,
    })
    // Two entries can share a date and a start time; without a stable
    // tiebreaker the same row can appear on two pages and another on none.
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1);

  const { data, error, count } = (await query) as unknown as QueryResult;

  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0 };
}

export interface LogTableStats {
  entryCount: number;
  totalQty: number;
  /**
   * Summed over the entries that *have* a target — `sum` skips nulls, and a
   * null target means none applies (an RPM-rated machine, a manual stage),
   * not a target of zero. Against `totalQty` it reads as plan attainment.
   */
  totalTargetQty: number;
  totalRejected: number;
  totalMinutes: number;
  /** Good units as a share of produced units; null when nothing was produced. */
  qualityRate: number | null;
}

export async function fetchLogTableStats(
  factoryId: string,
  filters: LogTableFilters
): Promise<LogTableStats> {
  const supabase = createClient();
  const term = sanitizeSearch(filters.search);

  const { data, error } = await supabase
    .rpc("shift_log_stats", {
      p_factory_id: factoryId,
      p_from: filters.from || null,
      p_to: filters.to || null,
      p_shift: filters.shift === "all" ? null : filters.shift,
      p_unit_id: filters.unitId === "all" ? null : filters.unitId,
      p_process_id: filters.processId === "all" ? null : filters.processId,
      p_flag: filters.flag === "all" ? null : filters.flag,
      p_search: term || null,
    })
    .single();

  if (error) throw new Error(error.message);

  const row = (data ?? {}) as {
    entry_count?: number;
    total_qty?: number;
    // Absent until migration 0015 is applied, which reads as 0 and renders as
    // an em-dash — the footer degrades to a missing total rather than an error.
    total_target_qty?: number;
    total_rejected?: number;
    total_minutes?: number;
  };

  const totalQty = Number(row.total_qty ?? 0);
  const totalRejected = Number(row.total_rejected ?? 0);

  return {
    entryCount: Number(row.entry_count ?? 0),
    totalQty,
    totalTargetQty: Number(row.total_target_qty ?? 0),
    totalRejected,
    totalMinutes: Number(row.total_minutes ?? 0),
    qualityRate:
      totalQty > 0 ? ((totalQty - totalRejected) / totalQty) * 100 : null,
  };
}

/**
 * Every row matching the current filters, for the CSV export — the file has
 * to be the filtered set, not the page on screen. Capped at `EXPORT_LIMIT`;
 * the caller warns when the cap was hit rather than writing a silently
 * truncated file.
 */
export async function fetchLogTableExportRows(
  factoryId: string,
  filters: LogTableFilters,
  sort: LogTableSort
): Promise<LogTableRow[]> {
  const supabase = createClient();

  const query = applyFilters(
    supabase
      .from("shift_log_entries_expanded")
      .select(COLUMNS) as unknown as FilterBuilder,
    factoryId,
    filters
  )
    .order(SORTABLE[sort.column], {
      ascending: sort.direction === "asc",
      nullsFirst: false,
    })
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);

  const { data, error } = (await query) as unknown as QueryResult;

  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ── Defaults ──────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD` for a date `daysAgo` before today, in the viewer's timezone. */
function dayKey(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The prototype's opening view: the last 30 days, unfiltered. */
export function defaultFilters(): LogTableFilters {
  return {
    from: dayKey(30),
    to: dayKey(0),
    shift: "all",
    unitId: "all",
    processId: "all",
    flag: "all",
    search: "",
  };
}

export const DEFAULT_SORT: LogTableSort = {
  column: "log_date",
  direction: "desc",
};

/**
 * How many filters are doing something, for the collapsed filter button.
 *
 * The date range counts as **one** even though it is two inputs: "16 Jul →
 * 15 Aug" is one decision, and counting it twice would make the badge read 2
 * on a table nobody has touched.
 */
export function activeFilterCount(f: LogTableFilters): number {
  const d = defaultFilters();
  let count = 0;
  if (f.from !== d.from || f.to !== d.to) count += 1;
  if (f.shift !== "all") count += 1;
  if (f.unitId !== "all") count += 1;
  if (f.processId !== "all") count += 1;
  if (f.flag !== "all") count += 1;
  if (f.search.trim() !== "") count += 1;
  return count;
}

/** True when the user has changed anything worth offering to clear. */
export function filtersAreDefault(f: LogTableFilters): boolean {
  const d = defaultFilters();
  return (
    f.from === d.from &&
    f.to === d.to &&
    f.shift === "all" &&
    f.unitId === "all" &&
    f.processId === "all" &&
    f.flag === "all" &&
    f.search.trim() === ""
  );
}
