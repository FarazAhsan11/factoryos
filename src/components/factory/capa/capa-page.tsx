"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react";

import { CapaCheckStep } from "@/components/factory/capa/capa-check-step";
import { CapaDoStep } from "@/components/factory/capa/capa-do-step";
import { CapaPlanStep } from "@/components/factory/capa/capa-plan-step";
import { CapaStepper } from "@/components/factory/capa/capa-stepper";
import { formatDate } from "@/components/factory/deviations/deviation-fields";
import { canReview } from "@/lib/factory/action-queries";
import {
  capaKeys,
  capaNext,
  fetchCapaActions,
  fetchCapaAudit,
  fetchCapaChecks,
  fetchCapas,
  STEP_INDEX,
  type CapaAuditEntry,
  type CapaCase,
} from "@/lib/factory/capa-queries";
import type { FactoryRole } from "@/lib/factory/context";
import { formatDateTime, todayKey } from "@/lib/factory/dates";
import { deviationKeys, fetchDeviations } from "@/lib/factory/deviation-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/** Where a case opens: a deviation has a page, an NCR or complaint a dialog. */
export function caseHref(slug: string, k: Pick<CapaCase, "id" | "type">): string {
  if (k.type === "planned" || k.type === "unplanned") {
    return `/factory/${slug}/deviations/${k.id}`;
  }
  const tab = k.type === "ncr" ? "ncr" : "complaints";
  return `/factory/${slug}/deviations?tab=${tab}&case=${k.id}`;
}

type CardState = "done" | "current" | "later";

/**
 * One CAPA, on a page of its own — the reference QMS's (qms-v6): what it is
 * and where it came from, the stepper (CAPA plan → Do → Effectiveness check →
 * Closed), and a card per step. The current step is open; a finished one can
 * be shown again; a later one only says when it starts. Files and history sit
 * underneath.
 */
export function CapaPage({
  factoryId,
  slug,
  capaId,
  role,
  viewerName,
}: {
  factoryId: string;
  slug: string;
  capaId: string;
  role: FactoryRole;
  viewerName: string;
}) {
  const today = useRenderClock(todayKey);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  // The CAPA's steps, or its history — two tabs, as on the case page.
  const [tab, setTab] = useState<"capa" | "history">("capa");

  const { data: capas, isPending, isError, error } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });
  const { data: actions = [] } = useQuery({
    queryKey: capaKeys.actions(factoryId, capaId),
    queryFn: () => fetchCapaActions(capaId),
  });
  const { data: checks = [] } = useQuery({
    queryKey: capaKeys.checks(factoryId, capaId),
    queryFn: () => fetchCapaChecks(capaId),
  });
  // The root causes come from the cases the CAPA covers.
  const { data: cases = [] } = useQuery({
    queryKey: deviationKeys.all(factoryId),
    queryFn: () => fetchDeviations(factoryId),
  });

  const registerHref = `/factory/${slug}/deviations?tab=capa`;
  const capa = capas?.find((c) => c.id === capaId) ?? null;

  if (isPending) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-5" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-6 text-center text-sm font-medium text-danger-deep">
        Could not load the CAPA: {(error as Error).message}
      </p>
    );
  }
  if (!capa) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
        <p className="text-sm text-ink-3">This CAPA could not be found.</p>
        <Link href={registerHref} className="mt-2 inline-block text-sm text-brand hover:underline">
          Back to the CAPA register
        </Link>
      </div>
    );
  }

  const reviewer = canReview(role);
  const at = STEP_INDEX[capa.step];
  const closed = capa.step === "closed";
  const state = (i: number): CardState => (i < at ? "done" : i === at ? "current" : "later");
  const next = capaNext(capa);
  const done = actions.filter((a) => a.closed_date).length;
  const total = actions.length;
  const lastCheck = checks.at(-1) ?? null;
  const roots = capa.cases.map((k) => ({
    k,
    root: cases.find((d) => d.id === k.id)?.root_cause ?? null,
  }));

  const planSummary = capa.plan_approved_at
    ? `✓ Approved by ${capa.plan_approved_by_name} · ${formatDate(capa.plan_approved_at.slice(0, 10))} — ${total} action${total === 1 ? "" : "s"}, ${
        capa.check_mode === "at_implementation"
          ? "confirmed when done"
          : `check on ${formatDate(capa.verify_by)}`
      }`
    : "The owner writes it, then it is approved";
  const doSummary =
    at > 1
      ? `✓ ${done} of ${total} actions done${capa.last_done ? `, last on ${formatDate(capa.last_done)}` : ""}`
      : at === 1
        ? `${done} of ${total} done${capa.next_due ? ` · next due ${formatDate(capa.next_due)}` : ""}`
        : "Starts when the plan is approved";
  const checkSummary = closed
    ? `✓ Worked — ${lastCheck?.checked_by_name ?? capa.verified_by_name ?? ""} · ${formatDate((lastCheck?.checked_at ?? capa.verified_at ?? "").slice(0, 10))}`
    : capa.step === "check"
      ? capa.check_mode === "at_implementation"
        ? "Confirm it worked"
        : `Due ${formatDate(capa.verify_by)}`
      : `Opens when every action is done${capa.check_mode === "dated" && capa.verify_by ? ` · planned for ${formatDate(capa.verify_by)}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-4">
        <Link href={registerHref} className="text-brand hover:underline">
          CAPA register
        </Link>
        <span className="mx-1.5 text-ink-5">/</span>
        <span className="font-mono">{capa.capa_no}</span>
      </nav>

      <div className="mt-3 rounded-2xl border border-line bg-surface shadow-soft">
        <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 max-w-3xl">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{capa.title}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-sm leading-relaxed text-ink-4">
              <span className="font-mono">{capa.capa_no}</span>
              {capa.reason && <span>· {capa.reason}</span>}
              <span>· owner {capa.owner_name ?? "—"}</span>
              <span>· from</span>
              {capa.cases.length === 0
                ? "—"
                : capa.cases.map((k, i) => (
                    <span key={k.id}>
                      <Link href={caseHref(slug, k)} className="font-mono text-brand hover:underline">
                        {k.deviation_no}
                      </Link>
                      {i < capa.cases.length - 1 && ","}
                    </span>
                  ))}
            </p>
            <div className="mt-4">
              <CapaStepper step={capa.step} />
            </div>
          </div>
          <div className="min-w-[8rem]">
            <p
              className={cn(
                "text-sm font-semibold whitespace-nowrap text-ink",
                !closed && next.date && next.date < today && "text-danger-deep",
              )}
            >
              {next.date ? formatDate(next.date) : next.text}
            </p>
            <p className="mt-1 text-xs text-ink-5">{next.date ? next.text : "Next"}</p>
          </div>
        </header>

        <div
          role="tablist"
          aria-label="CAPA sections"
          className="mt-4 flex gap-6 px-5 shadow-[inset_0_-1px_0_var(--color-line)] sm:px-7"
        >
          {(
            [
              { id: "capa", label: "CAPA" },
              { id: "history", label: "History" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 py-3 text-sm transition",
                tab === id
                  ? "border-brand font-semibold text-ink"
                  : "border-transparent text-ink-4 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "history" ? (
          <div className="px-5 py-6 sm:px-7">
            <CapaHistory factoryId={factoryId} capaId={capa.id} />
          </div>
        ) : (
        <div className="space-y-4 px-5 py-6 sm:px-7">
          {closed && (
            <p className="flex items-start gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                Closed — it worked. {lastCheck?.findings ?? capa.verification} (
                {lastCheck?.checked_by_name ?? capa.verified_by_name},{" "}
                {formatDate((lastCheck?.checked_at ?? capa.verified_at ?? "").slice(0, 10))})
              </span>
            </p>
          )}

          <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
            <span className="font-semibold text-ink">
              Root cause{roots.length > 1 ? "s" : ""} to fix:
            </span>{" "}
            {roots.length === 0
              ? "No linked case"
              : roots.map(({ k, root }, i) => (
                  <span key={k.id}>
                    {i > 0 && " · "}
                    <Link href={caseHref(slug, k)} className="font-mono text-brand hover:underline">
                      {k.deviation_no}
                    </Link>{" "}
                    {root ?? <span className="text-ink-5 italic">not recorded yet</span>}
                  </span>
                ))}
          </p>

          <StepCard
            n={1}
            title="CAPA plan"
            state={state(0)}
            summary={planSummary}
            shown={shown.plan}
            onToggle={() => setShown((s) => ({ ...s, plan: !s.plan }))}
          >
            <CapaPlanStep
              capa={capa}
              actions={actions}
              factoryId={factoryId}
              editable={reviewer && capa.step === "plan"}
              viewerName={viewerName}
              today={today}
            />
          </StepCard>

          <StepCard
            n={2}
            title="Do"
            state={state(1)}
            summary={doSummary}
            shown={shown.do}
            onToggle={() => setShown((s) => ({ ...s, do: !s.do }))}
          >
            <CapaDoStep
              capa={capa}
              actions={actions}
              factoryId={factoryId}
              editable={reviewer && capa.step === "do"}
              viewerName={viewerName}
              today={today}
            />
          </StepCard>

          <StepCard
            n={3}
            title="Effectiveness check"
            state={closed ? "done" : state(2)}
            summary={checkSummary}
            shown={shown.check}
            onToggle={() => setShown((s) => ({ ...s, check: !s.check }))}
            // A CAPA sent back to Do still shows the checks it has had.
            showLaterBody={checks.length > 0}
          >
            <CapaCheckStep
              capa={capa}
              checks={checks}
              factoryId={factoryId}
              editable={reviewer && capa.step === "check"}
              viewerName={viewerName}
              today={today}
            />
          </StepCard>

        </div>
        )}
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  state,
  summary,
  shown,
  onToggle,
  showLaterBody,
  children,
}: {
  n: number;
  title: string;
  state: CardState;
  summary: string;
  shown?: boolean;
  onToggle: () => void;
  showLaterBody?: boolean;
  children: React.ReactNode;
}) {
  const open = state === "current" || (state === "done" && shown) || (state === "later" && showLaterBody);
  return (
    <section
      className={cn(
        "rounded-2xl border",
        state === "current" ? "border-brand-line bg-surface shadow-soft" : "border-line bg-surface",
        state === "later" && !showLaterBody && "opacity-70",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5",
          open && "border-b border-line-soft",
        )}
      >
        <span className="min-w-0">
          <span className="font-semibold text-ink">
            {n} · {title}
          </span>
          <span className={cn("ml-2 text-sm", state === "done" ? "text-teal-deep" : "text-ink-4")}>
            {summary}
          </span>
        </span>
        {state === "done" && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={Boolean(shown)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            {shown ? "Hide" : "Show"}
            <ChevronDown className={cn("size-3.5 transition", shown && "rotate-180")} />
          </button>
        )}
      </div>
      {open && <div className="px-4 py-4 sm:px-5">{children}</div>}
    </section>
  );
}

/* ── History ──────────────────────────────────────────────────────────── */

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  owner_name: "CAPA owner",
  reason: "Why a CAPA",
  target_date: "Target date",
  effectiveness_criteria: "Effectiveness measure",
  check_mode: "When to check",
  check_why: "Why no dated check",
  verify_by: "Check date",
  checker_name: "Checked by",
};

const CHECK_MODE_LABEL: Record<string, string> = {
  dated: "On a date",
  at_implementation: "When the actions are done",
};

function isDateField(field: string | null) {
  return field === "verify_by" || field === "target_date" || Boolean(field?.endsWith("due date"));
}

function show(field: string | null, v: string | null): string | null {
  if (v === null) return null;
  if (field === "check_mode") return CHECK_MODE_LABEL[v] ?? v;
  if (isDateField(field) && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return v;
}

function historyRow(e: CapaAuditEntry): { what: string; from: string | null; to: string | null } {
  const kind = e.field ? ` (${e.field.toUpperCase()})` : "";
  switch (e.action) {
    case "created":
      return { what: "CAPA created", from: null, to: e.new_value };
    case "changed":
      return {
        what: FIELD_LABEL[e.field ?? ""] ?? e.field ?? "Changed",
        from: show(e.field, e.old_value),
        to: show(e.field, e.new_value),
      };
    case "plan_approved":
      return { what: "Signed: CAPA plan approved", from: null, to: null };
    case "action_added":
      return { what: `Action added${kind}`, from: null, to: e.new_value };
    case "action_removed":
      return { what: `Action removed from plan${kind}`, from: e.old_value, to: null };
    case "action_changed":
      return { what: `Action changed — ${e.field ?? ""}`, from: show(e.field, e.old_value), to: show(e.field, e.new_value) };
    case "action_done":
      return { what: `Action done${kind}`, from: null, to: e.new_value };
    case "check_effective":
      return { what: "Signed: effectiveness check — worked", from: null, to: null };
    case "check_not_effective":
      return { what: "Signed: effectiveness check — didn't work", from: null, to: null };
    case "case_linked":
      return { what: "Case linked", from: null, to: e.new_value };
    case "case_unlinked":
      return { what: "Case unlinked", from: e.old_value, to: null };
    default:
      return { what: e.action, from: e.old_value, to: e.new_value };
  }
}

/** Every change the database recorded on this CAPA, newest first. */
function CapaHistory({ factoryId, capaId }: { factoryId: string; capaId: string }) {
  const { data: entries = [], isPending } = useQuery({
    queryKey: capaKeys.audit(factoryId, capaId),
    queryFn: () => fetchCapaAudit(capaId),
  });

  return (
    <section>
      <h3 className="mb-4 flex items-baseline gap-2 text-base font-semibold text-ink">
        Audit trail
        <span className="text-sm font-normal text-ink-4">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </h3>
      {(
        <div>
          {isPending ? (
            <Loader2 className="size-5 animate-spin text-ink-5" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-ink-5">Nothing recorded yet.</p>
          ) : (
            <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[52rem] text-sm">
                <thead className="bg-sunken text-left text-xs text-ink-4">
                  <tr>
                    <th className="px-3.5 py-2 font-semibold">When</th>
                    <th className="px-3.5 py-2 font-semibold">Who</th>
                    <th className="px-3.5 py-2 font-semibold">What</th>
                    <th className="px-3.5 py-2 font-semibold">From</th>
                    <th className="px-3.5 py-2 font-semibold">To</th>
                    <th className="px-3.5 py-2 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {entries.map((e) => {
                    const r = historyRow(e);
                    return (
                      <tr key={e.id} className="align-top">
                        <td className="px-3.5 py-2.5 whitespace-nowrap text-ink-3 tabular-nums">
                          {formatDateTime(e.at)}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap text-ink-2">{e.actor_name ?? "—"}</td>
                        <td className="px-3.5 py-2.5 text-ink">{r.what}</td>
                        <td className="max-w-[16rem] px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere text-ink-4">
                          {r.from ?? ""}
                        </td>
                        <td className="max-w-[16rem] px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere text-ink">
                          {r.to ?? ""}
                        </td>
                        <td className="max-w-[18rem] px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere text-ink-4">
                          {e.reason ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
