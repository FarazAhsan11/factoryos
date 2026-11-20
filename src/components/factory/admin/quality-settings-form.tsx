"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  qualitySettingsSchema,
  type QualitySettingsValues,
} from "@/app/factory/[slug]/admin/schemas";
import { EmptyState, FIELD, PANEL, TD, TH } from "@/components/factory/admin/settings-ui";
import { formatDateTime } from "@/lib/factory/dates";
import {
  DEFAULT_QUALITY_SETTINGS,
  fetchQualitySettings,
  fetchQualitySettingsLog,
  qualitySettingsKeys,
  saveQualitySettings,
} from "@/lib/factory/quality-settings-queries";
import { useForm } from "@/lib/use-form";
import { cn } from "@/lib/utils";

const LABEL = "text-xs font-medium text-ink-3";

/**
 * Configuration → Quality settings — the reference QMS's (qms-v5): per
 * factory, and every change logged at the bottom of the page.
 *
 * Due dates: the days a case has to close, by class (set when its initial
 * assessment is signed), and the days QA has to sign that assessment (the
 * case's "Assess by"). Saved browser-direct under RLS; the database stamps
 * who and when and writes the change log.
 */
export function QualitySettingsForm({
  factoryId,
  canManage,
}: {
  factoryId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const {
    data,
    isPending,
    isError,
    error: loadError,
  } = useQuery({
    queryKey: qualitySettingsKeys.all(factoryId),
    queryFn: () => fetchQualitySettings(factoryId),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<QualitySettingsValues>({
    resolver: zodResolver(qualitySettingsSchema),
    defaultValues: DEFAULT_QUALITY_SETTINGS,
  });

  // The query resolves after first paint, so re-baseline once it lands —
  // otherwise the saved days would never reach the inputs.
  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const save = useMutation({
    mutationFn: async (values: QualitySettingsValues) => {
      await saveQualitySettings(factoryId, values);
      return values;
    },
    onSuccess: async (values) => {
      setError(null);
      reset(values);
      // The settings (the assessment and the case header read them) and the
      // change log the save just wrote.
      await queryClient.invalidateQueries({
        queryKey: qualitySettingsKeys.all(factoryId),
      });
      toast.success("Quality settings saved.");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isPending) {
    return (
      <div className="h-[22rem] animate-pulse rounded-2xl border border-line-soft bg-sunken" />
    );
  }
  if (isError) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
        Could not load the quality settings: {(loadError as Error).message}
      </p>
    );
  }

  const dayInput = (name: keyof QualitySettingsValues, max: number) => (
    <input
      type="number"
      min={1}
      max={max}
      step={1}
      inputMode="numeric"
      disabled={!canManage}
      aria-invalid={Boolean(errors[name])}
      className={cn(FIELD, "tabular-nums")}
      {...register(name, { valueAsNumber: true })}
    />
  );

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={handleSubmit((values) => {
          setError(null);
          save.mutate(values);
        })}
        className="space-y-5 rounded-2xl border border-line bg-surface p-6"
      >
        <div>
          <h3 className="text-sm font-semibold text-ink">Due dates</h3>
          <p className="mt-0.5 text-xs text-ink-5">
            Signing a case&rsquo;s initial assessment sets its due date: the
            raise date plus the days for its class. A change here applies to
            cases assessed after it — due dates already set stay as they were.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Critical — days to close"
            hint="Default 15"
            error={errors.dueCriticalDays?.message}
          >
            {dayInput("dueCriticalDays", 365)}
          </Field>
          <Field
            label="Major — days to close"
            hint="Default 30"
            error={errors.dueMajorDays?.message}
          >
            {dayInput("dueMajorDays", 365)}
          </Field>
          <Field
            label="Minor — days to close"
            hint="Default 60"
            error={errors.dueMinorDays?.message}
          >
            {dayInput("dueMinorDays", 365)}
          </Field>
          <Field
            label="Initial assessment — days"
            hint="Time QA has to assess a new case (default 2). Shown as “Assess by” until it is signed."
            error={errors.assessDays?.message}
          >
            {dayInput("assessDays", 30)}
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-deep"
          >
            {error}
          </p>
        )}

        {canManage && (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={save.isPending || !isDirty}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-brand-bright)_0%,var(--color-brand)_100%)] px-4 text-sm font-semibold text-white shadow-brand transition hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            {isDirty && !save.isPending && (
              <span className="text-xs text-ink-5">Unsaved changes</span>
            )}
          </div>
        )}
      </form>

      <ChangeLog factoryId={factoryId} />
    </div>
  );
}

/** Every change to these settings, newest first — written by the database. */
function ChangeLog({ factoryId }: { factoryId: string }) {
  const { data: rows = [], isPending, isError, error } = useQuery({
    queryKey: qualitySettingsKeys.log(factoryId),
    queryFn: () => fetchQualitySettingsLog(factoryId),
  });

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-ink">Settings change log</h3>
      {isPending ? (
        <Loader2 className="size-5 animate-spin text-ink-5" />
      ) : isError ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-deep">
          Could not load the change log: {(error as Error).message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No changes yet." className="py-10" />
      ) : (
        <div className={cn(PANEL, "overflow-x-auto")}>
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Who</th>
                <th className={TH}>Setting</th>
                <th className={TH}>From</th>
                <th className={TH}>To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={cn(TD, "whitespace-nowrap text-ink-3 tabular-nums")}>
                    {formatDateTime(r.at)}
                  </td>
                  <td className={cn(TD, "text-ink-2")}>{r.actor_name ?? "—"}</td>
                  <td className={cn(TD, "text-ink")}>{r.setting}</td>
                  <td className={cn(TD, "text-ink-4 tabular-nums")}>{r.old_value ?? "—"}</td>
                  <td className={cn(TD, "text-ink tabular-nums")}>{r.new_value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {error ? (
        <p className="text-xs text-danger-deep">{error}</p>
      ) : (
        hint && <p className="text-xs text-ink-5">{hint}</p>
      )}
    </div>
  );
}
