import type { Capa } from "@/lib/factory/capa-queries";
import {
  devStage,
  type Deviation,
  type DeviationType,
} from "@/lib/factory/deviation-queries";
import { addDays, localDay } from "@/lib/factory/dates";
import { NCR_DISPOSITIONS } from "@/lib/factory/ncr";

/**
 * The Quality dashboard's numbers, as the reference QMS (qms-v12, "v12 —
 * Quality dashboard") defines them. A plain module: every figure is derived
 * here from the cached case list and CAPA list, so the screen only draws.
 *
 * Two halves. **Today** is the live state of open work. **Trends** cuts a
 * period (3, 6 or 12 months) and compares it with the one before. Trends
 * read flat "facts" — one per case — so each chart is a count over them.
 *
 * Nothing is stored: a case's class, stage, overdue and age are what the
 * case list already derives.
 */

export type CaseKind = "DEV" | "NCR" | "CMP";

export const KINDS: { kind: CaseKind; plural: string; tab: string }[] = [
  { kind: "DEV", plural: "Deviations", tab: "deviations" },
  { kind: "NCR", plural: "Non-conformances", tab: "ncr" },
  { kind: "CMP", plural: "Complaints", tab: "complaints" },
];

export const kindOf = (t: DeviationType): CaseKind =>
  t === "ncr" ? "NCR" : t === "complaint" ? "CMP" : "DEV";

export type CaseClass = "Minor" | "Major" | "Critical";

/** One case, flattened for counting. */
export interface Fact {
  id: string;
  kind: CaseKind;
  /** The day it counts from: received for a complaint, raised otherwise. */
  raised: string;
  closed: string | null;
  due: string | null;
  cls: CaseClass | null;
  /** Deviation category, NCR defect type or complaint category. */
  cat: string | null;
  /** The first root-cause category ticked (the one trended). */
  rc: string | null;
  products: string[];
  /** NCR on a material only. */
  supplier: string | null;
  /** NCR disposition, once signed. */
  disposition: string | null;
  /** Investigation conclusion — for a complaint, "Complaint confirmed?". */
  conclusion: string | null;
  adverse: boolean;
  department: string | null;
  /** Complaint acknowledged after its acknowledge-by date (or not yet, and late). */
  ackLate: boolean;
  likelihood: number | null;
  planned: boolean;
}

/** "Not a non-conformance" and "Not a quality complaint" are not cases. */
const isCase = (d: Deviation) => !d.not_case_reason;

export function factOf(d: Deviation, ackDays: number, today: string): Fact {
  const kind = kindOf(d.type);
  const raised =
    kind === "CMP" && d.received_on ? d.received_on : localDay(d.created_at);
  const ackBy = d.received_on ? addDays(d.received_on, ackDays) : null;
  const cat =
    d.nc_category === "Other" && d.category_other ? d.category_other : d.nc_category;
  return {
    id: d.id,
    kind,
    raised,
    closed: d.status === "closed" && d.closed_at ? localDay(d.closed_at) : null,
    due: d.sla_date,
    cls: d.classification as CaseClass | null,
    cat,
    rc: d.root_cause_categories[0] ?? d.root_cause_category ?? null,
    products:
      d.product_names.length > 0
        ? d.product_names
        : d.product_label
          ? [d.product_label]
          : [],
    supplier: kind === "NCR" && d.material_code ? d.supplier_name : null,
    disposition: d.disposition_signed_at ? d.ncr_disposition : null,
    conclusion: d.root_cause_conclusion,
    adverse: d.adverse_reaction === true,
    department: d.department_name,
    ackLate:
      kind === "CMP" &&
      ackBy !== null &&
      (d.ack_on ? d.ack_on > ackBy : today > ackBy),
    likelihood: d.likelihood,
    planned: d.type === "planned",
  };
}

export function factsOf(cases: Deviation[], ackDays: number, today: string): Fact[] {
  return cases.filter(isCase).map((d) => factOf(d, ackDays, today));
}

/* ── Periods ─────────────────────────────────────────────────────────── */

export const monthKey = (day: string) => day.slice(0, 7);

/** The last `n` months up to this one, oldest first: "2026-01" … "2026-11". */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (key: string) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];

export interface Period {
  months: string[];
  /** Raised in the period. */
  raised: Fact[];
  /** Closed in the period, whenever raised. */
  closed: Fact[];
}

/** `offset` 0 is the period ending this month; 1 is the one before it. */
export function periodOf(facts: Fact[], today: string, n: number, offset: 0 | 1): Period {
  const months = lastMonths(today, n * (offset + 1)).slice(0, n);
  const set = new Set(months);
  return {
    months,
    raised: facts.filter((f) => set.has(monthKey(f.raised))),
    closed: facts.filter((f) => f.closed && set.has(monthKey(f.closed))),
  };
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

function median(list: number[]): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Closed in the period by its due date, of all closed in the period. */
export const closedOnTime = (p: Period) =>
  pct(p.closed.filter((f) => f.due && f.closed! <= f.due).length, p.closed.length);

export const medianDaysToClose = (p: Period) =>
  median(p.closed.map((f) => daysBetween(f.raised, f.closed!)));

/** Of the complaints closed in the period with a result, how many were confirmed. */
export function complaintsConfirmed(p: Period): { pct: number | null; withResult: number } {
  const L = p.closed.filter((f) => f.kind === "CMP" && f.conclusion);
  return { pct: pct(L.filter((f) => f.conclusion === "Confirmed").length, L.length), withResult: L.length };
}

/** "▲ 12% vs previous 6 months" — and whether that change is good. */
export function delta(
  cur: number | null,
  prev: number | null,
  upIsGood: boolean,
  unit: "count" | "pt" | "d",
  months: number,
): { text: string; tone: "good" | "bad" | "flat" } {
  if (cur == null || prev == null) return { text: "No earlier period to compare", tone: "flat" };
  const d = cur - prev;
  if (!d) return { text: `Same as the previous ${months} months`, tone: "flat" };
  const abs =
    unit === "pt"
      ? `${Math.abs(d)} pts`
      : unit === "d"
        ? `${Math.abs(d)} days`
        : prev
          ? `${Math.round((Math.abs(d) / prev) * 100)}%`
          : String(Math.abs(d));
  return {
    text: `${d > 0 ? "▲" : "▼"} ${abs} vs previous ${months} months`,
    tone: d > 0 === upIsGood ? "good" : "bad",
  };
}

/* ── Charts ──────────────────────────────────────────────────────────── */

export const CLASS_ORDER: (CaseClass | null)[] = ["Minor", "Major", "Critical", null];

/** Cases of one kind raised in one month, by class. */
export function monthByClass(p: Period, kind: CaseKind, month: string) {
  const L = p.raised.filter((f) => f.kind === kind && monthKey(f.raised) === month);
  return {
    total: L.length,
    parts: CLASS_ORDER.map((c) => ({ cls: c, n: L.filter((f) => f.cls === c).length })).filter(
      (s) => s.n > 0,
    ),
  };
}

export type ParetoKey = "DEV" | "NCR" | "CMP" | "RC" | "SUP" | "PROD";

export const PARETO_VIEWS: { key: ParetoKey; label: string }[] = [
  { key: "DEV", label: "Deviation categories" },
  { key: "NCR", label: "NCR defect types" },
  { key: "CMP", label: "Complaint categories" },
  { key: "RC", label: "Root causes" },
  { key: "SUP", label: "NCRs by supplier" },
  { key: "PROD", label: "Complaints by product" },
];

export interface ParetoRow {
  key: string;
  n: number;
  /** Cumulative share up to and including this row, %. */
  cumulative: number;
  /** One of the "vital few" — the rows that make up the first 80%. */
  vital: boolean;
}

export function pareto(facts: Fact[], key: ParetoKey): { rows: ParetoRow[]; total: number; vital: number } {
  const values: string[] =
    key === "SUP"
      ? facts.filter((f) => f.kind === "NCR" && f.supplier).map((f) => f.supplier!)
      : key === "PROD"
        ? facts.filter((f) => f.kind === "CMP").flatMap((f) => f.products)
        : key === "RC"
          ? facts.filter((f) => f.rc).map((f) => f.rc!)
          : facts.filter((f) => f.kind === key && f.cat).map((f) => f.cat!);
  let counted = countBy(values);
  if (counted.length > 9) {
    const rest = counted.slice(8).reduce((s, [, n]) => s + n, 0);
    counted = [...counted.slice(0, 8), ["All others", rest]];
  }
  const total = counted.reduce((s, [, n]) => s + n, 0);
  let cum = 0;
  let vital = 0;
  const rows = counted.map(([k, n]) => {
    const before = cum;
    cum += n;
    const v = before / total < 0.8 && k !== "All others";
    if (v) vital++;
    return { key: k, n, cumulative: Math.round((cum / total) * 100), vital: v };
  });
  return { rows, total, vital };
}

/** Counted and sorted, most first. */
export function countBy(values: (string | null | undefined)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export const DISPOSITIONS = NCR_DISPOSITIONS;

/* ── Today ───────────────────────────────────────────────────────────── */

export const AGE_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "0–30", from: 0, to: 30 },
  { label: "31–60", from: 31, to: 60 },
  { label: "61–90", from: 61, to: 90 },
  { label: "Over 90", from: 91, to: Infinity },
];

export interface OpenWorkRow {
  kind: CaseKind;
  open: number;
  overdue: number;
  dueIn7: number;
  critical: number;
  awaitingAssessment: number;
  investigation: number;
  actions: number;
  closing: number;
}

/** Each type separately; the four stage columns add up to its open total. */
export function openWork(open: Deviation[]): OpenWorkRow[] {
  return KINDS.map(({ kind }) => {
    const L = open.filter((d) => kindOf(d.type) === kind);
    const stage = L.map(devStage);
    const n = (...s: string[]) => stage.filter((x) => s.includes(x)).length;
    return {
      kind,
      open: L.length,
      overdue: L.filter((d) => d.is_overdue).length,
      dueIn7: L.filter((d) => d.days_to_sla != null && d.days_to_sla >= 0 && d.days_to_sla <= 7).length,
      critical: L.filter((d) => d.classification === "Critical").length,
      awaitingAssessment: n("Awaiting assessment"),
      investigation: n("Investigating", "Awaiting approval"),
      actions: n("Actions", "Awaiting CAPA"),
      closing: n("Batches on hold", "Ready to close", "Awaiting 2nd signature"),
    };
  });
}

export interface CapaWork {
  open: number;
  overdueActions: number;
  /** In Verify, checked on completion or due within 30 days. */
  checksDue: number;
  plans: number;
  implementing: number;
  verification: number;
}

export function capaWork(capas: Capa[], today: string): CapaWork {
  const live = capas.filter((c) => c.step !== "closed" && c.step !== "withdrawn");
  const soon = addDays(today, 30);
  return {
    open: live.length,
    overdueActions: live.reduce((n, c) => n + c.actions_overdue, 0),
    checksDue: live.filter(
      (c) => c.step === "check" && (c.check_mode === "at_implementation" || (c.verify_by != null && c.verify_by <= soon)),
    ).length,
    plans: live.filter((c) => c.step === "plan").length,
    implementing: live.filter((c) => c.step === "do").length,
    verification: live.filter((c) => c.step === "check").length,
  };
}

/** Of the CAPAs ever checked, how many worked at the first check. All time. */
export function capaFirstTime(capas: Capa[]): { pct: number | null; checked: number } {
  const L = capas.filter((c) => c.check_count > 0);
  return { pct: pct(L.filter((c) => c.first_check_effective).length, L.length), checked: L.length };
}

export interface Task {
  id: string;
  href: string;
  what: string;
  ref: string;
  title: string;
  /** A date to show beside it, and whether it is past. */
  due: string | null;
  late: boolean;
}

const same = (a: string | null | undefined, me: string) =>
  !!a && a.trim().toLowerCase() === me;

/**
 * Work assigned to the signed-in person by name: open cases they own whose
 * next step is the owner's, and CAPAs they own or hold an open action on.
 * Owners are names on the record (picked from Workforce), so this matches
 * on the viewer's name.
 */
export function tasksFor(
  viewerName: string | null,
  open: Deviation[],
  capas: Capa[],
  slug: string,
): Task[] {
  const me = (viewerName ?? "").trim().toLowerCase();
  if (!me) return [];
  const base = `/factory/${slug}/deviations`;
  const out: Task[] = [];
  for (const d of open) {
    if (!same(d.owner_name, me)) continue;
    const s = devStage(d);
    const what =
      s === "Investigating"
        ? "Complete the investigation"
        : s === "Actions"
          ? "Decide the actions"
          : null;
    if (!what) continue;
    const tab = kindOf(d.type) === "NCR" ? "?tab=ncr" : kindOf(d.type) === "CMP" ? "?tab=complaints" : "";
    out.push({
      id: d.id,
      href: `${base}/${d.id}${tab}`,
      what,
      ref: d.deviation_no,
      title: d.title,
      due: d.sla_date,
      late: d.is_overdue,
    });
  }
  for (const c of capas) {
    if (c.step === "closed" || c.step === "withdrawn") continue;
    const owns = same(c.owner_name, me);
    const acts = c.action_owners.some((o) => same(o, me));
    if (!owns && !acts) continue;
    const what =
      c.step === "plan" ? "Finish the CAPA plan" : c.step === "do" ? "Complete your CAPA actions" : "Check the CAPA worked";
    if (c.step === "check" && !owns) continue;
    out.push({
      id: c.id,
      href: `${base}/capa/${c.id}`,
      what,
      ref: c.capa_no,
      title: c.title,
      due: c.step === "check" ? c.verify_by : c.next_due,
      late: c.actions_overdue > 0,
    });
  }
  return out.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
