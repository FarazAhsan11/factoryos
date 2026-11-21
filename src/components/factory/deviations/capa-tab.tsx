"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  capaNotNeededSchema,
  correctionSchema,
  type CapaNotNeededValues,
  type CorrectionValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaPlanEditor } from "@/components/factory/capa/capa-plan-editor";
import { CapaStepper } from "@/components/factory/capa/capa-stepper";
import { CaseAttachments } from "@/components/factory/deviations/case-attachments";
import {
  AREA,
  CONTROL,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { DateField } from "@/components/ui/date-picker";
import { WorkerSelect } from "@/components/factory/worker-select";
import {
  capaKeys,
  capaNext,
  createCapaPlan,
  draftMissing,
  fetchCapaActions,
  fetchCapas,
  newPlanDraft,
  setCapaRootCause,
  stepLabel,
  type Capa,
  type PlanDraft,
} from "@/lib/factory/capa-queries";
import {
  addCorrection,
  correctionKeys,
  fetchCorrections,
  removeCorrection,
} from "@/lib/factory/correction-queries";
import { todayKey } from "@/lib/factory/dates";
import {
  deviationKeys,
  isLegacyRisk,
  linkCapa,
  saveCapaDecision,
  unlinkCapa,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useForm } from "@/lib/use-form";
import { useRenderClock } from "@/lib/use-render-clock";
import { cn } from "@/lib/utils";

const isDeviationType = (d: Deviation) => d.type === "planned" || d.type === "unplanned";

/** Recurring at the initial assessment (likelihood 3, 0068): a CAPA is required. */
function isRecurring(d: Deviation): boolean {
  return isDeviationType(d) && d.likelihood === 3 && !isLegacyRisk(d) && Boolean(d.assessed_at);
}

/**
 * The case's Actions tab, as the reference QMS (qms-v8) lays it out:
 *
 *   · **Corrections** — what was done to fix this case (what, who, date).
 *   · **CAPA** — "Is a CAPA required?" Yes / No. No asks the justification.
 *     Yes offers a **New CAPA** (its whole plan, written here and sent for
 *     approval) or **Add to an existing CAPA** (join an open one, or start a
 *     follow-up of a closed one when the problem came back). Once linked, the
 *     CAPA's card: where it stands, what is next, and the way to it.
 *   · **Attachments**.
 *
 * `viewerName` and `userId` are absent where the tab is only read (the
 * printed report).
 */
export function CapaTab({
  deviation: d,
  factoryId,
  readOnly,
  viewerName = "",
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
  viewerName?: string;
  userId?: string;
}) {
  const open = d.status === "open";
  const ed = !readOnly && open;
  return (
    <div className="space-y-8">
      {isDeviationType(d) && !d.assessed_at && open && (
        <p className="rounded-xl border border-line-soft bg-sunken px-4 py-3 text-sm text-ink-3">
          Actions are agreed after the initial assessment
          {d.investigation_required !== false && " and the investigation approval"}. Corrections
          done on the day can be recorded now.
        </p>
      )}
      <Corrections deviation={d} factoryId={factoryId} canEdit={ed && Boolean(userId)} userId={userId ?? ""} />
      <CapaSection deviation={d} factoryId={factoryId} canEdit={ed} />
      {isDeviationType(d) && (
        <CaseAttachments
          factoryId={factoryId}
          deviationId={d.id}
          section="actions"
          userId={userId ?? ""}
          userName={viewerName}
          canAttach={ed && Boolean(userId)}
        />
      )}
    </div>
  );
}

/* ── Corrections ──────────────────────────────────────────────────────── */

function Corrections({
  deviation: d,
  factoryId,
  canEdit,
  userId,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: rows = [], isPending } = useQuery({
    queryKey: correctionKeys.forCase(factoryId, d.id),
    queryFn: () => fetchCorrections(d.id),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCorrection(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Correction removed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
        Corrections
        <span className="text-sm font-normal text-ink-4">What was done to fix this case</span>
      </h3>
      {isPending ? (
        <Loader2 className="size-4 animate-spin text-ink-5" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-5">None recorded.</p>
      ) : (
        <div className="scrollbar-slim overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-sunken text-left text-xs text-ink-4">
              <tr>
                <th className="px-3.5 py-2 font-semibold">What was done</th>
                <th className="w-[12rem] px-3.5 py-2 font-semibold">Who</th>
                <th className="w-[9rem] px-3.5 py-2 font-semibold">Date</th>
                {canEdit && <th className="w-[6rem] px-3.5 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft bg-surface">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3.5 py-2.5 whitespace-pre-wrap wrap-anywhere text-ink">{r.what}</td>
                  <td className="px-3.5 py-2.5 text-ink-2">{r.who}</td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap text-ink-3">{formatDate(r.done_on)}</td>
                  {canEdit && (
                    <td className="px-3.5 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(r.id)}
                        className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit &&
        (adding ? (
          <CorrectionForm
            deviation={d}
            factoryId={factoryId}
            userId={userId}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand"
          >
            <Plus className="size-4" />
            Add correction
          </button>
        ))}
    </section>
  );
}

function CorrectionForm({
  deviation: d,
  factoryId,
  userId,
  onDone,
}: {
  deviation: Deviation;
  factoryId: string;
  userId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const today = useRenderClock(todayKey);
  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CorrectionValues>({
    resolver: zodResolver(correctionSchema),
    // Who did it is picked, not assumed to be whoever is recording it.
    defaultValues: { what: "", who: "", doneOn: today },
  });
  const errors = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: CorrectionValues) => addCorrection(factoryId, d.id, userId, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Correction added.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-xl border border-line bg-sunken p-4"
    >
      <p className="text-sm font-semibold text-ink">Add correction</p>
      <Field label="What was done" htmlFor="corr-what" required error={errors.what?.message}>
        <textarea
          id="corr-what"
          rows={2}
          autoFocus
          placeholder="e.g. 240 bottles relabelled and re-inspected"
          className={AREA}
          {...form.register("what")}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who" required error={errors.who?.message}>
          <Controller
            name="who"
            control={form.control}
            render={({ field }) => (
              <WorkerSelect value={field.value} onChange={field.onChange} workers={workers} ariaLabel="Who" />
            )}
          />
        </Field>
        <Field label="Date done" required error={errors.doneOn?.message}>
          <Controller
            name="doneOn"
            control={form.control}
            render={({ field }) => (
              <DateField value={field.value} onChange={field.onChange} max={today} ariaLabel="Date done" />
            )}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Add
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── CAPA ─────────────────────────────────────────────────────────────── */

type Mode = "new" | "link" | null;

function CapaSection({
  deviation: d,
  factoryId,
  canEdit,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
}) {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const { data: capas = [], isPending } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });
  const linked = capas.find((c) => c.id === d.capa_id) ?? null;
  const recurring = isRecurring(d);
  const invPending =
    isDeviationType(d) &&
    d.investigation_required !== false &&
    !d.investigation_approved_at &&
    d.status === "open";

  // "No" shows its justification before anything is saved.
  const [answer, setAnswer] = useState<"yes" | "no" | null>(
    d.capa_needed === null ? null : d.capa_needed ? "yes" : "no",
  );
  const [mode, setMode] = useState<Mode>(null);
  const [followUpOf, setFollowUpOf] = useState<Capa | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });

  const sayYes = useMutation({
    mutationFn: () => saveCapaDecision(d.id, true, ""),
    onSuccess: refresh,
    onError: (e: Error) => {
      setAnswer(d.capa_needed === null ? null : d.capa_needed ? "yes" : "no");
      toast.error(e.message);
    },
  });

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold text-ink">CAPA</h3>
      {invPending && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
          The investigation is not approved yet. Decide on a CAPA once QA has approved the root
          cause — or, to start a CAPA now, enter its root cause in the New CAPA form.
        </p>
      )}
      {recurring && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
          Recurring problem (likelihood 3): a CAPA is required.
        </p>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-ink-3">Is a CAPA required?</p>
        <div role="radiogroup" aria-label="Is a CAPA required?" className="inline-flex rounded-xl border border-line bg-surface p-1">
          {(["yes", "no"] as const).map((v) => {
            const active = answer === v;
            // Once a CAPA's plan is approved, the plan was approved for this
            // case too: the answer is fixed. Before that, No takes the case
            // off the CAPA.
            const locked = Boolean(d.capa_id) && !(linked && linked.step === "plan");
            const disabled =
              !canEdit || locked || sayYes.isPending || (v === "no" && recurring);
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                title={
                  v === "no" && recurring
                    ? "A recurring problem needs a CAPA"
                    : locked && linked
                      ? `${linked.capa_no}'s plan is approved — the answer is fixed`
                      : undefined
                }
                onClick={() => {
                  setAnswer(v);
                  if (v === "yes" && d.capa_needed !== true) sayYes.mutate();
                }}
                className={cn(
                  "h-8 min-w-[4.5rem] rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed",
                  active ? "bg-brand text-white shadow-soft" : "text-ink-3 hover:text-ink disabled:opacity-50",
                )}
              >
                {v === "yes" ? "Yes" : "No"}
              </button>
            );
          })}
        </div>
      </div>

      {answer === "no" && (
        <NotNeeded
          deviation={d}
          factoryId={factoryId}
          canEdit={canEdit}
          linkedNo={d.capa_id ? (linked?.capa_no ?? "the CAPA") : null}
          onCancel={() => setAnswer(d.capa_needed === null ? null : d.capa_needed ? "yes" : "no")}
        />
      )}

      {answer === "yes" &&
        (d.capa_id ? (
          linked ? (
            <LinkedCard capa={linked} deviation={d} slug={slug} canEdit={canEdit} factoryId={factoryId} />
          ) : isPending ? (
            <Loader2 className="size-5 animate-spin text-ink-5" />
          ) : (
            <p className="text-sm text-ink-5">The linked CAPA could not be found.</p>
          )
        ) : canEdit ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard
                on={mode === "new"}
                title="New CAPA"
                sub="Plan corrective and preventive actions for this root cause."
                onClick={() => {
                  setFollowUpOf(null);
                  setMode("new");
                }}
              />
              <ChoiceCard
                on={mode === "link"}
                title="Add to an existing CAPA"
                sub="Join an open CAPA, or follow up a closed one when the problem came back."
                onClick={() => {
                  setFollowUpOf(null);
                  setMode("link");
                }}
              />
            </div>
            {mode === "new" && (
              <NewCapaForm
                // A follow-up starts a fresh draft.
                key={followUpOf?.id ?? "new"}
                deviation={d}
                factoryId={factoryId}
                slug={slug}
                followUpOf={followUpOf}
                onCancel={() => {
                  setMode(null);
                  setFollowUpOf(null);
                }}
                onCreated={() => setMode(null)}
              />
            )}
            {mode === "link" && (
              <LinkList
                deviation={d}
                factoryId={factoryId}
                slug={slug}
                capas={capas}
                onFollowUp={(c) => {
                  setFollowUpOf(c);
                  setMode("new");
                }}
                onCancel={() => setMode(null)}
                onLinked={() => setMode(null)}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-5">No CAPA linked yet.</p>
        ))}

      {answer === null && !canEdit && <p className="text-sm text-ink-5">Not decided yet.</p>}
    </section>
  );
}

function ChoiceCard({
  on,
  title,
  sub,
  onClick,
}: {
  on: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-3 text-left transition",
        on
          ? "border-brand bg-brand-soft ring-2 ring-brand/15"
          : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span className="block text-sm font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-4">{sub}</span>
    </button>
  );
}

/** "No" — why the corrections above are enough. */
function NotNeeded({
  deviation: d,
  factoryId,
  canEdit,
  linkedNo,
  onCancel,
}: {
  deviation: Deviation;
  factoryId: string;
  canEdit: boolean;
  /** The CAPA the case is under, which saving No takes it off. */
  linkedNo: string | null;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<CapaNotNeededValues>({
    resolver: zodResolver(capaNotNeededSchema),
    defaultValues: { reason: d.capa_not_needed_reason ?? "" },
  });
  const errors = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: CapaNotNeededValues) => saveCapaDecision(d.id, false, v.reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Saved — no CAPA needed.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-ink-3">Justification</p>
        <p className="text-sm whitespace-pre-wrap text-ink">{d.capa_not_needed_reason ?? "—"}</p>
      </div>
    );
  }
  const saved = d.capa_needed === false;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3"
    >
      {linkedNo && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-sm text-warn-ink">
          This case is under {linkedNo}. Saving No takes it off that CAPA.
        </p>
      )}
      <Field label="Justification" htmlFor="capa-no-why" required error={errors.reason?.message}>
        <textarea
          id="capa-no-why"
          rows={3}
          placeholder="Why the corrections above are enough, e.g. isolated event, cause removed, nothing to prevent"
          className={AREA}
          {...form.register("reason")}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending || (saved && !form.formState.isDirty)}
          className={PRIMARY_BUTTON}
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        {linkedNo && (
          <button type="button" onClick={onCancel} disabled={save.isPending} className={SECONDARY_BUTTON}>
            Cancel
          </button>
        )}
        {saved && !form.formState.isDirty && <span className="text-xs text-teal-deep">Saved</span>}
      </div>
    </form>
  );
}

/* ── New CAPA ─────────────────────────────────────────────────────────── */

function NewCapaForm({
  deviation: d,
  factoryId,
  slug,
  followUpOf,
  onCancel,
  onCreated,
}: {
  deviation: Deviation;
  factoryId: string;
  slug: string;
  followUpOf: Capa | null;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const today = useRenderClock(todayKey);
  const [draft, setDraft] = useState<PlanDraft>(() => {
    const fresh = newPlanDraft(d.classification);
    // A follow-up is always checked on a date.
    return followUpOf ? { ...fresh, checkMode: "dated" } : fresh;
  });
  // The approved root cause is the case's. Until QA approves the investigation
  // (or when none was done) the CAPA records its own, starting from any draft.
  const approvedRoot = hasApprovedRoot(d);
  const [rootCause, setRootCause] = useState(approvedRoot ? "" : (d.root_cause ?? ""));
  const missing = [
    ...(approvedRoot || rootCause.trim() ? [] : ["root cause"]),
    ...draftMissing(draft),
  ];

  const create = useMutation({
    mutationFn: () =>
      createCapaPlan(d.id, d.title, approvedRoot ? "" : rootCause, draft, followUpOf?.id ?? null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("CAPA created — waiting for plan approval.");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      {followUpOf && <FollowUpNote capa={followUpOf} factoryId={factoryId} slug={slug} />}
      {approvedRoot ? (
        <p className="text-sm text-ink-3">
          <span className="text-ink-4">Root cause:</span>{" "}
          <span className="font-mono">{d.deviation_no}</span> {d.root_cause}
        </p>
      ) : (
        <Field
          label="Root cause"
          htmlFor="nc-root"
          required
          hint={
            d.root_cause?.trim()
              ? "From the investigation draft — not approved yet. Change it if needed."
              : "No investigation root cause is recorded on this case yet."
          }
          className="max-w-2xl"
        >
          <input
            id="nc-root"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="One line — what caused the problem"
            className={CONTROL}
          />
        </Field>
      )}

      <CapaPlanEditor value={draft} onChange={setDraft} today={today} />

      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-4">
        <button
          type="button"
          disabled={create.isPending || missing.length > 0}
          onClick={() => create.mutate()}
          className={PRIMARY_BUTTON}
        >
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          Create CAPA and send for approval
        </button>
        <button type="button" onClick={onCancel} disabled={create.isPending} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <span className="text-[0.8125rem] text-ink-4">
          {missing.length > 0 ? `Still needed: ${missing.join(", ")}.` : "Ready to send."}
        </span>
      </div>
    </div>
  );
}

/** "Follow-up of closed CAPA-…" — what was done last time. */
function FollowUpNote({ capa, factoryId, slug }: { capa: Capa; factoryId: string; slug: string }) {
  const { data: actions = [] } = useQuery({
    queryKey: capaKeys.actions(factoryId, capa.id),
    queryFn: () => fetchCapaActions(capa.id),
  });
  return (
    <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm text-warn-ink">
      <span className="font-semibold">
        Follow-up of closed{" "}
        <Link href={`/factory/${slug}/deviations/capa/${capa.id}`} className="font-mono underline">
          {capa.capa_no}
        </Link>
        .
      </span>{" "}
      It was verified effective
      {capa.verified_at && ` on ${formatDate(capa.verified_at.slice(0, 10))}`}, but the problem
      came back.
      {actions.length > 0 && ` Its actions were: ${actions.map((a) => a.description).join("; ")}.`}{" "}
      Plan what will be different this time.
    </p>
  );
}

/* ── Add to an existing CAPA ──────────────────────────────────────────── */

function LinkList({
  deviation: d,
  factoryId,
  slug,
  capas,
  onFollowUp,
  onCancel,
  onLinked,
}: {
  deviation: Deviation;
  factoryId: string;
  slug: string;
  capas: Capa[];
  onFollowUp: (c: Capa) => void;
  onCancel: () => void;
  onLinked: () => void;
}) {
  const queryClient = useQueryClient();
  const openC = capas.filter((c) => c.step !== "closed");
  const closedC = capas.filter((c) => c.step === "closed");
  const link = useMutation({
    mutationFn: (c: Capa) => linkCapa(d.id, c.id),
    onSuccess: async (_, c) => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(`Added to ${c.capa_no}.`);
      onLinked();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const row = (c: Capa, button: React.ReactNode) => (
    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Link
        href={`/factory/${slug}/deviations/capa/${c.id}`}
        className="shrink-0 font-mono text-sm font-semibold text-brand hover:underline"
      >
        {c.capa_no}
      </Link>
      <span className="min-w-0 flex-1 text-sm">
        <span className="text-ink">{c.title}</span>
        <span className="block text-xs text-ink-4">
          {stepLabel(c)} · {c.cases.map((k) => k.deviation_no).join(", ") || "no case"}
          {c.recurred_by.length > 0 && ` · recurred ${c.recurred_by.length}×`}
        </span>
      </span>
      {button}
    </li>
  );
  const small =
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-3 shadow-soft transition hover:border-brand hover:text-brand disabled:opacity-60";

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">Open CAPAs</span>
          <span className="text-xs text-ink-4">
            This case joins the CAPA and shares its actions and effectiveness check.
          </span>
        </p>
        {openC.length === 0 ? (
          <p className="text-sm text-ink-5">No open CAPAs.</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {openC.map((c) =>
              row(
                c,
                <button
                  type="button"
                  disabled={link.isPending}
                  onClick={() => link.mutate(c)}
                  className={small}
                >
                  {link.isPending && link.variables?.id === c.id && <Loader2 className="size-3.5 animate-spin" />}
                  Add this case
                </button>,
              ),
            )}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">Closed CAPAs</span>
          <span className="text-xs text-ink-4">
            Same problem fixed before? A closed CAPA is never reopened — start a follow-up that
            records the recurrence.
          </span>
        </p>
        {closedC.length === 0 ? (
          <p className="text-sm text-ink-5">No closed CAPAs.</p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {closedC.map((c) =>
              row(
                c,
                <button type="button" onClick={() => onFollowUp(c)} className={small}>
                  Start follow-up CAPA
                </button>,
              ),
            )}
          </ul>
        )}
      </div>
      <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
        Cancel
      </button>
    </div>
  );
}

/* ── Linked ───────────────────────────────────────────────────────────── */

/** The case's root cause counts once QA has approved the investigation. */
function hasApprovedRoot(d: Deviation): boolean {
  return Boolean(d.root_cause?.trim()) && (d.investigation_approved_at !== null || !isDeviationType(d));
}

/**
 * The root cause the CAPA works on. The case's approved one is shown as it
 * is; until then the CAPA keeps its own, editable while its plan is written
 * (starting from the investigation's draft).
 */
function CapaRootCause({
  capa,
  deviation: d,
  canEdit,
  factoryId,
}: {
  capa: Capa;
  deviation: Deviation;
  canEdit: boolean;
  factoryId: string;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(capa.root_cause ?? d.root_cause ?? "");
  const save = useMutation({
    mutationFn: () => setCapaRootCause(capa.id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success("Root cause saved on the CAPA.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (hasApprovedRoot(d)) {
    return (
      <p className="text-sm text-ink-3">
        <span className="text-ink-4">Root cause:</span> {d.root_cause}
      </p>
    );
  }
  if (!(canEdit && capa.step === "plan")) {
    return (
      <p className="text-sm text-ink-3">
        <span className="text-ink-4">Root cause:</span>{" "}
        {capa.root_cause ?? <span className="text-ink-5">not recorded yet</span>}
      </p>
    );
  }
  const dirty = value.trim() !== (capa.root_cause ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length < 5) {
          toast.error("State the root cause — at least a few words.");
          return;
        }
        save.mutate();
      }}
      className="space-y-1.5"
    >
      <label htmlFor={`rc-${capa.id}`} className="block text-xs font-medium text-ink-3">
        Root cause<span className="ml-0.5 text-danger">*</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`rc-${capa.id}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="One line — what caused the problem"
          className={cn(CONTROL, "max-w-2xl flex-1")}
        />
        <button type="submit" disabled={save.isPending || !dirty} className={SECONDARY_BUTTON}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
      </div>
      <p className="text-[0.6875rem] text-ink-5">
        {d.root_cause?.trim()
          ? "The investigation's root cause is not approved yet — this is the one the CAPA works on."
          : "No investigation root cause is recorded on this case yet."}
        {!capa.root_cause && value.trim() && " Not saved yet."}
      </p>
    </form>
  );
}

/**
 * The linked CAPA's card: number and title (and Follow-up), the stepper,
 * what is next and how many actions are done, and the way to it. A case can
 * be removed only while the plan is being written, and only from a CAPA that
 * covers other cases too.
 */
function LinkedCard({
  capa,
  deviation: d,
  slug,
  canEdit,
  factoryId,
}: {
  capa: Capa;
  deviation: Deviation;
  slug: string;
  canEdit: boolean;
  factoryId: string;
}) {
  const queryClient = useQueryClient();
  const today = useRenderClock(todayKey);
  const unlink = useMutation({
    mutationFn: () => unlinkCapa(d.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
      toast.success(`Removed from ${capa.capa_no}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const next = capaNext(capa);
  const href = `/factory/${slug}/deviations/capa/${capa.id}`;
  const dn = capa.actions_closed;
  const tot = capa.action_count;
  const late = capa.step !== "closed" && next.date !== null && next.date < today;

  return (
    <div className="space-y-2">
      <div className="space-y-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 text-sm text-ink">
            <Link href={href} className="font-mono font-semibold text-brand hover:underline">
              {capa.capa_no}
            </Link>{" "}
            · <span className="font-semibold">{capa.title}</span>
            {capa.recurrence_of_no && (
              <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-warn-deep">
                Follow-up of {capa.recurrence_of_no}
              </span>
            )}
          </p>
          <span className="flex shrink-0 items-center gap-3">
            {canEdit && capa.step === "plan" && capa.cases.length > 1 && (
              <button
                type="button"
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}
                className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
              >
                Remove this case
              </button>
            )}
            <Link href={href} className={cn(PRIMARY_BUTTON, "h-8 px-3 text-xs")}>
              Open CAPA
              <ArrowRight className="size-3.5" />
            </Link>
          </span>
        </div>
        <CapaRootCause capa={capa} deviation={d} canEdit={canEdit} factoryId={factoryId} />
        <CapaStepper step={capa.step} small />
        <p className="text-sm text-ink-3">
          <span className="font-semibold text-ink">{next.text}</span>
          {next.date && (
            <>
              {" · "}
              <span className={cn(late && "font-semibold text-danger-deep")}>{formatDate(next.date)}</span>
            </>
          )}
          {capa.step !== "plan" && (
            <span className="text-ink-4">
              {" "}
              · {dn} of {tot} actions done
            </span>
          )}
        </p>
        {capa.step === "do" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken-2">
            <div
              className="h-full rounded-full bg-teal transition-[width]"
              style={{ width: `${tot ? (dn / tot) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>
      <p className="text-xs text-ink-5">This case waits until the CAPA is verified effective.</p>
    </div>
  );
}
