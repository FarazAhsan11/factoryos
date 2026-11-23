"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useWatch } from "react-hook-form";
import { Check, CheckCircle2, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  capaCheckSchema,
  type CapaCheckValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaActionTable } from "@/components/factory/capa/capa-action-table";
import { CapaFiles, PickFiles, useCapaFiles } from "@/components/factory/capa/capa-files";
import { CapaPlanEditor, PlanGroupHead } from "@/components/factory/capa/capa-plan-editor";
import { CapaStepper } from "@/components/factory/capa/capa-stepper";
import { WithdrawCapa } from "@/components/factory/capa/capa-withdraw";
import {
  AREA,
  CONTROL,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { DateField } from "@/components/ui/date-picker";
import { canReview } from "@/lib/factory/action-queries";
import { deleteCapaFile, uploadCapaFiles } from "@/lib/factory/capa-attachment-queries";
import {
  approveCapaPlan,
  capaKeys,
  capaNext,
  checkText,
  draftChanged,
  draftMissing,
  fetchCapaActions,
  fetchCapaAudit,
  fetchCapaChecks,
  fetchCapas,
  planDraftOf,
  recordCapaCheck,
  renameCapa,
  savePlanDraft,
  STEP_INDEX,
  type Capa,
  type CapaAction,
  type CapaAuditEntry,
  type CapaCase,
  type CapaCheck,
  type PlanDraft,
} from "@/lib/factory/capa-queries";
import type { FactoryRole } from "@/lib/factory/context";
import { addDays, formatDateTime, todayKey } from "@/lib/factory/dates";
import {
  approvedRootCause,
  deviationKeys,
  fetchDeviations,
  investigationPending,
} from "@/lib/factory/deviation-queries";
import { useForm } from "@/lib/use-form";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

/** Where a case opens: a deviation has a page, an NCR or complaint a dialog. */
export function caseHref(slug: string, k: Pick<CapaCase, "id" | "type">): string {
  if (k.type === "planned" || k.type === "unplanned") {
    return `/factory/${slug}/deviations/${k.id}`;
  }
  // An NCR's page; an older NCR is sent on from there to its dialog.
  if (k.type === "ncr") return `/factory/${slug}/deviations/${k.id}?tab=ncr`;
  return `/factory/${slug}/deviations/${k.id}?tab=complaints`;
}

/** Whole days from `today` to `date` (both `YYYY-MM-DD`). */
function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

type StepState = "done" | "cur" | "later";

/**
 * One CAPA, on a page of its own — the reference QMS's (qms-v8): the title,
 * where it came from and who raised it (renamable), any follow-up link, the
 * stepper (Plan → Implement → Verify → Closed) and what is due next; the root
 * cause; then the three steps one under another — Plan (written, then
 * approved), Implement (each action marked done with its evidence) and
 * Verify (effective, or not effective with the next check date). Files and
 * history fold away underneath. A CAPA still in Plan can be withdrawn (0075).
 */
export function CapaPage({
  factoryId,
  slug,
  capaId,
  role,
  viewerName,
  userId,
}: {
  factoryId: string;
  slug: string;
  capaId: string;
  role: FactoryRole;
  viewerName: string;
  userId: string;
}) {
  const today = useRenderClock(todayKey);
  const { data: capas, isPending, isError, error } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });
  const { data: actions = [], isPending: actionsPending } = useQuery({
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
  const idx = STEP_INDEX[capa.step];
  const closed = capa.step === "closed";
  const withdrawn = capa.step === "withdrawn";
  // Neither is edited again.
  const frozen = closed || withdrawn;
  const state = (i: number): StepState => (i < idx ? "done" : i === idx ? "cur" : "later");
  const next = capaNext(capa);
  const done = actions.filter((a) => a.closed_date).length;
  const total = actions.length;
  const lastCheck = checks.at(-1) ?? null;
  const caseRows = capa.cases.map((k) => ({ k, d: cases.find((x) => x.id === k.id) ?? null }));
  const roots = caseRows.map(({ k, d }) => ({ k, root: d?.root_cause ?? null }));
  // One root cause, the case's (0075): an approved one wins over the CAPA's
  // draft, and the plan waits for every pending investigation.
  const approvedRoots = caseRows
    .map(({ k, d }) => ({ k, root: d ? approvedRootCause(d) : null }))
    .filter((r): r is { k: CapaCase; root: string } => r.root !== null);
  const pendingInv = caseRows.filter(({ d }) => d && investigationPending(d)).map(({ k }) => k.deviation_no);
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const rootDrift =
    approvedRoots.length > 0 &&
    Boolean(capa.root_cause?.trim()) &&
    !approvedRoots.some((r) => norm(r.root) === norm(capa.root_cause!));
  const nextOverdue = !frozen && next.date !== null && next.date < today;

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
        <header className="grid gap-x-10 gap-y-4 px-5 pt-5 sm:px-7 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <CapaTitle capa={capa} canRename={reviewer && !frozen} factoryId={factoryId} />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1 text-sm leading-relaxed text-ink-4">
              <span className="font-mono">{capa.capa_no}</span>
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
              <span>
                · raised by {capa.created_by_name ?? "—"} on {formatDate(capa.created_at)}
              </span>
            </p>
            {(capa.recurrence_of || capa.recurred_by.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {capa.recurrence_of && capa.recurrence_of_no && (
                  <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn-deep">
                    Follow-up of closed{" "}
                    <Link
                      href={`/factory/${slug}/deviations/capa/${capa.recurrence_of}`}
                      className="font-mono underline"
                    >
                      {capa.recurrence_of_no}
                    </Link>
                  </span>
                )}
                {capa.recurred_by.map((r) => (
                  <span
                    key={r.id}
                    className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger-deep"
                  >
                    Problem recurred — follow-up{" "}
                    <Link href={`/factory/${slug}/deviations/capa/${r.id}`} className="font-mono underline">
                      {r.capa_no}
                    </Link>
                    {r.case_no && ` (${r.case_no})`}
                  </span>
                ))}
              </div>
            )}
            {!withdrawn && (
              <div className="mt-4">
                <CapaStepper step={capa.step} />
              </div>
            )}
          </div>
          <div className="min-w-[9rem] lg:text-right">
            {next.date ? (
              <>
                <p className={cn("text-base font-semibold whitespace-nowrap text-ink", nextOverdue && "text-danger-deep")}>
                  {formatDate(next.date)}
                </p>
                <p className="mt-0.5 text-xs text-ink-5">{next.text}</p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-ink">{next.text}</p>
                <p className="mt-0.5 text-xs text-ink-5">Status</p>
              </>
            )}
          </div>
        </header>

        <div className="space-y-4 px-5 py-6 sm:px-7">
          <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
            <span className="text-ink-4">Root cause:</span>{" "}
            {approvedRoots.length > 0 ? (
              approvedRoots.map(({ k, root }, i) => (
                <span key={k.id}>
                  {i > 0 && " · "}
                  <Link href={caseHref(slug, k)} className="font-mono text-brand hover:underline">
                    {k.deviation_no}
                  </Link>{" "}
                  {root}
                </span>
              ))
            ) : capa.root_cause ? (
              <>
                {capa.root_cause}
                {/* A withdrawn CAPA has no case left to name. */}
                {capa.cases.length > 0 && (
                  <span className="text-ink-5">
                    {" "}
                    · {capa.cases.map((k) => k.deviation_no).join(", ")}
                    {pendingInv.length > 0 && " — draft: the investigation is not approved yet"}
                  </span>
                )}
              </>
            ) : roots.length === 0 ? (
              "No linked case"
            ) : (
              roots.map(({ k, root }, i) => (
                <span key={k.id}>
                  {i > 0 && " · "}
                  <Link href={caseHref(slug, k)} className="font-mono text-brand hover:underline">
                    {k.deviation_no}
                  </Link>{" "}
                  {root ?? <span className="text-ink-5">root cause not recorded yet</span>}
                </span>
              ))
            )}
          </p>

          {rootDrift && !frozen && (
            <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
              <span className="font-semibold">Root cause changed since this plan was drafted.</span> It
              was planned against “{capa.root_cause}”. Check the actions still fit.
            </p>
          )}

          {withdrawn && (
            <p className="rounded-xl border border-line bg-sunken-2 px-4 py-3 text-sm text-ink-3">
              <span className="font-semibold text-ink">Withdrawn</span> by {capa.withdrawn_by_name} on{" "}
              {formatDate(capa.withdrawn_at)} — {capa.withdraw_reason}. Kept as a
              record; its cases went back to “Is a CAPA required?”.
            </p>
          )}

          {closed && (
            <p className="flex items-start gap-2 rounded-xl border border-teal-line bg-teal-soft px-4 py-3 text-sm text-teal-deep">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                Closed — effective. {lastCheck?.findings ?? capa.verification} (
                {lastCheck?.checked_by_name ?? capa.verified_by_name},{" "}
                {formatDate(lastCheck?.checked_at ?? capa.verified_at ?? null)})
              </span>
            </p>
          )}

          <StepSection n={0} title="Plan" state={withdrawn ? "later" : state(0)}>
            {withdrawn ? (
              <PlanReadOnly capa={capa} actions={actions} factoryId={factoryId} viewerName={viewerName} userId={userId} today={today} note="Withdrawn before approval." />
            ) : capa.step === "plan" ? (
              reviewer ? (
                actionsPending ? (
                  <Loader2 className="size-5 animate-spin text-ink-5" />
                ) : (
                  <PlanStep
                    // Re-seeded when the saved plan changes underneath it.
                    key={planKey(capa, actions)}
                    capa={capa}
                    actions={actions}
                    factoryId={factoryId}
                    pendingInv={pendingInv}
                    viewerName={viewerName}
                    today={today}
                  />
                )
              ) : (
                <PlanReadOnly capa={capa} actions={actions} factoryId={factoryId} viewerName={viewerName} userId={userId} today={today} />
              )
            ) : (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-teal-deep">
                <Check className="size-4" />
                Approved by {capa.plan_approved_by_name} on{" "}
                {formatDate(capa.plan_approved_at)}
                {capa.plan_approval_note && (
                  <span className="text-ink-3"> — “{capa.plan_approval_note}”</span>
                )}
              </p>
            )}
          </StepSection>

          {!withdrawn && (
          <StepSection
            n={1}
            title="Implement"
            sub={capa.step === "plan" ? "Starts when the plan is approved" : undefined}
            state={state(1)}
          >
            {capa.step !== "plan" && (
              <div className="space-y-5">
                {capa.reopened && (
                  <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
                    Not effective at the last check. Add new actions — the effectiveness check
                    is repeated on {formatDate(capa.verify_by)}.
                  </p>
                )}
                <div>
                  <div className="flex justify-between text-xs text-ink-4">
                    <span>
                      {done} of {total} done
                    </span>
                    {capa.step === "do" && capa.next_due && (
                      <span className={cn(capa.next_due < today && "font-semibold text-danger-deep")}>
                        Next target {formatDate(capa.next_due)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken-2">
                    <div
                      className="h-full rounded-full bg-teal transition-[width]"
                      style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                {(["ca", "pa"] as const).map((kind) => (
                  <CapaActionTable
                    key={kind}
                    capa={capa}
                    actions={actions}
                    kind={kind}
                    mode="impl"
                    factoryId={factoryId}
                    canDo={reviewer && !closed}
                    canAdd={reviewer && !closed}
                    viewerName={viewerName}
                    userId={userId}
                    today={today}
                  />
                ))}
              </div>
            )}
          </StepSection>
          )}

          {!withdrawn && (
          <StepSection
            n={2}
            title="Verify"
            sub={
              closed || capa.step === "check"
                ? undefined
                : capa.step === "plan"
                  ? "After all actions are complete"
                  : "Opens when every action is complete"
            }
            state={closed ? "done" : state(2)}
          >
            {capa.step !== "plan" && (
              <VerifyStep
                capa={capa}
                checks={checks}
                factoryId={factoryId}
                canCheck={reviewer && capa.step === "check"}
                viewerName={viewerName}
                userId={userId}
                today={today}
              />
            )}
          </StepSection>
          )}

          <FilesAndHistory
            factoryId={factoryId}
            capaId={capa.id}
            userId={userId}
            userName={viewerName}
            canAttach={reviewer && !frozen}
          />
        </div>
      </div>
    </div>
  );
}

/** What the saved plan is, as a key — the editor starts again when it changes. */
function planKey(c: Capa, actions: CapaAction[]): string {
  return JSON.stringify([
    c.effectiveness_criteria,
    c.check_mode,
    c.verify_by,
    c.checker_name,
    actions.map((a) => [a.id, a.kind, a.description, a.owner_name, a.target_date]),
  ]);
}

/** The title, and Rename — useful when the CAPA covers several cases. */
function CapaTitle({
  capa,
  canRename,
  factoryId,
}: {
  capa: Capa;
  canRename: boolean;
  factoryId: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(capa.title);
  const save = useMutation({
    mutationFn: () => renameCapa(capa.id, title),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("CAPA renamed.");
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim().length < 3) {
            toast.error("Give the CAPA a name — at least a few words.");
            return;
          }
          save.mutate();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          aria-label="CAPA name"
          className={cn(CONTROL, "max-w-xl text-base font-semibold")}
        />
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setTitle(capa.title);
            setEditing(false);
          }}
          className={SECONDARY_BUTTON}
        >
          Cancel
        </button>
      </form>
    );
  }
  return (
    <h1 className="flex flex-wrap items-baseline gap-x-3 text-xl font-semibold tracking-tight break-words text-ink sm:text-2xl">
      {capa.title}
      {canRename && (
        <button
          type="button"
          onClick={() => {
            setTitle(capa.title);
            setEditing(true);
          }}
          className="text-sm font-medium tracking-normal text-brand hover:underline"
        >
          Rename
        </button>
      )}
    </h1>
  );
}

function StepSection({
  n,
  title,
  sub,
  state,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border px-4 py-4 sm:px-5",
        state === "cur" ? "border-brand-line bg-surface shadow-soft" : "border-line bg-surface",
        state === "later" && "opacity-70",
      )}
    >
      <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base font-semibold text-ink">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
            state === "done"
              ? "bg-teal-soft text-teal-deep"
              : state === "cur"
                ? "bg-brand text-white"
                : "border border-line-strong text-ink-5",
          )}
        >
          {state === "done" ? <Check className="size-3.5" /> : n + 1}
        </span>
        {title}
        {sub && <span className="text-sm font-normal text-ink-4">{sub}</span>}
      </h3>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/* ── 1 · Plan ─────────────────────────────────────────────────────────── */

function PlanStep({
  capa,
  actions,
  factoryId,
  pendingInv,
  viewerName,
  today,
}: {
  capa: Capa;
  actions: CapaAction[];
  factoryId: string;
  /** Cases whose investigation must be approved first (0075). */
  pendingInv: string[];
  viewerName: string;
  today: string;
}) {
  const queryClient = useQueryClient();
  const saved = planDraftOf(capa, actions);
  const [draft, setDraft] = useState<PlanDraft>(saved);
  const [note, setNote] = useState("");
  const changed = draftChanged(draft, saved);
  const missing = [
    ...draftMissing(draft),
    ...(pendingInv.length > 0 ? [`investigation approved on ${pendingInv.join(", ")}`] : []),
  ];

  const refresh = () => queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const save = useMutation({
    mutationFn: () => savePlanDraft(factoryId, capa, actions, draft),
    onSuccess: async () => {
      await refresh();
      toast.success("Plan saved.");
    },
    onError: async (e: Error) => {
      // Part of it may have been written; show what is saved.
      await refresh();
      toast.error(e.message);
    },
  });

  const approve = useMutation({
    mutationFn: () => {
      // Whoever raised the plan should not approve it. Said, not enforced —
      // for now, so it can be tested with one login.
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (norm(viewerName) && norm(viewerName) === norm(capa.created_by_name)) {
        toast.warning(`You raised ${capa.capa_no} — another QA approver should normally approve its plan.`);
      }
      return approveCapaPlan(capa.id, viewerName, note);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Plan approved — actions can start.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <CapaPlanEditor value={draft} onChange={setDraft} today={today} />
      <div className="space-y-3 border-t border-line-soft pt-4">
        {changed ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className={PRIMARY_BUTTON}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save plan
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => setDraft(saved)}
              className={SECONDARY_BUTTON}
            >
              Discard changes
            </button>
            <span className="text-[0.8125rem] text-ink-4">
              {missing.length > 0 ? `Still needed: ${missing.join(", ")}.` : "Save the plan, then approve it."}
            </span>
          </div>
        ) : missing.length > 0 ? (
          <p className="text-[0.8125rem] text-ink-4">Still needed: {missing.join(", ")}.</p>
        ) : (
          <>
            <Field label="Approval comment" htmlFor="cp-note" note="(optional)" className="max-w-xl">
              <input id="cp-note" value={note} onChange={(e) => setNote(e.target.value)} className={CONTROL} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={approve.isPending}
                onClick={() => approve.mutate()}
                className={PRIMARY_BUTTON}
              >
                {approve.isPending && <Loader2 className="size-4 animate-spin" />}
                Approve plan
              </button>
              <span className="text-[0.8125rem] text-ink-4">
                Raised by {capa.created_by_name ?? "—"}. Actions start once the plan is approved.
                Signing as {viewerName}.
              </span>
            </div>
          </>
        )}
        {pendingInv.length > 0 && (
          <p className="text-[0.8125rem] text-ink-4">
            The plan is approved against the case&rsquo;s approved root cause — save it now, approve
            it once QA has approved the investigation.
          </p>
        )}
        <WithdrawCapa capa={capa} factoryId={factoryId} viewerName={viewerName} />
      </div>
    </div>
  );
}

/** The plan for someone below supervisor, while it is being written. */
function PlanReadOnly({
  capa,
  actions,
  factoryId,
  viewerName,
  userId,
  today,
  note = "Waiting for a QA approver.",
}: {
  capa: Capa;
  actions: CapaAction[];
  factoryId: string;
  viewerName: string;
  userId: string;
  today: string;
  note?: string;
}) {
  return (
    <div className="space-y-5">
      {(["ca", "pa"] as const).map((kind) => (
        <CapaActionTable
          key={kind}
          capa={capa}
          actions={actions}
          kind={kind}
          mode="ro"
          factoryId={factoryId}
          canDo={false}
          canAdd={false}
          viewerName={viewerName}
          userId={userId}
          today={today}
        />
      ))}
      <section className="space-y-2.5">
        <PlanGroupHead title="Effectiveness check" />
        <CheckFacts capa={capa} />
      </section>
      <p className="text-[0.8125rem] text-ink-4">{note}</p>
    </div>
  );
}

function CheckFacts({ capa, criteriaOnly }: { capa: Capa; criteriaOnly?: boolean }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-ink-4">Effectiveness criteria</dt>
      <dd className="text-ink">{capa.effectiveness_criteria ?? "—"}</dd>
      {!criteriaOnly && (
        <>
          <dt className="text-ink-4">Check due</dt>
          <dd className="text-ink">{checkText(capa, formatDate)}</dd>
          <dt className="text-ink-4">Verifier</dt>
          <dd className="text-ink">{capa.checker_name ?? "—"}</dd>
        </>
      )}
    </dl>
  );
}

/* ── 3 · Verify ───────────────────────────────────────────────────────── */

function VerifyStep({
  capa,
  checks,
  factoryId,
  canCheck,
  viewerName,
  userId,
  today,
}: {
  capa: Capa;
  checks: CapaCheck[];
  factoryId: string;
  canCheck: boolean;
  viewerName: string;
  userId: string;
  today: string;
}) {
  const [verifying, setVerifying] = useState(false);
  const atCheck = capa.step === "check";
  const onCompletion = capa.check_mode === "at_implementation";
  const n = !onCompletion && capa.verify_by ? daysUntil(today, capa.verify_by) : null;

  return (
    <div className="space-y-4">
      {atCheck && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-sunken px-4 py-3.5">
          <span>
            {onCompletion ? (
              <>
                <span className="block text-sm font-semibold text-ink">Ready to verify</span>
                <span className="block text-xs text-ink-4">All actions complete.</span>
              </>
            ) : (
              <>
                <span className={cn("block text-sm font-semibold", n !== null && n < 0 ? "text-danger-deep" : "text-ink")}>
                  {n === null
                    ? "Check due"
                    : n > 0
                      ? `Check due in ${n} day${n === 1 ? "" : "s"}`
                      : n === 0
                        ? "Check due today"
                        : `Check ${-n} day${n === -1 ? "" : "s"} overdue`}
                </span>
                <span className="block text-xs text-ink-4">
                  {formatDate(capa.verify_by)} · {capa.checker_name ?? "QA"}
                </span>
              </>
            )}
          </span>
          {canCheck && !verifying ? (
            <button
              type="button"
              onClick={() => setVerifying(true)}
              className={n !== null && n > 0 ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            >
              {n !== null && n > 0 ? "Verify early" : "Verify effectiveness"}
            </button>
          ) : !canCheck ? (
            <span className="text-xs text-ink-4">{capa.checker_name ?? "QA"} verifies it</span>
          ) : null}
        </div>
      )}

      {verifying ? (
        <VerifyForm
          capa={capa}
          early={n !== null && n > 0}
          factoryId={factoryId}
          viewerName={viewerName}
          userId={userId}
          today={today}
          onDone={() => setVerifying(false)}
        />
      ) : (
        <CheckFacts capa={capa} criteriaOnly={atCheck} />
      )}

      {checks.length > 0 && <CheckList checks={checks} />}
    </div>
  );
}

function CheckList({ checks }: { checks: CapaCheck[] }) {
  return (
    <ul className="space-y-2.5 border-t border-line-soft pt-3">
      {checks.map((k) => {
        const worked = k.result === "effective";
        return (
          <li key={k.id} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                worked ? "bg-teal-soft text-teal-deep" : "bg-danger-soft text-danger-deep",
              )}
            >
              {worked ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-ink">{worked ? "Effective" : "Not effective"}</span>
              <span className="wrap-anywhere text-ink-2"> — {k.findings}</span>
              <span className="block text-xs text-ink-4">
                {k.checked_by_name} · {formatDateTime(k.checked_at)}
                {k.early_reason && ` · ${k.early_reason}`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function VerifyForm({
  capa,
  early,
  factoryId,
  viewerName,
  userId,
  today,
  onDone,
}: {
  capa: Capa;
  early: boolean;
  factoryId: string;
  viewerName: string;
  userId: string;
  today: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const form = useForm<CapaCheckValues>({
    resolver: zodResolver(capaCheckSchema),
    defaultValues: { result: "effective", findings: "", nextCheck: addDays(today, 90) },
  });
  const errors = form.formState.errors;
  const result = useWatch({ control: form.control, name: "result" });

  const save = useMutation({
    mutationFn: async (v: CapaCheckValues) => {
      const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
      if (norm(viewerName) && norm(viewerName) === norm(capa.created_by_name)) {
        toast.warning(`You raised ${capa.capa_no} — the check should normally be someone else's.`);
      }
      // The files first, while the CAPA is still open (Effective closes it);
      // if the check is refused they are removed again.
      const uploaded = await uploadCapaFiles(files, {
        factoryId,
        capaId: capa.id,
        section: "check",
        uploadedBy: userId,
        uploadedByName: viewerName,
      });
      try {
        await recordCapaCheck(
          capa.id,
          v.result === "effective",
          v.findings,
          v.result === "effective" ? null : v.nextCheck,
          viewerName,
        );
      } catch (e) {
        await Promise.all(uploaded.map((f) => deleteCapaFile(f).catch(() => {})));
        throw e;
      }
    },
    onSuccess: async (_, v) => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(
        v.result === "effective"
          ? `${capa.capa_no} closed — effective.`
          : "Recorded as not effective — add new actions.",
      );
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3.5 rounded-xl border border-brand-line bg-brand-tint/40 p-4"
    >
      <p className="text-sm font-semibold text-ink">Verify effectiveness — {capa.capa_no}</p>
      <div className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm">
        <span className="block text-xs font-semibold text-ink-4">Was this met?</span>
        <span className="text-ink">{capa.effectiveness_criteria}</span>
      </div>
      {early && (
        <p className="text-[0.8125rem] text-ink-4">
          Planned for {formatDate(capa.verify_by)}. Verify now only if the criteria can already be
          judged.
        </p>
      )}
      <Field label="Outcome" required>
        <Controller
          name="result"
          control={form.control}
          render={({ field }) => (
            <div role="radiogroup" aria-label="Outcome" className="grid max-w-md gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "effective", label: "Effective" },
                  { value: "not_effective", label: "Not effective" },
                ] as const
              ).map((o) => {
                const active = field.value === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(o.value)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                      active
                        ? o.value === "effective"
                          ? "border-teal bg-teal-soft text-teal-deep ring-2 ring-teal/20"
                          : "border-danger bg-danger-soft text-danger-deep ring-2 ring-danger/20"
                        : "border-line bg-surface text-ink hover:border-line-strong",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
        />
      </Field>
      <Field label="Findings" htmlFor="ck-findings" required error={errors.findings?.message}>
        <textarea
          id="ck-findings"
          rows={4}
          placeholder="What you checked and what you found, e.g. Batches 46701–46712 reviewed: 0 dented capsules"
          aria-invalid={Boolean(errors.findings)}
          className={AREA}
          {...form.register("findings")}
        />
      </Field>
      <PickFiles
        files={files}
        onChange={setFiles}
        disabled={save.isPending}
        label="Evidence file — a trend report, audit or record"
      />
      {result === "not_effective" && (
        <Field
          label="Next effectiveness check due"
          required
          hint="New actions are added next; the check is repeated on this date."
          error={errors.nextCheck?.message}
          className="max-w-xs"
        >
          <Controller
            name="nextCheck"
            control={form.control}
            render={({ field }) => (
              <DateField value={field.value} onChange={field.onChange} min={today} ariaLabel="Next check due" />
            )}
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Sign
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <span className="text-xs text-ink-4">
          Signing as {viewerName}. Effective closes the CAPA; not effective sends it back to Implement.
        </span>
      </div>
    </form>
  );
}

/* ── Files and history ────────────────────────────────────────────────── */

/** The CAPA's files (0075) above its history, folded away. */
function FilesAndHistory({
  factoryId,
  capaId,
  userId,
  userName,
  canAttach,
}: {
  factoryId: string;
  capaId: string;
  userId: string;
  userName: string;
  canAttach: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: entries = [] } = useQuery({
    queryKey: capaKeys.audit(factoryId, capaId),
    queryFn: () => fetchCapaAudit(capaId),
  });
  const { data: files = [] } = useCapaFiles(factoryId, capaId);
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-ink sm:px-5"
      >
        <span>
          Files and history{" "}
          <span className="font-normal text-ink-4">
            · {files.length} {files.length === 1 ? "file" : "files"} · {entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"}
          </span>
        </span>
        <ChevronDown className={cn("size-4 text-ink-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-line-soft px-4 py-4 sm:px-5">
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-ink">Files</p>
            <CapaFiles
              factoryId={factoryId}
              capaId={capaId}
              userId={userId}
              userName={userName}
              canAttach={canAttach}
            />
          </div>
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-ink">History</p>
            <CapaHistory entries={entries} />
          </div>
        </div>
      )}
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: "CAPA title",
  root_cause: "Root cause",
  owner_name: "CAPA owner",
  reason: "Why a CAPA",
  target_date: "Target date",
  effectiveness_criteria: "Effectiveness criteria",
  check_mode: "Verify on completion",
  check_why: "Reason to verify on completion",
  verify_by: "Check due",
  checker_name: "Verifier",
};

const FILE_SECTION: Record<string, string> = {
  capa: "CAPA",
  action: "action evidence",
  check: "effectiveness check",
};

const CHECK_MODE_LABEL: Record<string, string> = {
  dated: "No",
  at_implementation: "Yes",
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
      return { what: "Signed: Effective", from: null, to: null };
    case "check_not_effective":
      return { what: "Signed: Not effective", from: null, to: null };
    case "case_linked":
      return { what: "Case added", from: null, to: e.new_value };
    case "case_unlinked":
      return { what: "Case removed", from: e.old_value, to: null };
    case "withdrawn":
      return { what: "Signed: CAPA withdrawn", from: null, to: null };
    case "file_attached":
      return { what: `File attached${e.field ? ` — ${FILE_SECTION[e.field] ?? e.field}` : ""}`, from: null, to: e.new_value };
    case "file_removed":
      return { what: `File removed${e.field ? ` — ${FILE_SECTION[e.field] ?? e.field}` : ""}`, from: e.old_value, to: null };
    default:
      return { what: e.action, from: e.old_value, to: e.new_value };
  }
}

/** Every change the database recorded on this CAPA, newest first. */
function CapaHistory({ entries }: { entries: CapaAuditEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-ink-5">Nothing recorded yet.</p>;
  return (
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
                  {/* 0073's trigger prefixes the early note; since 0074 the
                      note already says it ("Verified before the planned date"). */}
                  {(e.reason ?? "").replace(" · checked early because: Verified before", " · Verified before")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
