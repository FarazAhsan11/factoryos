"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

import {
  SECTION_LABELS,
  auditKeys,
  fetchAudit,
  fieldMeta,
  type AuditAction,
  type AuditEntry,
  type FieldKind,
} from "@/lib/factory/audit-queries";
import { capaKeys, fetchCapas } from "@/lib/factory/capa-queries";
import { formatDateTime, formatDay } from "@/lib/factory/dates";
import {
  deviationKeys,
  dispositionMeta,
  fetchDeviations,
  type Deviation,
  type NcrDisposition,
} from "@/lib/factory/deviation-queries";
import { fetchSetupItems, setupKeys } from "@/lib/factory/setup-queries";
import { cn } from "@/lib/utils";

type Filter = "all" | "changes" | "signatures" | "files";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "changes", label: "Changes" },
  { value: "signatures", label: "Signatures & steps" },
  { value: "files", label: "Files" },
];

const SIGNATURES: AuditAction[] = [
  "raised",
  "assessment_signed",
  "investigation_submitted",
  "investigation_approved",
  "investigation_returned",
  "closeout_first_signed",
  "closed",
  "hold_placed",
  "batch_released",
  "batch_rejected",
];

function inFilter(e: AuditEntry, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "changes") return e.action === "changed";
  if (f === "files") return e.action === "file_attached" || e.action === "file_removed";
  return SIGNATURES.includes(e.action);
}

/**
 * A case's history: the timeline of its steps, then the audit trail — every
 * change the database recorded (0066), newest first, as the reference QMS
 * (qms-v5) lays it out: one row per change, When · Who · What · From · To ·
 * Reason.
 *
 * A list that changed is told item by item — "Reviewed item ticked",
 * "Finding: Batch record", "Likelihood evidence: previous case added" —
 * rather than as the whole list before and after. Long values are clipped to
 * two lines with a "Show more", and the whole text is also on hover.
 */
export function CaseHistory({
  deviation: d,
  factoryId,
}: {
  deviation: Deviation;
  factoryId: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const { data: entries = [], isPending, isError, error } = useQuery({
    queryKey: auditKeys.forCase(factoryId, d.id),
    queryFn: () => fetchAudit(d.id),
  });
  const { data: departments = [] } = useQuery({
    queryKey: setupKeys.all("factory_departments", factoryId),
    queryFn: () => fetchSetupItems("factory_departments", factoryId),
  });
  const { data: capas = [] } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });
  const { data: cases = [] } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });

  const names = useMemo(
    () => ({
      department: new Map(departments.map((x) => [x.id, x.name])),
      capa: new Map(capas.map((c) => [c.id, c.capa_no])),
      cases: new Map(cases.map((c) => [c.id, c.deviation_no])),
    }),
    [departments, capas, cases],
  );

  const allRows = useMemo(
    () => entries.flatMap((e) => trailRows(e, names)),
    [entries, names],
  );
  const rows = useMemo(
    () =>
      entries
        .filter((e) => inFilter(e, filter))
        .flatMap((e) => trailRows(e, names)),
    [entries, filter, names],
  );

  const days = d.age_days;

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 flex flex-wrap items-baseline gap-2 text-base font-semibold text-ink">
          Timeline
          <span className="text-sm font-normal text-ink-4">
            {days} day{days === 1 ? "" : "s"} {d.status === "closed" ? "to close" : "open"}
          </span>
        </h3>
        <Timeline deviation={d} entries={entries} />
      </section>

      <section className="border-t border-line-soft pt-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-baseline gap-2 text-base font-semibold text-ink">
            Audit trail
            <span className="text-sm font-normal text-ink-4">
              {allRows.length} {allRows.length === 1 ? "entry" : "entries"}
            </span>
          </h3>
          <div
            role="radiogroup"
            aria-label="Show"
            className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  filter === f.value
                    ? "bg-sunken-2 text-ink ring-1 ring-line"
                    : "text-ink-4 hover:text-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {isPending ? (
          <Loader2 className="size-5 animate-spin text-ink-5" />
        ) : isError ? (
          <p className="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-deep">
            Could not load the audit trail: {(error as Error).message}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-5">
            {entries.length === 0 ? "Nothing recorded yet." : "Nothing of this kind."}
          </p>
        ) : (
          <TrailTable rows={rows} />
        )}
      </section>
    </div>
  );
}

/* ── Timeline ─────────────────────────────────────────────────────────── */

function Timeline({
  deviation: d,
  entries,
}: {
  deviation: Deviation;
  entries: AuditEntry[];
}) {
  // When the CAPA decision was made: the latest save that set it.
  const decided = entries.find(
    (e) =>
      e.action === "changed" &&
      (e.field === "capa_needed" || e.field === "capa_id") &&
      e.new_value !== null,
  );
  const steps: { label: string; at: string | null; note?: string }[] = [
    { label: "Raised", at: d.created_at },
    { label: "Initial assessment", at: d.assessed_at },
    d.investigation_required === false
      ? { label: "Investigation", at: null, note: "Not required" }
      : { label: "Investigation approved", at: d.investigation_approved_at },
    {
      label: "Actions agreed",
      at: d.capa_needed === null ? null : (decided?.at ?? null),
      note: d.capa_needed !== null && !decided ? "Done" : undefined,
    },
    d.capa_needed === false
      ? { label: "CAPA", at: null, note: "Not needed" }
      : { label: "CAPA verified effective", at: d.capa_verified_at },
    { label: "Closed", at: d.closed_at },
  ];
  return (
    <ol className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map((s) => {
        const done = Boolean(s.at) || Boolean(s.note);
        return (
          <li
            key={s.label}
            className={cn(
              "min-w-0 rounded-xl border px-3.5 py-3",
              done ? "border-teal-line bg-teal-soft" : "border-line bg-surface",
            )}
          >
            <p
              className={cn(
                "flex items-center gap-1.5 truncate text-sm font-semibold",
                done ? "text-teal-deep" : "text-ink-3",
              )}
              title={s.label}
            >
              {done && <Check className="size-3.5 shrink-0" />}
              <span className="truncate">{s.label}</span>
            </p>
            <p className="mt-1 truncate text-xs text-ink-4">
              {s.at ? formatDateTime(s.at) : (s.note ?? "—")}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/* ── The audit trail, one row per change ──────────────────────────────── */

type Names = {
  department: Map<string, string>;
  capa: Map<string, string>;
  cases: Map<string, string>;
};

interface TrailRow {
  key: string;
  at: string;
  who: string;
  what: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  mono?: boolean;
}

/** What each step or signature is called in the trail. */
const EVENT_WHAT: Partial<Record<AuditAction, string>> = {
  raised: "Raised",
  assessment_signed: "Signed: Initial assessment approved",
  investigation_submitted: "Investigation submitted for approval",
  investigation_approved: "Signed: Investigation approved",
  investigation_returned: "Investigation sent back",
  closeout_first_signed: "Signed: Close-out — first of two signatures",
  closed: "Signed: Case closed",
  hold_placed: "Batch hold placed",
  batch_released: "Signed: Batch released",
  batch_rejected: "Signed: Batch rejected",
};

type ReviewCheck = { item: string; finding: string };

/** `review_checks` as the trail stores it: its objects, comma-joined. */
function parseChecks(raw: string | null): ReviewCheck[] {
  if (!raw) return [];
  try {
    return JSON.parse(`[${raw}]`) as ReviewCheck[];
  } catch {
    return [];
  }
}

/** One audit entry as the trail's rows — a list change becomes one per item. */
function trailRows(e: AuditEntry, names: Names): TrailRow[] {
  const who = e.actor_name ?? "Unknown";
  const row = (
    n: number,
    what: string,
    from: string | null,
    to: string | null,
    mono = false,
  ): TrailRow => ({ key: `${e.id}-${n}`, at: e.at, who, what, from, to, reason: e.reason, mono });
  const section = SECTION_LABELS[e.field ?? ""] ?? "the case";

  switch (e.action) {
    case "changed":
      break;
    case "raised":
      return [row(0, "Raised", null, null)];
    case "file_attached":
      return [row(0, `File attached — ${section}`, null, e.new_value)];
    case "file_removed":
      return [row(0, `File removed — ${section}`, e.old_value, null)];
    case "hold_placed":
      return [row(0, "Batch hold placed", null, e.new_value, true)];
    case "batch_released":
      return [row(0, "Signed: Batch released", "On hold", `${e.new_value} Released`)];
    case "batch_rejected":
      return [row(0, "Signed: Batch rejected", "On hold", `${e.new_value} Rejected`)];
    default:
      return [row(0, EVENT_WHAT[e.action] ?? e.action, e.old_value, e.new_value)];
  }

  const { label, kind } = fieldMeta(e.field);

  // What was reviewed: ticked, unticked, and each finding written.
  if (kind === "checks") {
    const before = parseChecks(e.old_value);
    const after = parseChecks(e.new_value);
    const same = (x: ReviewCheck, y: ReviewCheck) =>
      x.item.toLowerCase() === y.item.toLowerCase();
    const out: TrailRow[] = [];
    for (const c of after) {
      const was = before.find((b) => same(b, c));
      if (!was) out.push(row(out.length, "Reviewed item ticked", null, c.item));
      const old = was?.finding ?? "";
      if (old !== c.finding && (was || c.finding)) {
        out.push(row(out.length, `Finding: ${c.item}`, old || null, c.finding || null));
      }
    }
    for (const b of before) {
      if (!after.some((c) => same(b, c))) {
        out.push(row(out.length, "Reviewed item unticked", b.item, null));
      }
    }
    return out;
  }

  // The likelihood's evidence: previous cases added and removed.
  if (kind === "cases") {
    const split = (raw: string | null) => (raw ? raw.split(", ") : []);
    const before = split(e.old_value);
    const after = split(e.new_value);
    const no = (id: string) => names.cases.get(id) ?? "a case";
    const out: TrailRow[] = [];
    for (const id of after.filter((x) => !before.includes(x))) {
      out.push(row(out.length, "Likelihood evidence: previous case added", null, no(id), true));
    }
    for (const id of before.filter((x) => !after.includes(x))) {
      out.push(row(out.length, "Likelihood evidence: previous case removed", no(id), null, true));
    }
    return out;
  }

  return [
    row(
      0,
      label,
      display(kind, e.old_value, names),
      display(kind, e.new_value, names),
      kind === "mono",
    ),
  ];
}

function TrailTable({ rows }: { rows: TrailRow[] }) {
  const TH = "px-3.5 py-2.5 text-left text-xs font-semibold text-ink-4";
  const TD = "px-3.5 py-2.5 align-top";
  return (
    <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-sunken">
          <tr>
            <th className={TH}>When</th>
            <th className={TH}>Who</th>
            <th className={TH}>What</th>
            <th className={TH}>From</th>
            <th className={TH}>To</th>
            <th className={TH}>Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft bg-surface">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={cn(TD, "whitespace-nowrap text-ink-3 tabular-nums")}>
                <time dateTime={r.at}>{formatDateTime(r.at)}</time>
              </td>
              <td className={cn(TD, "whitespace-nowrap text-ink-2")}>{r.who}</td>
              <td className={cn(TD, "min-w-[12rem] text-ink")}>{r.what}</td>
              <td className={cn(TD, "max-w-[18rem] text-ink-4", r.mono && "font-mono")}>
                {r.from && <Clamp text={r.from} />}
              </td>
              <td className={cn(TD, "max-w-[18rem] text-ink", r.mono && "font-mono")}>
                {r.to && <Clamp text={r.to} />}
              </td>
              <td className={cn(TD, "max-w-[16rem] text-ink-4")}>
                {r.reason && <Clamp text={r.reason} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── One value ────────────────────────────────────────────────────────── */

function display(kind: FieldKind, raw: string | null, names: Names): string | null {
  if (raw === null || raw === "") return null;
  switch (kind) {
    case "bool":
      return raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
    case "date":
      return formatDay(raw);
    case "datetime":
      return formatDateTime(raw);
    case "money": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : raw;
    }
    case "department":
      return names.department.get(raw) ?? "A department since removed";
    case "capa":
      return names.capa.get(raw) ?? "A CAPA";
    case "priority":
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    case "disposition":
      return dispositionMeta(raw as NcrDisposition).label;
    default:
      return raw;
  }
}

/**
 * Two lines, then "Show more" — and the full text on hover regardless. A
 * paragraph never pushes the trail sideways or turns one entry into a page.
 */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160 || text.split("\n").length > 2;
  return (
    <span className="min-w-0">
      <span
        title={open ? undefined : text}
        className={cn(
          "break-words whitespace-pre-wrap",
          !open && long && "line-clamp-2",
        )}
      >
        {text}
      </span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 block text-[0.6875rem] font-semibold text-brand hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </span>
  );
}
