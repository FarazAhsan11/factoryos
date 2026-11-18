"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  FileText,
  Loader2,
  PenLine,
  Signature,
  Sparkles,
} from "lucide-react";

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
import { dispositionMeta, type Deviation, type NcrDisposition } from "@/lib/factory/deviation-queries";
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
];

function inFilter(e: AuditEntry, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "changes") return e.action === "changed";
  if (f === "files") return e.action === "file_attached" || e.action === "file_removed";
  return SIGNATURES.includes(e.action);
}

/**
 * A case's history: the timeline of its steps, then the audit trail — every
 * change the database recorded (0066), newest first, with who made it, when,
 * and the value before and after.
 *
 * One save is one entry: the rows a single update wrote (same moment, same
 * person) are grouped under one heading, with each field it changed beneath.
 * Long values are clipped to two lines with a "Show more", and the whole text
 * is also on hover; nothing runs off the screen.
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

  const names = useMemo(
    () => ({
      department: new Map(departments.map((x) => [x.id, x.name])),
      capa: new Map(capas.map((c) => [c.id, c.capa_no])),
    }),
    [departments, capas],
  );

  const groups = useMemo(() => {
    const out: { key: string; at: string; who: string; rows: AuditEntry[] }[] = [];
    for (const e of entries.filter((x) => inFilter(x, filter))) {
      const who = e.actor_name ?? "Unknown";
      const last = out[out.length - 1];
      // One update writes all its rows at the same instant.
      if (last && last.at === e.at && last.who === who) last.rows.push(e);
      else out.push({ key: `${e.id}`, at: e.at, who, rows: [e] });
    }
    return out;
  }, [entries, filter]);

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
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
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
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-5">
            {entries.length === 0 ? "Nothing recorded yet." : "Nothing of this kind."}
          </p>
        ) : (
          <ol className="relative space-y-3">
            {groups.map((g) => (
              <Group key={g.key} at={g.at} who={g.who} rows={g.rows} names={names} />
            ))}
          </ol>
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

/* ── One save ─────────────────────────────────────────────────────────── */

type Names = { department: Map<string, string>; capa: Map<string, string> };

function headline(rows: AuditEntry[]): { icon: typeof PenLine; text: string } {
  const event = rows.find((r) => r.action !== "changed");
  const changes = rows.filter((r) => r.action === "changed");
  const changedText =
    changes.length === 1
      ? `changed ${fieldMeta(changes[0].field).label.toLowerCase()}`
      : `changed ${changes.length} fields`;
  if (!event) return { icon: PenLine, text: changedText };
  const also = changes.length > 0 ? ` and ${changedText}` : "";
  const section = (s: string | null) => SECTION_LABELS[s ?? ""] ?? "the case";
  switch (event.action) {
    case "raised":
      return { icon: Sparkles, text: `raised the case${also}` };
    case "assessment_signed":
      return { icon: Signature, text: `signed the initial assessment${also}` };
    case "investigation_submitted":
      return { icon: Signature, text: `submitted the investigation for approval${also}` };
    case "investigation_approved":
      return { icon: Signature, text: `approved the investigation${also}` };
    case "investigation_returned":
      return { icon: Signature, text: `sent the investigation back${also}` };
    case "closeout_first_signed":
      return { icon: Signature, text: `signed the close-out — first of two${also}` };
    case "closed":
      return { icon: Signature, text: `closed the case${also}` };
    case "file_attached":
      return { icon: FileText, text: `attached a file to ${section(event.field)}` };
    case "file_removed":
      return { icon: FileText, text: `removed a file from ${section(event.field)}` };
    default:
      return { icon: PenLine, text: changedText };
  }
}

function Group({
  at,
  who,
  rows,
  names,
}: {
  at: string;
  who: string;
  rows: AuditEntry[];
  names: Names;
}) {
  const { icon: Icon, text } = headline(rows);
  const events = rows.filter((r) => r.action !== "changed");
  const changes = rows.filter((r) => r.action === "changed");
  return (
    <li className="min-w-0 rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
        <p className="flex min-w-0 items-start gap-2.5 text-sm text-ink-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-deep">
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 break-words">
            <span className="font-semibold text-ink">{who}</span> {text}
          </span>
        </p>
        <time className="shrink-0 font-mono text-xs tabular-nums text-ink-4" dateTime={at}>
          {formatDateTime(at)}
        </time>
      </div>

      {events.some((e) => e.new_value || e.old_value || e.reason) && (
        <div className="space-y-1.5 border-t border-line-soft px-4 py-2.5 pl-12.5">
          {events.map((e) => (
            <EventDetail key={e.id} e={e} />
          ))}
        </div>
      )}

      {changes.length > 0 && (
        <dl className="divide-y divide-line-soft border-t border-line-soft">
          {changes.map((c) => (
            <Change key={c.id} entry={c} names={names} />
          ))}
        </dl>
      )}
    </li>
  );
}

function EventDetail({ e }: { e: AuditEntry }) {
  const label =
    e.action === "raised"
      ? "Case"
      : e.action === "assessment_signed"
        ? "Class"
        : e.action === "closed"
          ? "Reason"
          : e.action === "file_attached" || e.action === "file_removed"
            ? "File"
            : null;
  const value = e.new_value ?? e.old_value;
  return (
    <>
      {label && value && (
        <p className="flex min-w-0 gap-2 text-xs">
          <span className="shrink-0 text-ink-5">{label}</span>
          <span className="min-w-0 truncate font-medium text-ink" title={value}>
            {value}
          </span>
        </p>
      )}
      {e.reason && (
        <div className="text-xs">
          <span className="text-ink-5">Reason </span>
          <Clamp text={e.reason} />
        </div>
      )}
    </>
  );
}

/* ── One field ────────────────────────────────────────────────────────── */

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

function Change({ entry, names }: { entry: AuditEntry; names: Names }) {
  const { label, kind } = fieldMeta(entry.field);
  const before = display(kind, entry.old_value, names);
  const after = display(kind, entry.new_value, names);
  // Paragraphs stack, before over after; short values sit on one line.
  const stacked =
    kind === "long" || (before?.length ?? 0) > 60 || (after?.length ?? 0) > 60;
  const mono = kind === "mono";

  return (
    <div className="grid min-w-0 gap-x-4 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:pl-12.5">
      <dt className="truncate text-xs font-medium text-ink-4" title={label}>
        {label}
      </dt>
      <dd className="min-w-0">
        {stacked ? (
          <div className="grid gap-1.5">
            <Pill tone="old" value={before} mono={mono} block />
            <Pill tone="new" value={after} mono={mono} block />
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Pill tone="old" value={before} mono={mono} />
            <ArrowRight className="size-3.5 shrink-0 text-ink-5" aria-label="changed to" />
            <Pill tone="new" value={after} mono={mono} />
          </div>
        )}
      </dd>
    </div>
  );
}

function Pill({
  tone,
  value,
  mono,
  block,
}: {
  tone: "old" | "new";
  value: string | null;
  mono?: boolean;
  block?: boolean;
}) {
  const shell = cn(
    "min-w-0 rounded-lg px-2 py-1 text-xs",
    tone === "old"
      ? "bg-sunken-2 text-ink-4"
      : "bg-teal-soft font-medium text-teal-deep",
    mono && "font-mono",
    block ? "block" : "inline-block max-w-full",
  );
  if (value === null) {
    return (
      <span className={cn(shell, "italic opacity-70")}>
        {tone === "old" ? "empty" : "cleared"}
      </span>
    );
  }
  return (
    <span className={shell}>
      {block && (
        <span className="mr-1.5 text-[0.625rem] font-bold tracking-wide uppercase opacity-60">
          {tone === "old" ? "Before" : "After"}
        </span>
      )}
      {block ? <Clamp text={value} /> : (
        <span className="block truncate" title={value}>
          {value}
        </span>
      )}
    </span>
  );
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
