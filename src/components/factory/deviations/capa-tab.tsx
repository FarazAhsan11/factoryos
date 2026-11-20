"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller } from "react-hook-form";
import { ArrowRight, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import {
  CAPA_REASONS,
  capaNewSchema,
  resolveDirectSchema,
  type CapaNewValues,
  type ResolveDirectValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaStepper } from "@/components/factory/capa/capa-stepper";
import {
  AREA,
  Badge,
  CONTROL,
  Fact,
  Field,
  Group,
  Muted,
  PersonControl,
  SelectControl,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { SelectField } from "@/components/ui/select-field";
import {
  ACTION_KINDS,
  capaKeys,
  capaNext,
  createCapa,
  fetchCapas,
  type Capa,
} from "@/lib/factory/capa-queries";
import { addDays, todayKey } from "@/lib/factory/dates";
import {
  deviationKeys,
  isLegacyRisk,
  linkCapa,
  saveCapaDecision,
  unlinkCapa,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useWorkers } from "@/lib/factory/worker-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

type Path = "direct" | "capa" | "link";

const PATHS: { value: Path; label: string; hint: string }[] = [
  {
    value: "direct",
    label: "Resolve directly",
    hint: "Correction only — fix and close",
  },
  {
    value: "capa",
    label: "Create a new CAPA",
    hint: "CAPA plan → Do → Effectiveness check",
  },
  {
    value: "link",
    label: "Link to an open CAPA",
    hint: "Same root cause as an open CAPA",
  },
];

/** Recurring at the initial assessment (likelihood 3, 0068): a CAPA is required. */
function isRecurring(d: Deviation): boolean {
  return (
    (d.type === "planned" || d.type === "unplanned") &&
    d.likelihood === 3 &&
    !isLegacyRisk(d)
  );
}

/**
 * The case's Actions tab — how the case is resolved.
 *
 * Three paths: **resolve directly** (a correction, no CAPA — stored as the
 * reason none is needed), **create a new CAPA** (its title, owner and why,
 * and optionally a first action — the plan is then written on the CAPA's own
 * page), or **link to an open CAPA** with the same root cause. Once linked,
 * the tab shows where the CAPA stands — its step, what is next — and opens it.
 */
export function CapaTab({
  deviation,
  factoryId,
  readOnly,
}: {
  deviation: Deviation;
  factoryId: string;
  readOnly: boolean;
}) {
  const { slug } = useParams<{ slug: string }>();
  const { data: capas = [], isPending } = useQuery({
    queryKey: capaKeys.all(factoryId),
    queryFn: () => fetchCapas(factoryId),
  });
  const linked = capas.find((c) => c.id === deviation.capa_id) ?? null;

  if (deviation.capa_id && !linked) {
    return isPending ? (
      <Loader2 className="mx-auto size-5 animate-spin text-ink-5" />
    ) : (
      <Muted>The linked CAPA could not be found.</Muted>
    );
  }

  if (linked) {
    return (
      <LinkedCard
        capa={linked}
        deviation={deviation}
        slug={slug}
        factoryId={readOnly ? undefined : factoryId}
      />
    );
  }

  if (readOnly) {
    return (
      <Group title="Resolution">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Path">
            {deviation.capa_needed === false ? (
              "Resolved directly"
            ) : deviation.capa_needed ? (
              "CAPA needed — none linked yet"
            ) : (
              <Muted>Not decided</Muted>
            )}
          </Fact>
          {deviation.capa_needed === false && (
            <Fact label="Correction / reason no CAPA is needed" wide>
              {deviation.capa_not_needed_reason ?? <Muted>—</Muted>}
            </Fact>
          )}
        </dl>
      </Group>
    );
  }

  return (
    <PathPicker
      // Re-seeded when the saved decision changes underneath it.
      key={`${deviation.capa_needed}`}
      deviation={deviation}
      factoryId={factoryId}
      slug={slug}
      capas={capas}
      capasLoading={isPending}
    />
  );
}

function PathPicker({
  deviation,
  factoryId,
  slug,
  capas,
  capasLoading,
}: {
  deviation: Deviation;
  factoryId: string;
  slug: string;
  capas: Capa[];
  capasLoading: boolean;
}) {
  const openCapas = capas.filter((c) => c.status === "open");
  const [path, setPath] = useState<Path | null>(
    deviation.capa_needed === false ? "direct" : deviation.capa_needed ? "capa" : null,
  );
  const recurring = isRecurring(deviation);
  const invPending =
    (deviation.type === "planned" || deviation.type === "unplanned") &&
    deviation.investigation_required !== false &&
    !deviation.investigation_approved_at;

  return (
    <div className="space-y-5">
      {invPending && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
          The investigation is not approved yet. Decide the CAPA once the root cause is approved.
        </p>
      )}
      {recurring && (
        <p className="rounded-xl border border-warn-line bg-warn-tint px-4 py-2.5 text-xs text-warn-ink">
          Recurring problem (likelihood 3 at the initial assessment): a CAPA is required.
        </p>
      )}
      <Group title="Resolution">
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {PATHS.map((p) => {
            const disabled = p.value === "link" && !capasLoading && openCapas.length === 0;
            const active = path === p.value;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                title={disabled ? "No open CAPA to link to" : undefined}
                onClick={() => setPath(p.value)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left shadow-[0_1px_2px_rgb(20_22_43/0.04)] transition disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? p.value === "capa"
                      ? "border-warn bg-warn-tint ring-2 ring-warn/20"
                      : "border-brand bg-brand-soft ring-2 ring-brand/15"
                    : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className="block text-sm font-semibold text-ink">{p.label}</span>
                <span className="block text-[0.6875rem] text-ink-5">{p.hint}</span>
              </button>
            );
          })}
        </div>
      </Group>

      {path === "direct" && <ResolveDirect deviation={deviation} factoryId={factoryId} />}
      {path === "capa" && <NewCapa deviation={deviation} factoryId={factoryId} slug={slug} />}
      {path === "link" && (
        <LinkExisting deviation={deviation} factoryId={factoryId} openCapas={openCapas} />
      )}
      {path === null && (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3 text-xs text-ink-5">
          Choose how the case is resolved. It cannot be closed until one is chosen.
        </p>
      )}
    </div>
  );
}

function useRefresh(factoryId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
}

/* ── Resolve directly ─────────────────────────────────────────────────── */

function ResolveDirect({ deviation, factoryId }: { deviation: Deviation; factoryId: string }) {
  const refresh = useRefresh(factoryId);
  const form = useForm<ResolveDirectValues>({
    resolver: zodResolver(resolveDirectSchema),
    defaultValues: { correction: deviation.capa_not_needed_reason ?? "" },
  });
  const save = useMutation({
    mutationFn: (v: ResolveDirectValues) => saveCapaDecision(deviation.id, false, v.correction),
    onSuccess: async () => {
      await refresh();
      toast.success("Resolved directly — no CAPA.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      onSubmit={form.handleSubmit((v) => save.mutateAsync(v).catch(() => {}))}
      className="space-y-3 rounded-2xl border border-line bg-surface p-4"
    >
      <Field
        label="Correction / reason no CAPA is needed"
        htmlFor="dev-correction"
        required
        hint="What was done about this instance, and why it needs no root-cause CAPA."
        error={form.formState.errors.correction?.message}
      >
        <textarea
          id="dev-correction"
          rows={3}
          placeholder="e.g. 240 bottles relabelled and re-inspected. One-off — form already revised under an existing change control."
          className={AREA}
          {...form.register("correction")}
        />
      </Field>
      <Submit pending={form.formState.isSubmitting} label="Save — resolve directly" />
    </form>
  );
}

/* ── Create a new CAPA ────────────────────────────────────────────────── */

/**
 * The reference QMS's "Create a CAPA" (qms-v6): a title (the case's, to
 * start), the CAPA owner, why a CAPA, and optionally a first action. The CAPA
 * starts in its plan step and opens on its own page, where the plan is
 * finished and approved.
 */
function NewCapa({
  deviation,
  factoryId,
  slug,
}: {
  deviation: Deviation;
  factoryId: string;
  slug: string;
}) {
  const router = useRouter();
  const refresh = useRefresh(factoryId);
  const today = useRenderClock(todayKey);
  const { data: workers = [] } = useWorkers(factoryId);
  const form = useForm<CapaNewValues>({
    resolver: zodResolver(capaNewSchema),
    defaultValues: {
      title: deviation.title,
      owner: deviation.owner_name ?? "",
      reason: isRecurring(deviation) ? "Recurring issue" : "Critical / Major impact",
      firstKind: "ca",
      firstAction: "",
    },
  });
  const errors = form.formState.errors;

  const create = useMutation({
    mutationFn: (v: CapaNewValues) => createCapa(deviation.id, v, addDays(today, 30)),
    onSuccess: async (id) => {
      await refresh();
      toast.success("CAPA created — finish its plan.");
      router.push(`/factory/${slug}/deviations/capa/${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => create.mutateAsync(v).catch(() => {}))}
      className="space-y-4 rounded-2xl border border-warn-line bg-warn-tint/30 p-4"
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-4">
        <Badge className="bg-warn-soft text-warn-deep">CAPA</Badge>
        Create a CAPA from {deviation.deviation_no}
      </p>

      <Field label="Title" htmlFor="nc-title" required error={errors.title?.message}>
        <input id="nc-title" className={CONTROL} {...form.register("title")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CAPA owner" htmlFor="nc-owner" required error={errors.owner?.message}>
          <PersonControl
            control={form.control}
            name="owner"
            id="nc-owner"
            workers={workers}
            label="CAPA owner"
          />
        </Field>
        <Field label="Why a CAPA" htmlFor="nc-reason" required error={errors.reason?.message}>
          <SelectControl
            control={form.control}
            name="reason"
            id="nc-reason"
            options={CAPA_REASONS.map((r) => ({ value: r, label: r }))}
          />
        </Field>
      </div>

      <Field
        label="First action"
        htmlFor="nc-first"
        note="(optional)"
        hint="Owned by the CAPA owner, due in 30 days — change it in the plan."
        error={errors.firstAction?.message}
      >
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <Controller
            name="firstKind"
            control={form.control}
            render={({ field }) => (
              <SelectField
                value={field.value}
                onChange={(v) => field.onChange(v as "ca" | "pa")}
                ariaLabel="Type"
                options={ACTION_KINDS.map((k) => ({ value: k.value, label: k.short, hint: k.label }))}
              />
            )}
          />
          <input
            id="nc-first"
            placeholder="Describe the action"
            className={CONTROL}
            {...form.register("firstAction")}
          />
        </div>
      </Field>

      <dl className="grid gap-3">
        <Fact label="Root cause" wide>
          {deviation.root_cause ?? <Muted>Not recorded</Muted>}
        </Fact>
      </dl>

      <Submit
        pending={form.formState.isSubmitting}
        label="Create CAPA"
        note="It opens on its own page, in its CAPA plan step."
      />
    </form>
  );
}

/* ── Link to an open CAPA ─────────────────────────────────────────────── */

function LinkExisting({
  deviation,
  factoryId,
  openCapas,
}: {
  deviation: Deviation;
  factoryId: string;
  openCapas: Capa[];
}) {
  const refresh = useRefresh(factoryId);
  const [pick, setPick] = useState(openCapas[0]?.id ?? "");
  const link = useMutation({
    mutationFn: (capaId: string) => linkCapa(deviation.id, capaId),
    onSuccess: async () => {
      await refresh();
      toast.success("Linked to the CAPA.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <Field label="Open CAPA with the same root cause" htmlFor="dev-capa-link">
        <SelectField
          id="dev-capa-link"
          value={pick}
          onChange={setPick}
          placeholder="Choose a CAPA…"
          searchPlaceholder="CAPA no. or title…"
          emptyMessage="No open CAPAs."
          options={openCapas.map((c) => ({
            value: c.id,
            label: `${c.capa_no} — ${c.title}`,
            meta: c.cases.map((k) => k.deviation_no).join(", "),
          }))}
        />
      </Field>
      <p className="text-[0.6875rem] text-ink-5">
        Added as a source of that CAPA — root cause and actions are shared, not duplicated.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!pick || link.isPending}
          onClick={() => link.mutate(pick)}
          className={SUBMIT}
        >
          {link.isPending && <Loader2 className="size-4 animate-spin" />}
          Link to CAPA
        </button>
      </div>
    </div>
  );
}

/* ── Linked ───────────────────────────────────────────────────────────── */

/**
 * Where the linked CAPA stands — its step, what is next, how many actions are
 * done — and the way to it. Unlinking is offered only while its plan is being
 * written: once approved, the plan was approved for this case too.
 */
function LinkedCard({
  capa,
  deviation,
  slug,
  factoryId,
}: {
  capa: Capa;
  deviation: Deviation;
  slug: string;
  /** Absent on a read-only case — no unlinking. */
  factoryId?: string;
}) {
  const refresh = useRefresh(factoryId ?? "");
  const unlink = useMutation({
    mutationFn: () => unlinkCapa(deviation.id),
    onSuccess: async () => {
      await refresh();
      toast.success(`${capa.capa_no} unlinked.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const next = capaNext(capa);
  const others = capa.cases.filter((k) => k.id !== deviation.id);
  const href = `/factory/${slug}/deviations/capa/${capa.id}`;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink">
              <Link href={href} className="font-mono font-semibold text-brand hover:underline">
                {capa.capa_no}
              </Link>{" "}
              · <span className="font-semibold">{capa.title}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-4">
              {capa.reason && `${capa.reason} · `}owner {capa.owner_name ?? "—"}
              {others.length > 0 && ` · also covers ${others.map((k) => k.deviation_no).join(", ")}`}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2 print:hidden">
            {factoryId && capa.step === "plan" && (
              <button
                type="button"
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-ink-3 shadow-soft transition hover:border-danger hover:text-danger-deep disabled:opacity-60"
              >
                {unlink.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
                Unlink
              </button>
            )}
            <Link href={href} className={SUBMIT}>
              Open CAPA
              <ArrowRight className="size-4" />
            </Link>
          </span>
        </div>
        <CapaStepper step={capa.step} small />
        <p className="text-sm text-ink-3">
          {next.text}
          {next.date && ` · ${formatDate(next.date)}`}
          {capa.step === "do" && ` · ${capa.actions_closed} of ${capa.action_count} actions done`}
        </p>
      </div>
      <p className="text-xs text-ink-5">
        This case closes once {capa.capa_no} is verified effective — its effectiveness check
        says it worked.
      </p>
    </div>
  );
}

const SUBMIT =
  "inline-flex h-9 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60";

function Submit({ pending, label, note }: { pending: boolean; label: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[0.6875rem] text-ink-5">{note}</p>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}
