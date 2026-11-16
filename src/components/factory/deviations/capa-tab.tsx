"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useWatch } from "react-hook-form";
import { Loader2, Plus, Unlink, X } from "lucide-react";
import { toast } from "sonner";

import {
  ACTION_STATUSES,
  capaInitiateSchema,
  resolveDirectSchema,
  type CapaInitiateValues,
  type ResolveDirectValues,
} from "@/app/factory/[slug]/deviations/schemas";
import { CapaPanel } from "@/components/factory/capa/capa-panel";
import {
  AREA,
  Badge,
  CONTROL,
  DateControl,
  Fact,
  Field,
  Group,
  Muted,
  SelectControl,
  formatDate,
} from "@/components/factory/deviations/deviation-fields";
import { SelectField } from "@/components/ui/select-field";
import {
  ACTION_STATUS_LABELS,
  CAPA_STATUS_LABELS,
  CAPA_STATUS_PILL,
  capaKeys,
  fetchCapas,
  initiateCapa,
  type Capa,
} from "@/lib/factory/capa-queries";
import { addDays, todayKey } from "@/lib/factory/dates";
import {
  deviationKeys,
  linkCapa,
  saveCapaDecision,
  unlinkCapa,
  type Deviation,
} from "@/lib/factory/deviation-queries";
import { useRenderClock } from "@/lib/use-render-clock";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

type Path = "direct" | "capa" | "link" | "later";

const PATHS: { value: Path; label: string; hint: string }[] = [
  {
    value: "direct",
    label: "Resolve directly",
    hint: "Correction only — fix and close",
  },
  {
    value: "capa",
    label: "Initiate CAPA",
    hint: "Corrective & preventive actions, with owners and dates",
  },
  {
    value: "link",
    label: "Link to existing CAPA",
    hint: "Same root cause as an open CAPA",
  },
  {
    value: "later",
    label: "Decide at review",
    hint: "Owner chooses later",
  },
];

/**
 * The case's CAPA tab — how the case is resolved.
 *
 * Four paths, as the reference system offers them: **resolve directly** (a
 * correction, no CAPA — stored as the reason none is needed), **initiate a
 * CAPA** (the whole plan in one form: why, owner, target, root cause, the
 * first CA and PA rows, the effectiveness check), **link to an existing
 * CAPA** with the same root cause (its root cause and actions are shared,
 * not duplicated), or **decide at review** (undecided — the close-out will
 * ask). Once a CAPA is linked, it is worked right here through the same panel
 * the register draws.
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
      <div className="space-y-6">
        <LinkedSummary
          capa={linked}
          deviation={deviation}
          factoryId={readOnly ? undefined : factoryId}
        />
        <CapaPanel capa={linked} factoryId={factoryId} readOnly={readOnly} />
      </div>
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
      capas={capas}
      capasLoading={isPending}
    />
  );
}

function PathPicker({
  deviation,
  factoryId,
  capas,
  capasLoading,
}: {
  deviation: Deviation;
  factoryId: string;
  capas: Capa[];
  capasLoading: boolean;
}) {
  const openCapas = capas.filter((c) => c.status === "open");
  const [path, setPath] = useState<Path>(
    deviation.capa_needed === false
      ? "direct"
      : deviation.capa_needed
        ? "capa"
        : "later",
  );

  return (
    <div className="space-y-5">
      <Group title="Resolution">
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PATHS.map((p) => {
            // Not while the register is still loading — only when it has
            // loaded with no open CAPA.
            const disabled =
              p.value === "link" && !capasLoading && openCapas.length === 0;
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
                <span className="block text-sm font-semibold text-ink">
                  {p.label}
                </span>
                <span className="block text-[0.6875rem] text-ink-5">
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      {path === "direct" && (
        <ResolveDirect deviation={deviation} factoryId={factoryId} />
      )}
      {path === "capa" && (
        <InitiateCapa deviation={deviation} factoryId={factoryId} />
      )}
      {path === "link" && (
        <LinkExisting
          deviation={deviation}
          factoryId={factoryId}
          openCapas={openCapas}
        />
      )}
      {path === "later" && (
        <DecideLater deviation={deviation} factoryId={factoryId} />
      )}
    </div>
  );
}

function useRefresh(factoryId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: deviationKeys.all(factoryId) });
}

/* ── Resolve directly ─────────────────────────────────────────────────── */

function ResolveDirect({
  deviation,
  factoryId,
}: {
  deviation: Deviation;
  factoryId: string;
}) {
  const refresh = useRefresh(factoryId);
  const form = useForm<ResolveDirectValues>({
    resolver: zodResolver(resolveDirectSchema),
    defaultValues: { correction: deviation.capa_not_needed_reason ?? "" },
  });
  const save = useMutation({
    mutationFn: (v: ResolveDirectValues) =>
      saveCapaDecision(deviation.id, false, v.correction),
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

/* ── Initiate CAPA ────────────────────────────────────────────────────── */

/**
 * Only the actions: corrective (CA) and preventive (PA), each with its
 * target / due date, status and owner. The CAPA takes the case's title; its
 * reason, owner, dates and verification are filled in from the register. The
 * root cause and its method are the case's own, on the Investigation tab.
 */
function InitiateCapa({
  deviation,
  factoryId,
}: {
  deviation: Deviation;
  factoryId: string;
}) {
  const refresh = useRefresh(factoryId);
  // Read through the render clock, never `todayKey()` in render — and only
  // the form's defaults use it, which are read once, on mount.
  const today = useRenderClock(todayKey);

  const form = useForm<CapaInitiateValues>({
    resolver: zodResolver(capaInitiateSchema),
    defaultValues: {
      actions: [
        {
          kind: "ca",
          description: "",
          owner: "",
          targetDate: addDays(today, 21),
          status: "open",
        },
        {
          kind: "pa",
          description: "",
          owner: "",
          targetDate: addDays(today, 21),
          status: "open",
        },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "actions",
  });

  const initiate = useMutation({
    mutationFn: (v: CapaInitiateValues) => initiateCapa(deviation.id, v),
    onSuccess: async () => {
      await refresh();
      toast.success("CAPA initiated and linked.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (kind: "ca" | "pa") =>
    fields
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => f.kind === kind);
  // "Add at least one action" — shown only while it is still true, so it
  // goes the moment a description is typed rather than at the next submit.
  const watched = useWatch({ control: form.control, name: "actions" });
  const anyAction = (watched ?? []).some((a) => a?.description?.trim());
  const arrayError = anyAction
    ? undefined
    : form.formState.errors.actions?.root?.message;

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        initiate.mutateAsync(v).catch(() => {}),
      )}
      className="space-y-5 rounded-2xl border border-warn-line bg-warn-tint/30 p-4"
    >
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-4">
        <Badge className="bg-warn-soft text-warn-deep">CAPA</Badge>
        Initiate a CAPA for {deviation.deviation_no} — list its corrective and
        preventive actions.
      </p>

      {(["ca", "pa"] as const).map((kind) => (
        <Group
          key={kind}
          title={
            kind === "ca"
              ? "Corrective action (CA)"
              : "Preventive action (PA)"
          }
        >
          {/* Each action is a small card: the action across the full width,
              then its date, status and owner on a line beneath — so a
              sentence is readable and a date is never cut short. */}
          {rows(kind).map(({ f, index }, n) => (
            <div
              key={f.id}
              className="grid items-start gap-x-2 gap-y-2 rounded-xl border border-line-soft bg-surface/70 p-2.5 sm:grid-cols-[2.75rem_minmax(0,1fr)_2.25rem]"
            >
              <span className="pt-2.5 font-mono text-xs font-semibold text-ink-4">
                {kind.toUpperCase()}
                {String(n + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 space-y-2">
                <input
                  aria-label={
                    kind === "ca" ? "Corrective action" : "Preventive action"
                  }
                  placeholder={
                    kind === "ca"
                      ? "What will remove the cause"
                      : "What will stop it happening elsewhere"
                  }
                  className={CONTROL}
                  {...form.register(`actions.${index}.description`)}
                />
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
                  <div className="space-y-1">
                    <p className="text-[0.625rem] font-medium text-ink-4">
                      Target / due date
                    </p>
                    <DateControl
                      control={form.control}
                      name={`actions.${index}.targetDate`}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[0.625rem] font-medium text-ink-4">
                      Status
                    </p>
                    <SelectControl
                      control={form.control}
                      name={`actions.${index}.status`}
                      options={ACTION_STATUSES.map((s) => ({
                        value: s,
                        label: ACTION_STATUS_LABELS[s],
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[0.625rem] font-medium text-ink-4">
                      Owner
                    </p>
                    {/* Typed, as on every CAPA form — the owner is a name, not
                        necessarily someone on the workforce register. */}
                    <input
                      aria-label="Owner"
                      placeholder="Who owns it"
                      className={CONTROL}
                      {...form.register(`actions.${index}.owner`)}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => remove(index)}
                className="grid size-9 place-items-center rounded-lg text-ink-5 transition hover:bg-sunken-2 hover:text-danger"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              append({
                kind,
                description: "",
                owner: "",
                targetDate: addDays(today, 21),
                status: "open",
              })
            }
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
          >
            <Plus className="size-3.5" />
            Add {kind.toUpperCase()}
          </button>
        </Group>
      ))}

      {arrayError && (
        <p role="alert" className="text-[0.7188rem] text-danger">
          {arrayError}
        </p>
      )}

      <Submit
        pending={form.formState.isSubmitting}
        label="Initiate CAPA"
        note="Rows left blank are not saved. Each action is closed later with its date and a name."
      />
    </form>
  );
}

/* ── Link to existing CAPA ────────────────────────────────────────────── */

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
        Added as a source of that CAPA — root cause and actions are shared, not
        duplicated.
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

/* ── Decide at review ─────────────────────────────────────────────────── */

function DecideLater({
  deviation,
  factoryId,
}: {
  deviation: Deviation;
  factoryId: string;
}) {
  const refresh = useRefresh(factoryId);
  const clear = useMutation({
    mutationFn: () => saveCapaDecision(deviation.id, null, ""),
    onSuccess: async () => {
      await refresh();
      toast.success("Left to decide at review.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Nothing to save when nothing has been decided yet.
  if (deviation.capa_needed === null) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3 text-xs text-ink-5">
        The owner chooses a path later. The case cannot be closed until one is
        chosen.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-ink-4">
        This clears the earlier decision. The case cannot be closed until a
        path is chosen again.
      </p>
      <button
        type="button"
        disabled={clear.isPending}
        onClick={() => clear.mutate()}
        className={SUBMIT}
      >
        {clear.isPending && <Loader2 className="size-4 animate-spin" />}
        Decide at review
      </button>
    </div>
  );
}

/* ── Linked ───────────────────────────────────────────────────────────── */

/** The linked CAPA's identity, its plan, what else it covers, the way out. */
function LinkedSummary({
  capa,
  deviation,
  factoryId,
}: {
  capa: Capa;
  deviation: Deviation;
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
  const others = capa.cases.filter((k) => k.id !== deviation.id);

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="bg-sunken-2 font-mono text-ink-3">
              {capa.capa_no}
            </Badge>
            <Badge className={CAPA_STATUS_PILL[capa.status]}>
              {CAPA_STATUS_LABELS[capa.status]}
            </Badge>
            {capa.reason && (
              <Badge className="bg-warn-soft text-warn-deep">
                {capa.reason}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-ink">{capa.title}</p>
          <p className="mt-0.5 text-xs text-ink-4">
            {capa.owner_name ? `Owner ${capa.owner_name}` : "No owner yet"}
            {others.length > 0 &&
              ` · also covers ${others.map((k) => k.deviation_no).join(", ")}`}
          </p>
        </div>
        {factoryId && (
          <button
            type="button"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-ink-3 shadow-soft transition hover:border-danger hover:text-danger-deep disabled:opacity-60"
          >
            {unlink.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Unlink className="size-3.5" />
            )}
            Unlink
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Target date">
          <span className={cn(capa.is_overdue && "font-semibold text-danger-deep")}>
            {formatDate(capa.target_date)}
          </span>
        </Fact>
      </dl>
    </div>
  );
}

const SUBMIT =
  "inline-flex h-9 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-3.5 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60";

function Submit({
  pending,
  label,
  note,
}: {
  pending: boolean;
  label: string;
  note?: string;
}) {
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
