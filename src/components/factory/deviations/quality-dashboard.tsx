"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";

import { SelectField } from "@/components/ui/select-field";
import { canReview } from "@/lib/factory/action-queries";
import { capaKeys, fetchCapas } from "@/lib/factory/capa-queries";
import { formatDay, todayKey } from "@/lib/factory/dates";
import { deviationKeys, fetchDeviations, type Deviation } from "@/lib/factory/deviation-queries";
import type { FactoryRole } from "@/lib/factory/context";
import {
  AGE_BUCKETS,
  CLASS_ORDER,
  DISPOSITIONS,
  KINDS,
  PARETO_VIEWS,
  capaFirstTime,
  capaWork,
  closedOnTime,
  complaintsConfirmed,
  countBy,
  delta,
  factsOf,
  kindOf,
  medianDaysToClose,
  monthByClass,
  monthLabel,
  openWork,
  pareto,
  pct,
  periodOf,
  tasksFor,
  type CaseClass,
  type CaseKind,
  type Fact,
  type ParetoKey,
  type Period,
} from "@/lib/factory/quality-dashboard";
import { useQualitySettings } from "@/lib/factory/quality-settings-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/**
 * Quality → Dashboard (`?tab=dashboard`), as the reference QMS's v12 lays it
 * out: **Today** — open cases, overdue, work assigned to you, batches and
 * lots on hold, the open-work table by type and stage, open cases by age —
 * and **Trends** over 3, 6 or 12 months, each figure set against the period
 * before: cases raised per month by class, the Pareto of what causes most
 * of them, and a panel each for complaints, NCRs and deviations.
 *
 * Every number comes from `quality-dashboard.ts` over the same cached case
 * and CAPA lists the registers use, so a save anywhere in Quality refreshes
 * it. Only recorded cases are counted — the reference's generated sample
 * history is a prototype aid and is not reproduced.
 */

const PANEL = "min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-soft";
const H2 = "text-[0.9375rem] font-semibold text-ink";
const LEAD = "mt-0.5 text-[0.8125rem] text-ink-4";
const SECTION = "mt-7 mb-3 text-[0.75rem] font-semibold tracking-[0.06em] text-ink-4 uppercase";

const CLASS_FILL: Record<string, string> = {
  Minor: "fill-cls-minor",
  Major: "fill-cls-major",
  Critical: "fill-cls-critical",
  none: "fill-cls-na",
};
const CLASS_BG: Record<string, string> = {
  Minor: "bg-cls-minor",
  Major: "bg-cls-major",
  Critical: "bg-cls-critical",
  none: "bg-cls-na",
};
const VIZ_BG = ["bg-viz-1", "bg-viz-2", "bg-viz-3", "bg-viz-4", "bg-viz-5"];
const OPEN_NOUN: Record<CaseKind, [string, string]> = {
  DEV: ["deviation", "deviations"],
  NCR: ["NCR", "NCRs"],
  CMP: ["complaint", "complaints"],
};

/* ── One tooltip for every chart: hover or keyboard focus ─────────────── */

type Tip = { text: string; x: number; y: number } | null;
const TipContext = createContext<(tip: Tip) => void>(() => {});

function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <TipContext.Provider value={setTip}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-[18rem] -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-[0.75rem] leading-snug whitespace-pre-line text-white shadow-lg"
          style={{ left: tip.x + 12, top: tip.y - 10 }}
        >
          {tip.text}
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Handlers that show `text` while the pointer or focus is on the element. */
function useTip(text: string) {
  const set = useContext(TipContext);
  return {
    tabIndex: 0,
    "aria-label": text.replace(/\n/g, ", "),
    onMouseMove: (e: React.MouseEvent) => set({ text, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => set(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as Element).getBoundingClientRect();
      set({ text, x: r.left + r.width / 2, y: r.top });
    },
    onBlur: () => set(null),
  };
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function QualityDashboard({
  factoryId,
  slug,
  viewerName,
  role,
}: {
  factoryId: string;
  slug: string;
  viewerName: string | null;
  role: FactoryRole;
}) {
  const today = useRenderClock(() => todayKey());
  const settings = useQualitySettings(factoryId);
  const cases = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });
  const capaQuery = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });

  const [months, setMonths] = useState<3 | 6 | 12>(12);
  const [product, setProduct] = useState("");
  const [paretoKey, setParetoKey] = useState<ParetoKey>("DEV");

  const all = useMemo(() => cases.data ?? [], [cases.data]);
  const capas = useMemo(() => capaQuery.data ?? [], [capaQuery.data]);
  const recorded = useMemo(() => all.filter((d) => !d.not_case_reason), [all]);
  const open = useMemo(() => recorded.filter((d) => d.status === "open"), [recorded]);

  const facts = useMemo(() => factsOf(all, settings.ackDays, today), [all, settings.ackDays, today]);
  const productOptions = useMemo(
    () => [
      { value: "", label: "All products" },
      ...countBy(facts.flatMap((f) => f.products))
        .map(([p]) => p)
        .sort((a, b) => a.localeCompare(b))
        .map((p) => ({ value: p, label: p })),
    ],
    [facts],
  );
  const inScope = useMemo(
    () => (product ? facts.filter((f) => f.products.includes(product)) : facts),
    [facts, product],
  );
  const P = useMemo(() => periodOf(inScope, today, months, 0), [inScope, today, months]);
  const Q = useMemo(() => periodOf(inScope, today, months, 1), [inScope, today, months]);

  if (cases.isPending) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-ink-4">
        <Loader2 className="size-4 animate-spin" /> Loading the dashboard…
      </div>
    );
  }
  if (cases.isError) {
    return <p className="py-16 text-sm text-danger-deep">{cases.error.message}</p>;
  }

  const overdue = open.filter((d) => d.is_overdue).length;
  const tasks = tasksFor(viewerName, open, capas, slug);
  const onHold = open.reduce((n, d) => n + d.holds_on_hold, 0);
  const work = openWork(open);
  const cw = capaWork(capas, today);
  const first = capaFirstTime(capas);
  const conf = complaintsConfirmed(P);
  const onTime = closedOnTime(P);
  const med = medianDaysToClose(P);
  const base = `/factory/${slug}/deviations`;

  return (
    <TipLayer>
      <div className="mx-auto w-full max-w-[1600px] pb-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[1.375rem] font-semibold text-ink">Quality dashboard</h1>
            <p className="mt-0.5 text-sm text-ink-4">
              Open work today, and how the last {months} months compare with the {months} before.
            </p>
          </div>
          {canReview(role) && (
            <div className="flex flex-wrap gap-2">
              {[
                ["New deviation", "/new"],
                ["New NCR", "/new?type=ncr"],
                ["New complaint", "/new?type=complaint"],
              ].map(([label, path]) => (
                <Link
                  key={path}
                  href={`${base}${path}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink-2 shadow-soft transition hover:border-brand hover:bg-brand-tint hover:text-brand-deep"
                >
                  <Plus className="size-4" />
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Today ── */}
        <h2 className={SECTION}>Today</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
          <Stat
            label="Open cases"
            value={open.length}
            sub={work
              .map((w) => `${w.open} ${OPEN_NOUN[w.kind][w.open === 1 ? 0 : 1]}`)
              .join(" · ")}
          />
          <Stat
            label="Overdue"
            value={overdue}
            tone={overdue ? "bad" : undefined}
            sub={overdue ? "Past their due date" : "Nothing overdue"}
          />
          <Stat label="Assigned to you" value={tasks.length} sub="Cases you own and your CAPA work" />
          <Stat label="Batches and lots on hold" value={onHold} sub="Blocked in production or quarantine" />
        </div>

        <section className={cn(PANEL, "mt-3")}>
          <h2 className={H2}>Open work</h2>
          <p className={LEAD}>Each type separately. The four stage columns add up to the open total.</p>
          <div className="scrollbar-slim mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-sunken text-left text-xs text-ink-4">
                <tr>
                  <th className="px-3.5 py-2 font-semibold" />
                  {["Open", "Overdue", "Due in 7 days", "Critical", "Awaiting assessment", "Investigation", "Actions", "Closing"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {work.map((r) => {
                  const k = KINDS.find((x) => x.kind === r.kind)!;
                  return (
                    <tr key={r.kind} className="border-t border-line-soft">
                      <td className="px-3.5 py-2.5">
                        <Link href={`${base}?tab=${k.tab}`} className="font-medium text-brand hover:underline">
                          {k.plural}
                        </Link>
                      </td>
                      <Num strong>{r.open}</Num>
                      <Num bad={r.overdue > 0}>{r.overdue}</Num>
                      <Num>{r.dueIn7}</Num>
                      <Num bad={r.critical > 0}>{r.critical}</Num>
                      <Num>{r.awaitingAssessment}</Num>
                      <Num>{r.investigation}</Num>
                      <Num>{r.actions}</Num>
                      <Num>{r.closing}</Num>
                    </tr>
                  );
                })}
                <tr className="border-t border-line-soft">
                  <td className="px-3.5 py-2.5">
                    <Link href={`${base}?tab=capa`} className="font-medium text-brand hover:underline">
                      CAPAs
                    </Link>
                  </td>
                  <Num strong>{cw.open}</Num>
                  <Num bad={cw.overdueActions > 0} note="actions">{cw.overdueActions}</Num>
                  <Num note="checks">{cw.checksDue}</Num>
                  <Num>—</Num>
                  <Num note="plans">{cw.plans}</Num>
                  <Num>—</Num>
                  <Num note="implementing">{cw.implementing}</Num>
                  <Num note="verifying">{cw.verification}</Num>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-4">
            CAPA row: actions past their target date · effectiveness checks due within 30 days · plans awaiting approval ·
            implementing · in verification.
          </p>
        </section>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <section className={PANEL}>
            <h2 className={H2}>Assigned to you</h2>
            <p className={LEAD}>Open cases you own, and CAPAs you own or have an action on.</p>
            {tasks.length ? (
              <ul className="mt-3 divide-y divide-line-soft">
                {tasks.slice(0, 8).map((t) => (
                  <li key={`${t.ref}-${t.what}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <Link href={t.href} className="text-sm font-medium text-brand hover:underline">
                        {t.what}
                      </Link>
                      <span className="block truncate text-xs text-ink-4">
                        <span className="font-mono">{t.ref}</span> · {t.title}
                      </span>
                    </span>
                    {t.due && (
                      <span className={cn("shrink-0 text-xs", t.late ? "font-semibold text-danger-deep" : "text-ink-4")}>
                        {t.late ? "Overdue · " : "Due "}
                        {formatDay(t.due)}
                      </span>
                    )}
                  </li>
                ))}
                {tasks.length > 8 && <li className="pt-2 text-xs text-ink-4">and {tasks.length - 8} more</li>}
              </ul>
            ) : (
              <Empty>Nothing assigned to you.</Empty>
            )}
          </section>
          <section className={PANEL}>
            <h2 className={H2}>Open cases by age</h2>
            <p className={LEAD}>Days since raised. Darker means more cases.</p>
            <Ageing open={open} base={base} />
          </section>
        </div>

        {/* ── Trends ── */}
        <div className="mt-7 mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className={cn(SECTION, "my-0")}>Trends</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
              {([3, 6, 12] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={months === n}
                  onClick={() => setMonths(n)}
                  className={cn(
                    "h-8 rounded-md px-3 text-xs font-semibold transition",
                    months === n ? "bg-surface text-brand-deep shadow-soft" : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  {n} months
                </button>
              ))}
            </div>
            <div className="w-[15rem]">
              <SelectField
                value={product}
                onChange={setProduct}
                options={productOptions}
                ariaLabel="Product"
                placeholder="All products"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
          <Stat label="Cases raised" value={P.raised.length} delta={delta(P.raised.length, Q.raised.length || null, false, "count", months)} />
          <Stat
            label="Closed on time"
            value={onTime == null ? "—" : `${onTime}%`}
            delta={delta(onTime, closedOnTime(Q), true, "pt", months)}
          />
          <Stat
            label="Median days to close"
            value={med ?? "—"}
            delta={delta(med, medianDaysToClose(Q), false, "d", months)}
          />
          <Stat
            label="Complaints confirmed"
            value={conf.pct == null ? "—" : `${conf.pct}%`}
            sub={`${conf.withResult} closed complaint${conf.withResult === 1 ? "" : "s"} with a result`}
          />
          <Stat
            label="CAPA effective first time"
            value={first.pct == null ? "—" : `${first.pct}%`}
            sub={`${first.checked} CAPA${first.checked === 1 ? "" : "s"} checked, all time`}
          />
        </div>

        <section className={cn(PANEL, "mt-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className={H2}>Cases raised per month</h2>
              <p className={LEAD}>By class, on one scale for all three, so the heights compare. Hover a month for the numbers.</p>
            </div>
            <Legend
              items={CLASS_ORDER.map((c) => ({ label: c ?? "Not assessed", swatch: CLASS_BG[c ?? "none"] }))}
            />
          </div>
          <MonthCharts P={P} />
        </section>

        <ParetoPanel facts={P.raised} view={paretoKey} onView={setParetoKey} />

        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <TypePanels P={P} cases={recorded} />
        </div>
      </div>
    </TipLayer>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Stat({
  label,
  value,
  sub,
  delta: d,
  tone,
  compact,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  delta?: { text: string; tone: "good" | "bad" | "flat" };
  tone?: "bad";
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        compact ? "rounded-lg bg-sunken px-3 py-2.5" : "rounded-xl border border-line bg-surface px-4 py-3.5 shadow-soft",
      )}
    >
      <span className="text-[0.78rem] text-ink-4">{label}</span>
      <b
        className={cn(
          "leading-tight font-semibold tabular-nums",
          compact ? "text-[1.1875rem]" : "text-[1.625rem]",
          tone === "bad" ? "text-danger-deep" : "text-ink",
        )}
      >
        {value}
      </b>
      {d && (
        <span
          className={cn(
            "text-xs",
            d.tone === "good" ? "text-teal-deep" : d.tone === "bad" ? "text-warn-deep" : "text-ink-5",
          )}
        >
          {d.text}
        </span>
      )}
      {sub && <span className="text-xs text-ink-5">{sub}</span>}
    </div>
  );
}

function Num({ children, strong, bad, note }: { children: ReactNode; strong?: boolean; bad?: boolean; note?: string }) {
  return (
    <td className="px-3 py-2.5 text-right">
      {bad ? (
        <span className="inline-flex min-w-6 justify-center rounded-full bg-danger-soft px-1.5 text-xs font-semibold text-danger-deep">
          {children}
        </span>
      ) : (
        <span className={strong ? "font-semibold text-ink" : "text-ink-3"}>{children}</span>
      )}
      {note && <span className="ml-1 text-[0.6875rem] text-ink-5">{note}</span>}
    </td>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-xl bg-sunken px-4 py-6 text-center text-sm text-ink-4">{children}</p>;
}

function Legend({ items }: { items: { label: string; swatch: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className={cn("size-2.5 rounded-[0.1875rem]", i.swatch)} />
          {i.label}
          {i.value}
        </span>
      ))}
    </div>
  );
}

function Ageing({ open, base }: { open: Deviation[]; base: string }) {
  const count = (kind: CaseKind, b: (typeof AGE_BUCKETS)[number]) =>
    open.filter((d) => kindOf(d.type) === kind && d.age_days >= b.from && d.age_days <= b.to).length;
  const max = Math.max(1, ...KINDS.flatMap(({ kind }) => AGE_BUCKETS.map((b) => count(kind, b))));
  return (
    <div className="scrollbar-slim mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-4">
          <tr>
            <th className="py-1.5 text-left font-semibold">Days open</th>
            {AGE_BUCKETS.map((b) => (
              <th key={b.label} className="py-1.5 text-center font-semibold">
                {b.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KINDS.map(({ kind, plural, tab }) => (
            <tr key={kind}>
              <td className="py-1">
                <Link href={`${base}?tab=${tab}`} className="font-medium text-brand hover:underline">
                  {plural}
                </Link>
              </td>
              {AGE_BUCKETS.map((b) => (
                <AgeCell key={b.label} n={count(kind, b)} max={max} text={`${plural}: ${count(kind, b)} open for ${b.label} days`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgeCell({ n, max, text }: { n: number; max: number; text: string }) {
  const tip = useTip(text);
  const strength = n ? 12 + (n / max) * 50 : 0;
  return (
    <td className="p-1 text-center">
      <span
        {...tip}
        className="flex h-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
        style={{ background: n ? `color-mix(in oklab, var(--color-viz-1) ${strength}%, transparent)` : undefined }}
      >
        {n || <span className="text-ink-6">·</span>}
      </span>
    </td>
  );
}

/* Monthly columns stacked by class — one chart per type, shared y-scale. */
function MonthCharts({ P }: { P: Period }) {
  const peak = Math.max(
    2,
    ...KINDS.flatMap(({ kind }) => P.months.map((m) => monthByClass(P, kind, m).total)),
  );
  const ymax = Math.ceil(peak / 2) * 2;
  return (
    <>
      <div className="mt-4 grid gap-5 md:grid-cols-3">
        {KINDS.map(({ kind, plural }) => (
          <div key={kind} className="min-w-0">
            <h3 className="text-[0.8125rem] font-semibold text-ink">
              {plural}{" "}
              <span className="font-normal text-ink-4">
                {P.raised.filter((f) => f.kind === kind).length} in {P.months.length} months
              </span>
            </h3>
            <MonthColumns P={P} kind={kind} plural={plural} ymax={ymax} />
          </div>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-brand">Table view</summary>
        <div className="scrollbar-slim mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-sunken text-xs text-ink-4">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">Month</th>
                {KINDS.map((k) => (
                  <th key={k.kind} className="px-3 py-1.5 text-right font-semibold">
                    {k.plural}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {P.months.map((m) => (
                <tr key={m} className="border-t border-line-soft">
                  <td className="px-3 py-1.5 text-ink-3">
                    {monthLabel(m)} {m.slice(0, 4)}
                  </td>
                  {KINDS.map((k) => (
                    <td key={k.kind} className="px-3 py-1.5 text-right text-ink-2">
                      {monthByClass(P, k.kind, m).total}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function MonthColumns({ P, kind, plural, ymax }: { P: Period; kind: CaseKind; plural: string; ymax: number }) {
  const W = 320, H = 150, pl = 26, pr = 6, pt = 14, pb = 22;
  const pw = W - pl - pr, ph = H - pt - pb;
  const band = pw / P.months.length;
  const bw = Math.min(18, band * 0.62);
  const every = P.months.length > 6 ? 2 : 1;
  const y = (v: number) => pt + ph - (v / ymax) * ph;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`${plural} raised per month`}>
      {[0, ymax / 2, ymax].map((v) => (
        <g key={v}>
          <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} className="stroke-line-soft" />
          <text x={pl - 6} y={y(v) + 3.5} textAnchor="end" className="fill-ink-5 text-[0.5625rem]">
            {v}
          </text>
        </g>
      ))}
      {P.months.map((m, i) => (
        <MonthBar
          key={m}
          month={m}
          index={i}
          last={i === P.months.length - 1}
          showLabel={i % every === (P.months.length - 1) % every}
          data={monthByClass(P, kind, m)}
          plural={plural}
          geo={{ x0: pl + band * i, band, bw, pt, ph, ymax, H }}
        />
      ))}
      <line x1={pl} x2={W - pr} y1={pt + ph} y2={pt + ph} className="stroke-line" />
    </svg>
  );
}

function MonthBar({
  month,
  last,
  showLabel,
  data,
  plural,
  geo,
}: {
  month: string;
  index: number;
  last: boolean;
  showLabel: boolean;
  data: { total: number; parts: { cls: CaseClass | null; n: number }[] };
  plural: string;
  geo: { x0: number; band: number; bw: number; pt: number; ph: number; ymax: number; H: number };
}) {
  const { x0, band, bw, pt, ph, ymax, H } = geo;
  const x = x0 + (band - bw) / 2;
  const tip = useTip(
    [
      `${monthLabel(month)} ${month.slice(0, 4)} · ${plural}`,
      `${data.total} raised`,
      ...data.parts.map((p) => `${p.cls ?? "Not assessed"}: ${p.n}`),
    ].join("\n"),
  );
  // Segments from the baseline up, a 2-unit surface gap between them; the
  // top one gets the rounded data-end.
  const segs = data.parts.reduce<{ cls: CaseClass | null; top: number; h: number }[]>((acc, p, j) => {
    const below = acc.length ? acc[acc.length - 1].top : pt + ph;
    const h = (p.n / ymax) * ph;
    const gap = j ? 2 : 0;
    return [...acc, { cls: p.cls, top: below - h, h: Math.max(0, h - gap) }];
  }, []);
  return (
    <g>
      {segs.map((s, j) => {
        const fill = CLASS_FILL[s.cls ?? "none"];
        const isTop = j === segs.length - 1;
        return isTop && s.h > 4 ? (
          <path
            key={j}
            className={fill}
            d={`M${x},${s.top + s.h} V${s.top + 4} Q${x},${s.top} ${x + 4},${s.top} H${x + bw - 4} Q${x + bw},${s.top} ${x + bw},${s.top + 4} V${s.top + s.h} Z`}
          />
        ) : (
          <rect key={j} className={fill} x={x} y={s.top} width={bw} height={s.h} />
        );
      })}
      <rect {...tip} x={x0} y={pt} width={band} height={ph} className="fill-transparent outline-none focus-visible:fill-brand/10" />
      {showLabel && (
        <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-ink-5 text-[0.5625rem]">
          {monthLabel(month)}
        </text>
      )}
      {last && data.total > 0 && (
        <text x={x + bw / 2} y={pt + ph - (data.total / ymax) * ph - 5} textAnchor="middle" className="fill-ink-2 text-[0.625rem] font-semibold">
          {data.total}
        </text>
      )}
    </g>
  );
}

function ParetoPanel({ facts, view, onView }: { facts: Fact[]; view: ParetoKey; onView: (k: ParetoKey) => void }) {
  const { rows, total, vital } = pareto(facts, view);
  const label = PARETO_VIEWS.find((p) => p.key === view)!.label;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className={cn(PANEL, "mt-3")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={H2}>Pareto — what causes most of the problems</h2>
          <p className={LEAD}>
            {total ? (
              <>
                <b className="font-semibold text-ink-2">
                  {vital} of {rows.length}
                </b>{" "}
                {label.toLowerCase()} account for 80% of {total} case{total === 1 ? "" : "s"} in the period. Fix these first.
              </>
            ) : (
              "No cases in the period."
            )}
          </p>
        </div>
        <div role="tablist" aria-label="Pareto of" className="flex flex-wrap gap-1 rounded-lg border border-line bg-sunken p-0.5">
          {PARETO_VIEWS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={view === p.key}
              onClick={() => onView(p.key)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-semibold transition",
                view === p.key ? "bg-surface text-brand-deep shadow-soft" : "text-ink-4 hover:text-ink-2",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length ? (
        <>
          <div className="mt-4 grid grid-cols-[minmax(8rem,16rem)_minmax(0,1fr)_3.5rem_5rem] items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="text-xs font-semibold text-ink-4">{label}</span>
            <span />
            <span className="text-right text-xs font-semibold text-ink-4">Cases</span>
            <span className="text-right text-xs font-semibold text-ink-4">Cumulative</span>
            {rows.map((r) => (
              <ParetoRowView key={r.key} row={r} max={max} total={total} />
            ))}
          </div>
          <div className="mt-3">
            <Legend
              items={[
                { label: "The vital few (up to 80% of cases)", swatch: "bg-viz-1" },
                { label: "The rest", swatch: "bg-cls-na" },
              ]}
            />
          </div>
        </>
      ) : (
        <Empty>Nothing to show yet.</Empty>
      )}
    </section>
  );
}

function ParetoRowView({ row, max, total }: { row: { key: string; n: number; cumulative: number; vital: boolean }; max: number; total: number }) {
  const tip = useTip(`${row.key}\n${row.n} cases · ${Math.round((row.n / total) * 100)}% of total\nCumulative ${row.cumulative}%`);
  return (
    <>
      <span className={cn("truncate", row.vital ? "font-medium text-ink" : "text-ink-3")} title={row.key}>
        {row.key}
      </span>
      <span {...tip} className="block h-3.5 rounded-sm bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <i
          className={cn("block h-full rounded-r-[0.25rem]", row.vital ? "bg-viz-1" : "bg-cls-na")}
          style={{ width: `${(row.n / max) * 100}%` }}
        />
      </span>
      <span className="text-right tabular-nums text-ink-2">{row.n}</span>
      <span className="text-right tabular-nums text-ink-4">{row.cumulative}%</span>
    </>
  );
}

function HBars({ rows, unit }: { rows: [string, number][]; unit: string }) {
  if (!rows.length) return <Empty>Nothing yet.</Empty>;
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="mt-2 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-x-2.5 gap-y-1.5 text-sm">
      {rows.map(([k, n]) => (
        <HBar key={k} k={k} n={n} max={max} unit={unit} />
      ))}
    </div>
  );
}

function HBar({ k, n, max, unit }: { k: string; n: number; max: number; unit: string }) {
  const tip = useTip(`${k}\n${n} ${unit}`);
  return (
    <>
      <span className="truncate text-ink-3" title={k}>
        {k}
      </span>
      <span {...tip} className="block h-3 rounded-sm bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <i className="block h-full rounded-r-[0.25rem] bg-viz-1" style={{ width: `${(n / max) * 100}%` }} />
      </span>
      <span className="text-right tabular-nums text-ink-2">{n}</span>
    </>
  );
}

function DispositionBar({ ncr }: { ncr: Fact[] }) {
  const parts = DISPOSITIONS.map((d, i) => ({
    label: d.label,
    n: ncr.filter((f) => f.disposition === d.value).length,
    bg: VIZ_BG[i],
  }));
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return <Empty>No disposition signed in the period.</Empty>;
  return (
    <>
      <div className="mt-2 flex h-4 gap-0.5 overflow-hidden rounded-[0.25rem]">
        {parts
          .filter((p) => p.n)
          .map((p) => (
            <DispositionPart key={p.label} {...p} total={total} />
          ))}
      </div>
      <div className="mt-2.5 flex flex-col gap-1 text-xs text-ink-3">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <i className={cn("size-2.5 shrink-0 rounded-[0.1875rem]", p.bg)} />
            {p.label} <b className="font-semibold text-ink-2 tabular-nums">{p.n}</b>
            <span className="text-ink-5 tabular-nums">{pct(p.n, total)}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

function DispositionPart({ label, n, bg, total }: { label: string; n: number; bg: string; total: number }) {
  const tip = useTip(`${label}\n${n} · ${pct(n, total)}%`);
  return <i {...tip} className={cn("block h-full outline-none focus-visible:ring-2 focus-visible:ring-brand", bg)} style={{ flex: n }} />;
}

/** `cases` is every recorded case: supplier replies are counted on open NCRs, tightened inspection on all. */
function TypePanels({ P, cases }: { P: Period; cases: Deviation[] }) {
  const cmp = P.raised.filter((f) => f.kind === "CMP");
  const ncr = P.raised.filter((f) => f.kind === "NCR");
  const dev = P.raised.filter((f) => f.kind === "DEV");
  const conf = complaintsConfirmed(P).pct;
  const ack = pct(cmp.filter((f) => !f.ackLate).length, cmp.length);
  const replies = cases.filter((d) => d.type === "ncr" && d.status === "open" && d.scar_requested && !d.scar_reply_on).length;
  const tightened = cases.filter((d) => d.type === "ncr" && d.tightened_inspection).length;
  const top = countBy(ncr.map((f) => f.supplier))[0];
  const recurring = pct(dev.filter((f) => f.likelihood === 3).length, dev.length);
  const show = (v: number | null) => (v == null ? "—" : `${v}%`);
  return (
    <>
      <section className={PANEL}>
        <h2 className={H2}>Complaints</h2>
        <p className={LEAD}>{cmp.length} received in the period.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat compact label="Confirmed" value={show(conf)} />
          <Stat compact label="Adverse reactions" value={cmp.filter((f) => f.adverse).length} />
          <Stat compact label="Acknowledged on time" value={show(ack)} />
        </div>
        <h3 className="mt-4 text-[0.8125rem] font-semibold text-ink">By product</h3>
        <HBars rows={countBy(cmp.flatMap((f) => f.products)).slice(0, 6)} unit="complaints" />
      </section>
      <section className={PANEL}>
        <h2 className={H2}>Non-conformances</h2>
        <p className={LEAD}>{ncr.length} raised in the period.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat compact label="Supplier replies awaited" value={replies} />
          <Stat compact label="Tightened inspection" value={tightened} />
          <Stat compact label={top ? `${top[0]} share` : "Top supplier share"} value={top ? show(pct(top[1], ncr.length)) : "—"} />
        </div>
        <h3 className="mt-4 text-[0.8125rem] font-semibold text-ink">Disposition</h3>
        <DispositionBar ncr={ncr} />
      </section>
      <section className={PANEL}>
        <h2 className={H2}>Deviations</h2>
        <p className={LEAD}>{dev.length} raised in the period.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat compact label="Recurring" value={show(recurring)} />
          <Stat compact label="Planned" value={dev.filter((f) => f.planned).length} />
          <Stat compact label="Critical" value={dev.filter((f) => f.cls === "Critical").length} />
        </div>
        <h3 className="mt-4 text-[0.8125rem] font-semibold text-ink">By department</h3>
        <HBars rows={countBy(dev.map((f) => f.department)).slice(0, 6)} unit="deviations" />
      </section>
    </>
  );
}
